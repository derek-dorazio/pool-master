import { expect } from '@jest/globals';
import {
  IngestionService,
  type IngestionServiceDependencies,
  SportEventSyncScopeError,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { Sport } from '../../../packages/shared/domain';
import { fakeParticipantProviderMappingRepo, fakeSportEventRepo } from '../../support/repo-fakes';
import { inMemorySyncRuns, type InMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';
import { fakeLogger } from '../../support/fake-logger';
import { jobHandlers } from '../../support/in-memory-background-jobs';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { stubInstance } from '../../support/stub-instance';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';

type IngestionPorts = Pick<IngestionServiceDependencies, 'sportEvents' | 'participantMappings' | 'syncRuns' | 'jobs'>;

function ports(overrides: Partial<Omit<IngestionPorts, 'syncRuns'>> & { syncRuns?: InMemorySyncRuns } = {}): IngestionPorts {
  const syncRuns = overrides.syncRuns ?? inMemorySyncRuns();
  return {
    sportEvents: fakeSportEventRepo(),
    participantMappings: fakeParticipantProviderMappingRepo(),
    jobs: new BackgroundJobQueue({ jobs: syncRuns.jobs }),
    ...overrides,
    syncRuns,
  };
}

describe('IngestionService manual sync submission', () => {
  it('rejects a manual sync for a sport the ingestion config does not schedule, and runs nothing', async () => {
    const registry = registryWith(fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      providerName: 'Mock Contest Feed Provider',
      sportsCovered: [Sport.GOLF],
    }));
    const ingestionConfigReader = {
      getConfig: jest.fn().mockResolvedValue({
        scheduledSports: [],
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        perSportOverrides: {},
      }),
      getPerSportConfig: jest.fn(),
    };
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn().mockResolvedValue([]) });
    const service = new IngestionService({
      ...ports(),
      registry,
      scheduler,
      logger: fakeLogger(),
      ingestionConfigReader,
    });

    await expect(service.syncEventData({
      sport: Sport.GOLF,
      eventId: 'golf-event-1',
      feeds: ['EVENTLIVESCORES'],
    }, 'admin-1', 'admin@example.com')).rejects.toMatchObject({
      name: 'SportSyncNotConfiguredError',
    });
    expect(scheduler.runEventSync).not.toHaveBeenCalled();
  });

  it('pool-master-rop.68.2.3 normalizes manual event sync before submission, and its job runs the normalized scope', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const syncRuns = inMemorySyncRuns();
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
        eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        perSportOverrides: {},
      }),
      getPerSportConfig: jest.fn(),
    };
    const service = new IngestionService({
      // pool-master-cgb — no local SportEvent row exists yet for this
      // manual sync target, so the syncScope guard is a permissive no-op.
      ...ports({ syncRuns }),
      registry,
      scheduler,
      logger: fakeLogger(),
      ingestionConfigReader,
      syncOrchestrator: new SyncOrchestrator({ now: () => now }),
    });

    const result = await service.syncEventData({
      sport: Sport.GOLF,
      eventId: '  golf-open-championship-2026  ',
      feeds: ['EVENTLIVESCORES', 'EVENTLIVESCORES'],
      mockEventState: 'live',
    }, 'admin-1', 'admin@example.com');

    expect(result.eventId).toBe('golf-open-championship-2026');
    expect(result.requestedFeeds).toEqual(['EVENTLIVESCORES']);
    expect(syncRuns.rows).toEqual([expect.objectContaining({
      sport: Sport.GOLF,
      eventId: 'golf-open-championship-2026',
      status: 'SUBMITTED',
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
    })]);
    const payloadJson = syncRuns.rows[0].payload;
    expect(payloadJson).not.toHaveProperty('source');
    expect(payloadJson).not.toHaveProperty('actor');
    expect(payloadJson).not.toHaveProperty('mockEventState');
    expect(scheduler.runEventSync).not.toHaveBeenCalled();

    const runner = new BackgroundJobRunner({
      jobs: syncRuns.jobs,
      handlers: jobHandlers({ MANUAL_EVENT_SYNC: (payload) => service.runManualEventSync(payload) }),
    });
    await runner.drain();
    expect(scheduler.runEventSync).toHaveBeenCalledWith({
      sport: Sport.GOLF,
      eventId: 'golf-open-championship-2026',
      feeds: ['EVENTLIVESCORES'],
      mockEventState: 'live',
    });
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
        ...ports({ sportEvents: fakeSportEventRepo({ findByProviderRef }) }),
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

    it('pool-master-5h3: allows EVENTPARTICIPANTS (not only EVENTLIVESCORES) when syncScope is SCORES_ONLY', async () => {
      // EVENTPARTICIPANTS (the field feed) is gated by syncScope != 'NONE':
      // the admin's Load/Refresh field action depends on it for a linked
      // (SCORES_ONLY) tournament. Only NONE (covered above) rejects a
      // manual-sync feed outright.
      const service = buildManualSyncService(
        jest.fn().mockResolvedValue({ syncScope: 'SCORES_ONLY' }),
      );
      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, eventId: 'linked-event', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'] },
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
