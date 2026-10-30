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
import { countingPrisma } from '../../support/counting-prisma';
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
    const { prisma, count } = countingPrisma(getAppPrisma());

    const leaderboard = await createContestService(prisma, getApp().log, { planEntitlements: integrationPlanEntitlements(prisma) }).getPickEmLeaderboard(season.contest.id, season.viewerId);

    // One query for every week's games; the live week is scored from those, not read again.
    expect(count('SportEventMatch.findMany')).toBe(1);
    // The contest's entries once for the board, once for the live week's submitted entries.
    expect(count('ContestEntry.findMany')).toBe(2);
    expect(count('ContestEntryMatchPrediction.findMany')).toBe(1);
    expect(leaderboard.weeks.map((week) => [week.started, week.settled])).toEqual([
      [true, true], [true, true], [true, true], [true, true], [true, false], [false, false],
    ]);
  });

  it('reports each settled week\'s game count and tiebreaker total from the batched games, and the live week\'s too', async () => {
    const season = await midSeason();

    const leaderboard = await createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() }).getPickEmLeaderboard(season.contest.id, season.viewerId);

    expect(leaderboard.weeks.map((week) => [week.gameCount, week.tiebreakerTotalPoints])).toEqual([
      [3, 37], [3, 37], [3, 37], [3, 37],
      // Week 5's last game is not played yet, and week 6 has not started.
      [3, null], [3, null],
    ]);
  });

  it('scores the week under way live and leaves the weeks the entry did not submit, and the week to come, empty', async () => {
    const season = await midSeason();

    const leaderboard = await createContestService(getAppPrisma(), getApp().log, { planEntitlements: integrationPlanEntitlements() }).getPickEmLeaderboard(season.contest.id, season.viewerId);

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
    const { prisma, count } = countingPrisma(getAppPrisma());

    const leaderboard = await createContestService(prisma, getApp().log, { planEntitlements: integrationPlanEntitlements(prisma) }).getPickEmLeaderboard(contest.id, viewerId);

    expect(leaderboard.weeks.map((week) => [week.settled, week.gameCount, week.tiebreakerTotalPoints])).toEqual([[true, 0, null]]);
    expect(count('SportEventMatch.findMany')).toBe(1);
    expect(count('ContestEntryMatchPrediction.findMany')).toBe(0);
  });
});
