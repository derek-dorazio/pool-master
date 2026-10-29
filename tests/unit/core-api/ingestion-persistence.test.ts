import { expect } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type {
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import type { SportEventParticipantView } from '@poolmaster/shared/db';

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
    syncScope: 'SCORES_ONLY',
    ...overrides,
  };
}

/**
 * A Prisma double for one event's field sync: the event's two reads, one provider participant
 * already mapped to `participant-1`, and that participant's stored field row, or none. Batched
 * writes run as Prisma runs a `$transaction` of them: all, in order.
 */
function fieldSyncPrisma(options: {
  externalId: string;
  eventRow: Record<string, unknown>;
  linkedEvent: Record<string, unknown>;
  fieldRow: Record<string, unknown> | null;
  createField?: jest.Mock;
}) {
  return {
    sportEvent: {
      update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      findUnique: jest.fn().mockResolvedValueOnce(options.eventRow).mockResolvedValueOnce(options.linkedEvent),
    },
    participantProviderMapping: {
      findMany: jest.fn().mockResolvedValue([{
        providerId: 'mock-contest-feed',
        externalId: options.externalId,
        participantId: 'participant-1',
        participant: { id: 'participant-1', name: 'Stored Name' },
      }]),
    },
    participant: { update: jest.fn().mockResolvedValue({ id: 'participant-1' }) },
    sportEventParticipant: {
      findMany: jest.fn().mockResolvedValue(options.fieldRow ? [{ participantId: 'participant-1', ...options.fieldRow }] : []),
      update: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      createManyAndReturn: options.createField ?? jest.fn().mockResolvedValue([{ id: 'sport-event-participant-1', participantId: 'participant-1' }]),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
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
            syncScope: 'SCORES_ONLY',
          })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValueOnce({ id: 'sport-event-1' }),
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
              name: 'Old Weekend 1 Name',
              participantCount: 80,
            }),
          }),
        ],
      },
    });
    expect(result.writeDiagnostics.rows).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'golf-weekend-2' }),
      'Skipped provider event with no linked sport event',
    );
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
          ranking: 7,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };
    const prisma = fieldSyncPrisma({
      externalId: 'golfer-01',
      eventRow: {
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
      },
      linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { participantType: null, scoringFamily: null } } },
      fieldRow: {
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
      },
    });
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

  // #698 — a released bracket's seeds are fixed: the field sync keeps the stored seed, while a
  // draft still takes the provider's.
  // #934 — a stat pool event (the NBA Finals' players) plays no bracket, so a released one has no
  // seeds to lock either.
  it.each([
    ['keeps the stored seed 3 on a released basketball event', 'SCHEDULED', null, 3],
    ['takes the provider\'s seed 1 on a draft basketball event', 'DRAFT', null, 1],
    ['takes the provider\'s seed 1 on a released basketball stat pool event', 'SCHEDULED', 'COMPOSITE', 1],
  ])('%s', async (_label, status, scoringFamily, expectedSeed) => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      sport: Sport.BASKETBALL,
      status: 'SCHEDULED',
      participants: [{
        externalId: 'team-01',
        providerId: 'mock-contest-feed',
        sport: Sport.BASKETBALL,
        name: 'Duke',
        active: true,
        metadata: { seed: 1 },
      }],
    };
    const prisma = fieldSyncPrisma({
      externalId: 'team-01',
      eventRow: linkedRow({ sport: Sport.BASKETBALL, status, rounds: 6 }),
      linkedEvent: {
        id: 'sport-event-1',
        sport: Sport.BASKETBALL,
        status,
        eventSeries: { sportLeague: { participantType: scoringFamily === null ? null : 'INDIVIDUAL', scoringFamily } },
      },
      fieldRow: {
        id: 'sport-event-participant-1',
        isActive: true,
        inactiveReason: null,
        ranking: null,
        oddsToWin: null,
        seedNumber: 3,
        metadata: { seed: 3 },
      },
    });
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    await persistence.persistEventDetailWithDiagnostics(detail);

    expect(prisma.sportEventParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ seedNumber: expectedSeed }),
    }));
  });

  // #1163 — a viewer's read of the event's field is shared for 30 seconds; once sync writes the
  // field, this container reads it afresh.
  describe('the event\'s field this container read lately', () => {
    const NOW = new Date('2026-10-28T20:00:00.000Z');
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      participants: [{ externalId: 'golfer-01', providerId: 'mock-contest-feed', sport: Sport.GOLF, name: 'Scottie Scheffler', active: true, ranking: 1, metadata: {} }],
    };

    function syncedEvent(createField: jest.Mock) {
      return fieldSyncPrisma({
        externalId: 'golfer-01',
        eventRow: linkedRow(),
        linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { participantType: null, scoringFamily: null } } },
        fieldRow: null,
        createField,
      });
    }

    async function cacheHoldingTheField() {
      const fieldCache = new ReadCache<SportEventParticipantView[]>();
      await fieldCache.get('sport-event-1', NOW, async () => []);
      return fieldCache;
    }

    async function readsAfresh(fieldCache: ReadCache<SportEventParticipantView[]>): Promise<boolean> {
      let read = false;
      await fieldCache.get('sport-event-1', NOW, async () => { read = true; return []; });
      return read;
    }

    it('forgets the event\'s field once sync writes it, so the next read of it is current', async () => {
      const fieldCache = await cacheHoldingTheField();
      const prisma = syncedEvent(jest.fn().mockResolvedValue([{ id: 'sport-event-participant-1', participantId: 'participant-1' }]));

      await new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), fieldCache).persistEventDetailWithDiagnostics(detail);

      expect(await readsAfresh(fieldCache)).toBe(true);
    });

    it('forgets it too when writing the field fails partway, since some rows may have been written', async () => {
      const fieldCache = await cacheHoldingTheField();
      const prisma = syncedEvent(jest.fn().mockRejectedValue(new Error('connection reset')));

      await expect(new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), fieldCache).persistEventDetailWithDiagnostics(detail))
        .rejects.toThrow('connection reset');

      expect(await readsAfresh(fieldCache)).toBe(true);
    });
  });

  // #118, #435 — an admin owns the header, rounds and status of every event, linked for
  // scores (SCORES_ONLY) or not (NONE). Sync may refresh the field size, and nothing else.
  it.each(['SCORES_ONLY', 'NONE'])('reports a %s event\'s admin-owned header unchanged and only its participantCount updated', async (syncScope) => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow({ syncScope, name: 'Admin Open', rounds: 4, participantCount: 60 })),
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    const result = await persistence.persistEventsWithDiagnostics([
      { ...buildInProgressEvent(), name: 'Provider Open', rounds: 5, participantCount: 80, startDate: new Date('2026-07-01T12:00:00.000Z') },
    ]);

    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      disposition: 'UPDATED',
      before: expect.objectContaining({ name: 'Admin Open', rounds: 4, participantCount: 60 }),
      after: expect.objectContaining({ name: 'Admin Open', rounds: 4, participantCount: 80 }),
    });
  });

});
