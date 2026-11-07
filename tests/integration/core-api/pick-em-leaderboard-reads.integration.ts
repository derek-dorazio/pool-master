import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  ContestEntryStatus,
  ContestStatus,
  MatchSide,
  MatchStatus,
  PickEmMode,
  PredictedResult,
  SelectionType,
  Sport,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { createContestService } from '../../../packages/core-api/src/modules/contests/wiring';
import { expectDefined } from '../../support/expect-defined';
import { writePicks } from '../../support/prediction-writes';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { recordStatements, statementsOn, StatementVerb } from '../statement-log';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { integrationPlanEntitlements } from '../plan-entitlements';
import { createContestRow } from '../../support/contest-rows';

// The pick'em season leaderboard's reads against real Postgres (#762): however many weeks the
// season has, the games of every week come from one query, and only the week under way loads its
// submitted entries and picks, scored live against the games already read. A settled week answers
// from what was frozen, and a week not started shows nothing, so neither loads them. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** An NFL week of three games (match numbers 1 to 3, an hour apart from `startDate`), its six teams on the field. */
async function createWeek(label: string, startDate: Date, status: SportEventStatus) {
  const prisma = getPrisma();
  // The integration cleanup empties sport leagues no template names, so the football rows are set up here.
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NFL' } },
    create: { sportId: sport.id, name: 'NFL' },
    update: {},
  });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `${label} ${randomUUID()}` } });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    eventSeriesId: eventSeries.id,
    eventYear: 2026,
    externalId: `pickem-board-${randomUUID()}`,
    providerId: 'integration-test',
    sport: Sport.AMERICAN_FOOTBALL,
    name: label,
    startDate,
    status,
    rounds: 1,
    syncScope: 'NONE',
    autoLifecycleEnabled: false,
  });
  await createRoundRows(new PrismaSportEventRoundRepository(getAppPrisma()), event.id, [{ roundNumber: 1, scheduledDate: startDate }]);
  const teams = await Promise.all(['Bills', 'Jets', 'Chiefs', 'Raiders', 'Eagles', 'Giants'].map((name) => prisma.participant.create({
    data: { sportId: sport.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' },
  })));
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, teams.map((team) => ({ participantId: team.id })));
  const rows = await field.findBySportEvent(event.id);
  const rowOf = (index: number) => expectDefined(rows.find((row) => row.participantId === teams[index]?.id));
  const matchRepo = new PrismaSportEventMatchRepository(getAppPrisma());
  await matchRepo.replaceBracket(event.id, [1, 2, 3].map((matchNumber) => ({
    id: randomUUID(),
    roundNumber: 1,
    matchNumber,
    homeSportEventParticipantId: rowOf((matchNumber - 1) * 2).id,
    awaySportEventParticipantId: rowOf((matchNumber - 1) * 2 + 1).id,
    isNeutralSite: false,
    scheduledDate: new Date(startDate.getTime() + (matchNumber - 1) * HOUR),
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
  })));
  const games = await matchRepo.findBySportEvent(event.id);
  return { event, games };
}

/** Every game of the week played, home winning each 20-17, so the last game totals 37 points. */
async function playWeek(games: readonly { id: string }[]) {
  await getPrisma().sportEventMatch.updateMany({
    where: { id: { in: games.map((game) => game.id) } },
    data: { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 20, awayScore: 17 },
  });
}

/** A league whose commissioner is the viewer, with a squad and an ACTIVE straight-up pick'em contest over `sportEventIds`. */
async function createPickEmContest(sportEventIds: string[]) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Pickem Board ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `PBRD${suffix.toUpperCase()}`, name: `Pickem Board League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Pickers ${suffix}` } });
  const contest = await createContestRow(new PrismaContestRepository(getAppPrisma()), {
    leagueId: league.id,
    seasonYear: 2026,
    sportEventIds,
    name: `Season ${suffix}`,
    status: ContestStatus.ACTIVE,
    contestFormat: 'PREDICTION',
    selectionType: SelectionType.PICK_EM,
  });
  await new PrismaContestConfigurationRepository(getAppPrisma()).create({
    contestId: contest.id,
    selectionType: SelectionType.PICK_EM,
    configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
  });
  const result = await new PrismaContestEntryRepository(getAppPrisma()).create({ contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Pickers', tiebreakerValue: null }, { entriesPerContest: () => null });
  if (result.status !== 'created') throw new Error(`seed: entry refused (${result.status})`);
  return { contest, entry: result.entry, viewerId: owner.user.id };
}

/** The entry's week submitted, picking the home team in every game. */
async function submitHomePicks(entryId: string, sportEventId: string, games: readonly { id: string; homeSportEventParticipantId: string | null }[], at: Date) {
  await writePicks(new PrismaContestEntryMatchPredictionRepository(getAppPrisma()), {
    contestEntryId: entryId,
    sportEventId,
    saves: games.map((game) => ({
      sportEventMatchId: game.id,
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: expectDefined(game.homeSportEventParticipantId),
      confidence: null,
    })),
    clearedMatchIds: [],
    eventStatus: ContestEntryStatus.SUBMITTED,
    at,
  });
}

/**
 * A six-week season seen mid-season: weeks 1 to 4 played and completed with no entry submitting
 * them (settled, with nothing to freeze), week 5 under way with the entry's picks in and two of
 * its games played, and week 6 still to come.
 */
async function midSeason() {
  const now = Date.now();
  const playedWeeks = await Promise.all([1, 2, 3, 4].map((week) =>
    createWeek(`Week ${week}`, new Date(now - (6 - week) * 7 * DAY), SportEventStatus.COMPLETED)));
  const liveWeek = await createWeek('Week 5', new Date(now - 3 * HOUR), SportEventStatus.IN_PROGRESS);
  const nextWeek = await createWeek('Week 6', new Date(now + 7 * DAY), SportEventStatus.SCHEDULED);
  for (const week of playedWeeks) await playWeek(week.games);
  await playWeek(liveWeek.games.slice(0, 2));
  const weeks = [...playedWeeks, liveWeek, nextWeek];
  const { contest, entry, viewerId } = await createPickEmContest(weeks.map((week) => week.event.id));
  await submitHomePicks(entry.id, liveWeek.event.id, liveWeek.games, new Date(now - 4 * HOUR));
  return { contest, entry, viewerId, weeks, liveWeek, nextWeek };
}

describe('ContestService.getPickEmLeaderboard reads (#762)', () => {
  it('loads the games of all six weeks in one query, and the entries and picks of only the week under way, not a set per week', async () => {
    const season = await midSeason();
    const service = createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() });

    const { result: leaderboard, statements } = await recordStatements(() => service.getPickEmLeaderboard(season.contest.id, season.viewerId).then((read) => read.board));

    const reads = (table: string) => statementsOn(statements, StatementVerb.SELECT, table).length;
    // One statement for every week's games; the live week is scored from those, not read again.
    expect(reads('sport_event_matches')).toBe(1);
    // The contest's entries once for the board, once for the live week's submitted entries.
    expect(reads('contest_entries')).toBe(2);
    expect(reads('contest_entry_match_predictions')).toBe(1);
    expect(leaderboard.weeks.map((week) => [week.started, week.settled])).toEqual([
      [true, true], [true, true], [true, true], [true, true], [true, false], [false, false],
    ]);
  });

  it('reports each settled week\'s game count and tiebreaker total from the batched games, and the live week\'s too', async () => {
    const season = await midSeason();

    const leaderboard = (await createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() }).getPickEmLeaderboard(season.contest.id, season.viewerId)).board;

    expect(leaderboard.weeks.map((week) => [week.gameCount, week.tiebreakerTotalPoints])).toEqual([
      [3, 37], [3, 37], [3, 37], [3, 37],
      // Week 5's last game is not played yet, and week 6 has not started.
      [3, null], [3, null],
    ]);
  });

  it('scores the week under way live and leaves the weeks the entry did not submit, and the week to come, empty', async () => {
    const season = await midSeason();

    const leaderboard = (await createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() }).getPickEmLeaderboard(season.contest.id, season.viewerId)).board;

    const row = expectDefined(leaderboard.entries.find((entry) => entry.entryId === season.entry.id));
    expect(row.weeks.map((week) => [week.submitted, week.points])).toEqual([
      [false, null], [false, null], [false, null], [false, null],
      // Two home wins picked and played; the third game is still to finish.
      [true, 2],
      [false, null],
    ]);
    expect(row.totalPoints).toBe(2);
    expect(row.position).toBe(1);
  });

  it('counts a cancelled week for nothing: no games, no tiebreaker total, and settled without a live load', async () => {
    const cancelled = await createWeek('Week 1', new Date(Date.now() - 7 * DAY), SportEventStatus.CANCELLED);
    const { contest, viewerId } = await createPickEmContest([cancelled.event.id]);
    const service = createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() });

    const { result: leaderboard, statements } = await recordStatements(() => service.getPickEmLeaderboard(contest.id, viewerId).then((read) => read.board));

    expect(leaderboard.weeks.map((week) => [week.settled, week.gameCount, week.tiebreakerTotalPoints])).toEqual([[true, 0, null]]);
    expect(statementsOn(statements, StatementVerb.SELECT, 'sport_event_matches')).toHaveLength(1);
    expect(statementsOn(statements, StatementVerb.SELECT, 'contest_entry_match_predictions')).toHaveLength(0);
  });
});

describe('Stored pick\'em leaderboards (#1435)', () => {
  const serviceOn = () => createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() });
  const snapshotRows = (contestId: string) => getPrisma().contestLeaderboardSnapshot.findMany({ where: { contestId } });

  it('answers a poll on another API task from the stored board, reading no entries, picks or games again', async () => {
    const season = await midSeason();
    const first = await serviceOn().getPickEmLeaderboard(season.contest.id, season.viewerId);

    const { result, statements } = await recordStatements(() => serviceOn().getPickEmLeaderboard(season.contest.id, season.viewerId));

    expect(result).toEqual(first);
    for (const table of ['contest_entries', 'contest_entry_match_predictions', 'sport_event_matches', 'contest_configurations']) {
      expect(statementsOn(statements, StatementVerb.SELECT, table)).toEqual([]);
    }
    expect(statementsOn(statements, StatementVerb.SELECT, 'contest_leaderboard_snapshots')).toHaveLength(1);
    // The contest (6), the reader's squad membership (1; the task keeps the league membership,
    // #1438), and the snapshot (1): pinned however many weeks, games, entries and picks the season has.
    expect(statements).toHaveLength(8);
  });

  it('stores the board until the next game kicks off, whose picks it would then reveal', async () => {
    const season = await midSeason();

    await serviceOn().getPickEmLeaderboard(season.contest.id, season.viewerId);

    const nextKickoff = expectDefined(season.nextWeek.games[0]?.scheduledDate);
    expect(await snapshotRows(season.contest.id)).toMatchObject([{ shownEvent: '', validUntil: nextKickoff }]);
  });

  it('rebuilds the stored board when an admin saves a game\'s result through the events routes, before the save answers', async () => {
    const season = await midSeason();
    const admin = await createTestUser({ isRootAdmin: true });
    await serviceOn().getPickEmLeaderboard(season.contest.id, season.viewerId);

    const saved = await getApp().inject({
      method: 'PUT',
      url: `/api/v1/events/${season.liveWeek.event.id}/bracket/matches/3/result`,
      headers: admin.headers,
      payload: { winnerSide: 'HOME', homeScore: 24, awayScore: 10 },
    });

    expect(saved.statusCode).toBe(200);
    expect(await snapshotRows(season.contest.id)).toMatchObject([{ version: 2 }]);
    const { board } = await serviceOn().getPickEmLeaderboard(season.contest.id, season.viewerId);
    // The third home pick now scores too.
    expect(expectDefined(board.entries.find((entry) => entry.entryId === season.entry.id)).totalPoints).toBe(3);
  });

  it('refuses the lineup leaderboard of a pick\'em contest whose pick\'em board is stored, as before it was stored', async () => {
    const season = await midSeason();
    await serviceOn().getPickEmLeaderboard(season.contest.id, season.viewerId);

    await expect(serviceOn().getLeaderboard(season.contest.id, season.viewerId)).rejects.toMatchObject({ code: 'CONTEST_FORMAT_MISMATCH' });
    expect(await snapshotRows(season.contest.id)).toMatchObject([{ version: 1 }]);
  });
});
