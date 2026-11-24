import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
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
import { jobHandlers, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { stubInstance } from '../../support/stub-instance';
import { ProviderRateLimitedError } from '../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';

type IngestionPorts = Pick<IngestionServiceDependencies, 'sportEvents' | 'participantMappings' | 'syncRuns' | 'jobs' | 'sportLeagues' | 'providerSettings' | 'webhooks' | 'jobHistory'>;

function ports(overrides: Partial<Omit<IngestionPorts, 'syncRuns'>> & { syncRuns?: InMemorySyncRuns } = {}): IngestionPorts {
  const syncRuns = overrides.syncRuns ?? inMemorySyncRuns();
  return {
    sportEvents: fakeSportEventRepo(),
    participantMappings: fakeParticipantProviderMappingRepo(),
    jobs: new BackgroundJobQueue({ jobs: syncRuns.jobs, currentStart: testCurrentJobStart }),
    sportLeagues: { findEventSynced: () => Promise.resolve([]) },
    providerSettings: { all: () => [], bySourceId: () => undefined },
    webhooks: { isOn: () => false, isSecretSet: () => false },
    jobHistory: { countByScope: () => Promise.resolve([]) },
    ...overrides,
    syncRuns,
  };
}

describe('IngestionService manual sync submission', () => {
  it('pool-master-rop.68.2.3 normalizes manual event sync before submission, and its job runs the normalized scope', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const syncRuns = inMemorySyncRuns();
    const registry = registryWith(fakeSportDataProvider({
      providerId: 'balldontlie',
      providerName: 'Mock Contest Feed Provider',
      sportsCovered: [Sport.GOLF],
      getEventDetails: jest.fn(),
    }));
    const scheduler = stubInstance(IngestionScheduler, {
      runEventSync: jest.fn().mockResolvedValue([{
        jobType: 'EVENT_LIVE_SCORES_SYNC',
        providerId: 'balldontlie',
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
    const service = new IngestionService({
      // pool-master-cgb — no local SportEvent row exists yet for this
      // manual sync target, so the syncScope guard is a permissive no-op.
      ...ports({ syncRuns }),
      registry,
      scheduler,
      logger: fakeLogger(),
      syncOrchestrator: new SyncOrchestrator({ now: () => now }),
    });

    const result = await service.syncEventData({
      sport: Sport.GOLF,
      providerId: 'balldontlie',
      eventId: '  golf-open-championship-2026  ',
      feeds: ['EVENTLIVESCORES', 'EVENTLIVESCORES'],
    }, 'admin-1', 'admin@example.com');

    expect(result.eventId).toBe('golf-open-championship-2026');
    expect(result.requestedFeeds).toEqual(['EVENTLIVESCORES']);
    expect(syncRuns.rows).toEqual([expect.objectContaining({
      sport: Sport.GOLF,
      providerId: BALLDONTLIE_TEST_PROVIDER_ID,
      providerName: 'BALLDONTLIE',
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
        }),
      }),
    })]);
    const payloadJson = syncRuns.rows[0].payload;
    expect(payloadJson).not.toHaveProperty('source');
    expect(payloadJson).not.toHaveProperty('actor');
    expect(scheduler.runEventSync).not.toHaveBeenCalled();

    const runner = new BackgroundJobRunner({
      jobs: syncRuns.jobs,
      handlers: jobHandlers({ MANUAL_EVENT_SYNC: (payload, context) => service.runManualEventSync(payload, context) }),
    });
    await runner.drain();
    expect(scheduler.runEventSync).toHaveBeenCalledWith({
      sport: Sport.GOLF,
      providerId: 'balldontlie',
      eventId: 'golf-open-championship-2026',
      feeds: ['EVENTLIVESCORES'],
    });
  });

  it('ends a manual sync\'s try when the provider rate limits a feed, and runs the feeds still waiting when the job is queued again, without counting the try', async () => {
    const syncRuns = inMemorySyncRuns();
    const completed = {
      jobType: 'EVENT_PARTICIPANTS_SYNC', providerId: 'balldontlie', sport: Sport.GOLF, eventExternalId: 'open-2026',
      status: 'COMPLETED', recordsProcessed: 1, errors: 0, errorLog: [], warnings: [], stats: {},
    };
    // Already due again, so the one drain runs the deferred try too.
    const refusal = new ProviderRateLimitedError('balldontlie', new Date(Date.now() - 1_000), 'its circuit is open');
    const scheduler = stubInstance(IngestionScheduler, {
      runEventSync: jest.fn().mockRejectedValueOnce(refusal).mockResolvedValue([completed]),
    });
    const service = new IngestionService({
      ...ports({ syncRuns }),
      registry: registryWith(fakeSportDataProvider({ providerId: 'balldontlie', sportsCovered: [Sport.GOLF] })),
      scheduler,
      logger: fakeLogger(),
      syncOrchestrator: new SyncOrchestrator({ now: () => new Date() }),
    });
    await service.syncEventData({
      sport: Sport.GOLF,
      providerId: 'balldontlie',
      eventId: 'open-2026',
      feeds: ['EVENTLIVESCORES', 'EVENTPARTICIPANTS'],
    }, 'admin-1', 'admin@example.com');

    const runner = new BackgroundJobRunner({
      jobs: syncRuns.jobs,
      handlers: jobHandlers({ MANUAL_EVENT_SYNC: (payload, context) => service.runManualEventSync(payload, context) }),
    });
    await runner.drain();

    expect(scheduler.runEventSync).toHaveBeenCalledTimes(2);
    expect(scheduler.runEventSync).toHaveBeenLastCalledWith(expect.objectContaining({ feeds: ['EVENTPARTICIPANTS'] }));
    expect(syncRuns.rows.map((run) => [run.payload['requestedFeed'], run.status])).toEqual([
      ['EVENTLIVESCORES', 'FAILED'],
      ['EVENTPARTICIPANTS', 'COMPLETED'],
    ]);
    expect(syncRuns.jobs.rows).toEqual([expect.objectContaining({ status: 'SUCCEEDED', attempts: 1 })]);
  });

  describe('pool-master-cgb: manual sync-trigger syncScope guard', () => {
    function buildManualSyncService(findByProviderRef: jest.Mock) {
      const registry = registryWith(fakeSportDataProvider({
        providerId: 'balldontlie',
        providerName: 'Mock Contest Feed Provider',
        sportsCovered: [Sport.GOLF],
      }));
      const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn().mockResolvedValue([]) });
      return new IngestionService({
        ...ports({ sportEvents: fakeSportEventRepo({ findByProviderRef }) }),
        registry,
        scheduler,
        logger: fakeLogger(),
      });
    }

    it('pool-master-cgb: rejects every feed when the target event has syncScope NONE', async () => {
      const service = buildManualSyncService(
        jest.fn().mockResolvedValue({ syncScope: 'NONE' }),
      );

      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'manual-event-1', feeds: ['EVENTLIVESCORES'] },
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
          { sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'linked-event', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'] },
          'admin-1',
          'admin@example.com',
        ),
      ).resolves.toBeDefined();
    });

    it('pool-master-cgb: is a permissive no-op when no local SportEvent row exists yet for the target', async () => {
      const service = buildManualSyncService(jest.fn().mockResolvedValue(null));

      await expect(
        service.syncEventData(
          { sport: Sport.GOLF, providerId: 'balldontlie', eventId: 'not-yet-persisted', feeds: ['EVENTPARTICIPANTS'] },
          'admin-1',
          'admin@example.com',
        ),
      ).resolves.toBeDefined();
    });
  });

});
