import { RecordingLeaderboardRebuilds, eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { expect } from '@jest/globals';
import { MappingConfidence, Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type {
  ProviderParticipant,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import type { SportEventParticipantView } from '@poolmaster/shared/db';
import { PublicReadPath } from '../../../packages/core-api/src/core/public-cache';
import { RecordingCdnInvalidator } from '../../support/recording-cdn-invalidator';

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
 * already mapped to `participant-1`, that participant's stored field row, or none, and the
 * field's ranked rows the provider has no mapping for. Batched
 * writes run as Prisma runs a `$transaction` of them: all, in order.
 */
function fieldSyncPrisma(options: {
  externalId: string;
  eventRow: Record<string, unknown>;
  linkedEvent: Record<string, unknown> | null;
  fieldRow: Record<string, unknown> | null;
  createField?: jest.Mock;
  /** The field's ranked rows with no mapping from the provider, as the read selects them. */
  unlinkedRanked?: Array<{ ranking: number | null; participant: { id: string; name: string } }>;
}) {
  return {
    sportEvent: {
      update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      findMany: jest.fn().mockResolvedValue([options.eventRow]),
      findUnique: jest.fn().mockResolvedValue(options.linkedEvent),
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
      // The field's rows by participant, or, asked for ranked rows, the ranked ones with no mapping from the provider.
      findMany: jest.fn(({ where }: { where: Record<string, unknown>; select?: unknown; orderBy?: unknown }) => Promise.resolve('ranking' in where
        ? options.unlinkedRanked ?? []
        : options.fieldRow ? [{ participantId: 'participant-1', ...options.fieldRow }] : [])),
      update: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      createManyAndReturn: options.createField ?? jest.fn().mockResolvedValue([{ id: 'sport-event-participant-1', participantId: 'participant-1' }]),
    },
    backgroundJob: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
        findMany: jest.fn().mockResolvedValue([{
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
          }]),
        update: jest.fn().mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
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

  it('lists the field\'s ranked participants the provider has no mapping for, read best rank first, with the sync\'s result (#1664)', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      sport: Sport.BASKETBALL,
      participants: [{ externalId: 'nba-player-1', providerId: 'mock-contest-feed', sport: Sport.BASKETBALL, name: 'Jayson Tatum', active: true, metadata: {} }],
    };
    const prisma = fieldSyncPrisma({
      externalId: 'nba-player-1',
      eventRow: linkedRow({ sport: Sport.BASKETBALL }),
      linkedEvent: { id: 'sport-event-1', sport: Sport.BASKETBALL, status: 'SCHEDULED', eventSeries: { sportLeague: { participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE' } } },
      fieldRow: null,
      unlinkedRanked: [{ ranking: 2, participant: { id: 'site-doncic', name: 'Luka Dončić' } }, { ranking: 5, participant: { id: 'site-brown', name: 'Jaylen Brown' } }],
    });

    const result = await new IngestionPersistence(asPrismaClient(prisma), fakeLogger()).persistEventDetailWithDiagnostics(detail);

    expect(result.unlinkedRankedParticipants).toEqual([
      { participantId: 'site-doncic', name: 'Luka Dončić', ranking: 2 },
      { participantId: 'site-brown', name: 'Jaylen Brown', ranking: 5 },
    ]);
    expect(prisma.sportEventParticipant.findMany).toHaveBeenCalledWith({
      where: { sportEventId: 'sport-event-1', ranking: { not: null }, participant: { providerMappings: { none: { providerId: 'mock-contest-feed' } } } },
      select: { ranking: true, participant: { select: { id: true, name: true } } },
      orderBy: [{ ranking: 'asc' }, { participant: { name: 'asc' } }],
    });
  });

  it('lists no unlinked ranked participants for a provider event no event is linked to, since it writes no field', async () => {
    const prisma = fieldSyncPrisma({ externalId: 'golfer-01', eventRow: linkedRow(), linkedEvent: null, fieldRow: null });

    const result = await new IngestionPersistence(asPrismaClient(prisma), fakeLogger()).persistEventDetailWithDiagnostics({ ...buildInProgressEvent(), participants: [] });

    expect(result.unlinkedRankedParticipants).toEqual([]);
    expect(prisma.sportEventParticipant.findMany).not.toHaveBeenCalled();
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

    it('clears the public event pages at the CDN once sync writes a field, since a loaded field can open an offer (#1181)', async () => {
      const cdn = new RecordingCdnInvalidator();
      const prisma = syncedEvent(jest.fn().mockResolvedValue([{ id: 'sport-event-participant-1', participantId: 'participant-1' }]));

      await new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), undefined, cdn).persistEventDetailWithDiagnostics(detail);

      expect(cdn.calls).toEqual([[PublicReadPath.EVENT_PAGES]]);
    });

    it('forgets it too when writing the field fails partway, since some rows may have been written', async () => {
      const fieldCache = await cacheHoldingTheField();
      const prisma = syncedEvent(jest.fn().mockRejectedValue(new Error('connection reset')));

      await expect(new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), fieldCache).persistEventDetailWithDiagnostics(detail))
        .rejects.toThrow('connection reset');

      expect(await readsAfresh(fieldCache)).toBe(true);
    });
  });

  it('writes the event\'s leaderboard rebuild job in the same transaction as a field sync that changes a row, and wakes the runner after it (#1435, #1466)', async () => {
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
    const leaderboards = new RecordingLeaderboardRebuilds();
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), undefined, undefined, leaderboards);

    await persistence.persistEventDetailWithDiagnostics(detail);

    expect(prisma.backgroundJob.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ type: eventRebuildJob('sport-event-1').type, dedupeKey: eventRebuildJob('sport-event-1').dedupeKey })],
    }));
    expect(leaderboards.sportEventIds).toEqual(['sport-event-1']);
  });

  it('writes no rebuild job for a field sync that changes no row, since no board can have moved (#1466)', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [{
        externalId: 'golfer-01', providerId: 'mock-contest-feed', sport: Sport.GOLF, name: 'Scottie Scheffler', active: true, ranking: 7,
        metadata: { seed: 1, odds: 8.5, oddsSourceEventId: 'golf-open-2026' },
      }],
    };
    const prisma = fieldSyncPrisma({
      externalId: 'golfer-01',
      eventRow: { id: 'sport-event-1', externalId: 'golf-open-2026', providerId: 'mock-contest-feed', sport: Sport.GOLF, name: 'Manual Test Golf Tournament', venue: null, location: null, startDate: detail.startDate, endDate: null, status: 'SCHEDULED', rounds: null, participantCount: null, metadata: detail.metadata },
      linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { participantType: null, scoringFamily: null } } },
      fieldRow: {
        id: 'sport-event-participant-1', isActive: true, inactiveReason: null, ranking: 7, oddsToWin: 8.5, seedNumber: 1,
        metadata: { seed: 1, odds: 8.5, oddsSourceEventId: 'golf-open-2026' },
      },
    });
    const leaderboards = new RecordingLeaderboardRebuilds();
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger(), undefined, undefined, leaderboards);

    const result = await persistence.persistEventDetailWithDiagnostics(detail);

    expect(result.writeDiagnostics.rows.filter((row) => row.entityType === 'SportEventParticipant').map((row) => row.disposition)).toEqual(['UNCHANGED']);
    expect(prisma.backgroundJob.createMany).not.toHaveBeenCalled();
    expect(leaderboards.handedOut).toEqual([]);
  });

  it('reads every linked event of a feed in one query and writes only the changed ones in one transaction (#1247)', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          linkedRow({ syncScope: 'SCORES_ONLY', participantCount: 60 }),
          { ...linkedRow({ syncScope: 'SCORES_ONLY', participantCount: 80 }), id: 'sport-event-2', externalId: 'golf-unchanged' },
        ]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const changed = { ...buildInProgressEvent(), participantCount: 80 };

    const result = await persistence.persistEventsWithDiagnostics([
      changed,
      { ...changed, externalId: 'golf-unchanged' },
      { ...changed, externalId: 'golf-unlinked' },
    ]);

    expect(prisma.sportEvent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith({
      where: { OR: [{ providerId: changed.providerId, externalId: { in: ['provider-event-1', 'golf-unchanged', 'golf-unlinked'] } }] },
    });
    expect(prisma.sportEvent.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledTimes(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledWith({ where: { id: 'sport-event-1' }, data: { participantCount: 80 } });
    expect(result.writeDiagnostics.rows.map((row) => row.disposition)).toEqual(['UPDATED', 'UNCHANGED']);
  });

  it('takes a feed that names the same event twice at its last copy, writing and reporting that event once', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([linkedRow({ syncScope: 'SCORES_ONLY', participantCount: 60 })]),
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const event = buildInProgressEvent();

    const result = await persistence.persistEventsWithDiagnostics([
      { ...event, participantCount: 70 },
      { ...event, participantCount: 90 },
    ]);

    expect(result.count).toBe(1);
    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith({
      where: { OR: [{ providerId: event.providerId, externalId: { in: [event.externalId] } }] },
    });
    expect(prisma.sportEvent.update).toHaveBeenCalledTimes(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledWith({ where: { id: 'sport-event-1' }, data: { participantCount: 90 } });
    expect(result.writeDiagnostics.rows).toHaveLength(1);
  });

  it('reads and writes nothing for an empty feed', async () => {
    const prisma = { sportEvent: { findMany: jest.fn() }, $transaction: jest.fn() };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    const result = await persistence.persistEventsWithDiagnostics([]);

    expect(result.count).toBe(0);
    expect(prisma.sportEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // #118, #435 — an admin owns the header, rounds and status of every event, linked for
  // scores (SCORES_ONLY) or not (NONE). Sync may refresh the field size, and nothing else.
  it.each(['SCORES_ONLY', 'NONE'])('reports a %s event\'s admin-owned header unchanged and only its participantCount updated', async (syncScope) => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([linkedRow({ syncScope, name: 'Admin Open', rounds: 4, participantCount: 60 })]),
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
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

/**
 * A provider participant with no mapping yet (#1496): linked to the site's one of the same sport
 * and name, or created. The double serves a feed whose event no event is linked to, so the sync
 * writes participants and stops there.
 */
describe('IngestionPersistence: provider participants with no mapping yet', () => {
  type Candidate = {
    id: string;
    sportId: string;
    name: string;
    providerMappings: Array<{ providerId: string }>;
    /** The sport leagues it is affiliated with, by match keyword; none when left out. */
    leagueAffiliations?: Array<{ sportLeague: { matchKeyword: string | null } }>;
  };

  function golfer(externalId: string, name: string, providerId = 'balldontlie'): ProviderParticipant {
    return { externalId, providerId, sport: Sport.GOLF, name, active: true, metadata: {} };
  }

  /** A college basketball team as a provider sends it, naming its league by match keyword. */
  function collegeTeam(externalId: string, name: string, tour: string): ProviderParticipant {
    return { externalId, providerId: 'balldontlie', sport: Sport.BASKETBALL, name, active: true, metadata: { tour } };
  }

  /** The site's team of a name, affiliated with the leagues whose keywords are given. */
  function siteTeam(id: string, name: string, keywords: Array<string | null>): Candidate {
    return { id, sportId: 'sport-basketball', name, providerMappings: [], leagueAffiliations: keywords.map((matchKeyword) => ({ sportLeague: { matchKeyword } })) };
  }

  /** The site's sport leagues the feed's tours may name, by id and match keyword. */
  const LEAGUES = [
    { id: 'league-nba-finals', sportId: 'sport-basketball', matchKeyword: 'NBA Finals' },
    { id: 'league-ncaam', sportId: 'sport-basketball', matchKeyword: 'NCAAM' },
  ];

  function unmappedPrisma(candidates: Candidate[]) {
    const double = {
      // The leagues whose keyword one of the asked-for tours names, ignoring case, as the database answers.
      sportLeague: {
        findMany: jest.fn(({ where }: { where: { OR: Array<{ sportId: string; matchKeyword: { in: string[]; mode?: string } }> }; select?: unknown }) => Promise.resolve(LEAGUES
          .filter((league) => where.OR.some((asked) => asked.sportId === league.sportId && asked.matchKeyword.in.some((tour) => tour.toLowerCase() === league.matchKeyword.toLowerCase())))
          .map(({ id, sportId }) => ({ id, sportId })))),
      },
      sportEvent: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      sport: { upsert: jest.fn(({ where }: { where: { sport: Sport } }) => Promise.resolve({ id: `sport-${where.sport.toLowerCase()}`, participantType: 'INDIVIDUAL' })) },
      participant: {
        findMany: jest.fn().mockResolvedValue(candidates.map((candidate) => ({ leagueAffiliations: [], ...candidate }))),
        createManyAndReturn: jest.fn(({ data }: { data: Array<{ sportId: string; externalId: string }> }) => Promise.resolve(
          data.map((row) => ({ id: `created-${row.externalId}`, sportId: row.sportId, externalId: row.externalId })),
        )),
      },
      participantProviderMapping: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    // A callback transaction runs on the double itself; a batch runs all, in order.
    const $transaction = jest.fn((work: unknown): Promise<unknown> => (typeof work === 'function'
      ? (work as (tx: typeof double) => Promise<unknown>)(double)
      : Promise.all(work as Array<Promise<unknown>>)));
    return { ...double, $transaction };
  }

  async function sync(prisma: ReturnType<typeof unmappedPrisma>, participants: ProviderParticipant[]) {
    const logger = fakeLogger();
    await new IngestionPersistence(asPrismaClient(prisma), logger).persistEventDetailWithDiagnostics({ ...buildInProgressEvent(), participants });
    const [[{ data: mappings }]] = prisma.participantProviderMapping.createMany.mock.calls as Array<[{ data: Array<{ participantId: string; externalId: string; confidence: string }> }]>;
    return { mappings, logger };
  }

  const createdNames = (prisma: ReturnType<typeof unmappedPrisma>) =>
    prisma.participant.createManyAndReturn.mock.calls.flatMap(([{ data }]) => data.map((row) => (row as unknown as { name: string }).name));

  it('links a golfer to the site\'s only one of that name and sport, with HIGH confidence, and creates no second one', async () => {
    const prisma = unmappedPrisma([{ id: 'site-scheffler', sportId: 'sport-golf', name: 'Scottie Scheffler', providerMappings: [] }]);

    const { mappings, logger } = await sync(prisma, [golfer('bdl-1', 'Scottie Scheffler')]);

    expect(mappings).toEqual([{ participantId: 'site-scheffler', providerId: 'balldontlie', externalId: 'bdl-1', confidence: MappingConfidence.HIGH }]);
    expect(prisma.participant.createManyAndReturn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ linked: 1, created: 0 }), 'Persisted participants from ingestion');
  });

  it('reads the candidates by sport and name, with only the mappings from the feed\'s own providers and the keywords of their leagues', async () => {
    const prisma = unmappedPrisma([]);

    await sync(prisma, [golfer('bdl-1', 'Scottie Scheffler'), golfer('mock-1', 'Rory McIlroy', 'mock-contest-feed')]);

    expect(prisma.participant.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.participant.findMany).toHaveBeenCalledWith({
      where: { OR: [{ sportId: 'sport-golf', name: { in: ['Scottie Scheffler', 'Rory McIlroy'] } }] },
      select: {
        id: true,
        sportId: true,
        name: true,
        providerMappings: { where: { providerId: { in: ['balldontlie', 'mock-contest-feed'] } }, select: { providerId: true } },
        leagueAffiliations: { select: { sportLeague: { select: { matchKeyword: true } } } },
      },
    });
  });

  it('links a school\'s men\'s and women\'s teams, which share a name, each to the site\'s team in its own league', async () => {
    const prisma = unmappedPrisma([siteTeam('site-duke-men', 'Duke Blue Devils', ['NCAAM']), siteTeam('site-duke-women', 'Duke Blue Devils', ['NCAAW'])]);

    const { mappings } = await sync(prisma, [collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM'), collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(mappings).toEqual([
      { participantId: 'site-duke-men', providerId: 'balldontlie', externalId: 'ncaab-team-150', confidence: MappingConfidence.HIGH },
      { participantId: 'site-duke-women', providerId: 'balldontlie', externalId: 'ncaaw-team-150', confidence: MappingConfidence.HIGH },
    ]);
    expect(prisma.participant.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('links a school\'s men\'s and women\'s teams both to the site\'s one row for the school, affiliated with both leagues, and creates none', async () => {
    const prisma = unmappedPrisma([siteTeam('site-duke', 'Duke Blue Devils', ['NCAAM', 'NCAAW'])]);

    const { mappings } = await sync(prisma, [collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM'), collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(mappings).toEqual([
      { participantId: 'site-duke', providerId: 'balldontlie', externalId: 'ncaab-team-150', confidence: MappingConfidence.HIGH },
      { participantId: 'site-duke', providerId: 'balldontlie', externalId: 'ncaaw-team-150', confidence: MappingConfidence.HIGH },
    ]);
    expect(prisma.participant.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('matches a league\'s keyword whatever its case and spacing, as an event\'s tour is matched', async () => {
    const prisma = unmappedPrisma([siteTeam('site-duke-women', 'Duke Blue Devils', [null, ' ncaaw '])]);

    const { mappings } = await sync(prisma, [collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(mappings).toEqual([{ participantId: 'site-duke-women', providerId: 'balldontlie', externalId: 'ncaaw-team-150', confidence: MappingConfidence.HIGH }]);
  });

  it('creates a team whose name the site has only in the other league, rather than linking it across leagues', async () => {
    const prisma = unmappedPrisma([siteTeam('site-duke-men', 'Duke Blue Devils', ['NCAAM']), siteTeam('site-unaffiliated', 'Duke Blue Devils', [])]);

    const { mappings } = await sync(prisma, [collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(createdNames(prisma)).toEqual(['Duke Blue Devils']);
    expect(mappings).toEqual([{ participantId: 'created-ncaaw-team-150', providerId: 'balldontlie', externalId: 'ncaaw-team-150', confidence: MappingConfidence.EXACT }]);
  });

  it('counts a name the feed sends in two leagues once per league, so neither blocks the other\'s link', async () => {
    const prisma = unmappedPrisma([siteTeam('site-duke-men', 'Duke Blue Devils', ['NCAAM'])]);

    const { mappings } = await sync(prisma, [collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM'), collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(mappings).toEqual([
      { participantId: 'created-ncaaw-team-150', providerId: 'balldontlie', externalId: 'ncaaw-team-150', confidence: MappingConfidence.EXACT },
      { participantId: 'site-duke-men', providerId: 'balldontlie', externalId: 'ncaab-team-150', confidence: MappingConfidence.HIGH },
    ]);
  });

  it('creates a team the feed sends twice in one league, though the site has one of that name there', async () => {
    const prisma = unmappedPrisma([siteTeam('site-duke-men', 'Duke Blue Devils', ['NCAAM'])]);

    await sync(prisma, [collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM'), collegeTeam('ncaab-team-999', 'Duke Blue Devils', 'NCAAM')]);

    expect(createdNames(prisma)).toEqual(['Duke Blue Devils', 'Duke Blue Devils']);
  });

  /** An NBA player as a provider sends him for a Clutch Card round, naming its sport league. */
  function finalsPlayer(externalId: string, name: string): ProviderParticipant {
    return { externalId, providerId: 'balldontlie', sport: Sport.BASKETBALL, name, active: true, metadata: { tour: 'NBA Finals' } };
  }

  it('links a player to the site\'s star of his league whose name differs only by accents, case and punctuation, with HIGH confidence (#1664)', async () => {
    const prisma = unmappedPrisma([siteTeam('site-doncic', 'Luka Dončić', ['NBA Finals']), siteTeam('site-pj', 'P.J. Washington', ['NBA Finals'])]);

    const { mappings } = await sync(prisma, [finalsPlayer('nba-player-132', 'Luka Doncic'), finalsPlayer('nba-player-7', 'pj washington')]);

    expect(mappings).toEqual([
      { participantId: 'site-doncic', providerId: 'balldontlie', externalId: 'nba-player-132', confidence: MappingConfidence.HIGH },
      { participantId: 'site-pj', providerId: 'balldontlie', externalId: 'nba-player-7', confidence: MappingConfidence.HIGH },
    ]);
    expect(prisma.participant.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('links a player to the site\'s star of his league whose name differs by a trailing suffix (#1664)', async () => {
    const prisma = unmappedPrisma([siteTeam('site-jjj', 'Jaren Jackson Jr.', ['NBA Finals'])]);

    const { mappings } = await sync(prisma, [finalsPlayer('nba-player-3', 'Jaren Jackson')]);

    expect(mappings).toEqual([{ participantId: 'site-jjj', providerId: 'balldontlie', externalId: 'nba-player-3', confidence: MappingConfidence.HIGH }]);
  });

  it('creates a player whose folded name two of the league\'s stars share, neither spelled as the feed spells it, rather than guessing (#1664)', async () => {
    const prisma = unmappedPrisma([siteTeam('site-a', 'Luka Dončić', ['NBA Finals']), siteTeam('site-b', 'LUKA DONČIĆ', ['NBA Finals'])]);

    const { mappings } = await sync(prisma, [finalsPlayer('nba-player-132', 'Luka Doncic')]);

    expect(createdNames(prisma)).toEqual(['Luka Doncic']);
    expect(mappings).toEqual([{ participantId: 'created-nba-player-132', providerId: 'balldontlie', externalId: 'nba-player-132', confidence: MappingConfidence.EXACT }]);
  });

  it('links the star spelled exactly as the feed spells him, where another of the league\'s stars folds to the same name', async () => {
    const prisma = unmappedPrisma([siteTeam('site-accented', 'Luka Dončić', ['NBA Finals']), siteTeam('site-plain', 'Luka Doncic', ['NBA Finals'])]);

    const { mappings } = await sync(prisma, [finalsPlayer('nba-player-132', 'Luka Doncic')]);

    expect(mappings).toEqual([{ participantId: 'site-plain', providerId: 'balldontlie', externalId: 'nba-player-132', confidence: MappingConfidence.HIGH }]);
  });

  it('creates both of two players the feed sends in one league whose names fold the same, though the site has one of that name', async () => {
    const prisma = unmappedPrisma([siteTeam('site-doncic', 'Luka Dončić', ['NBA Finals'])]);

    await sync(prisma, [finalsPlayer('nba-player-132', 'Luka Doncic'), finalsPlayer('nba-player-999', 'Luka Dončić')]);

    expect(createdNames(prisma)).toEqual(['Luka Doncic', 'Luka Dončić']);
  });

  it('creates a player whose folded name the site has only in another league, rather than linking it across leagues', async () => {
    const prisma = unmappedPrisma([siteTeam('site-doncic', 'Luka Dončić', ['NBA Conference Finals'])]);

    await sync(prisma, [finalsPlayer('nba-player-132', 'Luka Doncic')]);

    expect(createdNames(prisma)).toEqual(['Luka Doncic']);
  });

  it('links a participant that names no sport league only by its exact name, since the site\'s every spelling of it in the sport is not read', async () => {
    const prisma = unmappedPrisma([{ id: 'site-aberg', sportId: 'sport-golf', name: 'Ludvig Åberg', providerMappings: [] }]);

    await sync(prisma, [golfer('bdl-9', 'Ludvig Aberg')]);

    expect(createdNames(prisma)).toEqual(['Ludvig Aberg']);
  });

  it('reads, with the exact names, every participant of the sport affiliated with a league the feed names, found by keyword first, so a folded name is matched among them all', async () => {
    const prisma = unmappedPrisma([]);

    await sync(prisma, [finalsPlayer('nba-player-132', 'Luka Doncic'), collegeTeam('ncaab-team-150', 'Duke Blue Devils', ' NCAAM ')]);

    expect(prisma.sportLeague.findMany).toHaveBeenCalledWith({
      where: { OR: [{ sportId: 'sport-basketball', matchKeyword: { in: ['NBA Finals', 'NCAAM'], mode: 'insensitive' } }] },
      select: { id: true, sportId: true },
    });
    expect(prisma.participant.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.participant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { sportId: 'sport-basketball', name: { in: ['Luka Doncic', 'Duke Blue Devils'] } },
        { sportId: 'sport-basketball', leagueAffiliations: { some: { sportLeagueId: { in: ['league-nba-finals', 'league-ncaam'] } } } },
      ] },
    }));
  });

  it('reads no league for a feed that names none, and reads its candidates by exact name alone', async () => {
    const prisma = unmappedPrisma([]);

    await sync(prisma, [golfer('bdl-1', 'Scottie Scheffler')]);

    expect(prisma.sportLeague.findMany).not.toHaveBeenCalled();
    expect(prisma.participant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ sportId: 'sport-golf', name: { in: ['Scottie Scheffler'] } }] } }));
  });

  it('reads by exact name alone when no league has the keyword the feed names', async () => {
    const prisma = unmappedPrisma([]);

    await sync(prisma, [collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(prisma.participant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ sportId: 'sport-basketball', name: { in: ['Duke Blue Devils'] } }] } }));
  });

  it.each([
    ['a name two of the site\'s golfers share', [
      { id: 'site-a', sportId: 'sport-golf', name: 'Tom Kim', providerMappings: [] },
      { id: 'site-b', sportId: 'sport-golf', name: 'Tom Kim', providerMappings: [] },
    ], [golfer('bdl-1', 'Tom Kim')]],
    ['a name the site\'s golfer has from this provider already, under another id', [
      { id: 'site-a', sportId: 'sport-golf', name: 'Tom Kim', providerMappings: [{ providerId: 'balldontlie' }] },
    ], [golfer('bdl-1', 'Tom Kim')]],
    ['a name the feed sends for two golfers', [
      { id: 'site-a', sportId: 'sport-golf', name: 'Tom Kim', providerMappings: [] },
    ], [golfer('bdl-1', 'Tom Kim'), golfer('bdl-2', 'Tom Kim')]],
    ['a name the site has no golfer by', [], [golfer('bdl-1', 'Tom Kim')]],
  ])('creates the golfer, with an EXACT mapping, for %s', async (_label, candidates, participants) => {
    const prisma = unmappedPrisma(candidates);

    const { mappings } = await sync(prisma, participants);

    expect(createdNames(prisma)).toEqual(participants.map((participant) => participant.name));
    expect(mappings).toEqual(participants.map((participant) => ({
      participantId: `created-${participant.externalId}`,
      providerId: 'balldontlie',
      externalId: participant.externalId,
      confidence: MappingConfidence.EXACT,
    })));
  });
});
