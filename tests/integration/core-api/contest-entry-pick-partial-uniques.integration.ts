/**
 * Integration coverage for the unique index on `contest_entry_picks` (entry, sport-event
 * participant): an entry cannot pick the same participant twice. Only Postgres can guarantee
 * that under load. Only roster contests write picks (#605), so the index needs no format
 * column to predicate on (#2042 dropped the copy).
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { ParticipantType } from '@poolmaster/shared/domain';
import { freshEventEdition } from '../../support/event-edition';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';

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

async function seedContestFixture(): Promise<FixtureContext> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  // Owning user, league, squad — enough scaffolding for a real ContestEntry.
  const user = await prisma.user.create({
    data: {
      email: `partial-uniques-${suffix}@integration.test`,
      username: `partial-uniques-${suffix}`,
      firstName: 'Partial',
      lastName: 'Uniques',
      isActive: true,
    },
  });
  const league = await prisma.league.create({
    data: {
      cupName: 'Test Cup', leagueCode: `PUL${suffix.toUpperCase()}`,
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
    create: { sport: 'GOLF', ...sportRowKeys('GOLF'), participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `partial-uniques-${suffix}`,
      providerId: 'integration-test',
      name: `Partial Uniques Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const participantA = await prisma.participant.create({
    data: {
      sportLeagueId: await participantLeagueId(prisma, sport.id),
      name: `Participant A ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
    },
  });
  const participantB = await prisma.participant.create({
    data: {
      sportLeagueId: await participantLeagueId(prisma, sport.id),
      name: `Participant B ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
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
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: sportEvent.id, sequence: 1 } },
      name: `Partial Uniques Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: 'ROSTER',
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

describe('ContestEntryPick unique index', () => {
  it('uq_pick_entry_participant rejects a second pick of the same sport-event participant on one entry, and takes another participant', async () => {
    const prisma = getPrisma();
    const fixture = await seedContestFixture();

    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantAId,
        isAutoPicked: false,
      },
    });

    await expect(
      prisma.contestEntryPick.create({
        data: {
          entryId: fixture.entryId,
          sportEventParticipantId: fixture.participantAId,
          isAutoPicked: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Different sport-event participant succeeds: the index is scoped to
    // (entry, sportEventParticipantId).
    await prisma.contestEntryPick.create({
      data: {
        entryId: fixture.entryId,
        sportEventParticipantId: fixture.participantBId,
        isAutoPicked: false,
      },
    });
  });
});
