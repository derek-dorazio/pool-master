import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  cancelEventMatch,
  createContest,
  createEvent,
  createParticipant,
  createSportLeague,
  getEventBracket,
  listEventParticipants,
  listEvents,
  listSportLeagues,
  listSports,
  loadEventBracket,
  recordEventMatchResult,
  releaseEvent,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import {
  BracketAdvancement,
  ContestFormat,
  MatchSide,
  MatchStatus,
  SelectionType,
  Sport,
  findSportRow,
} from '@poolmaster/shared/domain';
import { SportEventBracketResponseSchema } from '@poolmaster/shared/dto';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
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

// An NFL regular-season week end to end over HTTP (#715). The week is its own event of one round,
// its field the eight teams playing, and its four games link nowhere: they form no bracket, even
// in a league that reseeds its playoff bracket. An admin loads the games, releases the week,
// cancels the game that is postponed, enters the other three results (one first as a tie, #792)
// and completes the week. A
// contest scored by knockout round points is refused on it, because no team goes a round further.
// The QA test seed of the 2025 season's first weeks loads a week the same way, played.
//
// Every date in the first test is fixed in 2099, so the server's real clock never reaches the week.

const RUN = `nfl-week-${Date.now()}`;
const SEED_FILE = join(__dirname, '../../packages/core-api/scripts/seed-golf/american-football-2025-nfl-weeks-test.json');
const TEAMS = ['Bills', 'Jets', 'Chiefs', 'Raiders', 'Packers', 'Bears', 'Eagles', 'Giants'];

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
  const seededIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: seededIds } } });
  await db.participant.deleteMany({ where: { id: { in: seededIds } } });
  if (created.sportLeagueIds.size) {
    await db.sportLeague.deleteMany({ where: { id: { in: [...created.sportLeagueIds] } } });
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: an NFL regular-season week (#715)', () => {
  it('loads a week whose games link nowhere, releases it, cancels its postponed game, takes a tie on a game, completes it on the other three results, and refuses knockout round points on it', async () => {
    const db = getFunctionalPrisma();
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await db.sport.upsert({
      where: { sport: Sport.AMERICAN_FOOTBALL },
      create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Week Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.AMERICAN_FOOTBALL)).id;

    // --- A league that reseeds its playoffs, and a week of three games --------------------------
    const nfl = await createSportLeague({
      client: a,
      body: { sport: Sport.AMERICAN_FOOTBALL, name: `Week League ${RUN}`, bracketAdvancement: BracketAdvancement.RESEED_BY_SEED },
    });
    const sportLeagueId = expectDefined(nfl.data, JSON.stringify(nfl.error)).sportLeague.id;
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
      body: { sportLeagueId, eventYear: 2099, name: `Week 1 ${RUN}`, startDate: '2099-09-10T17:00:00.000Z', rounds: 1, autoLifecycleEnabled: false },
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
    expect((await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'ODDS' } })).response.status).toBe(200);
    expect((await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() })).response.status).toBe(200);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
    const rowOf = (team: string) => expectDefined(field.find((row) => row.participant.name === `${team} ${RUN}`), team).id;

    // Bills-Jets, Chiefs-Raiders, Packers-Bears, Eagles-Giants: the home team first, every game linking nowhere.
    const kickoffs = ['2099-09-10T17:00:00.000Z', '2099-09-10T17:00:00.000Z', '2099-09-10T20:25:00.000Z', '2099-09-11T00:20:00.000Z'];
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
          scheduledDate: expectDefined(kickoffs[index]),
          advancesTo: null,
        })),
      },
    });
    expect([loaded.error, loaded.response.status]).toEqual([undefined, 200]);
    expect(expectMatchesSchema(SportEventBracketResponseSchema, loaded.data).matches.map((game) => [game.matchNumber, game.advancesToMatchId])).toEqual([[1, null], [2, null], [3, null], [4, null]]);

    // --- Released, a game is cancelled one by one; a draft's games are edited freely -----------
    expectFunctionalError(await cancelEventMatch({ client: a, path: { eventId, matchNumber: 4 } }), { status: 409, code: 'SPORT_EVENT_NOT_RELEASED' });
    const released = await releaseEvent({ client: a, path: { eventId } });
    expect([released.error, released.data?.event.status]).toEqual([undefined, 'SCHEDULED']);

    // Knockout round points need a team to go further; a week has nowhere to go.
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Week Commissioner', leagueName: `Week Pool ${RUN}` });
    expectFunctionalError(await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Week Knockout ${RUN}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        configuration: {
          maxEntriesPerSquad: 1,
          selectionType: SelectionType.TIERED,
          picksPerTier: 1,
          countedScores: 2,
          scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1], upsetBonus: { rule: 'NONE' } } },
        },
      },
    }), { status: 422, code: 'CONTEST_EVENT_NOT_A_BRACKET' });

    // Eagles-Giants is postponed: cancelled here, it would be added to the week it moves to.
    const cancelled = await cancelEventMatch({ client: a, path: { eventId, matchNumber: 4 } });
    expect([cancelled.error, cancelled.response.status]).toEqual([undefined, 200]);
    const statusOf = (matches: readonly { matchNumber: number; status: string }[]) => matches.map((game) => [game.matchNumber, game.status]);
    expect(statusOf(expectMatchesSchema(SportEventBracketResponseSchema, cancelled.data).matches))
      .toEqual([[1, MatchStatus.SCHEDULED], [2, MatchStatus.SCHEDULED], [3, MatchStatus.SCHEDULED], [4, MatchStatus.CANCELLED]]);
    expect(statusOf(expectDefined((await cancelEventMatch({ client: a, path: { eventId, matchNumber: 4 } })).data).matches))
      .toEqual([[1, MatchStatus.SCHEDULED], [2, MatchStatus.SCHEDULED], [3, MatchStatus.SCHEDULED], [4, MatchStatus.CANCELLED]]);

    // --- The other three games are played, and the week completes -------------------------------
    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const billsWin = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 1 }, body: { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 20 } });
    expect([billsWin.error, billsWin.response.status]).toEqual([undefined, 200]);
    // A game of a week can end in a tie (#792): no winner, and both scores, level. Corrected here
    // to the Raiders' win.
    expectFunctionalError(
      await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: null, homeScore: 17, awayScore: 24 } }),
      { status: 422, code: 'MATCH_RESULT_INVALID' },
    );
    const tie = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: null, homeScore: 20, awayScore: 20 } });
    expect(expectMatchesSchema(SportEventBracketResponseSchema, tie.data).matches.filter((game) => game.matchNumber === 2)
      .map((game) => [game.status, game.winnerSide, game.homeScore, game.awayScore])).toEqual([[MatchStatus.COMPLETED, null, 20, 20]]);
    expect((await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 2 }, body: { winnerSide: MatchSide.AWAY, homeScore: 17, awayScore: 24 } })).response.status).toBe(200);
    const packersWin = await recordEventMatchResult({ client: a, path: { eventId, matchNumber: 3 }, body: { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 10 } });
    expect(expectMatchesSchema(SportEventBracketResponseSchema, packersWin.data).matches.map((game) => [game.matchNumber, game.status, game.winnerSide]))
      .toEqual([[1, MatchStatus.COMPLETED, MatchSide.HOME], [2, MatchStatus.COMPLETED, MatchSide.AWAY], [3, MatchStatus.COMPLETED, MatchSide.HOME], [4, MatchStatus.CANCELLED, null]]);
    // A played game is not cancelled: its result is cleared first.
    expectFunctionalError(await cancelEventMatch({ client: a, path: { eventId, matchNumber: 1 } }), { status: 409, code: 'MATCH_ALREADY_PLAYED' });

    expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
  });

  it('loads week 1 of the 2025 season\'s test seed into the NFL, released with its sixteen games played, and completes it', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Week Loader' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    // Week 1 only, its teams and event tagged with this run.
    const file = parseSportDataFile(JSON.parse(readFileSync(SEED_FILE, 'utf8')) as unknown, { allowTestData: true });
    const [nflLeague] = file.sportLeagues;
    const week = expectDefined(nflLeague.events[0]);
    nflLeague.events = [week];
    const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
    week.name = `NFL Week 1 ${RUN}`;
    for (const player of nflLeague.players) player.key = expectDefined(tagged(player.key));
    for (const entry of week.field) entry.player = expectDefined(tagged(entry.player));
    for (const game of week.matches ?? []) Object.assign(game, { home: tagged(game.home), away: tagged(game.away) });
    // Release refuses an event that has started by the server's clock, so the seed is dated from today.
    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });

    const nfl = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AMERICAN_FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'NFL'));
    const event = expectDefined(expectDefined((await listEvents({ client: a, query: { sportLeagueId: nfl.id } })).data).events
      .find((row) => row.name === week.name));
    created.sportEventIds.add(event.id);
    expect([event.status, event.rounds]).toEqual(['SCHEDULED', 1]);
    const games = expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: a, path: { eventId: event.id } })).data).matches;
    expect(games).toHaveLength(16);
    expect(games.every((game) => game.status === MatchStatus.COMPLETED && game.advancesToMatchId === null)).toBe(true);
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const nameOf = (id: string | null) => expectDefined(field.find((row) => row.id === id)).participant.name;
    expect(games.slice(0, 1).map((game) => [nameOf(game.homeSportEventParticipantId), nameOf(game.awaySportEventParticipantId), game.homeScore, game.awayScore, game.winnerSide]))
      .toEqual([['Philadelphia Eagles', 'Dallas Cowboys', 24, 20, MatchSide.HOME]]);

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
  });
});
