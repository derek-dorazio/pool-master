import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import {
  IngestionService,
  type IngestionServiceDependencies,
  SportEventNotSyncedError,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { BackgroundJobType, Sport } from '../../../packages/shared/domain';
import { fakeSportEventRepo } from '../../support/repo-fakes';
import { inMemorySyncRuns, type InMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { fakeLogger } from '../../support/fake-logger';
import { testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';

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

/** Our event's id: a job names the event by it. */
const EVENT_ID = '5d0b8f2e-7c1a-4e3b-9f60-2a4c8e1d7b35';

describe('IngestionService manual sync submission', () => {
  describe('a root admin\'s sync of one event, by its own id (#2004)', () => {
    function buildEventSyncService(findById: jest.Mock) {
      const registry = registryWith(fakeSportDataProvider({
        providerId: 'balldontlie',
        providerName: 'Mock Contest Feed Provider',
        }));
      const syncRuns = inMemorySyncRuns();
      const service = new IngestionService({
        ...ports({ syncRuns, sportEvents: fakeSportEventRepo({ findById, findByProviderRefs: jest.fn().mockResolvedValue([]) }) }),
        registry,
        logger: fakeLogger(),
        syncOrchestrator: new SyncOrchestrator({ now: () => new Date('2026-05-30T12:00:00.000Z') }),
      });
      return { service, syncRuns };
    }
    const event = (overrides: Record<string, unknown> = {}) => ({
      id: EVENT_ID, sportLeagueId: 'pga-tour', sport: Sport.GOLF, status: 'SCHEDULED', syncProviderId: 'balldontlie',
      providerMappings: [{ providerCode: 'BALLDONTLIE', providerName: 'BALLDONTLIE', externalId: 'golf-open-2026' }],
      ...overrides,
    });

    it('queues the sync for the id its league\'s provider has for the event', async () => {
      const { service, syncRuns } = buildEventSyncService(jest.fn().mockResolvedValue(event()));

      const result = await service.syncSportEvent(EVENT_ID, ['FIELD'], 'admin-1', 'admin@example.com');

      expect(result).toMatchObject({ sport: Sport.GOLF, eventId: 'golf-open-2026', requestedKinds: ['FIELD'] });
      expect(syncRuns.rows).toEqual([expect.objectContaining({ kind: 'FIELD', status: 'SUBMITTED' })]);
    });

    it('refuses a test event, which its provider has no id for, with 409 EVENT_NOT_LINKED, and an unknown one with 404 EVENT_NOT_FOUND, queuing nothing', async () => {
      const testEvent = buildEventSyncService(jest.fn().mockResolvedValue(event({ providerMappings: [] })));
      const missing = buildEventSyncService(jest.fn().mockResolvedValue(null));

      await expect(testEvent.service.syncSportEvent(EVENT_ID, ['SCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toThrow(SportEventNotSyncedError);
      await expect(testEvent.service.syncSportEvent(EVENT_ID, ['SCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toMatchObject({ code: 'EVENT_NOT_LINKED', statusCode: 409 });
      await expect(missing.service.syncSportEvent(EVENT_ID, ['SCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
      expect([...testEvent.syncRuns.rows, ...missing.syncRuns.rows]).toEqual([]);
    });

    it('refuses a sync kind the event cannot run now with 422 EVENT_SYNC_KIND_UNAVAILABLE: live scores before play starts, queuing nothing', async () => {
      const { service, syncRuns } = buildEventSyncService(jest.fn().mockResolvedValue(event({ status: 'SCHEDULED' })));

      await expect(service.syncSportEvent(EVENT_ID, ['FIELD', 'SCORES'], 'admin-1', 'admin@example.com'))
        .rejects.toMatchObject({ code: 'EVENT_SYNC_KIND_UNAVAILABLE', statusCode: 422 });
      expect(syncRuns.rows).toEqual([]);
    });

    it('submits one run per distinct kind asked for, each with the job that runs it naming the event and the run, and calls no provider', async () => {
      const { service, syncRuns } = buildEventSyncService(jest.fn().mockResolvedValue(event({ status: 'IN_PROGRESS' })));

      const result = await service.syncSportEvent(EVENT_ID, ['FIELD', 'SCORES', 'SCORES'], 'admin-1', 'admin@example.com');

      expect(result.requestedKinds).toEqual(['FIELD', 'SCORES']);
      expect(syncRuns.rows).toEqual([
        expect.objectContaining({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, kind: 'FIELD', status: 'SUBMITTED', trigger: 'ADMIN', sportEventId: EVENT_ID, sportLeagueId: 'pga-tour' }),
        expect.objectContaining({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, kind: 'SCORES', status: 'SUBMITTED', trigger: 'ADMIN', sportEventId: EVENT_ID, sportLeagueId: 'pga-tour' }),
      ]);
      expect(syncRuns.jobs.rows).toEqual([
        expect.objectContaining({ type: BackgroundJobType.SYNC_EVENT_FIELD, payload: { sportEventId: EVENT_ID, syncRunId: syncRuns.rows[0].id }, startedByUserId: 'admin-1', dedupeKey: undefined }),
        expect.objectContaining({ type: BackgroundJobType.SYNC_EVENT_SCORES, payload: { sportEventId: EVENT_ID, syncRunId: syncRuns.rows[1].id }, startedByUserId: 'admin-1', dedupeKey: undefined }),
      ]);
    });

    it('queues live scores for an event in play, where its sync kinds include them', async () => {
      const { service, syncRuns } = buildEventSyncService(jest.fn().mockResolvedValue(event({ status: 'IN_PROGRESS' })));

      await service.syncSportEvent(EVENT_ID, ['SCORES'], 'admin-1', 'admin@example.com');

      expect(syncRuns.rows).toEqual([expect.objectContaining({ kind: 'SCORES', status: 'SUBMITTED' })]);
    });
  });

});
