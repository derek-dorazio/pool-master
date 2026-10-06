import { expect } from '@jest/globals';
import type { Prisma } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type {
  ProviderRanking,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';

function buildInProgressEvent(): SportEvent {
  return {
    externalId: 'provider-event-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    status: 'IN_PROGRESS',
    fieldLocked: true,
    metadata: {
      releaseAt: '2026-05-01T20:00:00.000Z',
      fieldLocksAt: '2026-05-02T19:00:00.000Z',
    },
  };
}

/** The sport_events row of an event already linked to the provider event (plans/147: sync only updates these). */
function linkedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sport-event-1',
    externalId: 'provider-event-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    name: 'Manual Test Golf Tournament',
    venue: null,
    location: null,
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    endDate: null,
    status: 'SCHEDULED',
    rounds: 4,
    participantCount: null,
    releaseAt: new Date('2026-05-01T20:00:00.000Z'),
    fieldLocksAt: new Date('2026-05-02T19:00:00.000Z'),
    fieldLocked: false,
    metadata: {},
    syncScope: 'FULL',
    ...overrides,
  };
}

describe('IngestionPersistence', () => {
  // plans/147 — sync never creates a SportEvent: a provider event names no series or sport
  // league, so a created row would have to guess its tour. A linked event is updated; an
  // unlinked one is skipped and logged, and no row is written for it.
  it('pool-master-rop.68.1.4, plans/147: reports the update of a linked event and skips a provider event no event is linked to', async () => {
    const existingStartDate = new Date('2026-06-04T12:00:00.000Z');
    const existingReleaseAt = new Date('2026-05-21T12:00:00.000Z');
    const existingFieldLocksAt = new Date('2026-06-03T16:00:00.000Z');
    const prisma = {
      sportEvent: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'sport-event-1',
            externalId: 'golf-weekend-1',
            providerId: 'mock-contest-feed',
            sport: Sport.GOLF,
            name: 'Old Weekend 1 Name',
            venue: 'Old Links',
            location: null,
            startDate: existingStartDate,
            endDate: new Date('2026-06-07T22:00:00.000Z'),
            status: 'SCHEDULED',
            rounds: 4,
            participantCount: 72,
            releaseAt: existingReleaseAt,
            fieldLocksAt: existingFieldLocksAt,
            fieldLocked: false,
            metadata: {
              releaseAt: existingReleaseAt.toISOString(),
              fieldLocksAt: existingFieldLocksAt.toISOString(),
              eventType: 'stroke_play',
            },
            syncScope: 'FULL',
          })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValueOnce({ id: 'sport-event-1' }),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const logger = fakeLogger();
    const persistence = new IngestionPersistence(asPrismaClient(prisma), logger);
    const events: SportEvent[] = [
      {
        externalId: 'golf-weekend-1',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        name: 'Weekend 1 Championship',
        venue: 'PoolMaster QA Links',
        startDate: existingStartDate,
        endDate: new Date('2026-06-07T22:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 80,
        fieldLocked: false,
        metadata: {
          releaseAt: existingReleaseAt.toISOString(),
          fieldLocksAt: existingFieldLocksAt.toISOString(),
          eventType: 'stroke_play',
        },
      },
      {
        externalId: 'golf-weekend-2',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        name: 'Weekend 2 Championship',
        venue: 'PoolMaster QA Links',
        startDate: new Date('2026-06-11T12:00:00.000Z'),
        endDate: new Date('2026-06-14T22:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 80,
        fieldLocked: false,
        metadata: {
          releaseAt: '2026-05-28T12:00:00.000Z',
          fieldLocksAt: '2026-06-10T16:00:00.000Z',
          eventType: 'stroke_play',
        },
      },
    ];

    const result = await persistence.persistEventsWithDiagnostics(events);

    expect(result).toMatchObject({
      count: 1,
      value: 1,
      writeDiagnostics: {
        summary: {
          total: 1,
          unchanged: 0,
          created: 0,
          updated: 1,
          deleted: 0,
        },
        rows: [
          expect.objectContaining({
            entityType: 'SportEvent',
            disposition: 'UPDATED',
            internalId: 'sport-event-1',
            before: expect.objectContaining({
              name: 'Old Weekend 1 Name',
              participantCount: 72,
            }),
            after: expect.objectContaining({
              name: 'Weekend 1 Championship',
              participantCount: 80,
            }),
          }),
        ],
      },
    });
    expect(result.writeDiagnostics?.rows).toHaveLength(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledTimes(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sport-event-1' } }));
    expect(prisma.sportEvent.create).not.toHaveBeenCalled();
    expect(prisma.sportEvent.upsert).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'golf-weekend-2' }),
      'Skipped provider event with no linked sport event',
    );
  });

  it('pool-master-rop.68.1.3 persists provider-scoped participant ranking snapshots by provider mapping', async () => {
    const prisma = {
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'ranking-snapshot-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const ranking: ProviderRanking = {
      providerId: 'mock-contest-feed',
      participantExternalId: 'golfer-01',
      rankingType: 'OWGR',
      rank: 3,
      points: 12.34,
      asOfDate: new Date('2026-05-29T12:00:00.000Z'),
    };

    await expect(persistence.persistRankings([ranking])).resolves.toBe(1);

    expect(prisma.participantProviderMapping.findUnique).toHaveBeenCalledWith({
      where: {
        providerId_externalId: {
          providerId: 'mock-contest-feed',
          externalId: 'golfer-01',
        },
      },
    });
    expect(prisma.participantRankingSnapshot.upsert).toHaveBeenCalledWith({
      where: {
        providerId_participantId_rankingType_asOfDate: {
          providerId: 'mock-contest-feed',
          participantId: 'participant-1',
          rankingType: 'OWGR',
          asOfDate: new Date('2026-05-29T12:00:00.000Z'),
        },
      },
      create: {
        providerId: 'mock-contest-feed',
        participantId: 'participant-1',
        rankingType: 'OWGR',
        rank: 3,
        points: 12.34,
        asOfDate: new Date('2026-05-29T12:00:00.000Z'),
      },
      update: {
        rank: 3,
        points: 12.34,
      },
    });
  });

  it('pool-master-rop.68.1.4 reports created and updated ranking snapshot write diagnostics', async () => {
    const asOfDate = new Date('2026-05-29T12:00:00.000Z');
    const prisma = {
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'ranking-snapshot-existing',
            providerId: 'mock-contest-feed',
            participantId: 'participant-1',
            rankingType: 'OWGR',
            rank: 4,
            points: 10.12,
            asOfDate,
          })
          .mockResolvedValueOnce(null),
        upsert: jest.fn().mockResolvedValue({ id: 'ranking-snapshot-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const rankings: ProviderRanking[] = [
      {
        providerId: 'mock-contest-feed',
        participantExternalId: 'golfer-01',
        rankingType: 'OWGR',
        rank: 3,
        points: 12.34,
        asOfDate,
      },
      {
        providerId: 'mock-contest-feed',
        participantExternalId: 'golfer-02',
        rankingType: 'OWGR',
        rank: 8,
        points: 5.67,
        asOfDate,
      },
    ];

    await expect(persistence.persistRankingsWithDiagnostics(rankings)).resolves.toMatchObject({
      count: 2,
      value: 2,
      writeDiagnostics: {
        summary: {
          total: 2,
          unchanged: 0,
          created: 1,
          updated: 1,
          deleted: 0,
        },
        rows: [
          expect.objectContaining({
            entityType: 'ParticipantRankingSnapshot',
            disposition: 'UPDATED',
            before: expect.objectContaining({ rank: 4, points: 10.12 }),
            after: expect.objectContaining({ rank: 3, points: 12.34 }),
          }),
          expect.objectContaining({
            entityType: 'ParticipantRankingSnapshot',
            disposition: 'CREATED',
            after: expect.objectContaining({ rank: 8, points: 5.67 }),
          }),
        ],
      },
    });
  });

  it('pool-master-rop.68.1.4 reports unchanged ranking snapshots for idempotent ranking reruns', async () => {
    const asOfDate = new Date('2026-05-29T12:00:00.000Z');
    const prisma = {
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ranking-snapshot-existing',
          providerId: 'mock-contest-feed',
          participantId: 'participant-1',
          rankingType: 'OWGR',
          rank: 3,
          points: 12.34,
          asOfDate,
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'ranking-snapshot-existing' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    const result = await persistence.persistRankingsWithDiagnostics([
      {
        providerId: 'mock-contest-feed',
        participantExternalId: 'golfer-01',
        rankingType: 'OWGR',
        rank: 3,
        points: 12.34,
        asOfDate,
      },
    ]);

    expect(result.writeDiagnostics.summary).toEqual({
      total: 1,
      unchanged: 1,
      created: 0,
      updated: 0,
      deleted: 0,
    });
    expect(result.writeDiagnostics.rows).toEqual([
      expect.objectContaining({
        entityType: 'ParticipantRankingSnapshot',
        disposition: 'UNCHANGED',
        before: expect.objectContaining({ rank: 3, points: 12.34 }),
        after: expect.objectContaining({ rank: 3, points: 12.34 }),
      }),
    ]);
  });

  it('pool-master-rop.68.1.3 hydrates event participants with seed, event-scoped odds, and latest global rank', async () => {
    const prisma = {
      sportEvent: {
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce(linkedRow())
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ rank: 7 }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };

    await expect(persistence.persistEventDetail(detail)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    expect(prisma.participantRankingSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        providerId: 'mock-contest-feed',
        participantId: 'participant-1',
        rankingType: 'OWGR',
      },
      orderBy: { asOfDate: 'desc' },
    });
    expect(prisma.sportEventParticipant.upsert).toHaveBeenCalledWith({
      where: {
        sportEventId_participantId: {
          sportEventId: 'sport-event-1',
          participantId: 'participant-1',
        },
      },
      create: {
        sportEventId: 'sport-event-1',
        participantId: 'participant-1',
        isActive: true,
        inactiveReason: null,
        ranking: 7,
        oddsToWin: 8.5,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
      update: {
        isActive: true,
        inactiveReason: null,
        ranking: 7,
        oddsToWin: 8.5,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
    });
  });

  it('pool-master-rop.68.1.4 reports before and after JSON for updated event participants', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };
    const prisma = {
      sportEvent: {
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'sport-event-1',
            externalId: 'golf-open-2026',
            providerId: 'mock-contest-feed',
            sport: Sport.GOLF,
            name: 'Manual Test Golf Tournament',
            venue: null,
            location: null,
            startDate: detail.startDate,
            endDate: null,
            status: 'SCHEDULED',
            rounds: null,
            participantCount: null,
            releaseAt: new Date('2026-05-01T20:00:00.000Z'),
            fieldLocksAt: new Date('2026-05-02T19:00:00.000Z'),
            fieldLocked: true,
            metadata: detail.metadata,
          })
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ rank: 7 }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sport-event-participant-1',
          isActive: true,
          inactiveReason: null,
          ranking: 12,
          oddsToWin: 11.25,
          seedNumber: 3,
          metadata: {
            seed: 3,
            odds: 11.25,
            oddsSourceEventId: 'golf-open-2026',
          },
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    const result = await persistence.persistEventDetailWithDiagnostics(detail);

    expect(result.writeDiagnostics.summary).toEqual({
      total: 1,
      unchanged: 0,
      created: 0,
      updated: 1,
      deleted: 0,
    });
    expect(result.writeDiagnostics.rows).toEqual([
      expect.objectContaining({
        entityType: 'SportEventParticipant',
        disposition: 'UPDATED',
        name: 'Scottie Scheffler',
        before: expect.objectContaining({
          ranking: 12,
          oddsToWin: 11.25,
          seedNumber: 3,
        }),
        after: expect.objectContaining({
          ranking: 7,
          oddsToWin: 8.5,
          seedNumber: 1,
        }),
      }),
    ]);
  });

  it('pool-master-rop.68.1.3 does not bleed mismatched event odds or absent global ranking onto event participants', async () => {
    const prisma = {
      sportEvent: {
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce(linkedRow())
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'different-provider-event',
          },
        },
      ],
    };

    await expect(persistence.persistEventDetail(detail)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    expect(prisma.sportEventParticipant.upsert).toHaveBeenCalledWith({
      where: {
        sportEventId_participantId: {
          sportEventId: 'sport-event-1',
          participantId: 'participant-1',
        },
      },
      create: {
        sportEventId: 'sport-event-1',
        participantId: 'participant-1',
        isActive: true,
        inactiveReason: null,
        ranking: null,
        oddsToWin: null,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
      update: {
        isActive: true,
        inactiveReason: null,
        ranking: null,
        oddsToWin: null,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
    });
  });

  // pool-master-g1z — proves persistEventsWithDiagnostics delegates the
  // status write and its side effects to EventLifecycleService rather than
  // performing them inline; the transition logic itself (transition-map
  // validity, side effects) is covered directly in
  // tests/unit/core-api/event-lifecycle-service.test.ts.
  it('pool-master-g1z calls eventLifecycleService.applySportEventStatusTransition for each persisted event', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow()),
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const eventLifecycleService = {
      applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined),
    };
    const persistence = new IngestionPersistence(
      asPrismaClient(prisma),
      fakeLogger(),
      eventLifecycleService,
    );

    await persistence.persistEvents([buildInProgressEvent()]);

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'sport-event-1',
      toStatus: 'IN_PROGRESS',
      actor: { type: 'PROVIDER' },
    });
  });

  // #118 — an admin owns the header, rounds and status of an event it linked to a provider
  // for scores only (SCORES_ONLY) or not at all (NONE). Sync may refresh the field size, and
  // nothing else.
  it.each(['SCORES_ONLY', 'NONE'])('leaves a %s event\'s admin-owned header unchanged, writes only participantCount, and runs no provider status transition', async (syncScope) => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow({ syncScope, name: 'Admin Open', rounds: 4, participantCount: 60 })),
        update: jest.fn<Promise<{ id: string }>, [Prisma.SportEventUpdateArgs]>().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const eventLifecycleService = {
      applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined),
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), eventLifecycleService);

    const result = await persistence.persistEventsWithDiagnostics([
      { ...buildInProgressEvent(), name: 'Provider Open', rounds: 5, participantCount: 80, startDate: new Date('2026-07-01T12:00:00.000Z') },
    ]);

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({ where: { id: 'sport-event-1' }, data: { participantCount: 80 } });
    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      disposition: 'UPDATED',
      before: expect.objectContaining({ name: 'Admin Open', rounds: 4, participantCount: 60 }),
      after: expect.objectContaining({ name: 'Admin Open', rounds: 4, participantCount: 80 }),
    });
  });

  it('still overwrites a FULL event\'s header from the provider', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow({ name: 'Old Name' })),
        update: jest.fn<Promise<{ id: string }>, [Prisma.SportEventUpdateArgs]>().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    await persistence.persistEvents([{ ...buildInProgressEvent(), name: 'Provider Open', rounds: 4 }]);

    const [updateArg] = prisma.sportEvent.update.mock.calls[0];
    expect(updateArg.data).toMatchObject({ name: 'Provider Open', rounds: 4 });
  });

  it('pool-master-g1z does not write SportEvent.status directly — EventLifecycleService owns that write', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow()),
        update: jest.fn<Promise<{ id: string }>, [Prisma.SportEventUpdateArgs]>().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    await persistence.persistEvents([buildInProgressEvent()]);

    const [updateArg] = prisma.sportEvent.update.mock.calls[0];
    expect(updateArg.data).not.toHaveProperty('status');
  });
});
