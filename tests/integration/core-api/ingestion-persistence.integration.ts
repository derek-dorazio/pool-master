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
  await prisma.ingestionJob.deleteMany({
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

    expect(sportEventParticipant.status).toBe('ACTIVE');
    expect(event.releaseAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    expect(event.fieldLocksAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');

    // Per-participant source data (sportEventParticipantSourceData) was dropped
    // per plans/117 §13.2. rop.78.7 will rebuild the live-scoring path on
    // SportEventParticipantGolfRound and the per-(category × contestFormat)
    // contribution table.
  });

  it('pool-master-8yh persists scheduler job completions for dashboard history', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);

    await persistence.persistIngestionJob({
      jobType: 'EVENT_SCHEDULE_SYNC',
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      status: 'COMPLETED',
      startedAt: new Date('2026-04-27T00:00:00.000Z'),
      completedAt: new Date('2026-04-27T00:00:01.000Z'),
      recordsProcessed: 10,
      errors: 0,
      errorLog: [],
    });

    const job = await prisma.ingestionJob.findFirstOrThrow({
      where: {
        providerId: 'TEST_PROVIDER',
        jobType: 'EVENT_SCHEDULE_SYNC',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(job.status).toBe('COMPLETED');
    expect(job.sport).toBe(Sport.GOLF);
    expect(job.recordsProcessed).toBe(10);
    expect(job.errors).toBe(0);
    expect(job.startedAt?.toISOString()).toBe('2026-04-27T00:00:00.000Z');
    expect(job.completedAt?.toISOString()).toBe('2026-04-27T00:00:01.000Z');
  });
});
