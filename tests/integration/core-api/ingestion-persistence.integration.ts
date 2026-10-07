import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type { SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { Sport } from '@poolmaster/shared/domain';
import { linkedProviderEvent } from '../../support/event-edition';

const rankedEventIds = [
  'integration-ingestion-event',
  'integration-ranked-field',
  'integration-ranked-refresh',
  'integration-ranked-overwrite',
];

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
      sportEvent: { externalId: { in: rankedEventIds } },
    },
  });
  await prisma.sportEventRound.deleteMany({
    where: { sportEvent: { externalId: { in: rankedEventIds } } },
  });
  await prisma.sportEvent.deleteMany({
    where: { externalId: { in: rankedEventIds } },
  });
  await prisma.participantProviderMapping.deleteMany({
    where: { providerId: 'TEST_PROVIDER' },
  });
  await prisma.participant.deleteMany({
    where: {
      externalId: {
        in: ['ingestion-player-1', 'ingestion-ranked-1', 'ingestion-ranked-2', 'ingestion-ranked-3', 'ingestion-ranked-4'],
      },
    },
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

  it('writes each golfer\'s ranking from the provider\'s field onto the event participant, and leaves it empty when the field gives none', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    const golfer = (externalId: string, name: string, ranking?: number) => ({
      externalId,
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name,
      active: true,
      ...(ranking === undefined ? {} : { ranking }),
      metadata: {},
    });
    const detail: SportEventDetail = {
      externalId: 'integration-ranked-field',
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: 'Integration Ranked Field',
      startDate: new Date('2026-04-22T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      metadata: {},
      participants: [golfer('ingestion-ranked-1', 'Ranked Golfer', 7), golfer('ingestion-ranked-2', 'Unranked Golfer')],
    };
    const event = await linkedProviderEvent(prisma, {
      providerId: detail.providerId,
      externalId: detail.externalId,
      name: detail.name,
      startDate: detail.startDate,
    });

    await persistence.persistEventDetail(detail);

    const rows = await prisma.sportEventParticipant.findMany({
      where: { sportEventId: event.id },
      include: { participant: true },
    });
    expect(Object.fromEntries(rows.map((row) => [row.participant.externalId, row.ranking]))).toEqual({
      'ingestion-ranked-1': 7,
      'ingestion-ranked-2': null,
    });
  });

  function rankedGolfer(externalId: string, ranking?: number) {
    return {
      externalId,
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: `Golfer ${externalId}`,
      active: true,
      ...(ranking === undefined ? {} : { ranking }),
      metadata: {},
    };
  }

  function rankedFieldDetail(externalId: string, participants: SportEventDetail['participants']): SportEventDetail {
    return {
      externalId,
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: `Integration ${externalId}`,
      startDate: new Date('2026-04-29T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      metadata: {},
      participants,
    };
  }

  it('keeps a golfer\'s existing ranking when a later field refresh gives no ranking', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    const first = rankedFieldDetail('integration-ranked-refresh', [rankedGolfer('ingestion-ranked-3', 12)]);
    const event = await linkedProviderEvent(prisma, {
      providerId: first.providerId,
      externalId: first.externalId,
      name: first.name,
      startDate: first.startDate,
    });
    await persistence.persistEventDetail(first);

    await persistence.persistEventDetail(
      rankedFieldDetail('integration-ranked-refresh', [rankedGolfer('ingestion-ranked-3')]),
    );

    const row = await prisma.sportEventParticipant.findFirstOrThrow({
      where: { sportEventId: event.id, participant: { externalId: 'ingestion-ranked-3' } },
    });
    expect(row.ranking).toBe(12);
  });

  it('writes the field\'s ranking over the ranking a golfer already has on the event when a refresh carries a new one', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    const first = rankedFieldDetail('integration-ranked-overwrite', [rankedGolfer('ingestion-ranked-4', 40)]);
    const event = await linkedProviderEvent(prisma, {
      providerId: first.providerId,
      externalId: first.externalId,
      name: first.name,
      startDate: first.startDate,
    });
    await persistence.persistEventDetail(first);

    await persistence.persistEventDetail(
      rankedFieldDetail('integration-ranked-overwrite', [rankedGolfer('ingestion-ranked-4', 5)]),
    );

    const row = await prisma.sportEventParticipant.findFirstOrThrow({
      where: { sportEventId: event.id, participant: { externalId: 'ingestion-ranked-4' } },
    });
    expect(row.ranking).toBe(5);
  });

  it('#125: the participant_ranking_snapshots table no longer exists — the global ranking snapshot is retired, not demoted', async () => {
    const prisma = getPrisma();

    const [{ table }] = await prisma.$queryRaw<Array<{ table: string | null }>>`
      SELECT to_regclass('public.participant_ranking_snapshots')::text AS "table"
    `;

    expect(table).toBeNull();
    expect((prisma as unknown as Record<string, unknown>).participantRankingSnapshot).toBeUndefined();
  });

  // #205 — the `pool-master-8yh` job-completion case went with `persistIngestionJob` and the
  // `ingestion_jobs` table: the sync-run ledger records the same job on the run (`jobPayload`).
});
