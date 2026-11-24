import { expectDefined } from '../../support/expect-defined';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { expect } from '@jest/globals';
import {
  DEFAULT_SYNC_RUN_WINDOW_HOURS,
  IngestionService,
  ProviderSyncRunNotFoundError,
  type IngestionServiceDependencies,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { IngestionScheduler, type IngestionJobRecord } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { memoizedRead, ReadMemoKey, runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import type { PrismaClient } from '@prisma/client';
import type { SportDataProvider } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { ProviderSyncRunRepository } from '../../../packages/shared/db';
import { ScoringFamily, Sport, SportEventSyncScope, type SportEvent } from '../../../packages/shared/domain';
import { fakeParticipantProviderMappingRepo, fakeSportEventRepo } from '../../support/repo-fakes';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { fakeLogger } from '../../support/fake-logger';
import { jobHandlers, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { stubInstance } from '../../support/stub-instance';
import { inMemorySyncRuns, type InMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';

// The root-admin reads over ingestion (provider list, sync-run history, unmapped competitors)
// and the manual sync submission's refusals and its background worker.

function syncRuns(overrides: Partial<ProviderSyncRunRepository> = {}): InMemorySyncRuns {
  return Object.assign(inMemorySyncRuns(), overrides);
}

/**
 * The service as the app builds it: a real job queue and runner over in-memory tables, so a
 * submitted sync runs as its MANUAL_EVENT_SYNC job. `jobsDone` waits for the runner.
 */
function service(
  deps: Partial<Omit<IngestionServiceDependencies, 'syncRuns'>> & Pick<IngestionServiceDependencies, 'registry'> & { syncRuns?: InMemorySyncRuns },
) {
  const runs = deps.syncRuns ?? syncRuns();
  const jobs = new BackgroundJobQueue({ jobs: runs.jobs, currentStart: testCurrentJobStart });
  const ingestion = new IngestionService({
    sportEvents: fakeSportEventRepo(),
    participantMappings: fakeParticipantProviderMappingRepo(),
    sportLeagues: { findEventSyncedWithClutchCards: () => Promise.resolve([]) },
    providerSettings: { all: () => [] },
    webhooks: { isOn: () => false, isSecretSet: () => false },
    jobHistory: { countByScope: () => Promise.resolve([]) },
    logger: fakeLogger(),
    jobs,
    ...deps,
    syncRuns: runs,
  });
  const runner = new BackgroundJobRunner({
    jobs: runs.jobs,
    handlers: jobHandlers({ MANUAL_EVENT_SYNC: (payload, context) => ingestion.runManualEventSync(payload, context) }),
    logger: fakeLogger(),
  });
  jobs.wakes(runner);
  return Object.assign(ingestion, { jobsDone: () => runner.drain() });
}

describe('IngestionService.listProviders', () => {
  it('lists a provider with its live health and its event activity', async () => {
    const provider = fakeSportDataProvider({ providerId: 'zebra', providerName: 'Zebra Feed', sportsCovered: [Sport.GOLF] });
    const lastChangedAt = new Date('2026-05-30T09:00:00.000Z');
    const sportEvents = fakeSportEventRepo({
      summarizeByProviders: jest.fn().mockResolvedValue(new Map([['zebra', { activeEventCount: 3, lastChangedAt }]])),
    });

    const providers = await service({ registry: registryWith(provider), sportEvents }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: 'zebra', status: 'HEALTHY', lastEventAt: lastChangedAt, activeEventCount: 3, sportsCovered: [Sport.GOLF],
      }),
    ]);
  });

  it('falls back to a provider\'s last successful poll for its last event time when it has no events', async () => {
    const provider = fakeSportDataProvider({
      providerId: 'alpha',
      sportsCovered: [Sport.GOLF],
      healthCheck: jest.fn().mockResolvedValue({
        providerId: 'alpha', status: 'DEGRADED', errorRateLastHour: 0.2, latencyMsP95: 900,
        lastSuccessfulPoll: new Date('2026-05-01T00:00:00.000Z'),
      }),
    });

    const providers = await service({
      registry: registryWith(provider),
    }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: 'alpha', status: 'DEGRADED', errorRate: 0.2, latencyMs: 900,
        lastEventAt: new Date('2026-05-01T00:00:00.000Z'), activeEventCount: 0,
        sportsCovered: [Sport.GOLF], supportsLiveSimulation: false,
      }),
    ]);
  });

  it('lists every sport a provider covers, and a null last-event time when it has none', async () => {
    const provider = fakeSportDataProvider({ sportsCovered: [Sport.GOLF] });

    const [summary] = await service({ registry: registryWith(provider) }).listProviders();

    expect(summary).toMatchObject({ sportsCovered: [Sport.GOLF], lastEventAt: null });
  });

  it('marks each provider primary only for the covered sports it is the default for, when two serve one sport', async () => {
    const primary = fakeSportDataProvider({ providerId: 'mock', providerName: 'Mock', sportsCovered: [Sport.GOLF] });
    const secondary = fakeSportDataProvider({ providerId: 'feed', providerName: 'Feed', sportsCovered: [Sport.GOLF] });
    const registry = registryWith(primary);
    registry.register(Sport.GOLF, secondary, 'SECONDARY');

    const providers = await service({ registry }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({ providerId: 'feed', sportsCovered: [Sport.GOLF], primaryForSports: [] }),
      expect.objectContaining({ providerId: 'mock', sportsCovered: [Sport.GOLF], primaryForSports: [Sport.GOLF] }),
    ]);
  });

  it('shows each provider\'s request rate, whether its webhooks are on, and how many active sport leagues its sync creates', async () => {
    const paced = { ...fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' }), requestsPerMinute: 600 };
    const unpaced = fakeSportDataProvider({ providerId: 'mock', providerName: 'Mock' });
    const registry = registryWith(paced);
    registry.register(Sport.GOLF, unpaced, 'SECONDARY');
    const nba = buildSportLeague({ name: 'NBA', selectedProviderMapping: buildProviderMapping() });
    const findEventSyncedWithClutchCards = jest.fn().mockResolvedValue([
      buildSportLeague({ name: 'PGA TOUR', selectedProviderMapping: buildProviderMapping({ providerLeagueCode: 'pga', providerLeagueName: 'PGA TOUR' }) }),
      nba,
      // A Clutch Card league is not a synced league of its own.
      buildSportLeague({ name: 'NBA Clutch Card', scoringFamily: ScoringFamily.COMPOSITE, parentSportLeagueId: nba.id }),
    ]);

    const providers = await service({
      registry,
      sportLeagues: { findEventSyncedWithClutchCards },
      providerSettings: { all: () => [balldontlieTestProvider({ requestsPerMinute: 600 })] },
      webhooks: { isOn: () => true, isSecretSet: () => true },
    }).listProviders();

    expect(findEventSyncedWithClutchCards).toHaveBeenCalledTimes(1);
    expect(providers).toEqual([
      expect.objectContaining({ providerId: 'balldontlie', requestsPerMinute: 600, webhooksEnabled: true, syncedSportLeagueCount: 2 }),
      expect.objectContaining({ providerId: 'mock', requestsPerMinute: null, webhooksEnabled: false, syncedSportLeagueCount: 0 }),
    ]);
  });

  it('lists a provider that has a row but is not running here, as when its key is not set, with no status and its row\'s settings', async () => {
    const [summary] = await service({
      registry: registryWith(null),
      providerSettings: { all: () => [balldontlieTestProvider({ requestsPerMinute: 5 })] },
      webhooks: { isOn: () => false, isSecretSet: () => false },
    }).listProviders();

    expect(summary).toMatchObject({
      providerId: 'balldontlie', providerName: 'BALLDONTLIE', status: null, sportsCovered: [], requestsPerMinute: 5, webhooksEnabled: false,
      settings: { code: 'BALLDONTLIE', requestsPerMinute: 5, webhooksEnabled: true, webhookSecretSet: false },
    });
  });

  it('shows a provider\'s webhooks off while its row switches them on but its signing secret is not set', async () => {
    const isOn = jest.fn().mockReturnValue(false);
    const [summary] = await service({
      registry: registryWith(fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' })),
      providerSettings: { all: () => [balldontlieTestProvider({ webhooksEnabled: true })] },
      webhooks: { isOn, isSecretSet: () => false },
    }).listProviders();

    expect(isOn).toHaveBeenCalledWith(expect.objectContaining({ code: 'BALLDONTLIE', webhooksEnabled: true }));
    expect(summary).toMatchObject({ webhooksEnabled: false, settings: { webhooksEnabled: true, webhookSecretSet: false } });
  });

  it('counts each provider\'s rate-limited jobs of the last 24 hours: league jobs by the league\'s sync provider (a Clutch Card\'s by its parent\'s), event jobs by the event\'s provider', async () => {
    const registry = registryWith(fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' }));
    registry.register(Sport.GOLF, fakeSportDataProvider({ providerId: 'mock', providerName: 'Mock' }), 'SECONDARY');
    const nba = buildSportLeague({ name: 'NBA', selectedProviderMapping: buildProviderMapping() });
    // Listed before its parent, as the read's name order can put it.
    const clutchCard = buildSportLeague({ name: 'A NBA Clutch Card', scoringFamily: ScoringFamily.COMPOSITE, parentSportLeagueId: nba.id });
    const countByScope = jest.fn().mockResolvedValue([
      { sportLeagueId: nba.id, sportEventId: null, count: 2 },
      { sportLeagueId: clutchCard.id, sportEventId: null, count: 10 },
      { sportLeagueId: null, sportEventId: 'event-bdl', count: 3 },
      { sportLeagueId: null, sportEventId: 'event-mock', count: 1 },
      // Neither scope, an unsynced league and an event no longer there count for no provider.
      { sportLeagueId: null, sportEventId: null, count: 7 },
      { sportLeagueId: 'unsynced-league', sportEventId: null, count: 5 },
      { sportLeagueId: null, sportEventId: 'event-deleted', count: 4 },
    ]);
    const findLinks = jest.fn().mockResolvedValue([
      { id: 'event-bdl', name: 'Masters', sportLeagueId: 'pga', providerId: 'balldontlie' },
      { id: 'event-mock', name: 'Mock Open', sportLeagueId: 'pga', providerId: 'mock' },
    ]);

    const providers = await service({
      registry,
      sportEvents: fakeSportEventRepo({ findLinks }),
      sportLeagues: { findEventSyncedWithClutchCards: () => Promise.resolve([clutchCard, nba]) },
      jobHistory: { countByScope },
      now: () => new Date('2026-11-19T12:00:00.000Z'),
    }).listProviders();

    expect(countByScope).toHaveBeenCalledWith({ errorType: 'RATE_LIMITED', since: new Date('2026-11-18T12:00:00.000Z') });
    expect(findLinks).toHaveBeenCalledWith(['event-bdl', 'event-mock', 'event-deleted']);
    expect(providers).toEqual([
      expect.objectContaining({ providerId: 'balldontlie', rateLimitedJobsLast24h: 15 }),
      expect.objectContaining({ providerId: 'mock', rateLimitedJobsLast24h: 1 }),
    ]);
  });

  it('fails the list when a provider\'s live health check throws, since there is no stored health to show', async () => {
    const provider = fakeSportDataProvider({ healthCheck: jest.fn().mockRejectedValue(new Error('provider down')) });

    await expect(service({ registry: registryWith(provider) }).listProviders()).rejects.toThrow('provider down');
  });
});

describe('IngestionService.listSyncRuns', () => {
  it('defaults the window to the six hours before now when the caller names neither end', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
    try {
      const runs = syncRuns();
      await service({ registry: registryWith(null), syncRuns: runs }).listSyncRuns();

      expect(runs.findAll).toHaveBeenCalledWith({
        providerId: undefined, sport: undefined, status: undefined,
        createdFrom: new Date('2026-05-30T06:00:00.000Z'),
        createdTo: new Date('2026-05-30T12:00:00.000Z'),
      });
      expect(DEFAULT_SYNC_RUN_WINDOW_HOURS).toBe(6);
    } finally {
      jest.useRealTimers();
    }
  });

  it('counts the default start back from the caller\'s end, and passes every filter through', async () => {
    const runs = syncRuns();
    const to = new Date('2026-01-10T00:00:00.000Z');

    await service({ registry: registryWith(null), syncRuns: runs }).listSyncRuns({
      providerId: 'mock', sport: Sport.GOLF, status: 'FAILED', to,
    });

    expect(runs.findAll).toHaveBeenCalledWith({
      providerId: 'mock', sport: Sport.GOLF, status: 'FAILED',
      createdFrom: new Date('2026-01-09T18:00:00.000Z'), createdTo: to,
    });
  });
});

describe('IngestionService.getSyncRun', () => {
  it('returns one run with its detailed diagnostics, read by its id', async () => {
    const run = {
      id: 'run-1', providerId: 'mock', sport: Sport.GOLF, eventId: 'event-1', status: 'COMPLETED' as const,
      startedAt: null, completedAt: null, createdAt: new Date('2026-05-30T12:00:00.000Z'),
      payload: { requestedFeed: 'EVENTPARTICIPANTS' }, details: { jobPayload: { recordsProcessed: 3 } },
    };
    const runs = syncRuns({ findById: jest.fn().mockResolvedValue(run) });

    await expect(service({ registry: registryWith(null), syncRuns: runs }).getSyncRun('run-1')).resolves.toBe(run);
    expect(runs.findById).toHaveBeenCalledWith('run-1');
  });

  it('refuses a run that does not exist with ProviderSyncRunNotFoundError', async () => {
    const runs = syncRuns();

    await expect(service({ registry: registryWith(null), syncRuns: runs }).getSyncRun('missing'))
      .rejects.toBeInstanceOf(ProviderSyncRunNotFoundError);
  });
});

describe('IngestionService.getUnmappedParticipants', () => {
  it('lists the competitors each provider reports for its sports that no participant is mapped to', async () => {
    const provider = fakeSportDataProvider({
      providerId: 'feed', providerName: 'Feed', sportsCovered: [Sport.GOLF],
      getParticipants: jest.fn().mockResolvedValue([
        { externalId: 'p-1', providerId: 'feed', sport: Sport.GOLF, name: 'Mapped Golfer', active: true, metadata: {} },
        { externalId: 'p-2', providerId: 'feed', sport: Sport.GOLF, name: 'New Golfer', active: true, metadata: {} },
      ]),
    });
    const participantMappings = fakeParticipantProviderMappingRepo({
      findByProviderExternalIds: jest.fn().mockResolvedValue([{ externalId: 'p-1' }]),
    });

    const unmapped = await service({
      registry: registryWith(provider), participantMappings,
    }).getUnmappedParticipants();

    expect(provider.getParticipants).toHaveBeenCalledTimes(1);
    expect(provider.getParticipants).toHaveBeenCalledWith(Sport.GOLF);
    expect(participantMappings.findByProviderExternalIds).toHaveBeenCalledWith('feed', { sport: Sport.GOLF }, ['p-1', 'p-2']);
    expect(unmapped).toEqual([
      { providerId: 'feed', providerName: 'Feed', externalId: 'p-2', externalName: 'New Golfer', sport: Sport.GOLF },
    ]);
  });

  it('keeps only the competitor named by provider and id, and reads the mapping of that one id alone', async () => {
    const provider = fakeSportDataProvider({
      providerId: 'feed', providerName: 'Feed', sportsCovered: [Sport.GOLF],
      getParticipants: jest.fn().mockResolvedValue([
        { externalId: 'p-1', providerId: 'feed', sport: Sport.GOLF, name: 'Other Golfer', active: true, metadata: {} },
        { externalId: 'p-2', providerId: 'feed', sport: Sport.GOLF, name: 'New Golfer', active: true, metadata: {} },
      ]),
    });
    const participantMappings = fakeParticipantProviderMappingRepo({ findByProviderExternalIds: jest.fn().mockResolvedValue([]) });

    const unmapped = await service({
      registry: registryWith(provider), participantMappings,
    }).getUnmappedParticipants({ providerId: 'feed', externalId: 'p-2' });

    expect(participantMappings.findByProviderExternalIds).toHaveBeenCalledWith('feed', { sport: Sport.GOLF }, ['p-2']);
    expect(unmapped).toEqual([
      { providerId: 'feed', providerName: 'Feed', externalId: 'p-2', externalName: 'New Golfer', sport: Sport.GOLF },
    ]);
  });

  it('asks no provider but the one named, and reads no mapping when the named competitor is not reported', async () => {
    const provider = fakeSportDataProvider({
      providerId: 'feed', sportsCovered: [Sport.GOLF],
      getParticipants: jest.fn().mockResolvedValue([
        { externalId: 'p-1', providerId: 'feed', sport: Sport.GOLF, name: 'Golfer', active: true, metadata: {} },
      ]),
    });
    const participantMappings = fakeParticipantProviderMappingRepo({ findByProviderExternalIds: jest.fn().mockResolvedValue([]) });
    const reads = service({ registry: registryWith(provider), participantMappings });

    await expect(reads.getUnmappedParticipants({ providerId: 'other-feed' })).resolves.toEqual([]);
    expect(provider.getParticipants).not.toHaveBeenCalled();
    await expect(reads.getUnmappedParticipants({ providerId: 'feed', externalId: 'gone' })).resolves.toEqual([]);
    expect(participantMappings.findByProviderExternalIds).not.toHaveBeenCalled();
  });

  it('returns nothing when no provider is registered', async () => {
    await expect(service({ registry: registryWith(null) }).getUnmappedParticipants()).resolves.toEqual([]);
  });
});

describe('IngestionService.syncEventData refusals', () => {
  const REQUEST = { sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTLIVESCORES' as const] };

  it('fails when no scheduler is wired, since a manual sync has nothing to run it', async () => {
    await expect(service({ registry: registryWith(fakeSportDataProvider()) }).syncEventData(REQUEST, 'admin', 'a@x.test'))
      .rejects.toThrow('Ingestion scheduler is required for manual event sync');
  });

  it('refuses a sport no provider is registered for with SportProviderNotFoundError, and records no run', async () => {
    const runs = syncRuns();
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn() });

    await expect(service({ registry: registryWith(null), scheduler, syncRuns: runs }).syncEventData(REQUEST, 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'SportProviderNotFoundError' });
    expect(runs.createWithJob).not.toHaveBeenCalled();
  });

  it('refuses with SportProviderNotFoundError a provider that is registered but does not serve the event\'s sport, and records no run', async () => {
    const runs = syncRuns();
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn() });
    const tennisOnly = fakeSportDataProvider({ sportsCovered: [Sport.TENNIS] });

    await expect(service({ registry: registryWith(tennisOnly), scheduler, syncRuns: runs }).syncEventData(REQUEST, 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'SportProviderNotFoundError', message: 'No provider mock-provider is registered for sport GOLF' });
    expect(runs.createWithJob).not.toHaveBeenCalled();
  });

  it('refuses with SportProviderNotFoundError an event linked to a provider that is not registered, even when another serves the sport', async () => {
    const runs = syncRuns();
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn() });

    await expect(service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs })
      .syncEventData({ ...REQUEST, providerId: 'balldontlie' }, 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'SportProviderNotFoundError' });
    expect(runs.createWithJob).not.toHaveBeenCalled();
  });

  it('refuses a mock event state for a provider that has no mock controls, and records no run', async () => {
    const runs = syncRuns();
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn() });

    await expect(service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs })
      .syncEventData({ ...REQUEST, mockEventState: 'live' }, 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'MockEventStateUnsupportedError' });
    expect(runs.createWithJob).not.toHaveBeenCalled();
    expect(runs.jobs.rows).toEqual([]);
  });
});

describe('IngestionService manual sync job (#1441)', () => {
  function linkedEvent(): SportEvent {
    return { id: 'event-1', syncScope: SportEventSyncScope.SCORES_ONLY } as SportEvent;
  }

  const COMPLETED_JOB: IngestionJobRecord = {
    jobType: 'EVENT_LIVE_SCORES_SYNC', providerId: 'mock-provider', sport: Sport.GOLF, eventExternalId: 'evt-1',
    status: 'COMPLETED', recordsProcessed: 0, errors: 0, errorLog: [], warnings: [],
  };

  it('returns the SUBMITTED runs before any feed runs, with one queued MANUAL_EVENT_SYNC job naming them and scoped to the linked event', async () => {
    const runs = syncRuns();
    const runEventSync = jest.fn().mockResolvedValue([COMPLETED_JOB]);
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const sportEvents = fakeSportEventRepo({ findByProviderRef: jest.fn().mockResolvedValue(linkedEvent()) });
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs, sportEvents });

    const submitted = await ingestion.syncEventData({
      sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
    }, 'admin', 'a@x.test');

    expect(runEventSync).not.toHaveBeenCalled();
    expect(submitted.syncRuns.map((run) => run.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
    expect(runs.create).not.toHaveBeenCalled();
    expect(runs.jobs.rows).toEqual([expect.objectContaining({
      type: 'MANUAL_EVENT_SYNC',
      payload: { syncRunIds: submitted.syncRuns.map((run) => run.id), sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1', sportEventId: 'event-1' },
      sportEventId: 'event-1',
    })]);
    expect(submitted.syncRuns.map((run) => [run.kind, run.trigger, run.sportEventId])).toEqual([['FIELD', 'ADMIN', 'event-1'], ['SCORES', 'ADMIN', 'event-1']]);

    await ingestion.jobsDone();
    expect(runEventSync).toHaveBeenCalledTimes(2);
    expect(runs.jobs.rows[0].status).toBe('SUCCEEDED');
    // The job that ran them is named on each run, so Activity opens a job's runs.
    expect(runs.rows.map((run) => run.backgroundJobId)).toEqual([runs.jobs.rows[0].id, runs.jobs.rows[0].id]);
  });

  it('runs each requested feed as its own run, and keeps going after one feed fails', async () => {
    const runs = syncRuns();
    const runEventSync = jest.fn()
      .mockRejectedValueOnce(new Error('field feed exploded'))
      .mockResolvedValueOnce([COMPLETED_JOB]);
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const provider: SportDataProvider = fakeSportDataProvider();
    const sportEvents = fakeSportEventRepo({ findByProviderRef: jest.fn().mockResolvedValue(linkedEvent()) });
    const ingestion = service({ registry: registryWith(provider), scheduler, syncRuns: runs, sportEvents });

    const submitted = await ingestion.syncEventData({
      sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
    }, 'admin', 'a@x.test');
    await ingestion.jobsDone();

    const [fieldRun, scoresRun] = submitted.syncRuns;
    expect(runEventSync).toHaveBeenNthCalledWith(1, expect.objectContaining({ feeds: ['EVENTPARTICIPANTS'] }));
    expect(runEventSync).toHaveBeenNthCalledWith(2, expect.objectContaining({ feeds: ['EVENTLIVESCORES'] }));
    expect(runs.update).toHaveBeenCalledWith(fieldRun.id, expect.objectContaining({ status: 'FAILED' }));
    expect(runs.update).toHaveBeenCalledWith(scoresRun.id, expect.objectContaining({ status: 'COMPLETED' }));
    // A failed feed is the run's outcome, not the job's: the job is done.
    expect(runs.jobs.rows[0].status).toBe('SUCCEEDED');
  });

  it('on a retry, marks a run an earlier try left IN_PROGRESS FAILED as interrupted and runs only the SUBMITTED ones, so no feed runs twice and none shows as running forever (#1445)', async () => {
    const runs = syncRuns();
    const runEventSync = jest.fn().mockResolvedValue([COMPLETED_JOB]);
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs });
    const waiting = await runs.create({
      ...SCHEDULED_SCORES_RUN,
      providerId: 'mock-provider', sport: Sport.GOLF, eventId: 'evt-1', status: 'SUBMITTED',
      startedAt: null, completedAt: null, payload: { requestedFeed: 'EVENTPARTICIPANTS' },
    });
    const started = await runs.create({
      ...SCHEDULED_SCORES_RUN,
      providerId: 'mock-provider', sport: Sport.GOLF, eventId: 'evt-1', status: 'IN_PROGRESS',
      startedAt: new Date(), completedAt: null, payload: { requestedFeed: 'EVENTLIVESCORES' },
    });

    await ingestion.runManualEventSync({ syncRunIds: [started.id, waiting.id], sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1' }, { attempt: 2, jobId: 'job-1' });

    expect(runEventSync).toHaveBeenCalledTimes(1);
    expect(runEventSync).toHaveBeenCalledWith(expect.objectContaining({ feeds: ['EVENTPARTICIPANTS'] }));
    const interrupted = runs.rows.find((run) => run.id === started.id);
    expect(interrupted?.status).toBe('FAILED');
    expect(interrupted?.completedAt).toBeInstanceOf(Date);
    const failedWith = runs.update.mock.calls.find(([id, update]) => id === started.id && update.status === 'FAILED')?.[1];
    expect(JSON.stringify(failedWith?.details)).toContain('Interrupted');
    expect(runs.rows.find((run) => run.id === waiting.id)?.status).toBe('COMPLETED');
  });

  it('on a first try, leaves a run already IN_PROGRESS alone, since only a retry can know an earlier try stopped', async () => {
    const runs = syncRuns();
    const runEventSync = jest.fn().mockResolvedValue([COMPLETED_JOB]);
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs });
    const started = await runs.create({
      ...SCHEDULED_SCORES_RUN,
      providerId: 'mock-provider', sport: Sport.GOLF, eventId: 'evt-1', status: 'IN_PROGRESS',
      startedAt: new Date(), completedAt: null, payload: { requestedFeed: 'EVENTLIVESCORES' },
    });

    await ingestion.runManualEventSync({ syncRunIds: [started.id], sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1' }, { attempt: 1, jobId: 'job-1' });

    expect(runEventSync).not.toHaveBeenCalled();
    expect(runs.rows.find((run) => run.id === started.id)?.status).toBe('IN_PROGRESS');
  });

  it('fails the job when no scheduler is wired on the task that runs it, so the runner retries it', async () => {
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()) });

    await expect(ingestion.runManualEventSync({
      syncRunIds: ['00000000-0000-4000-8000-000000000001'], sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1',
    }, { attempt: 1, jobId: 'job-1' })).rejects.toThrow('Ingestion scheduler is required for manual event sync');
  });

  it('runs the other feeds, then fails the job when a failed feed\'s run could not be marked FAILED, so the retry marks it interrupted (#1445)', async () => {
    const runs = syncRuns();
    const update = runs.update.getMockImplementation();
    let refuseFailedWrite = true;
    runs.update.mockImplementation((id, change) => {
      if (change.status === 'FAILED' && refuseFailedWrite) {
        refuseFailedWrite = false;
        return Promise.reject(new Error('connection reset'));
      }
      return expectDefined(update)(id, change);
    });
    const runEventSync = jest.fn()
      .mockRejectedValueOnce(new Error('provider timed out'))
      .mockResolvedValue([COMPLETED_JOB]);
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs });
    const failing = await runs.create({
      ...SCHEDULED_SCORES_RUN,
      providerId: 'mock-provider', sport: Sport.GOLF, eventId: 'evt-1', status: 'SUBMITTED',
      startedAt: null, completedAt: null, payload: { requestedFeed: 'EVENTPARTICIPANTS' },
    });
    const healthy = await runs.create({
      ...SCHEDULED_SCORES_RUN,
      providerId: 'mock-provider', sport: Sport.GOLF, eventId: 'evt-1', status: 'SUBMITTED',
      startedAt: null, completedAt: null, payload: { requestedFeed: 'EVENTLIVESCORES' },
    });
    const payload = { syncRunIds: [failing.id, healthy.id], sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1' };

    await expect(ingestion.runManualEventSync(payload, { attempt: 1, jobId: 'job-1' })).rejects.toThrow(`without a recorded outcome: ${failing.id}`);
    expect(runs.rows.find((run) => run.id === failing.id)?.status).toBe('IN_PROGRESS');
    expect(runs.rows.find((run) => run.id === healthy.id)?.status).toBe('COMPLETED');

    await ingestion.runManualEventSync(payload, { attempt: 2, jobId: 'job-1' });

    expect(runs.rows.find((run) => run.id === failing.id)?.status).toBe('FAILED');
    expect(runEventSync).toHaveBeenCalledTimes(2);
  });

  it('runs outside the submitting request\'s read memo, so the background sync reads afresh', async () => {
    // Stands in for the root Prisma client, the only one whose reads are remembered.
    const root = { $transaction: jest.fn() } as unknown as PrismaClient;
    const load = jest.fn(async () => linkedEvent());
    const runEventSync = jest.fn(async () => {
      await memoizedRead(root, `${ReadMemoKey.sportEvent}event-1`, load);
      await memoizedRead(root, `${ReadMemoKey.sportEvent}event-1`, load);
      return [COMPLETED_JOB];
    });
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const sportEvents = fakeSportEventRepo({ findByProviderRef: jest.fn().mockResolvedValue(linkedEvent()) });
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()), scheduler, sportEvents });

    await runWithReadMemo(async () => {
      await memoizedRead(root, `${ReadMemoKey.sportEvent}event-1`, load);
      await ingestion.syncEventData({ sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTLIVESCORES'] }, 'admin', 'a@x.test');
    });
    await ingestion.jobsDone();

    expect(runEventSync).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
