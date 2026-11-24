import { testDomainEvents } from '../../support/domain-events';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { expect } from '@jest/globals';
import { BackgroundJobType, ProviderCode, Sport } from '@poolmaster/shared/domain';
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
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';

function buildInProgressEvent(): SportEvent {
  return {
    externalId: 'provider-event-1',
    providerId: 'balldontlie',
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
    providerId: 'balldontlie',
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
    // The event's sport league, which the sync's new participants belong to (#1853).
    eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'INDIVIDUAL' } } },
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
        id: 'mapping-1',
        // Keyed to the Provider row (#2040); the read joins its code.
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        provider: { code: ProviderCode.BALLDONTLIE },
        externalId: options.externalId,
        participantId: 'participant-1',
        participant: { id: 'participant-1', name: 'Stored Name' },
      }]),
      // Marks the mappings the field matched as seen in the feed (#1865).
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
            providerId: 'balldontlie',
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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), logger);
    const events: SportEvent[] = [
      {
        externalId: 'golf-weekend-1',
        providerId: 'balldontlie',
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
        providerId: 'balldontlie',
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
          providerId: 'balldontlie',
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
        providerId: 'balldontlie',
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
      linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'INDIVIDUAL' } } } },
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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger());

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
      participants: [{ externalId: 'nba-player-1', providerId: 'balldontlie', sport: Sport.BASKETBALL, name: 'Jayson Tatum', active: true, metadata: {} }],
    };
    const prisma = fieldSyncPrisma({
      externalId: 'nba-player-1',
      eventRow: linkedRow({ sport: Sport.BASKETBALL }),
      linkedEvent: { id: 'sport-event-1', sport: Sport.BASKETBALL, status: 'SCHEDULED', eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'TEAM' } } } },
      fieldRow: null,
      unlinkedRanked: [{ ranking: 2, participant: { id: 'site-doncic', name: 'Luka Dončić' } }, { ranking: 5, participant: { id: 'site-brown', name: 'Jaylen Brown' } }],
    });

    const result = await new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger()).persistEventDetailWithDiagnostics(detail);

    expect(result.unlinkedRankedParticipants).toEqual([
      { participantId: 'site-doncic', name: 'Luka Dončić', ranking: 2 },
      { participantId: 'site-brown', name: 'Jaylen Brown', ranking: 5 },
    ]);
    expect(prisma.sportEventParticipant.findMany).toHaveBeenCalledWith({
      where: { sportEventId: 'sport-event-1', ranking: { not: null }, participant: { providerMappings: { none: { provider: { code: ProviderCode.BALLDONTLIE } } } } },
      select: { ranking: true, participant: { select: { id: true, name: true } } },
      orderBy: [{ ranking: 'asc' }, { participant: { name: 'asc' } }],
    });
  });

  it('lists no unlinked ranked participants for a provider event no event is linked to, since it writes no field', async () => {
    const prisma = fieldSyncPrisma({ externalId: 'golfer-01', eventRow: linkedRow(), linkedEvent: null, fieldRow: null });

    const result = await new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger()).persistEventDetailWithDiagnostics({ ...buildInProgressEvent(), participants: [] });

    expect(result.unlinkedRankedParticipants).toEqual([]);
    expect(prisma.sportEventParticipant.findMany).not.toHaveBeenCalled();
  });

  // #698 — a released bracket's seeds are fixed: the field sync keeps the stored seed, while a
  // draft still takes the provider's.
  it.each([
    ['keeps the stored seed 3 on a released basketball event', 'SCHEDULED', 3],
    ['takes the provider\'s seed 1 on a draft basketball event', 'DRAFT', 1],
  ])('%s', async (_label, status, expectedSeed) => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      sport: Sport.BASKETBALL,
      status: 'SCHEDULED',
      participants: [{
        externalId: 'team-01',
        providerId: 'balldontlie',
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
        eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'TEAM' } } },
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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger());

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
      participants: [{ externalId: 'golfer-01', providerId: 'balldontlie', sport: Sport.GOLF, name: 'Scottie Scheffler', active: true, ranking: 1, metadata: {} }],
    };

    function syncedEvent(createField: jest.Mock) {
      return fieldSyncPrisma({
        externalId: 'golfer-01',
        eventRow: linkedRow(),
        linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'INDIVIDUAL' } } } },
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

      await new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger(), fieldCache).persistEventDetailWithDiagnostics(detail);

      expect(await readsAfresh(fieldCache)).toBe(true);
    });

    it('clears the public event pages at the CDN once sync writes a field, since a loaded field can open an offer (#1181)', async () => {
      const cdn = new RecordingCdnInvalidator();
      const prisma = syncedEvent(jest.fn().mockResolvedValue([{ id: 'sport-event-participant-1', participantId: 'participant-1' }]));

      await new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger(), undefined, cdn).persistEventDetailWithDiagnostics(detail);

      expect(cdn.calls).toEqual([[PublicReadPath.EVENT_PAGES]]);
    });

    it('forgets it too when writing the field fails partway, since some rows may have been written', async () => {
      const fieldCache = await cacheHoldingTheField();
      const prisma = syncedEvent(jest.fn().mockRejectedValue(new Error('connection reset')));

      await expect(new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger(), fieldCache).persistEventDetailWithDiagnostics(detail))
        .rejects.toThrow('connection reset');

      expect(await readsAfresh(fieldCache)).toBe(true);
    });
  });

  it('writes the event\'s leaderboard rebuild job and the sync\'s follow-up job in the one transaction of a field sync that changes a row, and wakes the runner after it (#1435, #1466, #1952)', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'balldontlie',
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
        providerId: 'balldontlie',
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
      linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'INDIVIDUAL' } } } },
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
    const domainEvents = new RecordingDomainEvents();
    const persistence = new IngestionPersistence(asPrismaClient(prisma), domainEvents, fakeLogger());

    await persistence.persistEventDetailWithDiagnostics(detail);

    expect(prisma.backgroundJob.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({ type: eventRebuildJob('sport-event-1').type, dedupeKey: eventRebuildJob('sport-event-1').dedupeKey }),
        expect.objectContaining({ type: BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS, dedupeKey: `${BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS}:sport-event-1` }),
      ],
    }));
    expect(prisma.backgroundJob.createMany).toHaveBeenCalledTimes(1);
    expect(domainEvents.changedSportEventIds).toEqual(['sport-event-1']);
  });

  it('writes no rebuild job for a field sync that changes no row, since no board can have moved, but still writes the sync\'s follow-up job (#1466, #1952)', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [{
        externalId: 'golfer-01', providerId: 'balldontlie', sport: Sport.GOLF, name: 'Scottie Scheffler', active: true, ranking: 7,
        metadata: { seed: 1, odds: 8.5, oddsSourceEventId: 'golf-open-2026' },
      }],
    };
    const prisma = fieldSyncPrisma({
      externalId: 'golfer-01',
      eventRow: { id: 'sport-event-1', externalId: 'golf-open-2026', providerId: 'balldontlie', sport: Sport.GOLF, name: 'Manual Test Golf Tournament', venue: null, location: null, startDate: detail.startDate, endDate: null, status: 'SCHEDULED', rounds: null, participantCount: null, metadata: detail.metadata },
      linkedEvent: { id: 'sport-event-1', sport: Sport.GOLF, status: 'SCHEDULED', eventSeries: { sportLeague: { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'INDIVIDUAL' } } } },
      fieldRow: {
        id: 'sport-event-participant-1', isActive: true, inactiveReason: null, ranking: 7, oddsToWin: 8.5, seedNumber: 1,
        metadata: { seed: 1, odds: 8.5, oddsSourceEventId: 'golf-open-2026' },
      },
    });
    const domainEvents = new RecordingDomainEvents();
    const persistence = new IngestionPersistence(asPrismaClient(prisma), domainEvents, fakeLogger());

    const result = await persistence.persistEventDetailWithDiagnostics(detail);

    expect(result.writeDiagnostics.rows.filter((row) => row.entityType === 'SportEventParticipant').map((row) => row.disposition)).toEqual(['UNCHANGED']);
    expect(prisma.backgroundJob.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.backgroundJob.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ type: BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS })],
    }));
    expect(domainEvents.handedOutSportEventIds).toEqual([]);
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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger());
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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger());
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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger());

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
    const persistence = new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger());

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
 * A provider participant with no mapping yet (#1496): created in the sport league of the event the
 * sync fields them in (#1853), and never linked to a participant by its name (#1850). The double
 * serves an event linked to the feed's, on that league; the field it writes is tested elsewhere.
 */
describe('IngestionPersistence: provider participants with no mapping yet', () => {
  /** The site's participant of a name, which no feed id maps: a sync never links it by its name (#1850). */
  type SiteParticipant = { id: string; sportLeagueId: string; name: string };

  const EVENT_LEAGUE = { id: 'league-event', participantType: null, scoringFamily: null, sport: { participantType: 'INDIVIDUAL' } };

  function golfer(externalId: string, name: string, providerId = 'balldontlie'): ProviderParticipant {
    return { externalId, providerId, sport: Sport.GOLF, name, active: true, metadata: {} };
  }

  /** A college basketball team as a provider sends it, naming its league by match keyword. */
  function collegeTeam(externalId: string, name: string, tour: string): ProviderParticipant {
    return { externalId, providerId: 'balldontlie', sport: Sport.BASKETBALL, name, active: true, metadata: { tour } };
  }

  function unmappedPrisma(siteParticipants: SiteParticipant[] = [], linked = true) {
    const double = {
      sportLeague: { findMany: jest.fn().mockResolvedValue([]) },
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(linked ? linkedRow() : null),
      },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([]),
        createManyAndReturn: jest.fn(({ data }: { data: Array<{ participantId: string }> }) => Promise.resolve(
          data.map((row) => ({ id: `entry-${row.participantId}`, participantId: row.participantId })),
        )),
      },
      participant: {
        // What the site holds; a sync that matched by name would read it.
        findMany: jest.fn().mockResolvedValue(siteParticipants),
        // Numbered in the order given, as Postgres returns them.
        createManyAndReturn: jest.fn(({ data }: { data: unknown[] }) => Promise.resolve(data.map((_row, index) => ({ id: `created-${index + 1}` })))),
      },
      provider: { findMany: jest.fn().mockResolvedValue([{ id: BALLDONTLIE_TEST_PROVIDER_ID, code: ProviderCode.BALLDONTLIE }]) },
      participantProviderMapping: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      // The field write carries the event's leaderboard rebuild (#1466).
      backgroundJob: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    // A callback transaction runs on the double itself; a batch runs all, in order.
    const $transaction = jest.fn((work: unknown): Promise<unknown> => (typeof work === 'function'
      ? (work as (tx: typeof double) => Promise<unknown>)(double)
      : Promise.all(work as Array<Promise<unknown>>)));
    return { ...double, $transaction };
  }

  async function sync(prisma: ReturnType<typeof unmappedPrisma>, participants: ProviderParticipant[]) {
    const logger = fakeLogger();
    await new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), logger).persistEventDetailWithDiagnostics({ ...buildInProgressEvent(), participants });
    const [[{ data: mappings }]] = prisma.participantProviderMapping.createMany.mock.calls as Array<[{ data: Array<{ participantId: string; externalId: string }> }]>;
    return { mappings, logger };
  }

  const createdRows = (prisma: ReturnType<typeof unmappedPrisma>) =>
    prisma.participant.createManyAndReturn.mock.calls.flatMap(([{ data }]) => data as unknown as Array<{ name: string; sportLeagueId: string; participantType: string }>);
  const createdNames = (prisma: ReturnType<typeof unmappedPrisma>) => createdRows(prisma).map((row) => row.name);

  it('creates a golfer whose feed id no participant of the league is mapped to, mapped in the league to the BALLDONTLIE Provider row, though the league has an unmapped golfer of the same name', async () => {
    const prisma = unmappedPrisma([{ id: 'site-scheffler', sportLeagueId: EVENT_LEAGUE.id, name: 'Scottie Scheffler' }]);

    const { mappings, logger } = await sync(prisma, [golfer('bdl-1', 'Scottie Scheffler')]);

    expect(createdNames(prisma)).toEqual(['Scottie Scheffler']);
    expect(mappings).toEqual([{ participantId: 'created-1', sportLeagueId: EVENT_LEAGUE.id, participantType: 'INDIVIDUAL', providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: 'bdl-1', lastSeenAt: expect.any(Date) }]);
    expect(prisma.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { code: { in: [ProviderCode.BALLDONTLIE] } } }));
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ created: 1 }), 'Persisted participants from ingestion');
  });

  it('reads the feed ids\' mappings within the synced event\'s sport league only, and no participant by name', async () => {
    const prisma = unmappedPrisma([{ id: 'site-scheffler', sportLeagueId: EVENT_LEAGUE.id, name: 'Scottie Scheffler' }]);

    await sync(prisma, [golfer('bdl-1', 'Scottie Scheffler'), collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM')]);

    expect(prisma.participant.findMany).not.toHaveBeenCalled();
    expect(prisma.participantProviderMapping.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.participantProviderMapping.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sportLeagueId: EVENT_LEAGUE.id }) }));
  });

  it('creates every participant in the synced event\'s sport league, of its sport\'s kind, whatever tour the feed names, reading no league by keyword', async () => {
    const prisma = unmappedPrisma();

    await sync(prisma, [collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM'), collegeTeam('ncaaw-team-150', 'Duke Blue Devils', 'NCAAW')]);

    expect(createdRows(prisma).map((row) => [row.sportLeagueId, row.participantType])).toEqual([[EVENT_LEAGUE.id, 'INDIVIDUAL'], [EVENT_LEAGUE.id, 'INDIVIDUAL']]);
    expect(prisma.sportLeague.findMany).not.toHaveBeenCalled();
  });

  it('creates each of two teams the feed sends under one name, one per feed id, and holds neither aside', async () => {
    const prisma = unmappedPrisma([{ id: 'site-duke', sportLeagueId: EVENT_LEAGUE.id, name: 'Duke Blue Devils' }]);

    const { mappings } = await sync(prisma, [collegeTeam('ncaab-team-150', 'Duke Blue Devils', 'NCAAM'), collegeTeam('ncaab-team-999', 'Duke Blue Devils', 'NCAAM')]);

    expect(createdNames(prisma)).toEqual(['Duke Blue Devils', 'Duke Blue Devils']);
    expect(mappings.map((mapping) => [mapping.participantId, mapping.externalId])).toEqual([['created-1', 'ncaab-team-150'], ['created-2', 'ncaab-team-999']]);
  });

  it('creates no participant for a feed event no event is linked to, there being no sport league for them to belong to', async () => {
    const prisma = unmappedPrisma([], false);

    const result = await new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger())
      .persistEventDetailWithDiagnostics({ ...buildInProgressEvent(), participants: [golfer('bdl-1', 'Scottie Scheffler')] });

    expect(result.value.participantsPersisted).toBe(0);
    expect(prisma.participant.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.participantProviderMapping.findMany).not.toHaveBeenCalled();
  });

  it('creates every golfer of a feed whose ids no participant is mapped to, one per feed id, though two share a name', async () => {
    const prisma = unmappedPrisma();
    const participants = [golfer('bdl-1', 'Tom Kim'), golfer('bdl-2', 'Tom Kim')];

    const { mappings } = await sync(prisma, participants);

    expect(createdNames(prisma)).toEqual(['Tom Kim', 'Tom Kim']);
    expect(mappings).toEqual(participants.map((participant, index) => ({
      participantId: `created-${index + 1}`,
      sportLeagueId: EVENT_LEAGUE.id,
      participantType: 'INDIVIDUAL',
      providerId: BALLDONTLIE_TEST_PROVIDER_ID,
      externalId: participant.externalId,
      lastSeenAt: expect.any(Date),
    })));
  });

  it('creates no participant for a feed whose provider has no Provider row, since its mappings could be keyed to none', async () => {
    const prisma = unmappedPrisma();

    await expect(new IngestionPersistence(asPrismaClient(prisma), testDomainEvents(), fakeLogger())
      .persistEventDetailWithDiagnostics({ ...buildInProgressEvent(), participants: [golfer('mock-1', 'Rory McIlroy', 'mock-contest-feed')] }))
      .rejects.toThrow('mock-contest-feed has no Provider row');
    expect(prisma.participant.createManyAndReturn).not.toHaveBeenCalled();
  });
});
