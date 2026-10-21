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
  updateEventBracketMatch,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  MatchSide,
  ParticipantStandingStatus,
  PickEmMode,
  PickOutcome,
  PredictedResult,
  SelectionType,
  Sport,
  findSportRow,
} from '@poolmaster/shared/domain';
import {
  GamePicksResponseSchema,
  PickEmLeaderboardResponseSchema,
  SportEventBracketResponseSchema,
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

// A pick'em week scored against the spread end to end over HTTP (#720). An admin releases a week of
// four unlinked basketball games and sets three spreads; a straight-up pool against the spread is
// refused until the fourth is set too. Two teams enter and pick, and one game's spread is then
// refused a change because it has picks.
//
// Spreads, from the home side, and results:
//   game 1: Duke -3.5 beats Vermont by 3        -> Vermont covers
//   game 2: Houston +6.5 loses to Texas by 4    -> Houston covers
//   game 3: Purdue -3 beats Akron by 3          -> push, worth nothing to either side
//   game 4: Baylor PK beats Colgate by 10       -> Baylor covers
//
// Alice picks every home team: game 2 and game 4 cover, game 3 pushes, so 2 points. Bob picks
// every away team: game 1 covers, game 3 pushes, so 1 point, though his teams won only one game.
//
// Every date is fixed in 2099, so the server's real clock never reaches the week: the admin
// starts and completes it by status.

const RUN = `pick-em-ats-${Date.now()}`;
const TEAMS = ['Duke', 'Vermont', 'Houston', 'Texas', 'Purdue', 'Akron', 'Baylor', 'Colgate'];
const START = '2099-09-10T17:00:00.000Z';

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

describe('SDK Functional: a pick\'em week against the spread (#720)', () => {
  it('needs every spread before a pool against the spread is built, locks a picked game\'s spread, and scores the team that covers with a game on the spread a push', async () => {
    const db = getFunctionalPrisma();
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await db.sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Spread Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.BASKETBALL)).id;

    // --- A released week of four games ------------------------------------------------------------
    const conference = await createSportLeague({ client: a, body: { sport: Sport.BASKETBALL, name: `Spread Conference ${RUN}` } });
    const sportLeagueId = expectDefined(conference.data, JSON.stringify(conference.error)).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const teamIds: string[] = [];
    for (const team of TEAMS) {
      const participant = await createParticipant({ client: a, body: { sportId, participantType: 'TEAM', name: `${team} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      teamIds.push(id);
    }
    const event = await createEvent({
      client: a,
      body: { sportLeagueId, eventYear: 2099, name: `Spread Week ${RUN}`, startDate: START, rounds: 1, autoLifecycleEnabled: false },
    });
    const eventId = expectDefined(event.data, JSON.stringify(event.error)).event.id;
    created.sportEventIds.add(eventId);
    expect((await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: teamIds } })).data?.added).toBe(TEAMS.length);
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
          scheduledDate: START,
          advancesTo: null,
        })),
      },
    });
    expect([loaded.error, loaded.response.status]).toEqual([undefined, 200]);
    const released = await releaseEvent({ client: a, path: { eventId } });
    expect([released.error, released.data?.event.status]).toEqual([undefined, 'SCHEDULED']);

    const setSpread = (matchNumber: number, homeSpread: number | null) =>
      updateEventBracketMatch({ client: a, path: { eventId, matchNumber }, body: { homeSpread } });
    for (const [matchNumber, homeSpread] of [[1, -3.5], [2, 6.5], [3, -3]] as const) {
      const set = await setSpread(matchNumber, homeSpread);
      expect([set.error, set.data?.match.homeSpread]).toEqual([undefined, homeSpread]);
    }
    expectFunctionalError(
      await updateEventBracketMatch({ client: a, path: { eventId, matchNumber: 4 }, body: { homeSpread: 2.25 } }),
      { status: 400, code: 'FST_ERR_VALIDATION' },
    );
    const games = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
    const game = (matchNumber: number) => expectDefined(games.find((match) => match.matchNumber === matchNumber), `game ${matchNumber}`);
    const pick = (matchNumber: number, side: Side) => ({
      sportEventMatchId: game(matchNumber).id,
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: expectDefined(side === 'home' ? game(matchNumber).homeSportEventParticipantId : game(matchNumber).awaySportEventParticipantId),
    });

    // --- A pool against the spread waits on the last spread -------------------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Spread Commissioner', leagueName: `Spread Pool ${RUN}` });
    const alice = commissioner;
    const bob = await buildRegisteredUser({ displayName: 'Spread Bob' });
    const invite = await generateInviteLink({ client: alice.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: bob.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const createAts = () => createContest({
      client: alice.client,
      path: { id: league.id },
      body: {
        name: `Against the Spread ${RUN}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.PICK_EM,
        configuration: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true, maxEntriesPerSquad: 1 },
      },
    });
    expectFunctionalError(await createAts(), { status: 422, code: 'CONTEST_EVENT_SPREAD_MISSING' });
    expect((await setSpread(4, 0)).data?.match.homeSpread).toBe(0);
    const contest = await createAts();
    expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: alice.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const entryOf = async (client: Client) => expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
    const entries = { alice: await entryOf(alice.client), bob: await entryOf(bob.client) };
    const path = (entryId: string) => ({ contestId, entryId, sportEventId: eventId });

    // --- Picks: the week screen carries each spread ---------------------------------------------
    const aliceWeek = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: alice.client, path: path(entries.alice) })).data);
    expect(aliceWeek.againstTheSpread).toBe(true);
    expect(aliceWeek.games.map((each) => [each.matchNumber, each.homeSpread])).toEqual([[1, -3.5], [2, 6.5], [3, -3], [4, 0]]);
    for (const [client, entryId, side, tiebreakerValue] of [
      [alice.client, entries.alice, 'home', 140],
      [bob.client, entries.bob, 'away', 120],
    ] as const) {
      await saveGamePicks({ client, path: path(entryId), body: { picks: [1, 2, 3, 4].map((matchNumber) => pick(matchNumber, side)), tiebreakerValue } });
      expect((await submitGamePicks({ client, path: path(entryId) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    }

    // A picked game's spread is fixed: a correction now would change picks already made.
    expectFunctionalError(await setSpread(1, -4), { status: 409, code: 'MATCH_SPREAD_LOCKED' });

    // --- The week plays and settles against the spread ------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    for (const [matchNumber, homeScore, awayScore] of [[1, 70, 67], [2, 60, 64], [3, 73, 70], [4, 80, 70]] as const) {
      const recorded = await recordEventMatchResult({
        client: a,
        path: { eventId, matchNumber },
        body: { winnerSide: homeScore > awayScore ? MatchSide.HOME : MatchSide.AWAY, homeScore, awayScore },
      });
      expect([recorded.error, recorded.response.status]).toEqual([undefined, 200]);
    }
    // A week has no winner of its own (#768): every team's game is played, none is ranked.
    const weekField = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    expect(weekField.map((row) => [row.standing?.position, row.standing?.displayPosition, row.standing?.status])).toEqual(
      TEAMS.map(() => [null, null, ParticipantStandingStatus.COMPLETE]),
    );
    const outcomes = async (client: Client, entryId: string) => expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client, path: path(entryId) })).data)
      .games.map((each) => [each.matchNumber, each.pick?.outcome, each.pick?.points]);
    expect(await outcomes(alice.client, entries.alice)).toEqual([
      [1, PickOutcome.BUSTED, 0],
      [2, PickOutcome.CORRECT, 1],
      [3, PickOutcome.PUSH, 0],
      [4, PickOutcome.CORRECT, 1],
    ]);
    expect(await outcomes(bob.client, entries.bob)).toEqual([
      [1, PickOutcome.CORRECT, 1],
      [2, PickOutcome.BUSTED, 0],
      [3, PickOutcome.PUSH, 0],
      [4, PickOutcome.BUSTED, 0],
    ]);

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    const board = expectMatchesSchema(PickEmLeaderboardResponseSchema, (await getPickEmLeaderboard({ client: bob.client, path: { contestId } })).data);
    expect(board).toMatchObject({ mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true });
    expect(board.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalPoints])).toEqual([
      [entries.alice, '1', 2],
      [entries.bob, '2', 1],
    ]);
  });
});
