/**
 * ContestEntryPick.contestFormat is denormalized from the parent contest
 * (plans/117 §7.1) so partial unique indexes can predicate on a local column.
 * ROSTER is the only format since #605, so this checks the copy is made; the
 * per-format cross-checks went with the formats.
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
import { freshEventEdition } from '../../support/event-edition';

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
      cupName: 'Test Cup', leagueCode: `PIN${suffix.toUpperCase()}`,
      name: `Invariant League ${suffix}`,
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
      name: `Invariant Squad ${suffix}`,
      createdBy: user.id,
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
      externalId: `pick-invariant-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Invariant Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
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
      isActive: true,
    },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: sportEvent.id, sequence: 1 } },
      name: `Invariant Contest ${suffix}`,
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
      name: `Invariant Entry ${suffix}`,
      events: { create: { sportEventId: sportEvent.id, status: 'SUBMITTED', submittedAt: new Date() } },
    },
  });

  return {
    contestId: contest.id,
    entryId: entry.id,
    sportEventParticipantId: sep.id,
  };
}

describe('ContestEntryPick.contestFormat denormalization', () => {
  it('copies the parent contest\'s format onto the pick row it creates', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');

    const dto = await service.createPick({
      entryId: fixture.entryId,
      sportEventParticipantId: fixture.sportEventParticipantId,
    });

    const row = await prisma.contestEntryPick.findUniqueOrThrow({ where: { id: dto.id } });
    expect(dto.contestFormat).toBe('ROSTER');
    expect(row.contestFormat).toBe('ROSTER');
  });
});

describe('ContestEntryPickService.deletePick', () => {
  it('removes the one pick named and leaves the entry and its other picks in place', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    const kept = await service.createPick({ entryId: fixture.entryId, sportEventParticipantId: fixture.sportEventParticipantId });
    const other = await seedFixtureForFormat('ROSTER');
    const removed = await service.createPick({ entryId: fixture.entryId, sportEventParticipantId: other.sportEventParticipantId });

    await service.deletePick(removed.id);

    const remaining = await prisma.contestEntryPick.findMany({ where: { entryId: fixture.entryId } });
    expect(remaining.map((pick) => pick.id)).toEqual([kept.id]);
    await expect(prisma.contestEntry.count({ where: { id: fixture.entryId } })).resolves.toBe(1);
  });
});
