import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import {
  PrismaSportEventParticipantRepository,
} from '../../../packages/core-api/src/adapters';
import { Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipantGolfStanding.deleteMany({
    where: {
      sportEventParticipant: { sportEvent: { externalId: 'integration-event-participants' } },
    },
  });
  await prisma.sportEventParticipant.deleteMany({
    where: {
      sportEvent: { externalId: 'integration-event-participants' },
    },
  });
  await prisma.sportEvent.deleteMany({
    where: { externalId: 'integration-event-participants' },
  });
  await prisma.participant.deleteMany({
    where: { externalId: 'integration-participant-1' },
  });
  await teardownIntegrationTests();
});

describe('Sport event participant repositories', () => {
  it('pool-master-rop.68.1.3 creates and updates event participants, source data, rankings, odds, and seeds', async () => {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: {
        name: Sport.GOLF,
        participantType: 'INDIVIDUAL',
      },
      update: {},
    });
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'Integration Golfer',
        participantType: 'INDIVIDUAL',
        externalId: 'integration-participant-1',
        status: 'ACTIVE',
      },
    });
    const event = await prisma.sportEvent.create({
      data: {
        externalId: 'integration-event-participants',
        providerId: 'TEST_PROVIDER',
        sport: Sport.GOLF,
        name: 'Integration Event Participants',
        startDate: new Date('2026-04-12T12:00:00.000Z'),
        releaseAt: new Date('2026-04-12T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-12T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const participantRepo = new PrismaSportEventParticipantRepository(prisma);

    const sportEventParticipant = await participantRepo.create({
      sportEventId: event.id,
      participantId: participant.id,
      isActive: true,
      worldRanking: 11,
      oddsToWin: 24.5,
      seedNumber: 3,
      metadata: { teeTime: '08:30' },
    });

    expect(sportEventParticipant.sportEventId).toBe(event.id);
    expect(sportEventParticipant.participantId).toBe(participant.id);
    expect(sportEventParticipant.worldRanking).toBe(11);
    expect(sportEventParticipant.oddsToWin).toBe(24.5);
    expect(sportEventParticipant.seedNumber).toBe(3);

    const updatedParticipant = await participantRepo.update(
      sportEventParticipant.id,
      {
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        worldRanking: 8,
        oddsToWin: 20,
        metadata: { teeTime: '08:30', started: true },
      },
    );

    expect(updatedParticipant.isActive).toBe(false);
    expect(updatedParticipant.inactiveReason).toBe('WITHDRAWN');
    expect(updatedParticipant.worldRanking).toBe(8);
    expect(updatedParticipant.oddsToWin).toBe(20);

    const participantsForEvent = await participantRepo.findBySportEvent(event.id);

    expect(participantsForEvent).toHaveLength(1);
    expect(participantsForEvent[0].worldRanking).toBe(8);
    expect(participantsForEvent[0].oddsToWin).toBe(20);
  });
});
