import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
} from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type { SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { ParticipantInactiveReason, Sport } from '@poolmaster/shared/domain';
import { linkedProviderEvent } from '../../support/event-edition';

const rankedEventIds = [
  'integration-ingestion-event',
  'integration-ranked-field',
  'integration-ranked-refresh',
  'integration-ranked-overwrite',
  'integration-linked-sync',
  'integration-unlinked-sync',
  'integration-odds-field',
  'integration-admin-header-SCORES_ONLY',
  'integration-admin-header-NONE',
  'integration-batched-sync',
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
        in: [
          'ingestion-player-1',
          'ingestion-ranked-1',
          'ingestion-ranked-2',
          'ingestion-ranked-3',
          'ingestion-ranked-4',
          'ingestion-odds-1',
          'ingestion-odds-2',
          'ingestion-batch-1',
          'ingestion-batch-2',
          'ingestion-batch-3',
        ],
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

    const result = (await persistence.persistEventDetailWithDiagnostics(detail)).value;

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

    await persistence.persistEventDetailWithDiagnostics(detail);

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
    await persistence.persistEventDetailWithDiagnostics(first);

    await persistence.persistEventDetailWithDiagnostics(
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
    await persistence.persistEventDetailWithDiagnostics(first);

    await persistence.persistEventDetailWithDiagnostics(
      rankedFieldDetail('integration-ranked-overwrite', [rankedGolfer('ingestion-ranked-4', 5)]),
    );

    const row = await prisma.sportEventParticipant.findFirstOrThrow({
      where: { sportEventId: event.id, participant: { externalId: 'ingestion-ranked-4' } },
    });
    expect(row.ranking).toBe(5);
  });

  // plans/147 — sync never creates a SportEvent: a provider event names no series or sport
  // league, so a created row would have to guess its tour.
  it('updates the event linked to a provider event and writes no row for a provider event nothing is linked to', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    const startDate = new Date('2026-06-04T12:00:00.000Z');
    const linked = await linkedProviderEvent(prisma, {
      providerId: 'TEST_PROVIDER',
      externalId: 'integration-linked-sync',
      name: 'Linked Sync Open',
      startDate,
    });
    const providerEvent = (externalId: string) => ({
      externalId,
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: `Provider ${externalId}`,
      startDate,
      status: 'SCHEDULED' as const,
      participantCount: 80,
      fieldLocked: false,
      metadata: {},
    });

    const result = await persistence.persistEventsWithDiagnostics([
      providerEvent('integration-linked-sync'),
      providerEvent('integration-unlinked-sync'),
    ]);

    expect(result.count).toBe(1);
    expect((await prisma.sportEvent.findUniqueOrThrow({ where: { id: linked.id } })).participantCount).toBe(80);
    await expect(prisma.sportEvent.count({
      where: { providerId: 'TEST_PROVIDER', externalId: 'integration-unlinked-sync' },
    })).resolves.toBe(0);
  });

  // #1247 — one read for every linked event and one transaction for the changed ones, with the
  // same rows and dispositions the one-event-at-a-time sync wrote.
  it('syncs a feed of linked, unlinked, changed and unchanged events into the right rows and dispositions', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    const startDate = new Date('2026-06-18T12:00:00.000Z');
    const link = async (externalId: string, participantCount: number) => {
      const event = await linkedProviderEvent(prisma, { providerId: 'TEST_PROVIDER', externalId, name: `Batch ${externalId}`, startDate });
      return prisma.sportEvent.update({ where: { id: event.id }, data: { participantCount } });
    };
    const grown = await link('integration-batch-grown', 60);
    const same = await link('integration-batch-same', 80);
    const shrunk = await link('integration-batch-shrunk', 90);
    const providerEvent = (externalId: string, participantCount: number) => ({
      externalId,
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: `Provider ${externalId}`,
      startDate,
      status: 'SCHEDULED' as const,
      participantCount,
      fieldLocked: false,
      metadata: {},
    });

    const result = await persistence.persistEventsWithDiagnostics([
      providerEvent('integration-batch-grown', 80),
      providerEvent('integration-batch-unlinked', 80),
      providerEvent('integration-batch-same', 80),
      providerEvent('integration-batch-shrunk', 70),
    ]);

    expect(result.count).toBe(3);
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 3, updated: 2, unchanged: 1, created: 0 });
    expect(result.writeDiagnostics.rows.map((row) => [row.externalId, row.disposition, row.internalId])).toEqual([
      ['integration-batch-grown', 'UPDATED', grown.id],
      ['integration-batch-same', 'UNCHANGED', same.id],
      ['integration-batch-shrunk', 'UPDATED', shrunk.id],
    ]);
    const stored = await prisma.sportEvent.findMany({
      where: { id: { in: [grown.id, same.id, shrunk.id] } },
      select: { id: true, participantCount: true, updatedAt: true },
    });
    const byId = new Map(stored.map((row) => [row.id, row]));
    expect([grown.id, same.id, shrunk.id].map((id) => byId.get(id)?.participantCount)).toEqual([80, 80, 70]);
    expect(byId.get(same.id)?.updatedAt).toEqual(same.updatedAt);
    await expect(prisma.sportEvent.count({
      where: { providerId: 'TEST_PROVIDER', externalId: 'integration-batch-unlinked' },
    })).resolves.toBe(0);
  });

  it('writes each golfer\'s seed, and the odds only when they were quoted for this event, onto the event participant', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    const golfer = (externalId: string, oddsSourceEventId: string) => ({
      externalId,
      providerId: 'TEST_PROVIDER',
      sport: Sport.GOLF,
      name: `Golfer ${externalId}`,
      active: true,
      metadata: { seed: 3, odds: 8.5, oddsSourceEventId },
    });
    const detail = rankedFieldDetail('integration-odds-field', [
      golfer('ingestion-odds-1', 'integration-odds-field'),
      golfer('ingestion-odds-2', 'some-other-event'),
    ]);
    const event = await linkedProviderEvent(prisma, {
      providerId: detail.providerId,
      externalId: detail.externalId,
      name: detail.name,
      startDate: detail.startDate,
    });

    await persistence.persistEventDetailWithDiagnostics(detail);

    const rows = await prisma.sportEventParticipant.findMany({
      where: { sportEventId: event.id },
      include: { participant: true },
    });
    const byGolfer: Record<string, { seedNumber: number | null; oddsToWin: number | null }> = {};
    for (const row of rows) {
      byGolfer[row.participant.externalId ?? row.participantId] = {
        seedNumber: row.seedNumber,
        oddsToWin: row.oddsToWin === null ? null : Number(row.oddsToWin),
      };
    }
    // Odds quoted for a different event must not bleed onto this one.
    expect(byGolfer).toEqual({
      'ingestion-odds-1': { seedNumber: 3, oddsToWin: 8.5 },
      'ingestion-odds-2': { seedNumber: 3, oddsToWin: null },
    });
  });

  // #118, #435 — an admin owns the header, rounds and status of every event, linked for
  // scores (SCORES_ONLY) or not (NONE). Sync may refresh the field size, and nothing else.
  it.each(['SCORES_ONLY', 'NONE'] as const)(
    'leaves a %s event\'s admin-owned name, start, rounds and status as they were, and refreshes only its field size',
    async (syncScope) => {
      const prisma = getPrisma();
      const persistence = new IngestionPersistence(prisma);
      const externalId = `integration-admin-header-${syncScope}`;
      const startDate = new Date('2026-06-11T12:00:00.000Z');
      const created = await linkedProviderEvent(prisma, {
        providerId: 'TEST_PROVIDER',
        externalId,
        name: 'Admin Open',
        startDate,
      });
      await prisma.sportEvent.update({ where: { id: created.id }, data: { syncScope, participantCount: 60 } });

      await persistence.persistEventsWithDiagnostics([{
        externalId,
        providerId: 'TEST_PROVIDER',
        sport: Sport.GOLF,
        name: 'Provider Open',
        startDate: new Date('2026-07-01T12:00:00.000Z'),
        status: 'IN_PROGRESS',
        rounds: 5,
        participantCount: 80,
        fieldLocked: true,
        metadata: {},
      }]);

      const row = await prisma.sportEvent.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        name: 'Admin Open',
        startDate,
        rounds: created.rounds,
        status: created.status,
        syncScope,
        participantCount: 80,
      });
    },
  );

  it('#125: the participant_ranking_snapshots table no longer exists — the global ranking snapshot is retired, not demoted', async () => {
    const prisma = getPrisma();

    const [{ table }] = await prisma.$queryRaw<Array<{ table: string | null }>>`
      SELECT to_regclass('public.participant_ranking_snapshots')::text AS "table"
    `;

    expect(table).toBeNull();
    // The model is gone, so the client type has no such key; ask the object itself.
    expect(Reflect.get(prisma, 'participantRankingSnapshot')).toBeUndefined();
  });

  // #1183 — a field sync reads its mappings and field rows at once and writes only what moved.
  it('creates a new field with its participants and mappings, then on a repeat sync writes nothing, and on a change writes only the changed golfer', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(prisma);
    type Golfer = ReturnType<typeof rankedGolfer> & Partial<SportEventDetail['participants'][number]>;
    const field = (secondRanking: number, changes: Record<string, Partial<Golfer>> = {}) => rankedFieldDetail('integration-batched-sync', [
      { ...rankedGolfer('ingestion-batch-1', 1), ...changes['ingestion-batch-1'] },
      { ...rankedGolfer('ingestion-batch-2', secondRanking), ...changes['ingestion-batch-2'] },
      { ...rankedGolfer('ingestion-batch-3', 3), ...changes['ingestion-batch-3'] },
    ]);
    const event = await linkedProviderEvent(prisma, {
      providerId: 'TEST_PROVIDER',
      externalId: 'integration-batched-sync',
      name: field(2).name,
      startDate: field(2).startDate,
    });
    const stamps = async () => {
      const rows = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { participant: true } });
      return new Map(rows.map((row) => [row.participant.externalId, [row.updatedAt.toISOString(), row.participant.updatedAt.toISOString()]]));
    };

    const created = await persistence.persistEventDetailWithDiagnostics(field(2));

    expect(created.value).toEqual({ eventsPersisted: 1, participantsPersisted: 3, sportEventParticipantsPersisted: 3 });
    expect(created.writeDiagnostics.rows.filter((row) => row.entityType === 'SportEventParticipant').map((row) => [row.disposition, Boolean(row.internalId)]))
      .toEqual([['CREATED', true], ['CREATED', true], ['CREATED', true]]);
    await expect(prisma.participantProviderMapping.count({ where: { providerId: 'TEST_PROVIDER', externalId: { startsWith: 'ingestion-batch-' } } })).resolves.toBe(3);
    const afterCreate = await stamps();

    const repeated = await persistence.persistEventDetailWithDiagnostics(field(2));

    expect(repeated.writeDiagnostics.summary).toMatchObject({ unchanged: 3, created: 0, updated: 0 });
    expect(await stamps()).toEqual(afterCreate);

    const changed = await persistence.persistEventDetailWithDiagnostics(field(9));

    expect(changed.writeDiagnostics.rows.filter((row) => row.disposition === 'UPDATED').map((row) => row.participantExternalId)).toEqual(['ingestion-batch-2']);
    const afterChange = await stamps();
    expect(afterChange.get('ingestion-batch-1')).toEqual(afterCreate.get('ingestion-batch-1'));
    expect(afterChange.get('ingestion-batch-3')).toEqual(afterCreate.get('ingestion-batch-3'));
    expect(afterChange.get('ingestion-batch-2')?.[0]).not.toBe(afterCreate.get('ingestion-batch-2')?.[0]);
    const row = await prisma.sportEventParticipant.findFirstOrThrow({ where: { sportEventId: event.id, participant: { externalId: 'ingestion-batch-2' } } });
    expect(row.ranking).toBe(9);

    // A withdrawal: the field row records it, and the rest of the field is not touched.
    const withdrawn = await persistence.persistEventDetailWithDiagnostics(field(9, {
      'ingestion-batch-3': { active: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN },
    }));

    expect(withdrawn.writeDiagnostics.rows.filter((diagnostic) => diagnostic.disposition === 'UPDATED').map((diagnostic) => diagnostic.participantExternalId)).toEqual(['ingestion-batch-3']);
    const afterWithdrawal = await stamps();
    expect(afterWithdrawal.get('ingestion-batch-1')).toEqual(afterChange.get('ingestion-batch-1'));
    expect(afterWithdrawal.get('ingestion-batch-2')).toEqual(afterChange.get('ingestion-batch-2'));
    await expect(prisma.sportEventParticipant.findFirstOrThrow({ where: { sportEventId: event.id, participant: { externalId: 'ingestion-batch-3' } } }))
      .resolves.toMatchObject({ isActive: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN });

    // A participant-only change: the participant row is rewritten, the field row is not.
    const reaffiliated = await persistence.persistEventDetailWithDiagnostics(field(9, {
      'ingestion-batch-1': { teamAffiliation: 'Team Europe' },
      'ingestion-batch-3': { active: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN },
    }));

    expect(reaffiliated.writeDiagnostics.summary).toMatchObject({ unchanged: 3, updated: 0, created: 0 });
    const afterReaffiliation = await stamps();
    const [fieldRowAt, participantAt] = afterReaffiliation.get('ingestion-batch-1') ?? [];
    expect(fieldRowAt).toBe(afterWithdrawal.get('ingestion-batch-1')?.[0]);
    expect(participantAt).not.toBe(afterWithdrawal.get('ingestion-batch-1')?.[1]);
    expect(afterReaffiliation.get('ingestion-batch-2')).toEqual(afterWithdrawal.get('ingestion-batch-2'));
    await expect(prisma.participant.findFirstOrThrow({ where: { externalId: 'ingestion-batch-1' } })).resolves.toMatchObject({ teamAffiliation: 'Team Europe' });
  });

  // #205 — the `pool-master-8yh` job-completion case went with `persistIngestionJob` and the
  // `ingestion_jobs` table: the sync-run ledger records the same job on the run (`jobPayload`).
});
