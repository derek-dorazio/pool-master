import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import {
  IngestionService,
  type IngestionServiceDependencies,
  SportEventNotSyncedError,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { Sport } from '../../../packages/shared/domain';
import { fakeSportEventRepo } from '../../support/repo-fakes';
import { inMemorySyncRuns, type InMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';
import { fakeLogger } from '../../support/fake-logger';
import { jobHandlers, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { stubInstance } from '../../support/stub-instance';
import { ProviderRateLimitedError } from '../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';

type IngestionPorts = Pick<IngestionServiceDependencies, 'sportEvents' | 'syncRuns' | 'jobs' | 'sportLeagues' | 'providerSettings' | 'webhooks' | 'jobHistory'>;

function ports(overrides: Partial<Omit<IngestionPorts, 'syncRuns'>> & { syncRuns?: InMemorySyncRuns } = {}): IngestionPorts {
  const syncRuns = overrides.syncRuns ?? inMemorySyncRuns();
  return {
    sportEvents: fakeSportEventRepo(),
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
      // No local SportEvent row exists yet for this manual sync target, so its runs name none.
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
      kind: 'SCORES',
      trigger: 'ADMIN',
    })]);
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
    expect(syncRuns.rows.map((run) => [run.kind, run.status])).toEqual([
      ['SCORES', 'FAILED'],
      ['FIELD', 'COMPLETED'],
    ]);
    expect(syncRuns.jobs.rows).toEqual([expect.objectContaining({ status: 'SUCCEEDED', attempts: 1 })]);
  });

  describe('a root admin\'s sync of one event, by its own id (#2004)', () => {
    function buildEventSyncService(findById: jest.Mock) {
      const registry = registryWith(fakeSportDataProvider({
        providerId: 'balldontlie',
        providerName: 'Mock Contest Feed Provider',
        sportsCovered: [Sport.GOLF],
      }));
      const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn().mockResolvedValue([]) });
      const syncRuns = inMemorySyncRuns();
      const service = new IngestionService({
        ...ports({ syncRuns, sportEvents: fakeSportEventRepo({ findById, findByProviderRef: jest.fn().mockResolvedValue(null) }) }),
        registry,
        scheduler,
        logger: fakeLogger(),
      });
      return { service, syncRuns };
    }
    const event = (overrides: Record<string, unknown> = {}) => ({
      id: 'event-1', sport: Sport.GOLF, syncProviderId: 'balldontlie',
      providerMappings: [{ providerCode: 'BALLDONTLIE', providerName: 'BALLDONTLIE', externalId: 'golf-open-2026' }],
      ...overrides,
    });

    it('queues the sync for the id its league\'s provider has for the event', async () => {
      const { service, syncRuns } = buildEventSyncService(jest.fn().mockResolvedValue(event()));

      const result = await service.syncSportEvent('event-1', ['EVENTPARTICIPANTS'], 'admin-1', 'admin@example.com');

      expect(result).toMatchObject({ sport: Sport.GOLF, eventId: 'golf-open-2026', requestedFeeds: ['EVENTPARTICIPANTS'] });
      expect(syncRuns.rows).toEqual([expect.objectContaining({ kind: 'FIELD', status: 'SUBMITTED' })]);
    });

    it('refuses a test event, which its provider has no id for, with 409 EVENT_NOT_LINKED, and an unknown one with 404 EVENT_NOT_FOUND, queuing nothing', async () => {
      const testEvent = buildEventSyncService(jest.fn().mockResolvedValue(event({ providerMappings: [] })));
      const missing = buildEventSyncService(jest.fn().mockResolvedValue(null));

      await expect(testEvent.service.syncSportEvent('event-1', ['EVENTLIVESCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toThrow(SportEventNotSyncedError);
      await expect(testEvent.service.syncSportEvent('event-1', ['EVENTLIVESCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toMatchObject({ code: 'EVENT_NOT_LINKED', statusCode: 409 });
      await expect(missing.service.syncSportEvent('event-1', ['EVENTLIVESCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
      expect([...testEvent.syncRuns.rows, ...missing.syncRuns.rows]).toEqual([]);
    });
  });

});
