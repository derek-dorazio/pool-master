import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createContest,
  createEvent,
  createParticipant,
  createSportLeague,
  enterContest,
  generateInviteLink,
  getContest,
  getEventBracket,
  getGamePicks,
  getPickEmLeaderboard,
  getSurvivorLeaderboard,
  listEventParticipants,
  listSports,
  loadEventBracket,
  openContest,
  recordEventMatchResult,
  releaseEvent,
  saveGamePicks,
  submitGamePicks,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  SelectionType,
  Sport,
  SurvivorWeekOutcome,
  findSportRow,
} from '@poolmaster/shared/domain';
import {
  GamePicksResponseSchema,
  SportEventBracketResponseSchema,
  SurvivorLeaderboardResponseSchema,
  type SurvivorLeaderboardResponse,
} from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { standardEventPricing } from '../support/budget-pricing';
import { expectMatchesSchema } from '../support/expect-matches-schema';

// A two-week survivor season end to end over HTTP (#719). An admin releases two weeks, each four
// unlinked basketball games between the same eight teams. A commissioner runs a survivor contest
// over both weeks, and three teams enter.
//
// Week 1: Alice picks Duke, Bob Vermont, Cara Houston. A save of two picks is refused, and a new
// pick replaces the entry's old one. Duke and Houston win: Bob is out.
//
// Week 2: Alice may not pick Duke again, so she picks Purdue; Bob, out, may not pick at all; Cara
// leaves her week in draft past kickoff, which puts her out. Purdue wins and the contest
// completes with weeks survived as the total: Alice 2, Cara 1, Bob 0.
//
// Every date is fixed in 2099, so the server's real clock never reaches either week: the admin
// starts and completes each by status, and a game's recorded result is what kicks it off.

const RUN = `survivor-season-${Date.now()}`;
const TEAMS = ['Duke', 'Vermont', 'Houston', 'Texas', 'Purdue', 'Akron', 'Baylor', 'Colgate'];

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.contestEntryMatchPrediction.deleteMany({ where: { sportEventMatch: { sportEventId: { in: eventIds } } } });
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.sportEventMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
  if (created.sportLeagueIds.size) {
    await db.sportLeague.deleteMany({ where: { id: { in: [...created.sportLeagueIds] } } });
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

type Client = Awaited<ReturnType<typeof buildRegisteredUser>>['client'];
type Side = 'home' | 'away';

/** A released week on `sportLeagueId`: four unlinked games, Duke-Vermont, Houston-Texas, Purdue-Akron, Baylor-Colgate. */
async function releasedWeek(a: Client, sportLeagueId: string, teamIds: readonly string[], name: string, startDate: string) {
  const event = await createEvent({
    client: a,
    body: { sportLeagueId, eventYear: 2099, name: `${name} ${RUN}`, startDate, rounds: 1, autoLifecycleEnabled: false },
  });
  const eventId = expectDefined(event.data, JSON.stringify(event.error)).event.id;
  created.sportEventIds.add(eventId);
  expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: [...teamIds] } })).data?.added).toBe(TEAMS.length);
  // Release asks every event for its roster setup too: seeds, tiers and prices.
  expect((await applyEventParticipantUpload({
    client: a,
    path: { eventId },
    body: { rows: TEAMS.map((team, index) => ({ playerName: `${team} ${RUN}`, seedNumber: index + 1, oddsToWin: 2 + index * 5 })) },
  })).response.status).toBe(200);
  expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS', tierSize: 2 } })).response.status).toBe(200);
  expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
  const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
  const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === `${team} ${RUN}`), team).id;

  const loaded = await loadEventBracket({
    client: a,
    path: { eventId },
    body: {
      matches: [0, 1, 2, 3].map((index) => ({
        matchNumber: index + 1,
        roundNumber: 1,
        homeSportEventParticipantId: rowOf(expectDefined(TEAMS[index * 2])),
        awaySportEventParticipantId: rowOf(expectDefined(TEAMS[index * 2 + 1])),
        isNeutralSite: false,
        scheduledDate: startDate,
        advancesTo: null,
      })),
    },
  });
  expect([loaded.error, loaded.response.status]).toEqual([undefined, 200]);
  const released = await releaseEvent({ client: a, path: { eventId } });
  expect([released.error, released.data?.event.status]).toEqual([undefined, 'SCHEDULED']);

  const games = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
  const game = (matchNumber: number) => expectDefined(games.find((match) => match.matchNumber === matchNumber), `game ${matchNumber}`);
  /** A pick of game `matchNumber`'s home or away team. */
  const pick = (matchNumber: number, side: Side) => ({
    sportEventMatchId: game(matchNumber).id,
    sportEventParticipantId: expectDefined(side === 'home' ? game(matchNumber).homeSportEventParticipantId : game(matchNumber).awaySportEventParticipantId),
  });
  /** The admin enters game `matchNumber`'s result: `side` wins it. */
  const result = async (matchNumber: number, side: Side) => {
    const recorded = await recordEventMatchResult({
      client: a,
      path: { eventId, matchNumber },
      body: side === 'home' ? { winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 60 } : { winnerSide: MatchSide.AWAY, homeScore: 60, awayScore: 70 },
    });
    expect([recorded.error, recorded.response.status]).toEqual([undefined, 200]);
  };
  return { eventId, gameId: (matchNumber: number) => game(matchNumber).id, pick, result };
}

describe('SDK Functional: a survivor season (#719)', () => {
  it('puts an entry out after a loss or a week left in draft, refuses a team picked before and any pick of an entry that is out, and completes the contest on weeks survived', async () => {
    const db = getFunctionalPrisma();
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await db.sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Survivor Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- Two released weeks of the same four games -----------------------------------------------
    const conference = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Survivor Conference ${RUN}` } });
    const sportLeagueId = expectDefined(conference.data, JSON.stringify(conference.error)).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const teamIds: string[] = [];
    for (const team of TEAMS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `${team} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    const week1 = await releasedWeek(a, sportLeagueId, teamIds, 'Survivor Week 1', '2099-09-10T17:00:00.000Z');
    const week2 = await releasedWeek(a, sportLeagueId, teamIds, 'Survivor Week 2', '2099-09-17T17:00:00.000Z');

    // --- A survivor contest over both weeks, entered by three teams ------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Survivor Commissioner', leagueName: `Survivor Pool ${RUN}` });
    const join = async (displayName: string) => {
      const member = await buildRegisteredUser({ displayName });
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
      return member;
    };
    const alice = commissioner;
    const bob = await join('Survivor Bob');
    const cara = await join('Survivor Cara');
    const contest = await createContest({
      client: alice.client,
      path: { id: league.id },
      body: {
        name: `Survivor ${RUN}`,
        sportEventIds: [week1.eventId, week2.eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.SURVIVOR,
        configuration: { selectionType: SelectionType.SURVIVOR, maxEntriesPerSquad: 1 },
      },
    });
    expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: alice.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const entryOf = async (client: Client) => expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
    const entries = { alice: await entryOf(alice.client), bob: await entryOf(bob.client), cara: await entryOf(cara.client) };
    const path = (week: { eventId: string }, entryId: string) => ({ contestId, entryId, sportEventId: week.eventId });
    const contestStatus = async () => expectDefined((await getContest({ client: bob.client, path: { contestId } })).data).contest.status;

    const leaderboard = async (): Promise<SurvivorLeaderboardResponse> => {
      const read = await getSurvivorLeaderboard({ client: cara.client, path: { contestId } });
      expect([read.error, read.response.status]).toEqual([undefined, 200]);
      return expectMatchesSchema(SurvivorLeaderboardResponseSchema, read.data);
    };
    /** Each entry's place, whether it is in, the week it went out, its weeks survived and each week's outcome, keyed by entry. */
    const board = async () => Object.fromEntries((await leaderboard()).entries.map((entry) => [entry.entryId, [
      entry.displayPosition, entry.alive, entry.eliminatedInWeek, entry.weeksSurvived, entry.weeks.map((week) => week.outcome),
    ]]));

    // --- Week 1: one pick each ---------------------------------------------------------------------
    expectFunctionalError(
      await saveGamePicks({ client: alice.client, path: path(week1, entries.alice), body: { picks: [week1.pick(1, 'home'), week1.pick(2, 'home')] } }),
      { status: 409, code: 'PREDICTION_ONE_PICK_REQUIRED' },
    );
    // Alice picks Houston, then Duke in its place.
    await saveGamePicks({ client: alice.client, path: path(week1, entries.alice), body: { picks: [week1.pick(2, 'home')] } });
    const aliceWeek1 = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({
      client: alice.client, path: path(week1, entries.alice), body: { picks: [week1.pick(1, 'home')] },
    })).data);
    expect(aliceWeek1).toMatchObject({
      selectionType: SelectionType.SURVIVOR, mode: null, pickedCount: 1, tiebreakerMatchId: null, canSubmit: true,
      survivor: { eliminatedInWeek: null, usedParticipantIds: [] },
    });
    expect(aliceWeek1.games.flatMap((game) => (game.pick ? [game.sportEventMatchId] : []))).toEqual([week1.gameId(1)]);
    for (const [client, entryId, pick] of [
      [alice.client, entries.alice, week1.pick(1, 'home')],
      [bob.client, entries.bob, week1.pick(1, 'away')],
      [cara.client, entries.cara, week1.pick(2, 'home')],
    ] as const) {
      await saveGamePicks({ client, path: path(week1, entryId), body: { picks: [pick] } });
      expect((await submitGamePicks({ client, path: path(week1, entryId) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    }
    // A survivor pool has its own leaderboard: the pick'em one refuses it.
    expectFunctionalError(await getPickEmLeaderboard({ client: bob.client, path: { contestId } }), { status: 400, code: 'CONTEST_FORMAT_MISMATCH' });

    // --- Week 1 plays: Duke and Houston win, so Bob's Vermont is out ------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: week1.eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    expect(await contestStatus()).toBe(ContestStatus.ACTIVE);
    await week1.result(1, 'home');
    await week1.result(2, 'home');
    await week1.result(3, 'home');
    await week1.result(4, 'home');
    expect(await board()).toEqual({
      [entries.alice]: ['T1', true, null, 1, [SurvivorWeekOutcome.SURVIVED, null]],
      [entries.cara]: ['T1', true, null, 1, [SurvivorWeekOutcome.SURVIVED, null]],
      [entries.bob]: ['3', false, 1, 0, [SurvivorWeekOutcome.ELIMINATED, null]],
    });
    expect((await transitionEvent({ client: a, path: { eventId: week1.eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(await contestStatus()).toBe(ContestStatus.ACTIVE);
    const frozenWeek1 = await db.contestEntryEventStanding.findMany({ where: { contestId, sportEventId: week1.eventId } });
    expect(Object.fromEntries(frozenWeek1.map((standing) => [standing.contestEntryId, [standing.totalScore, standing.displayPosition]]))).toEqual({
      [entries.alice]: [1, 'T1'],
      [entries.cara]: [1, 'T1'],
      [entries.bob]: [0, '3'],
    });

    // --- Week 2: Duke is used up for Alice, and Bob is out -----------------------------------------
    const aliceWeek2 = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: alice.client, path: path(week2, entries.alice) })).data);
    expect(aliceWeek2.survivor?.usedParticipantIds).toEqual([teamIds[0]]);
    expectFunctionalError(
      await saveGamePicks({ client: alice.client, path: path(week2, entries.alice), body: { picks: [week2.pick(1, 'home')] } }),
      { status: 409, code: 'PREDICTION_TEAM_ALREADY_USED' },
    );
    await saveGamePicks({ client: alice.client, path: path(week2, entries.alice), body: { picks: [week2.pick(3, 'home')] } });
    expect((await submitGamePicks({ client: alice.client, path: path(week2, entries.alice) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    expectFunctionalError(
      await saveGamePicks({ client: bob.client, path: path(week2, entries.bob), body: { picks: [week2.pick(4, 'home')] } }),
      { status: 409, code: 'PREDICTION_ENTRY_ELIMINATED' },
    );
    // Cara picks Baylor and never submits.
    expect((await saveGamePicks({ client: cara.client, path: path(week2, entries.cara), body: { picks: [week2.pick(4, 'home')] } })).data?.status)
      .toBe(ContestEntryStatus.DRAFT);

    // --- Week 2 plays: Purdue wins; Cara's week left in draft at kickoff puts her out ----------------
    expect((await transitionEvent({ client: a, path: { eventId: week2.eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    await week2.result(1, 'home');
    await week2.result(2, 'home');
    await week2.result(3, 'home');
    await week2.result(4, 'home');
    expect((await transitionEvent({ client: a, path: { eventId: week2.eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(await contestStatus()).toBe(ContestStatus.COMPLETED);
    expect(await board()).toEqual({
      [entries.alice]: ['1', true, null, 2, [SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.SURVIVED]],
      [entries.cara]: ['2', false, 2, 1, [SurvivorWeekOutcome.SURVIVED, SurvivorWeekOutcome.ELIMINATED]],
      [entries.bob]: ['3', false, 1, 0, [SurvivorWeekOutcome.ELIMINATED, null]],
    });
    const frozenSeason = await db.contestEntryStanding.findMany({ where: { contestId }, orderBy: { position: 'asc' } });
    expect(frozenSeason.map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])).toEqual([
      [entries.alice, 2, '1'],
      [entries.cara, 1, '2'],
      [entries.bob, 0, '3'],
    ]);
  });
});
