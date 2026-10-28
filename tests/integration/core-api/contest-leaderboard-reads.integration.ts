import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ContestStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { createContestService } from '../../../packages/core-api/src/modules/contests/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { integrationPlanEntitlements } from '../plan-entitlements';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';

// The roster contest leaderboard's reads against real Postgres (#1162): however many events the
// contest has, its entries come from one query and its picks from one more, and only the picks
// of the events scored live: the shown one and any not settled yet. A settled event answers
// from its frozen standings, without its picks. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const DAY = 24 * 60 * 60 * 1000;
const ENTRIES = 3;
const PICKS_PER_EVENT = 4;

/** The Prisma client with every model operation counted, as `Model.operation`, and the rows each read returned. */
function countingPrisma() {
  const counts = new Map<string, number>();
  const rows = new Map<string, number>();
  const client = getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const key = `${model}.${operation}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          const result = await query(args);
          if (Array.isArray(result)) rows.set(key, (rows.get(key) ?? 0) + result.length);
          return result;
        },
      },
    },
  });
  // The extended client runs every query the plain one does; the services take the plain type.
  return {
    prisma: client as unknown as PrismaClient,
    count: (key: string) => counts.get(key) ?? 0,
    rows: (key: string) => rows.get(key) ?? 0,
  };
}

/** A golf event that started `daysAgo`, with a field of `PICKS_PER_EVENT` golfers. */
async function createEvent(label: string, daysAgo: number, status: SportEventStatus) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `leaderboard-reads-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `${label} ${randomUUID().slice(0, 6)}`,
      startDate: new Date(Date.now() - daysAgo * DAY),
      endDate: new Date(Date.now() - daysAgo * DAY + 3 * DAY),
      status,
    },
  });
  const field = [];
  for (let golfer = 1; golfer <= PICKS_PER_EVENT; golfer++) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Golfer ${golfer} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true } }));
  }
  return { event, field };
}

/**
 * A four-major contest of `status` whose viewer is its commissioner, with three entries that
 * each submitted every major and picked its whole field. Every major but the last finished and
 * settled, its standings frozen; the last is under way unless `lastSettled`.
 */
async function fourMajors(status: ContestStatus, lastSettled: boolean) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const majors = [
    await createEvent('Masters', 200, SportEventStatus.COMPLETED),
    await createEvent('PGA', 160, SportEventStatus.COMPLETED),
    await createEvent('US Open', 120, SportEventStatus.COMPLETED),
    await createEvent('Open', 1, lastSettled ? SportEventStatus.COMPLETED : SportEventStatus.IN_PROGRESS),
  ];
  const owner = await createTestUser({ displayName: `Leaderboard Reads ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `LBR${suffix.toUpperCase()}`, name: `Leaderboard Reads League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: majors.map(({ event }, index) => ({ sportEventId: event.id, sequence: index + 1 })) },
      name: `Majors ${suffix}`,
      status,
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: 'TIERED',
      configJson: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 2 },
      participantScoringRules: { create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 } },
    },
  });
  const settledAt = new Date();
  const settledMajors = lastSettled ? majors : majors.slice(0, -1);
  const entries = [];
  for (let number = 1; number <= ENTRIES; number++) {
    const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Squad ${number} ${suffix}` } });
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squad.id,
        entryNumber: 1,
        name: `Entry ${number}`,
        events: { create: majors.map(({ event }) => ({ sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date(event.startDate.getTime() - DAY) })) },
      },
    });
    entries.push(entry);
    await prisma.contestEntryPick.createMany({
      data: majors.flatMap(({ field }) => field.map((row, index) => ({
        entryId: entry.id,
        sportEventParticipantId: row.id,
        contestFormat: 'ROSTER' as const,
        slot: index + 1,
        pickedAt: new Date(),
      }))),
    });
    // Entry 1 settles first in every major, entry 3 last.
    for (const { event } of settledMajors) {
      await prisma.contestEntryEventStanding.create({
        data: {
          contestId: contest.id,
          contestEntryId: entry.id,
          sportEventId: event.id,
          position: number,
          displayPosition: String(number),
          countingPickLimit: 2,
          scoredPickCount: 2,
          asOf: settledAt,
          settledAt,
          totalScore: number - 4,
        },
      });
    }
    if (status === ContestStatus.COMPLETED) {
      await prisma.contestEntryStanding.create({
        data: {
          contestId: contest.id,
          contestEntryId: entry.id,
          position: number,
          displayPosition: String(number),
          countingPickLimit: 2,
          scoredPickCount: 8,
          asOf: settledAt,
          settledAt,
          totalScore: 4 * (number - 4),
        },
      });
    }
  }
  return { contest, entries, majors, viewerId: owner.user.id };
}

function serviceOn(prisma: PrismaClient) {
  return createContestService(prisma, getApp().log, { planEntitlements: integrationPlanEntitlements(prisma) });
}

describe('ContestService.getLeaderboard reads (#1162)', () => {
  it('reads the entries once and only the major under way\'s picks, not every pick once per major', async () => {
    const season = await fourMajors(ContestStatus.ACTIVE, false);
    const { prisma, count, rows } = countingPrisma();

    const leaderboard = await serviceOn(prisma).getLeaderboard(season.contest.id, season.viewerId);

    expect(count('ContestEntry.findMany')).toBe(1);
    expect(count('ContestEntryPick.findMany')).toBe(1);
    expect(rows('ContestEntryPick.findMany')).toBe(ENTRIES * PICKS_PER_EVENT);
    // The settled majors answer from their frozen standings; the live one lists every entry unscored.
    const first = leaderboard.entries.find((entry) => entry.entryId === season.entries[0]?.id);
    expect(first?.events.map((event) => [event.sportEventId, event.position, event.score])).toEqual([
      [season.majors[0]?.event.id, 1, -3],
      [season.majors[1]?.event.id, 1, -3],
      [season.majors[2]?.event.id, 1, -3],
      [season.majors[3]?.event.id, null, null],
    ]);
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.score, entry.position])).toEqual([
      ['Entry 1', -9, 1],
      ['Entry 2', -6, 2],
      ['Entry 3', -3, 3],
    ]);
    expect(first?.picks).toHaveLength(PICKS_PER_EVENT);
  });

  it('answers a COMPLETED contest from its frozen totals, reading the picks of the shown major alone', async () => {
    const season = await fourMajors(ContestStatus.COMPLETED, true);
    const { prisma, count, rows } = countingPrisma();

    const leaderboard = await serviceOn(prisma).getLeaderboard(season.contest.id, season.viewerId, season.majors[1]?.event.id);

    expect(count('ContestEntryPick.findMany')).toBe(1);
    expect(rows('ContestEntryPick.findMany')).toBe(ENTRIES * PICKS_PER_EVENT);
    expect(leaderboard.sportEventId).toBe(season.majors[1]?.event.id);
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.score, entry.position])).toEqual([
      ['Entry 1', -12, 1],
      ['Entry 2', -8, 2],
      ['Entry 3', -4, 3],
    ]);
  });

  it('answers a second viewer within 30 seconds from the board already computed, reading no entries or picks again', async () => {
    const season = await fourMajors(ContestStatus.ACTIVE, false);
    const { prisma, count } = countingPrisma();
    const service = serviceOn(prisma);

    const first = await service.getLeaderboard(season.contest.id, season.viewerId);
    const second = await service.getLeaderboard(season.contest.id, season.viewerId);

    expect(second).toEqual(first);
    expect(count('ContestEntry.findMany')).toBe(1);
    expect(count('ContestEntryPick.findMany')).toBe(1);
  });

  it('computes the live standings email\'s board afresh even when a viewer\'s board is cached, so an email never reports older scores', async () => {
    const season = await fourMajors(ContestStatus.ACTIVE, false);
    const { prisma, count } = countingPrisma();
    const service = serviceOn(prisma);

    const contest = expectDefined(await new PrismaContestRepository(prisma).findById(season.contest.id));

    await service.getLeaderboard(season.contest.id, season.viewerId);
    await service.leaderboardOf(contest);

    expect(count('ContestEntryPick.findMany')).toBe(2);
  });
});
