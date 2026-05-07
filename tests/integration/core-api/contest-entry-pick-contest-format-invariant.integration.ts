/**
 * Contract coverage for the ContestEntryPick.contestFormat denormalization
 * invariant from plans/117 §7.1: every persisted pick row's `contestFormat`
 * column matches the parent `Contest.contestFormat`.
 *
 * The denormalization makes the per-format partial unique indexes (see
 * `contest-entry-pick-partial-uniques.integration.ts`) implementable —
 * Postgres partial indexes can predicate only on local columns. For that to
 * be safe the application layer must guarantee the denormalized column never
 * drifts from the parent contest.
 *
 * pool-master-rop.78.6 — service-layer enforcement of this invariant lives
 * in `ContestEntryPickService.createPick`. This test exercises the service
 * end-to-end and asserts the database row matches the parent contest. It
 * also asserts a global cross-row invariant (`pick.contestFormat ===
 * pick.entry.contest.contestFormat`) over every persisted pick at the end
 * of the suite — a defensive check against any future code path that might
 * bypass the service.
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';
import {
  ContestEntryPickService,
} from '../../../packages/core-api/src/modules/contest-entry-picks';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

interface FormatFixture {
  contestId: string;
  entryId: string;
  sportEventParticipantId: string;
}

async function seedFixtureForFormat(contestFormat: string): Promise<FormatFixture> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  const user = await prisma.user.create({
    data: {
      email: `pick-invariant-${suffix}@example.com`,
      username: `pick-invariant-${suffix}`,
      firstName: 'Invariant',
      lastName: 'Pick',
      isActive: true,
    },
  });
  const league = await prisma.league.create({
    data: {
      leagueCode: `PIN${suffix.toUpperCase()}`,
      name: `Invariant League ${suffix}`,
      createdBy: user.id,
      iconKey: 'TROPHY',
      joinPolicy: 'COMMISSIONER_ONLY',
    },
  });
  await prisma.leagueMembership.create({
    data: {
      leagueId: league.id,
      userId: user.id,
      role: 'COMMISSIONER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  const squad = await prisma.squad.create({
    data: {
      leagueId: league.id,
      name: `Invariant Squad ${suffix}`,
      createdBy: user.id,
    },
  });

  const sport = await prisma.sport.create({
    data: {
      name: `Invariant Sport ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
    },
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      externalId: `pick-invariant-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Invariant Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
      releaseAt: new Date('2030-01-01T12:00:00.000Z'),
      fieldLocksAt: new Date('2030-01-15T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const participant = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Invariant Participant ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
      externalIds: {},
    },
  });
  const sep = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: sportEvent.id,
      participantId: participant.id,
      status: 'ACTIVE',
    },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      sportEventId: sportEvent.id,
      name: `Invariant Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: contestFormat as 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
    },
  });
  const entry = await prisma.contestEntry.create({
    data: {
      contestId: contest.id,
      squadId: squad.id,
      entryNumber: 1,
      name: `Invariant Entry ${suffix}`,
      status: 'ACTIVE',
    },
  });

  return {
    contestId: contest.id,
    entryId: entry.id,
    sportEventParticipantId: sep.id,
  };
}

describe('plans/117 §7.1 — ContestEntryPick.contestFormat denormalization invariant', () => {
  it('reads the parent contest format and writes it onto the pick row regardless of caller intent', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);

    for (const format of ['ROSTER', 'BRACKET', 'PICKEM_CONFIDENCE', 'PREDICT_TOP_N', 'SURVIVOR']) {
      const fixture = await seedFixtureForFormat(format);
      const dto = await service.createPick({
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.sportEventParticipantId,
        // Per-format metadata varies; supply the minimum each partial index
        // expects so the row can be inserted without violating uniqueness.
        period: format === 'BRACKET' || format === 'PICKEM_CONFIDENCE' || format === 'SURVIVOR' ? 1 : null,
        slot: format === 'BRACKET' || format === 'PICKEM_CONFIDENCE' || format === 'PREDICT_TOP_N' ? 1 : null,
      });

      expect(dto.contestFormat).toBe(format);
      const row = await prisma.contestEntryPick.findUniqueOrThrow({
        where: { id: dto.id },
      });
      expect(row.contestFormat).toBe(format);

      // Cross-check: pick.contestFormat === parent contest.contestFormat.
      const parentContest = await prisma.contest.findUniqueOrThrow({
        where: { id: fixture.contestId },
        select: { contestFormat: true },
      });
      expect(row.contestFormat).toBe(parentContest.contestFormat);
    }
  });

  it('global invariant — every persisted pick has contestFormat matching its parent contest', async () => {
    const prisma = getPrisma();
    const drifted = await prisma.contestEntryPick.findMany({
      include: {
        entry: {
          include: {
            contest: { select: { contestFormat: true } },
          },
        },
      },
    });
    const violations = drifted.filter(
      (pick) => pick.contestFormat !== pick.entry.contest.contestFormat,
    );
    expect(violations).toEqual([]);
  });
});
