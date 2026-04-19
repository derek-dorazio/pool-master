import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type { SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipantSourceData.deleteMany({
    where: { providerId: 'TEST_PROVIDER' },
  });
  await prisma.sportEventParticipant.deleteMany({
    where: {
      sportEvent: { externalId: 'integration-ingestion-event' },
    },
  });
  await prisma.sportEvent.deleteMany({
    where: { externalId: 'integration-ingestion-event' },
  });
  await prisma.participantProviderMapping.deleteMany({
    where: { providerId: 'TEST_PROVIDER' },
  });
  await prisma.participant.deleteMany({
    where: { externalId: 'ingestion-player-1' },
  });
  await teardownIntegrationTests();
});

describe('IngestionPersistence', () => {
  it('persists event detail into events, participants, event participants, and source data', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);

    const detail: SportEventDetail = {
      externalId: 'integration-ingestion-event',
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: 'Integration Ingestion Event',
      startDate: new Date('2026-04-15T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      metadata: { season: '2026' },
      participants: [
        {
          externalId: 'ingestion-player-1',
          providerId: 'TEST_PROVIDER',
          sport: Sport.GOLF,
          name: 'Ingestion Player One',
          firstName: 'Ingestion',
          lastName: 'One',
          active: true,
          metadata: { scoreToPar: -4, madeCut: true },
        },
      ],
    };

    const result = await persistence.persistEventDetail(detail);

    expect(result).toMatchObject({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
      sourceDataPersisted: 1,
    });

    const event = await prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId: 'TEST_PROVIDER',
          externalId: 'integration-ingestion-event',
        },
      },
    });
    const participant = await prisma.participant.findFirstOrThrow({
      where: { externalId: 'ingestion-player-1' },
    });
    const sportEventParticipant =
      await prisma.sportEventParticipant.findUniqueOrThrow({
        where: {
          sportEventId_participantId: {
            sportEventId: event.id,
            participantId: participant.id,
          },
        },
      });
    const sourceData =
      await prisma.sportEventParticipantSourceData.findFirstOrThrow({
        where: { sportEventParticipantId: sportEventParticipant.id },
        orderBy: { receivedAt: 'desc' },
      });

    expect(sportEventParticipant.status).toBe('ACTIVE');
    expect(event.releaseAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    expect(event.fieldLocksAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    expect(sourceData.externalId).toBe('ingestion-player-1');
    expect(sourceData.normalizedData).toMatchObject({
      scoreToPar: -4,
      madeCut: true,
    });
  });
});
