/**
 * Integration coverage for the per-contest-format partial unique index on
 * `contest_entry_picks` (plans/117 §7.1): a roster entry cannot pick the same
 * participant twice. Only Postgres can guarantee that under load. ROSTER is the
 * only built format (#605); a new format adds its own index here.
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
import { freshEventEdition } from '../../support/event-edition';

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

async function seedContestFixture(contestFormat: 'ROSTER'): Promise<FixtureContext> {
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
      iconKey: 'TROPHY',
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

  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `partial-uniques-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Partial Uniques Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
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
      isActive: true,
    },
  });
  const sepB = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: sportEvent.id,
      participantId: participantB.id,
      isActive: true,
    },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      sportEvents: { create: { sportEventId: sportEvent.id, sequence: 1 } },
      name: `Partial Uniques Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: contestFormat as 'ROSTER',
      selectionType: 'TIERED',
    },
  });
  const entry = await prisma.contestEntry.create({
    data: {
      contestId: contest.id,
      squadId: squad.id,
      entryNumber: 1,
      name: `Entry ${suffix}`,
      events: { create: { sportEventId: sportEvent.id, status: 'SUBMITTED', submittedAt: new Date() } },
    },
  });

  return {
    contestId: contest.id,
    entryId: entry.id,
    participantAId: sepA.id,
    participantBId: sepB.id,
  };
}

describe('pool-master-rop.78.6 / plans/117 §7.1 — ContestEntryPick partial unique indexes', () => {
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
});
