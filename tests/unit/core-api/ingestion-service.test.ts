import { expect } from '@jest/globals';
import {
  IngestionService,
  type IngestionServiceDependencies,
  SportEventSyncScopeError,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import type { ProviderSyncRunRepository } from '../../../packages/shared/db';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { Sport } from '../../../packages/shared/domain';
import { fakeParticipantProviderMappingRepo, fakeSportEventRepo } from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import { fakeLogger } from '../../support/fake-logger';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { stubInstance } from '../../support/stub-instance';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';

async function flushMicrotasks(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

type IngestionPorts = Pick<IngestionServiceDependencies, 'sportEvents' | 'participantMappings' | 'syncRuns'>;

function ports(overrides: Partial<IngestionPorts> = {}): IngestionPorts {
  return {
    sportEvents: fakeSportEventRepo(),
    participantMappings: fakeParticipantProviderMappingRepo(),
    syncRuns: { create: jest.fn(), update: jest.fn(), findAll: jest.fn() },
    ...overrides,
  };
}

/** Echoes a sync-run create back as the stored run, which is what the ledger reads. */
function echoSyncRunCreate() {
  return mockFn<ProviderSyncRunRepository['create']>(async (input) => ({
    id: 'sync-run-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...input,
  }));
}

describe('IngestionService manual sync submission', () => {
  it('pool-master-r04 rejects manual sync for sports outside ingestion scheduledSports config', async () => {
    const registry = registryWith(fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      providerName: 'Mock Contest Feed Provider',
      sportsCovered: [Sport.GOLF, Sport.TENNIS],
    }));
    const ingestionConfigReader = {
      getConfig: jest.fn().mockResolvedValue({
        scheduledSports: [Sport.GOLF],
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
        eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      }),
      getPerSportConfig: jest.fn(),
    };
    const service = new IngestionService({
      ...ports(),
      registry,
      logger: fakeLogger(),
      ingestionConfigReader,
    });

    await expect(service.prepareSportSync({
      sport: Sport.TENNIS,
      feeds: ['EVENTSCHEDULE'],
    }, 'admin-1', 'admin@example.com')).rejects.toMatchObject({
      name: 'SportSyncNotConfiguredError',
    });
  });

  it('pool-master-rop.68.2.3 pool-master-rop.68.2.5 proves deferred manual sport sync uses the normalized window', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    let deferredSync: (() => void) | undefined;
    const setImmediateSpy = jest
      .spyOn(global, 'setImmediate')
      .mockImplementation((callback: () => void) => {
        deferredSync = callback;
        return 0 as unknown as NodeJS.Immediate;
      });
    const providerSyncRunCreate = echoSyncRunCreate();
    const providerSyncRunUpdate = jest.fn().mockResolvedValue(undefined);
    const registry = registryWith(fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      providerName: 'Mock Contest Feed Provider',
      sportsCovered: [Sport.GOLF],
    }));
    const scheduler = stubInstance(IngestionScheduler, {
      runSportSync: jest.fn().mockResolvedValue([{
        jobType: 'EVENT_SCHEDULE_SYNC',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        status: 'COMPLETED',
        recordsProcessed: 1,
        errors: 0,
        errorLog: [],
        warnings: [],
        stats: { providerRecordsReturned: 1 },
      }]),
    });
    const ingestionConfigReader = {
      getConfig: jest.fn().mockResolvedValue({
        scheduledSports: [Sport.GOLF],
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 45 },
        eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      }),
      getPerSportConfig: jest.fn().mockResolvedValue({
        scheduledSports: [Sport.GOLF],
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 45 },
        eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      }),
    };
    const service = new IngestionService({
      ...ports({ syncRuns: { create: providerSyncRunCreate, update: providerSyncRunUpdate, findAll: jest.fn() } }),
      registry,
      scheduler,
      logger: fakeLogger(),
      ingestionConfigReader,
      syncOrchestrator: new SyncOrchestrator({ now: () => now }),
    });

    try {
      const result = await service.prepareSportSync({
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
      }, 'admin-1', 'admin@example.com');

      expect(result.requestedFeeds).toEqual(['EVENTSCHEDULE']);
      expect(providerSyncRunCreate).toHaveBeenCalledWith(expect.objectContaining({
        sport: Sport.GOLF,
        eventId: null,
        payload: expect.objectContaining({
          requestedFeed: 'EVENTSCHEDULE',
          requestPayload: expect.objectContaining({
            source: 'MANUAL',
            actor: {
              type: 'ROOT_ADMIN',
              userId: 'admin-1',
              email: 'admin@example.com',
            },
            from: null,
            to: null,
            effectiveWindow: {
              from: '2026-05-30T12:00:00.000Z',
              to: '2026-07-14T12:00:00.000Z',
              defaultedFrom: true,
              defaultedTo: true,
            },
          }),
        }),
      }));
      const payloadJson = providerSyncRunCreate.mock.calls[0][0].payload;
      expect(payloadJson).not.toHaveProperty('source');
      expect(payloadJson).not.toHaveProperty('actor');
      expect(payloadJson).not.toHaveProperty('effectiveWindow');
      expect(deferredSync).toBeDefined();
      deferredSync?.();
      await flushMicrotasks();
      expect(scheduler.runSportSync).toHaveBeenCalledWith({
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
        from: new Date('2026-05-30T12:00:00.000Z'),
        to: new Date('2026-07-14T12:00:00.000Z'),
      });
    } finally {
      setImmediateSpy.mockRestore();
    }
  });

  it('pool-master-rop.68.2.3 normalizes manual event sync before submission', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    let deferredSync: (() => void) | undefined;
    const setImmediateSpy = jest
      .spyOn(global, 'setImmediate')
      .mockImplementation((callback: () => void) => {
        deferredSync = callback;
        return 0 as unknown as NodeJS.Immediate;
      });
    const providerSyncRunCreate = echoSyncRunCreate();
    const providerSyncRunUpdate = jest.fn().mockResolvedValue(undefined);
    const registry = registryWith(fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      providerName: 'Mock Contest Feed Provider',
      sportsCovered: [Sport.GOLF],
      getEventDetails: jest.fn(),
    }));
    const scheduler = stubInstance(IngestionScheduler, {
      runEventSync: jest.fn().mockResolvedValue([{
        jobType: 'EVENT_LIVE_SCORES_SYNC',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        eventExternalId: 'golf-open-championship-2026',
        status: 'COMPLETED',
        recordsProcessed: 1,
        errors: 0,
        errorLog: [],
        warnings: [],
        stats: { liveScoreUpdatesReturned: 1 },
      }]),
    });
    const ingestionConfigReader = {
      getConfig: jest.fn().mockResolvedValue({
        scheduledSports: [Sport.GOLF],
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
        eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      }),
      getPerSportConfig: jest.fn(),
    };
    const service = new IngestionService({
      // pool-master-cgb — no local SportEvent row exists yet for this
      // manual sync target, so the syncScope guard is a permissive no-op.
      ...ports({ syncRuns: { create: providerSyncRunCreate, update: providerSyncRunUpdate, findAll: jest.fn() } }),
      registry,
      scheduler,
      logger: fakeLogger(),
      ingestionConfigReader,
      syncOrchestrator: new SyncOrchestrator({ now: () => now }),
    });

    try {
      const result = await service.syncEventData({
        sport: Sport.GOLF,
        eventId: '  golf-open-championship-2026  ',
        feeds: ['EVENTLIVESCORES', 'EVENTLIVESCORES'],
        mockEventState: 'live',
      }, 'admin-1', 'admin@example.com');

      expect(result.eventId).toBe('golf-open-championship-2026');
      expect(result.requestedFeeds).toEqual(['EVENTLIVESCORES']);
      expect(providerSyncRunCreate).toHaveBeenCalledWith(expect.objectContaining({
        sport: Sport.GOLF,
        eventId: 'golf-open-championship-2026',
        payload: expect.objectContaining({
          requestedFeeds: ['EVENTLIVESCORES'],
          requestedFeed: 'EVENTLIVESCORES',
          requestPayload: expect.objectContaining({
            source: 'MANUAL',
            actor: {
              type: 'ROOT_ADMIN',
              userId: 'admin-1',
              email: 'admin@example.com',
            },
            mockEventState: 'live',
          }),
        }),
      }));
      const payloadJson = providerSyncRunCreate.mock.calls[0][0].payload;
      expect(payloadJson).not.toHaveProperty('source');
      expect(payloadJson).not.toHaveProperty('actor');
      expect(payloadJson).not.toHaveProperty('mockEventState');
      expect(deferredSync).toBeDefined();
      deferredSync?.();
      await flushMicrotasks();
      expect(scheduler.runEventSync).toHaveBeenCalledWith({
        sport: Sport.GOLF,
        eventId: 'golf-open-championship-2026',
        feeds: ['EVENTLIVESCORES'],
        mockEventState: 'live',
      });
    } finally {
      setImmediateSpy.mockRestore();
    }
  });

  describe('pool-master-cgb: manual sync-trigger syncScope guard', () => {
    function buildManualSyncService(findByProviderRef: jest.Mock) {
      const registry = registryWith(fakeSportDataProvider({
        providerId: 'mock-contest-feed',
        providerName: 'Mock Contest Feed Provider',
        sportsCovered: [Sport.GOLF],
      }));
      const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn().mockResolvedValue([]) });
      const ingestionConfigReader = {
        getConfig: jest.fn().mockResolvedValue({ scheduledSports: [Sport.GOLF] }),
        getPerSportConfig: jest.fn(),
      };
      return new IngestionService({
        ...ports({
          sportEvents: fakeSportEventRepo({ findByProviderRef }),
          syncRuns: {
            create: echoSyncRunCreate(),
            update: jest.fn().mockResolvedValue(undefined),
            findAll: jest.fn(),
          },
        }),
        registry,
        scheduler,
        logger: fakeLogger(),
        ingestionConfigReader,
      });
    }

    it('pool-master-cgb: rejects every feed when the target event has syncScope NONE', async () => {
      const service = buildManualSyncService(
        jest.fn().mockResolvedValue({ syncScope: 'NONE' }),
      );

      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, eventId: 'manual-event-1', feeds: ['EVENTLIVESCORES'] },
          'admin-1',
          'admin@example.com',
        ),
      ).rejects.toBeInstanceOf(SportEventSyncScopeError);
    });

    it('pool-master-5h3: allows EVENTPARTICIPANTS (not only EVENTLIVESCORES/EVENTRESULTS) when syncScope is SCORES_ONLY', async () => {
      // EVENTPARTICIPANTS (the field/"details" feed) is a separate concern
      // from the scores feeds and is gated by syncScope != 'NONE', not
      // restricted to FULL (plans/125 §3.2) — plans/124 §4.4a's admin
      // Load/Refresh Participant Field action depends on this for a
      // SCORES_ONLY-linked tournament. Every one of the three manual-sync
      // feeds is a valid combination for SCORES_ONLY; only NONE (covered
      // above) rejects a manual-sync feed outright.
      const service = buildManualSyncService(
        jest.fn().mockResolvedValue({ syncScope: 'SCORES_ONLY' }),
      );
      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, eventId: 'linked-event', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'EVENTRESULTS'] },
          'admin-1',
          'admin@example.com',
        ),
      ).resolves.toBeDefined();
    });

    it('pool-master-cgb: allows every feed when syncScope is FULL', async () => {
      const service = buildManualSyncService(
        jest.fn().mockResolvedValue({ syncScope: 'FULL' }),
      );

      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, eventId: 'legacy-event', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'] },
          'admin-1',
          'admin@example.com',
        ),
      ).resolves.toBeDefined();
    });

    it('pool-master-cgb: is a permissive no-op when no local SportEvent row exists yet for the target', async () => {
      const service = buildManualSyncService(jest.fn().mockResolvedValue(null));

      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, eventId: 'not-yet-persisted', feeds: ['EVENTPARTICIPANTS'] },
          'admin-1',
          'admin@example.com',
        ),
      ).resolves.toBeDefined();
    });
  });

});
