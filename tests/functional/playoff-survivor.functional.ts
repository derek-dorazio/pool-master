import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getContest,
  getEventBracket,
  getSurvivorLeaderboard,
  listEventParticipants,
  listEvents,
  listSportLeagues,
  openContest,
  saveGamePicks,
  submitGamePicks,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestEntryStatus, ContestFormat, ContestStatus, PredictedResult, SelectionType, Sport, SurvivorWeekOutcome } from '@poolmaster/shared/domain';
import { SportEventBracketResponseSchema, SurvivorLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { enterSeedRound, oneEventOf, placeSeedRound, playedSeedEvent } from '../support/sport-test-seed';

// Playoff survivor end to end over HTTP (#785), on the 2026 NFL playoffs as played: four rounds,
// the 1 seeds on a bye, the Divisional round and the conference championships placed by reseeding.
// Each round is a week of the survivor pool. The seed loads released and unplayed, a commissioner
// runs a survivor contest on it, four teams enter, and each round's real results go in after its
// picks.
//
// - Alice picks the Bills, Broncos, Patriots and Seahawks, every one a winner: still in at the end.
// - Bob picks the Chargers, who lose on Wild Card weekend: out in week 1.
// - Cara picks the Rams and leaves the Divisional round without a pick: out in week 2.
// - Dan picks the 49ers, Patriots and Seahawks, then meets a Super Bowl of two teams he has used:
//   both picks are refused, and he is out in week 4.

const RUN = `playoff-survivor-${Date.now()}`;
const FILE = 'american-football-2026-nfl-playoffs-test.json';
const SEASON = 2094;

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = (await db.sportEvent.findMany({ where: { name: { contains: RUN } }, select: { id: true } })).map((event) => event.id);
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
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

type Client = Awaited<ReturnType<typeof buildRegisteredUser>>['client'];

describe('SDK Functional: a playoff survivor pool on the NFL playoffs (#785)', () => {
  it('takes one pick per round, never the same team twice, puts an entry out after a loss, an empty round or a round with no unused team, and completes on rounds survived', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Playoff Survivor Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    // --- The NFL playoffs, released and unplayed ---------------------------------------------------
    const seed = oneEventOf(FILE, 'NFL', 'NFL Playoffs', { withoutResults: true })(RUN, SEASON);
    await loadSportData(seed, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });
    const played = playedSeedEvent(FILE, 'NFL', 'NFL Playoffs');
    const nfl = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AMERICAN_FOOTBALL } })).data).sportLeagues
      .find((row) => row.name === 'NFL'), 'the NFL');
    const eventId = expectDefined(expectDefined((await listEvents({ client: a, query: { sportLeagueId: nfl.id } })).data).events
      .find((row) => row.name === seed.sportLeagues[0].events[0].name), 'the playoffs').id;
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const playerName = new Map(seed.sportLeagues[0].players.map((player) => [player.key.replace(`${RUN}-`, ''), player.name]));
    const rowOf = (key: string) => expectDefined(field.find((row) => row.participant.name === playerName.get(key)), key).id;
    /** A pick of the team in its game of `roundNumber`, as the bracket now stands. */
    const pickOf = async (roundNumber: number, key: string) => {
      const bracket = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId } })).data).matches;
      const team = rowOf(key);
      const game = expectDefined(bracket.find((match) => match.roundNumber === roundNumber
        && (match.homeSportEventParticipantId === team || match.awaySportEventParticipantId === team)), `${key}'s round ${roundNumber} game`);
      return { sportEventMatchId: game.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: team };
    };

    // --- A survivor contest on the playoffs, entered by four teams ---------------------------------
    // Only Wild Card weekend's teams are known: the later rounds' come from the results.
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Playoff Survivor Alice', leagueName: `Playoff Survivor ${RUN}` });
    const join = async (displayName: string) => {
      const member = await buildRegisteredUser({ displayName });
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
      return member;
    };
    const players = { alice: commissioner, bob: await join('Playoff Survivor Bob'), cara: await join('Playoff Survivor Cara'), dan: await join('Playoff Survivor Dan') };
    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Playoff Survivor ${RUN}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.SURVIVOR,
        configuration: { selectionType: SelectionType.SURVIVOR, maxEntriesPerSquad: 1 },
      },
    });
    expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const entries = {} as Record<keyof typeof players, string>;
    for (const [name, player] of Object.entries(players) as Array<[keyof typeof players, { client: Client }]>) {
      entries[name] = expectDefined((await enterContest({ client: player.client, path: { contestId } })).data).entry.id;
    }
    const path = (name: keyof typeof players) => ({ contestId, entryId: entries[name], sportEventId: eventId });
    const save = async (name: keyof typeof players, roundNumber: number, key: string) =>
      saveGamePicks({ client: players[name].client, path: path(name), body: { picks: [await pickOf(roundNumber, key)] } });
    const board = async () => {
      const read = await getSurvivorLeaderboard({ client: players.bob.client, path: { contestId } });
      const leaderboard = expectMatchesSchema(SurvivorLeaderboardResponseSchema, read.data);
      return {
        weeks: leaderboard.weeks.map((week) => [week.weekNumber, week.roundNumber, week.roundCount]),
        entries: Object.fromEntries(leaderboard.entries.map((entry) => [entry.entryId, [
          entry.displayPosition, entry.alive, entry.eliminatedInWeek, entry.weeksSurvived, entry.weeks.map((week) => week.outcome),
        ]])),
      };
    };
    const playRound = async (roundNumber: number) => enterSeedRound(a, eventId, played, roundNumber);
    const placeRound = async (roundNumber: number) => placeSeedRound(a, eventId, played, roundNumber);

    // --- Wild Card weekend: one pick each, then the playoffs are submitted --------------------------
    expectFunctionalError(await submitGamePicks({ client: players.alice.client, path: path('alice') }), { status: 409, code: 'PREDICTION_ONE_PICK_REQUIRED' });
    // A 1 seed is on a bye: it has no Wild Card game to pick.
    expectFunctionalError(
      await saveGamePicks({ client: players.alice.client, path: path('alice'), body: { picks: [{ ...(await pickOf(1, 'nfl-buffalo-bills')), sportEventParticipantId: rowOf('nfl-denver-broncos') }] } }),
      { status: 400, code: 'PREDICTION_TEAM_NOT_IN_GAME' },
    );
    for (const [name, key] of [['alice', 'nfl-buffalo-bills'], ['bob', 'nfl-los-angeles-chargers'], ['cara', 'nfl-los-angeles-rams'], ['dan', 'nfl-san-francisco-49ers']] as const) {
      expect((await save(name, 1, key)).error).toBeUndefined();
      expect((await submitGamePicks({ client: players[name].client, path: path(name) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
    }
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    await playRound(1);

    const afterWildCard = await board();
    expect(afterWildCard.weeks).toEqual([[1, 1, 4], [2, 2, 4], [3, 3, 4], [4, 4, 4]]);
    expect(afterWildCard.entries[entries.bob]).toEqual(['4', false, 1, 0, [SurvivorWeekOutcome.ELIMINATED, null, null, null]]);

    // --- The Divisional round, reseeded --------------------------------------------------------------
    await placeRound(2);
    expectFunctionalError(await save('alice', 2, 'nfl-buffalo-bills'), { status: 409, code: 'PREDICTION_TEAM_ALREADY_USED' });
    expectFunctionalError(await save('bob', 2, 'nfl-denver-broncos'), { status: 409, code: 'PREDICTION_ENTRY_ELIMINATED' });
    // Alice changes her mind: the Broncos replace the Patriots, and her Wild Card pick stays.
    await save('alice', 2, 'nfl-new-england-patriots');
    const aliceRound2 = await save('alice', 2, 'nfl-denver-broncos');
    expect(expectDefined(aliceRound2.data).games.filter((game) => game.pick !== null).map((game) => game.pick?.sportEventParticipantId))
      .toEqual([rowOf('nfl-buffalo-bills'), rowOf('nfl-denver-broncos')]);
    await save('dan', 2, 'nfl-new-england-patriots');
    await playRound(2);

    // --- The conference championships and the Super Bowl ----------------------------------------------
    await placeRound(3);
    await save('alice', 3, 'nfl-new-england-patriots');
    await save('dan', 3, 'nfl-seattle-seahawks');
    await playRound(3);
    await save('alice', 4, 'nfl-seattle-seahawks');
    // Dan has used both Super Bowl teams.
    expectFunctionalError(await save('dan', 4, 'nfl-seattle-seahawks'), { status: 409, code: 'PREDICTION_TEAM_ALREADY_USED' });
    expectFunctionalError(await save('dan', 4, 'nfl-new-england-patriots'), { status: 409, code: 'PREDICTION_TEAM_ALREADY_USED' });
    await playRound(4);
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: players.bob.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);

    const { SURVIVED: S, ELIMINATED: E } = SurvivorWeekOutcome;
    expect((await board()).entries).toEqual({
      [entries.alice]: ['1', true, null, 4, [S, S, S, S]],
      [entries.dan]: ['2', false, 4, 3, [S, S, S, E]],
      [entries.cara]: ['3', false, 2, 1, [S, E, null, null]],
      [entries.bob]: ['4', false, 1, 0, [E, null, null, null]],
    });
    const settled = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId }, orderBy: { position: 'asc' } });
    expect(settled.map((standing) => [standing.contestEntryId, standing.totalScore, standing.displayPosition])).toEqual([
      [entries.alice, 4, '1'],
      [entries.dan, 3, '2'],
      [entries.cara, 1, '3'],
      [entries.bob, 0, '4'],
    ]);
  }, 120_000);
});
