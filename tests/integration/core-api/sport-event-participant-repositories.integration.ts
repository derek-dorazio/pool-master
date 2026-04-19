import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import {
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantSourceDataRepository,
  PrismaSportEventParticipantValuationRepository,
} from '../../../packages/core-api/src/adapters';
import { Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipantSourceData.deleteMany({
    where: { providerId: 'TEST_PROVIDER' },
  });
  await prisma.sportEventParticipantValuation.deleteMany({
    where: { valuationSource: 'integration-test' },
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
  it('creates and updates event participants, source data, and valuations', async () => {
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
    const sourceDataRepo = new PrismaSportEventParticipantSourceDataRepository(prisma);
    const valuationRepo = new PrismaSportEventParticipantValuationRepository(prisma);

    const sportEventParticipant = await participantRepo.create({
      sportEventId: event.id,
      participantId: participant.id,
      status: 'ACTIVE',
      metadata: { teeTime: '08:30' },
    });

    expect(sportEventParticipant.sportEventId).toBe(event.id);
    expect(sportEventParticipant.participantId).toBe(participant.id);

    const sourceData = await sourceDataRepo.create({
      sportEventParticipantId: sportEventParticipant.id,
      providerId: 'TEST_PROVIDER',
      externalId: 'integration-external-participant',
      rawPayload: { raw: true },
      normalizedData: { scoreToPar: -3, madeCut: true },
      receivedAt: new Date('2026-04-12T13:00:00.000Z'),
    });

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
        metadata: { teeTime: '08:30', started: true },
      },
    );
    const updatedSourceData = await sourceDataRepo.update(sourceData.id, {
      normalizedData: { scoreToPar: -5, madeCut: true },
    });
    const updatedValuation = await valuationRepo.update(valuation.id, {
      price: 9800,
      tier: 'S',
    });

    expect(updatedParticipant.status).toBe('IN_PROGRESS');
    expect(updatedSourceData.normalizedData).toMatchObject({ scoreToPar: -5 });
    expect(updatedValuation.price).toBe(9800);
    expect(updatedValuation.tier).toBe('S');

    const participantsForEvent = await participantRepo.findBySportEvent(event.id);
    const sourceDataRows = await sourceDataRepo.findBySportEventParticipant(
      sportEventParticipant.id,
    );
    const valuations = await valuationRepo.findBySportEventParticipant(
      sportEventParticipant.id,
    );

    expect(participantsForEvent).toHaveLength(1);
    expect(sourceDataRows).toHaveLength(1);
    expect(valuations).toHaveLength(1);
  });
});
