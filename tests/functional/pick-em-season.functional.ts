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
  getContestLeaderboard,
  getEventBracket,
  getGamePicks,
  getPickEmLeaderboard,
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
  MatchStatus,
  PickEmMode,
  PickOutcome,
  SelectionType,
  Sport,
  findSportRow,
} from '@poolmaster/shared/domain';
import {
  GamePicksResponseSchema,
  PickEmLeaderboardResponseSchema,
  SportEventBracketResponseSchema,
  type PickEmLeaderboardResponse,
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

// A two-week confidence pick'em season end to end over HTTP (#717). An admin releases two weeks,
// each an eight-team basketball event whose four first-round games are the week (its later
// rounds are called off), the fourth game the last to kick off and so the week's tiebreaker game.
// A commissioner runs a CONFIDENCE pick'em contest over both weeks, and three teams enter.
//
// Week 1: all three teams submit, each with a tiebreaker (one is first refused for leaving it
// out). The results go in, a lost pick scoring nothing; the leaderboard shows the live points,
// unsettled and with no winner. Two teams finish level on points and the tiebreaker, the last
// game's total points, separates them. The week completes and settles: its winner is frozen and
// the contest stays ACTIVE for week 2.
//
// Week 2: two teams submit; the third leaves its week in draft past kickoff, scoring nothing for
// it. One game is a tie, which scores nobody. The week completes: the contest is COMPLETED with
// each team's season total the sum of its weeks, and a result corrected afterwards changes
// nothing.
//
// Every date is fixed in 2099, so the server's real clock never reaches either week: the admin
// starts and completes each by status, and a game's recorded result is what kicks it off.

const RUN = `pick-em-season-${Date.now()}`;
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

/**
 * A released week: an eight-team event on `sportLeagueId` whose first-round games 1 to 4 kick off
 * at `kickoffs` (game 4 last), its later rounds called off so the week is those four games.
 */
async function releasedWeek(a: Client, sportLeagueId: string, teamIds: readonly string[], name: string, kickoffs: readonly [string, string, string, string]) {
  const event = await createEvent({
    client: a,
    body: { sportLeagueId, eventYear: 2099, name: `${name} ${RUN}`, startDate: kickoffs[0], rounds: 3, autoLifecycleEnabled: false },
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

  // Games 1-4: Duke-Vermont, Houston-Texas, Purdue-Akron, Baylor-Colgate; 5 and 6 the second round, 7 the final.
  const firstRound = [0, 1, 2, 3].map((index) => ({
    matchNumber: index + 1,
    roundNumber: 1,
    homeSportEventParticipantId: rowOf(expectDefined(TEAMS[index * 2])),
    awaySportEventParticipantId: rowOf(expectDefined(TEAMS[index * 2 + 1])),
    isNeutralSite: true,
    scheduledDate: kickoffs[index] ?? null,
    advancesTo: { matchNumber: 5 + Math.floor(index / 2), side: index % 2 === 0 ? MatchSide.HOME : MatchSide.AWAY },
  }));
  const loaded = await loadEventBracket({
    client: a,
    path: { eventId },
    body: {
      matches: [
        ...firstRound,
        { matchNumber: 5, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 7, side: MatchSide.HOME } },
        { matchNumber: 6, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 7, side: MatchSide.AWAY } },
        { matchNumber: 7, roundNumber: 3, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
      ],
    },
  });
  expect([loaded.error, loaded.response.status]).toEqual([undefined, 200]);
  const released = await releaseEvent({ client: a, path: { eventId } });
  expect([released.error, released.data?.event.status]).toEqual([undefined, 'SCHEDULED']);
  // The later rounds are called off, so they are not among the week's games.
  await getFunctionalPrisma().sportEventMatch.updateMany({ where: { sportEventId: eventId, matchNumber: { gt: 4 } }, data: { status: MatchStatus.CANCELLED } });

  const bracket = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
  const game = (matchNumber: number) => expectDefined(bracket.find((match) => match.matchNumber === matchNumber), `game ${matchNumber}`);
  /** A confidence pick of game `matchNumber`'s home or away team. */
  const pick = (matchNumber: number, side: Side, confidence: number) => ({
    sportEventMatchId: game(matchNumber).id,
    sportEventParticipantId: expectDefined(side === 'home' ? game(matchNumber).homeSportEventParticipantId : game(matchNumber).awaySportEventParticipantId),
    confidence,
  });
  /** The admin enters game `matchNumber`'s result: `side` wins it, by `winnerScore` to `loserScore`. */
  const result = async (matchNumber: number, side: Side, winnerScore = 70, loserScore = 60) => {
    const winnerSide = side === 'home' ? MatchSide.HOME : MatchSide.AWAY;
    const [homeScore, awayScore] = side === 'home' ? [winnerScore, loserScore] : [loserScore, winnerScore];
    const recorded = await recordEventMatchResult({ client: a, path: { eventId, matchNumber }, body: { winnerSide, homeScore, awayScore } });
    expect([recorded.error, recorded.response.status]).toEqual([undefined, 200]);
  };
  return { eventId, gameId: (matchNumber: number) => game(matchNumber).id, pick, result };
}

describe('SDK Functional: a pick\'em season (#717)', () => {
  it('settles two confidence weeks, each with its weekly winner decided by points then the last game\'s tiebreaker, and completes the contest on season totals summed over the weeks that no later result correction moves', async () => {
    const db = getFunctionalPrisma();
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await db.sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Season Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- Two released weeks of four games -----------------------------------------------------
    const conference = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Season Conference ${RUN}` } });
    const sportLeagueId = expectDefined(conference.data, JSON.stringify(conference.error)).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const teamIds: string[] = [];
    for (const team of TEAMS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `${team} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    const week1 = await releasedWeek(a, sportLeagueId, teamIds, 'Season Week 1', [
      '2099-09-10T17:00:00.000Z', '2099-09-10T20:00:00.000Z', '2099-09-11T17:00:00.000Z', '2099-09-12T00:15:00.000Z',
    ]);
    const week2 = await releasedWeek(a, sportLeagueId, teamIds, 'Season Week 2', [
      '2099-09-17T17:00:00.000Z', '2099-09-17T20:00:00.000Z', '2099-09-18T17:00:00.000Z', '2099-09-19T00:15:00.000Z',
    ]);

    // --- A confidence pick'em contest over both weeks, entered by three teams ------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Season Commissioner', leagueName: `Season Pool ${RUN}` });
    const join = async (displayName: string) => {
      const member = await buildRegisteredUser({ displayName });
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
      return member;
    };
    const alice = commissioner;
    const bob = await join('Season Bob');
    const cara = await join('Season Cara');
    const contest = await createContest({
      client: alice.client,
      path: { id: league.id },
      body: {
        name: `Season Confidence ${RUN}`,
        sportEventIds: [week1.eventId, week2.eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.PICK_EM,
        configuration: {
          selectionType: SelectionType.PICK_EM,
          mode: PickEmMode.CONFIDENCE,
          againstTheSpread: false,
          maxEntriesPerSquad: 1,
          scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 3], upsetBonus: { rule: 'NONE' } } },
        },
      },
    });
    expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: alice.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const entryOf = async (client: Client) => expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
    const entries = { alice: await entryOf(alice.client), bob: await entryOf(bob.client), cara: await entryOf(cara.client) };
    const path = (week: { eventId: string }, entryId: string) => ({ contestId, entryId, sportEventId: week.eventId });
    const contestStatus = async () => expectDefined((await getContest({ client: bob.client, path: { contestId } })).data).contest.status;

    const leaderboard = async (): Promise<PickEmLeaderboardResponse> => {
      const read = await getPickEmLeaderboard({ client: cara.client, path: { contestId } });
      expect([read.error, read.response.status]).toEqual([undefined, 200]);
      return expectMatchesSchema(PickEmLeaderboardResponseSchema, read.data);
    };
    /**
     * Each entry's season place and total, then for each week its points, place and whether it won
     * it, keyed by entry: entries sharing a place have no order between them.
     */
    const board = async () => Object.fromEntries((await leaderboard()).entries.map((entry) => [entry.entryId, [
      entry.displayPosition, entry.totalPoints,
      entry.weeks.map((week) => [week.points, week.displayPosition, week.weeklyWinner]),
    ]]));
    /** Each week's started and settled flags, its tiebreaker game's total and its winners. */
    const weeks = async () => (await leaderboard()).weeks.map((week) => [week.sportEventId, week.started, week.settled, week.tiebreakerTotalPoints, week.winnerEntryIds]);

    // --- Week 1: each team picks all four games and gives its tiebreaker ------------------------
    // Alice: Duke 4, Houston 3, Purdue 2, Colgate 1; tiebreaker 140.
    const aliceWeek1 = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({
      client: alice.client,
      path: path(week1, entries.alice),
      body: { picks: [week1.pick(1, 'home', 4), week1.pick(2, 'home', 3), week1.pick(3, 'home', 2), week1.pick(4, 'away', 1)], tiebreakerValue: 140 },
    })).data);
    expect(aliceWeek1).toMatchObject({ mode: PickEmMode.CONFIDENCE, gameCount: 4, pickedCount: 4, tiebreakerMatchId: week1.gameId(4), tiebreakerValue: 140, canSubmit: true });
    expect((await submitGamePicks({ client: alice.client, path: path(week1, entries.alice) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    // Bob: Duke 3, Houston 4, Purdue 1, Colgate 2; tiebreaker 125.
    await saveGamePicks({
      client: bob.client,
      path: path(week1, entries.bob),
      body: { picks: [week1.pick(1, 'home', 3), week1.pick(2, 'home', 4), week1.pick(3, 'home', 1), week1.pick(4, 'away', 2)], tiebreakerValue: 125 },
    });
    expect((await submitGamePicks({ client: bob.client, path: path(week1, entries.bob) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    // Cara: Vermont 4, Houston 1, Akron 3, Baylor 2; she forgets her tiebreaker at first.
    const caraWeek1 = expectMatchesSchema(GamePicksResponseSchema, (await saveGamePicks({
      client: cara.client,
      path: path(week1, entries.cara),
      body: { picks: [week1.pick(1, 'away', 4), week1.pick(2, 'home', 1), week1.pick(3, 'away', 3), week1.pick(4, 'home', 2)] },
    })).data);
    expect(caraWeek1).toMatchObject({ pickedCount: 4, tiebreakerMatchId: week1.gameId(4), tiebreakerValue: null, canSubmit: false });
    expectFunctionalError(await submitGamePicks({ client: cara.client, path: path(week1, entries.cara) }), { status: 409, code: 'PREDICTION_TIEBREAKER_MISSING' });
    await saveGamePicks({ client: cara.client, path: path(week1, entries.cara), body: { picks: [], tiebreakerValue: 150 } });
    expect((await submitGamePicks({ client: cara.client, path: path(week1, entries.cara) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);

    // Before kickoff no week has started: nobody has points or a place.
    expect(await weeks()).toEqual([[week1.eventId, false, false, null, []], [week2.eventId, false, false, null, []]]);
    expect(await board()).toEqual({
      [entries.alice]: [null, 0, [[null, null, false], [null, null, false]]],
      [entries.bob]: [null, 0, [[null, null, false], [null, null, false]]],
      [entries.cara]: [null, 0, [[null, null, false], [null, null, false]]],
    });

    // --- Week 1 kicks off ---------------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: week1.eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    expect(await contestStatus()).toBe(ContestStatus.ACTIVE);
    // A pick'em pool has its own leaderboard: the roster one refuses it.
    expectFunctionalError(await getContestLeaderboard({ client: bob.client, path: { contestId } }), { status: 400, code: 'CONTEST_FORMAT_MISMATCH' });
    // The tiebreaker can still change until the tiebreaker game kicks off: Bob moves his to 120.
    const bobRetuned = await saveGamePicks({ client: bob.client, path: path(week1, entries.bob), body: { picks: [], tiebreakerValue: 120 } });
    expect([bobRetuned.error, bobRetuned.data?.tiebreakerValue]).toEqual([undefined, 120]);

    // Games 1 to 3: Duke and Houston win, Akron upsets Purdue.
    await week1.result(1, 'home');
    await week1.result(2, 'home');
    await week1.result(3, 'away');
    // Live, unsettled and with no winner: Alice 4 + 3, Bob 3 + 4, Cara 1 + 3; nobody has scored game 4 yet.
    expect(await weeks()).toEqual([[week1.eventId, true, false, null, []], [week2.eventId, false, false, null, []]]);
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 7, [[7, 'T1', false], [null, null, false]]],
      [entries.bob]: ['T1', 7, [[7, 'T1', false], [null, null, false]]],
      [entries.cara]: ['3', 4, [[4, '3', false], [null, null, false]]],
    });
    // Alice's lost pick on Purdue scores nothing.
    const aliceLive = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: alice.client, path: path(week1, entries.alice) })).data);
    const aliceOutcome = (matchNumber: number) => expectDefined(aliceLive.games.find((game) => game.matchNumber === matchNumber)).pick;
    expect(aliceOutcome(1)).toMatchObject({ outcome: PickOutcome.CORRECT, points: 4 });
    expect(aliceOutcome(3)).toMatchObject({ outcome: PickOutcome.BUSTED, points: 0 });
    expect(aliceOutcome(4)).toMatchObject({ outcome: PickOutcome.PENDING, points: null });

    // Game 4, the tiebreaker game: Baylor beats Colgate 70 to 66, a total of 136. Its tiebreaker is now locked.
    await week1.result(4, 'home', 70, 66);
    expectFunctionalError(
      await saveGamePicks({ client: bob.client, path: path(week1, entries.bob), body: { picks: [], tiebreakerValue: 136 } }),
      { status: 409, code: 'CONTEST_ENTRY_LOCKED' },
    );
    // Alice and Bob are level on 7; Alice's 140 is 4 away from 136, Bob's 120 is 16 away. Cara adds Baylor's 2.
    expect(await weeks()).toEqual([[week1.eventId, true, false, 136, []], [week2.eventId, false, false, null, []]]);
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 7, [[7, '1', false], [null, null, false]]],
      [entries.bob]: ['T1', 7, [[7, '2', false], [null, null, false]]],
      [entries.cara]: ['3', 6, [[6, '3', false], [null, null, false]]],
    });

    // --- Week 1 completes and settles; the contest goes on --------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: week1.eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(await contestStatus()).toBe(ContestStatus.ACTIVE);
    expect(await weeks()).toEqual([[week1.eventId, true, true, 136, [entries.alice]], [week2.eventId, false, false, null, []]]);
    // The season places are by total points only: the week's tiebreaker does not split Alice and Bob there.
    expect(await board()).toEqual({
      [entries.alice]: ['T1', 7, [[7, '1', true], [null, null, false]]],
      [entries.bob]: ['T1', 7, [[7, '2', false], [null, null, false]]],
      [entries.cara]: ['3', 6, [[6, '3', false], [null, null, false]]],
    });
    const frozenWeek1 = await db.contestEntryEventStanding.findMany({ where: { contestId, sportEventId: week1.eventId }, orderBy: { position: 'asc' } });
    expect(frozenWeek1.map((standing) => [standing.contestEntryId, standing.totalScore, standing.position, standing.displayPosition])).toEqual([
      [entries.alice, 7, 1, '1'],
      [entries.bob, 7, 2, '2'],
      [entries.cara, 6, 3, '3'],
    ]);
    expect(await db.contestEntryStanding.count({ where: { contestId } })).toBe(0);

    // --- Week 2: Alice and Bob submit; Cara leaves hers in draft -------------------------------
    // Alice: Duke 1, Houston 4, Purdue 3, Baylor 2; tiebreaker 100.
    await saveGamePicks({
      client: alice.client,
      path: path(week2, entries.alice),
      body: { picks: [week2.pick(1, 'home', 1), week2.pick(2, 'home', 4), week2.pick(3, 'home', 3), week2.pick(4, 'home', 2)], tiebreakerValue: 100 },
    });
    expect((await submitGamePicks({ client: alice.client, path: path(week2, entries.alice) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    // Bob: Duke 4, Texas 3, Akron 1, Colgate 2; tiebreaker 115.
    await saveGamePicks({
      client: bob.client,
      path: path(week2, entries.bob),
      body: { picks: [week2.pick(1, 'home', 4), week2.pick(2, 'away', 3), week2.pick(3, 'away', 1), week2.pick(4, 'away', 2)], tiebreakerValue: 115 },
    });
    expect((await submitGamePicks({ client: bob.client, path: path(week2, entries.bob) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    // Cara picks two games and never submits.
    expect((await saveGamePicks({
      client: cara.client, path: path(week2, entries.cara), body: { picks: [week2.pick(1, 'home', 4), week2.pick(2, 'home', 3)] },
    })).data?.status).toBe(ContestEntryStatus.DRAFT);

    expect((await transitionEvent({ client: a, path: { eventId: week2.eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    // Still in draft at the week's first kickoff, Cara's week can no longer change or be submitted.
    expectFunctionalError(
      await saveGamePicks({ client: cara.client, path: path(week2, entries.cara), body: { picks: [week2.pick(3, 'home', 2)], tiebreakerValue: 110 } }),
      { status: 409, code: 'CONTEST_ENTRY_LOCKED' },
    );

    // Duke wins game 1; game 2 ends level at 75, as a score feed reports a tie (no admin route
    // records a draw in a knockout), so neither pick on it scores; Purdue wins game 3; Colgate
    // wins game 4, 60 to 50, a total of 110.
    await week2.result(1, 'home');
    await db.sportEventMatch.update({
      where: { id: week2.gameId(2) },
      data: { status: MatchStatus.COMPLETED, winnerSide: null, homeScore: 75, awayScore: 75 },
    });
    await week2.result(3, 'home');
    await week2.result(4, 'away', 60, 50);
    // Alice: Duke 1 + Purdue 3. Bob: Duke 4 + Colgate 2. Cara's draft week scores nothing.
    expect(await weeks()).toEqual([[week1.eventId, true, true, 136, [entries.alice]], [week2.eventId, true, false, 110, []]]);
    expect(await board()).toEqual({
      [entries.bob]: ['1', 13, [[7, '2', false], [6, '1', false]]],
      [entries.alice]: ['2', 11, [[7, '1', true], [4, '2', false]]],
      [entries.cara]: ['3', 6, [[6, '3', false], [null, null, false]]],
    });

    // --- Week 2 completes: the last week, so the season settles and the contest completes ------
    expect((await transitionEvent({ client: a, path: { eventId: week2.eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(await contestStatus()).toBe(ContestStatus.COMPLETED);
    const finalBoard = {
      [entries.bob]: ['1', 13, [[7, '2', false], [6, '1', true]]],
      [entries.alice]: ['2', 11, [[7, '1', true], [4, '2', false]]],
      [entries.cara]: ['3', 6, [[6, '3', false], [null, null, false]]],
    };
    expect(await weeks()).toEqual([[week1.eventId, true, true, 136, [entries.alice]], [week2.eventId, true, true, 110, [entries.bob]]]);
    expect(await board()).toEqual(finalBoard);
    const settled = await leaderboard();
    expect(settled.entries.map((entry) => [entry.entryId, entry.position, entry.weeks.map((week) => week.submitted)])).toEqual([
      [entries.bob, 1, [true, true]],
      [entries.alice, 2, [true, true]],
      [entries.cara, 3, [true, false]],
    ]);
    // Each season total is the sum of its weeks.
    for (const entry of settled.entries) {
      expect(entry.totalPoints).toBe(entry.weeks.reduce((sum, week) => sum + (week.points ?? 0), 0));
    }
    const frozenSeason = await db.contestEntryStanding.findMany({ where: { contestId }, orderBy: { position: 'asc' } });
    expect(frozenSeason.map((standing) => [standing.contestEntryId, standing.totalScore, standing.position, standing.displayPosition])).toEqual([
      [entries.bob, 13, 1, '1'],
      [entries.alice, 11, 2, '2'],
      [entries.cara, 6, 3, '3'],
    ]);

    // --- A result corrected after settlement changes nothing ------------------------------------
    // Week 1's game 3 goes to Purdue after all: live, Alice would gain 2 and Bob 1, and Cara lose 3.
    await week1.result(3, 'home');
    expect(await contestStatus()).toBe(ContestStatus.COMPLETED);
    expect(await board()).toEqual(finalBoard);
    const frozenWeek1After = await db.contestEntryEventStanding.findMany({ where: { contestId, sportEventId: week1.eventId }, orderBy: { position: 'asc' } });
    expect(frozenWeek1After.map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])).toEqual([
      [entries.alice, 7, '1'],
      [entries.bob, 7, '2'],
      [entries.cara, 6, '3'],
    ]);
  });
});
