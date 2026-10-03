import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type { SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { Sport } from '@poolmaster/shared/domain';
import { linkedProviderEvent } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipantGolfStanding.deleteMany({
    where: {
      standing: {
        sportEventParticipant: {
          sportEvent: { externalId: 'integration-ingestion-event' },
        },
      },
    },
  });
  await prisma.sportEventParticipantStanding.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: { externalId: 'integration-ingestion-event' },
      },
    },
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

    // plans/147 — sync updates a linked event; it does not create one.
    await linkedProviderEvent(prisma, {
      providerId: detail.providerId,
      externalId: detail.externalId,
      name: detail.name,
      startDate: detail.startDate,
    });

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

    expect(sportEventParticipant.isActive).toBe(true);
    expect(sportEventParticipant.inactiveReason).toBeNull();
    expect(event.releaseAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    expect(event.fieldLocksAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');

    // Per-participant source data (sportEventParticipantSourceData) was dropped
    // per plans/117 §13.2. rop.78.7 will rebuild the live-scoring path on
    // SportEventParticipantGolfRound and the per-(category × contestFormat)
    // contribution table.
  });

  // #205 — the `pool-master-8yh` job-completion case went with `persistIngestionJob` and the
  // `ingestion_jobs` table: the sync-run ledger records the same job on the run (`jobPayload`).
});
