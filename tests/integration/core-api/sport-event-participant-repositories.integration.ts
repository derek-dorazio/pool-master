import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import {
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantValuationRepository,
} from '../../../packages/core-api/src/adapters';
import { Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipantValuation.deleteMany({
    where: { valuationSource: 'integration-test' },
  });
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
  it('pool-master-rop.68.1.3 creates and updates event participants, source data, rankings, odds, seeds, and valuations', async () => {
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
    const valuationRepo = new PrismaSportEventParticipantValuationRepository(prisma);

    const sportEventParticipant = await participantRepo.create({
      sportEventId: event.id,
      participantId: participant.id,
      status: 'ACTIVE',
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

    const valuation = await valuationRepo.create({
      sportEventParticipantId: sportEventParticipant.id,
      price: 9300,
      tier: 'A',
      orderIndex: 1,
      valuationSource: 'integration-test',
    });

    const updatedParticipant = await participantRepo.update(
      sportEventParticipant.id,
      {
        status: 'IN_PROGRESS',
        worldRanking: 8,
        oddsToWin: 20,
        metadata: { teeTime: '08:30', started: true },
      },
    );
    const updatedValuation = await valuationRepo.update(valuation.id, {
      price: 9800,
      tier: 'S',
    });

    expect(updatedParticipant.status).toBe('IN_PROGRESS');
    expect(updatedParticipant.worldRanking).toBe(8);
    expect(updatedParticipant.oddsToWin).toBe(20);
    expect(updatedValuation.price).toBe(9800);
    expect(updatedValuation.tier).toBe('S');

    const participantsForEvent = await participantRepo.findBySportEvent(event.id);
    const valuations = await valuationRepo.findBySportEventParticipant(
      sportEventParticipant.id,
    );

    expect(participantsForEvent).toHaveLength(1);
    expect(valuations).toHaveLength(1);

    expect(participantsForEvent[0].worldRanking).toBe(8);
    expect(participantsForEvent[0].oddsToWin).toBe(20);
  });
});
