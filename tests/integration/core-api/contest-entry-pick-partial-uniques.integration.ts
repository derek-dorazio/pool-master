/**
 * Integration coverage for the per-contest-format partial unique indexes
 * landed by pool-master-rop.78.4 (plans/117 §7.1).
 *
 * Each `contest_entry_picks` partial unique enforces a per-format pick rule
 * that only Postgres-level constraints can guarantee under load. This suite
 * builds a real entry, inserts a valid pick for each format, then asserts
 * the duplicate insert fails with Prisma's P2002 unique-violation code.
 *
 * Indexes asserted:
 *   - uq_pick_roster_participant — ROSTER: no double-picking same participant
 *   - uq_pick_period_slot — BRACKET / PICKEM_CONFIDENCE: no duplicate
 *     (period, slot) tuple
 *   - uq_pick_predicted_position — PREDICT_TOP_N: no duplicate slot
 *   - uq_pick_survivor_week — SURVIVOR: one pick per week (period) per entry
 *
 * pool-master-rop.78.6 — service-layer enforcement of the contestFormat
 * denormalization invariant is the second half of the guarantee; that layer
 * is asserted in `contest-entry-pick-contest-format-invariant.integration.ts`.
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

interface FixtureContext {
  contestId: string;
  entryId: string;
  participantAId: string;
  participantBId: string;
}

async function seedContestFixture(contestFormat: string): Promise<FixtureContext> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  // Owning user, league, squad — enough scaffolding for a real ContestEntry.
  const user = await prisma.user.create({
    data: {
      email: `partial-uniques-${suffix}@example.com`,
      username: `partial-uniques-${suffix}`,
      firstName: 'Partial',
      lastName: 'Uniques',
      isActive: true,
    },
  });
  const league = await prisma.league.create({
    data: {
      leagueCode: `PUL${suffix.toUpperCase()}`,
      name: `Partial Uniques League ${suffix}`,
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
      name: `Partial Uniques Squad ${suffix}`,
      createdBy: user.id,
    },
  });
  await prisma.squadMembership.create({
    data: {
      squadId: squad.id,
      userId: user.id,
      status: 'ACTIVE',
      leagueId: league.id,
      joinedAt: new Date(),
    },
  });

  const sport = await prisma.sport.create({
    data: {
      name: `Partial Uniques Sport ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
    },
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      externalId: `partial-uniques-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Partial Uniques Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
      releaseAt: new Date('2030-01-01T12:00:00.000Z'),
      fieldLocksAt: new Date('2030-01-15T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const participantA = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Participant A ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
      externalIds: {},
    },
  });
  const participantB = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Participant B ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
      externalIds: {},
    },
  });
  const sepA = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: sportEvent.id,
      participantId: participantA.id,
      status: 'ACTIVE',
    },
  });
  const sepB = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: sportEvent.id,
      participantId: participantB.id,
      status: 'ACTIVE',
    },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      sportEventId: sportEvent.id,
      name: `Partial Uniques Contest ${suffix}`,
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
      name: `Entry ${suffix}`,
      status: 'ACTIVE',
    },
  });

  return {
    contestId: contest.id,
    entryId: entry.id,
    participantAId: sepA.id,
    participantBId: sepB.id,
  };
}

describe('plans/117 §7.1 — ContestEntryPick partial unique indexes', () => {
  it('uq_pick_roster_participant — rejects duplicate ROSTER picks for the same sport-event participant on one entry', async () => {
    const prisma = getPrisma();
    const fixture = await seedContestFixture('ROSTER');

    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantAId,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });

    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId: fixture.entryId,
          sportEventParticipantId: fixture.participantAId,
          contestFormat: 'ROSTER',
          isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Different sport-event participant succeeds — the partial index is
    // scoped to (entry, sportEventParticipantId).
    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantBId,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });
  });

  it('uq_pick_period_slot — rejects duplicate (entry, period, slot) tuples for BRACKET / PICKEM_CONFIDENCE', async () => {
    const prisma = getPrisma();
    const bracketFixture = await seedContestFixture('BRACKET');

    await prisma.contestEntryPick.create({
      data: {
        entryId: bracketFixture.entryId,
        sportEventParticipantId: bracketFixture.participantAId,
        contestFormat: 'BRACKET',
        period: 1,
        slot: 1,
        isAutoPicked: false,
      },
    });

    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId: bracketFixture.entryId,
          sportEventParticipantId: bracketFixture.participantBId,
          contestFormat: 'BRACKET',
          period: 1,
          slot: 1,
          isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // The same partial index also applies to PICKEM_CONFIDENCE.
    const pickemFixture = await seedContestFixture('PICKEM_CONFIDENCE');
    await prisma.contestEntryPick.create({
      data: {
        entryId: pickemFixture.entryId,
        sportEventParticipantId: pickemFixture.participantAId,
        contestFormat: 'PICKEM_CONFIDENCE',
        period: 5,
        slot: 16,
        isAutoPicked: false,
      },
    });
    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId: pickemFixture.entryId,
          sportEventParticipantId: pickemFixture.participantBId,
          contestFormat: 'PICKEM_CONFIDENCE',
          period: 5,
          slot: 16,
          isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('uq_pick_predicted_position — rejects duplicate slot picks for PREDICT_TOP_N', async () => {
    const prisma = getPrisma();
    const fixture = await seedContestFixture('PREDICT_TOP_N');

    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantAId,
        contestFormat: 'PREDICT_TOP_N',
        slot: 1,
        isAutoPicked: false,
      },
    });

    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId: fixture.entryId,
          sportEventParticipantId: fixture.participantBId,
          contestFormat: 'PREDICT_TOP_N',
          slot: 1,
          isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // A different predicted position succeeds.
    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantBId,
        contestFormat: 'PREDICT_TOP_N',
        slot: 2,
        isAutoPicked: false,
      },
    });
  });

  it('uq_pick_survivor_week — rejects more than one SURVIVOR pick per (entry, period)', async () => {
    const prisma = getPrisma();
    const fixture = await seedContestFixture('SURVIVOR');

    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantAId,
        contestFormat: 'SURVIVOR',
        period: 1,
        isAutoPicked: false,
      },
    });

    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId: fixture.entryId,
          sportEventParticipantId: fixture.participantBId,
          contestFormat: 'SURVIVOR',
          period: 1,
          isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Different week succeeds.
    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantBId,
        contestFormat: 'SURVIVOR',
        period: 2,
        isAutoPicked: false,
      },
    });
  });
});
