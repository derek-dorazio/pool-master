import { syncRunOutcome } from '../../support/sync-run-payload';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { expect } from '@jest/globals';
import { providerCodeOfSourceId } from '../../../packages/shared/domain/providers';
import {
  DEFAULT_SYNC_RUN_WINDOW_HOURS,
  IngestionService,
  ProviderSyncRunNotFoundError,
  type IngestionServiceDependencies,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import type { ProviderSyncRunRepository } from '../../../packages/shared/db';
import { ProviderCode, Sport, type ProviderSettings, type SportEvent } from '../../../packages/shared/domain';
import { fakeSportEventRepo } from '../../support/repo-fakes';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { fakeLogger } from '../../support/fake-logger';
import { testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { inMemorySyncRuns, type InMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';

/** A second Provider code, for a registry running two providers. */
const OTHER_PROVIDER = 'OTHER_FEED' as ProviderCode;

// The root-admin reads over ingestion (provider list, sync-run history)
// and the manual sync submission's refusals.

/** The provider settings store over these Provider rows: each adapter finds its row by its source id. */
function settingsOf(...rows: ProviderSettings[]): IngestionServiceDependencies['providerSettings'] {
  return {
    all: () => rows,
    bySourceId: (sourceId) => rows.find((row) => row.code === providerCodeOfSourceId(sourceId)),
  };
}

function syncRuns(overrides: Partial<ProviderSyncRunRepository> = {}): InMemorySyncRuns {
  return Object.assign(inMemorySyncRuns(), overrides);
}

/** The service as the app builds it, with a real job queue over in-memory tables. */
function service(
  deps: Partial<Omit<IngestionServiceDependencies, 'syncRuns'>> & Pick<IngestionServiceDependencies, 'registry'> & { syncRuns?: InMemorySyncRuns },
) {
  const runs = deps.syncRuns ?? syncRuns();
  const jobs = new BackgroundJobQueue({ jobs: runs.jobs, currentStart: testCurrentJobStart });
  return new IngestionService({
    sportEvents: fakeSportEventRepo(),
    sportLeagues: { findEventSynced: () => Promise.resolve([]) },
    providerSettings: { all: () => [], bySourceId: () => undefined },
    webhooks: { isOn: () => false, isSecretSet: () => false },
    jobHistory: { countByScope: () => Promise.resolve([]) },
    logger: fakeLogger(),
    jobs,
    ...deps,
    syncRuns: runs,
  });
}

describe('IngestionService.listProviders', () => {
  it('lists a provider with its event activity, and no health while it has no Provider row to own runs', async () => {
    const provider = fakeSportDataProvider({ providerId: 'zebra', providerName: 'Zebra Feed' });
    const lastChangedAt = new Date('2026-05-30T09:00:00.000Z');
    const sportEvents = fakeSportEventRepo({
      summarizeByProviders: jest.fn().mockResolvedValue(new Map([['zebra', { activeEventCount: 3, lastChangedAt }]])),
    });

    const providers = await service({ registry: registryWith(provider), sportEvents }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: 'zebra', status: null, errorRate: null, lastEventAt: lastChangedAt, activeEventCount: 3,
      }),
    ]);
  });

  it('reads a provider\'s health from its sync runs of the last hour: DEGRADED with the failed share when some failed, ignoring older and unfinished runs, and calling the provider never', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
    try {
      const provider = fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' });
      const runs = syncRuns();
      const run = (status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS', createdAt: string) => runs.create({
        ...SCHEDULED_SCORES_RUN, providerCode: ProviderCode.BALLDONTLIE, status,
        startedAt: null, completedAt: null, ...syncRunOutcome(), createdAt: new Date(createdAt),
      });
      await run('COMPLETED', '2026-05-30T11:30:00.000Z');
      await run('COMPLETED', '2026-05-30T11:40:00.000Z');
      await run('FAILED', '2026-05-30T11:50:00.000Z');
      await run('IN_PROGRESS', '2026-05-30T11:55:00.000Z');
      await run('FAILED', '2026-05-30T10:00:00.000Z');

      const [summary] = await service({
        registry: registryWith(provider),
        providerSettings: settingsOf(balldontlieTestProvider()),
        syncRuns: runs,
      }).listProviders();

      expect(summary).toMatchObject({ providerId: 'balldontlie', status: 'DEGRADED', errorRate: 1 / 3 });
      expect(summary).not.toHaveProperty('latencyMs');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a provider as HEALTHY when none of its runs of the hour failed, DOWN when all did, and unknown (null) when none finished', async () => {
    const provider = fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' });
    const health = async (counts: { finished: number; failed: number } | null) => {
      const runs = syncRuns({
        countFinishedByProvider: jest.fn().mockResolvedValue(counts === null ? [] : [{ providerId: balldontlieTestProvider().id, ...counts }]),
      });
      const [summary] = await service({ registry: registryWith(provider), providerSettings: settingsOf(balldontlieTestProvider()), syncRuns: runs }).listProviders();
      return { status: summary.status, errorRate: summary.errorRate };
    };

    await expect(health({ finished: 4, failed: 0 })).resolves.toEqual({ status: 'HEALTHY', errorRate: 0 });
    await expect(health({ finished: 2, failed: 2 })).resolves.toEqual({ status: 'DOWN', errorRate: 1 });
    await expect(health(null)).resolves.toEqual({ status: null, errorRate: null });
  });

  it('shows a null last-event time for a running provider none of whose events changed', async () => {
    const [summary] = await service({ registry: registryWith(fakeSportDataProvider()) }).listProviders();

    expect(summary).toMatchObject({ providerId: 'mock-provider', lastEventAt: null });
  });

  it('lists every provider running here, each once, by its Provider code', async () => {
    const providers = await service({
      registry: registryWith(
        fakeSportDataProvider({ providerId: 'mock', providerName: 'Mock' }),
        fakeSportDataProvider({ providerId: 'feed', providerName: 'Feed', providerCode: OTHER_PROVIDER }),
      ),
    }).listProviders();

    expect(providers.map((summary) => summary.providerId)).toEqual(['feed', 'mock']);
  });

  it('shows each provider\'s request rate, whether its webhooks are on, and how many active sport leagues its sync creates', async () => {
    const paced = { ...fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' }), requestsPerMinute: 600 };
    const unpaced = fakeSportDataProvider({ providerId: 'mock', providerName: 'Mock', providerCode: OTHER_PROVIDER });
    const registry = registryWith(paced, unpaced);
    const nba = buildSportLeague({ name: 'NBA', selectedProviderMapping: buildProviderMapping() });
    const findEventSynced = jest.fn().mockResolvedValue([
      buildSportLeague({ name: 'PGA TOUR', selectedProviderMapping: buildProviderMapping({ providerLeagueCode: 'pga', providerLeagueName: 'PGA TOUR' }) }),
      nba,
    ]);

    const providers = await service({
      registry,
      sportLeagues: { findEventSynced },
      providerSettings: settingsOf(balldontlieTestProvider({ requestsPerMinute: 600 })),
      webhooks: { isOn: () => true, isSecretSet: () => true },
    }).listProviders();

    expect(findEventSynced).toHaveBeenCalledTimes(1);
    expect(providers).toEqual([
      expect.objectContaining({ providerId: 'balldontlie', requestsPerMinute: 600, webhooksEnabled: true, syncedSportLeagueCount: 2 }),
      expect.objectContaining({ providerId: 'mock', requestsPerMinute: null, webhooksEnabled: false, syncedSportLeagueCount: 0 }),
    ]);
  });

  it('counts no league for any provider when the synced league read has no selected mapping', async () => {
    const providers = await service({
      registry: registryWith(fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' })),
      sportLeagues: { findEventSynced: jest.fn().mockResolvedValue([buildSportLeague({ name: 'Unmapped', selectedProviderMapping: null })]) },
    }).listProviders();

    expect(providers).toEqual([expect.objectContaining({ providerId: 'balldontlie', syncedSportLeagueCount: 0 })]);
  });

  it('lists a provider that has a row but is not running here, as when its key is not set, with no status and its row\'s settings', async () => {
    const [summary] = await service({
      registry: registryWith(null),
      providerSettings: settingsOf(balldontlieTestProvider({ requestsPerMinute: 5 })),
      webhooks: { isOn: () => false, isSecretSet: () => false },
    }).listProviders();

    expect(summary).toMatchObject({
      providerId: 'balldontlie', providerName: 'BALLDONTLIE', status: null, requestsPerMinute: 5, webhooksEnabled: false,
      settings: { code: 'BALLDONTLIE', requestsPerMinute: 5, webhooksEnabled: true, webhookSecretSet: false },
    });
  });

  it('shows a provider\'s webhooks off while its row switches them on but its signing secret is not set', async () => {
    const isOn = jest.fn().mockReturnValue(false);
    const [summary] = await service({
      registry: registryWith(fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' })),
      providerSettings: settingsOf(balldontlieTestProvider({ webhooksEnabled: true })),
      webhooks: { isOn, isSecretSet: () => false },
    }).listProviders();

    expect(isOn).toHaveBeenCalledWith(expect.objectContaining({ code: 'BALLDONTLIE', webhooksEnabled: true }));
    expect(summary).toMatchObject({ webhooksEnabled: false, settings: { webhooksEnabled: true, webhookSecretSet: false } });
  });

  it('counts each provider\'s rate-limited jobs of the last 24 hours: league jobs by the league\'s sync provider, event jobs by the event\'s provider', async () => {
    const registry = registryWith(
      fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE' }),
      fakeSportDataProvider({ providerId: 'mock', providerName: 'Mock', providerCode: OTHER_PROVIDER }),
    );
    const nba = buildSportLeague({ name: 'NBA', selectedProviderMapping: buildProviderMapping() });
    const countByScope = jest.fn().mockResolvedValue([
      { sportLeagueId: nba.id, sportEventId: null, count: 2 },
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
      sportLeagues: { findEventSynced: () => Promise.resolve([nba]) },
      jobHistory: { countByScope },
      now: () => new Date('2026-11-19T12:00:00.000Z'),
    }).listProviders();

    expect(countByScope).toHaveBeenCalledWith({ errorType: 'RATE_LIMITED', since: new Date('2026-11-18T12:00:00.000Z') });
    expect(findLinks).toHaveBeenCalledWith(['event-bdl', 'event-mock', 'event-deleted']);
    expect(providers).toEqual([
      expect.objectContaining({ providerId: 'balldontlie', rateLimitedJobsLast24h: 5 }),
      expect.objectContaining({ providerId: 'mock', rateLimitedJobsLast24h: 1 }),
    ]);
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
      ...syncRunOutcome(), details: { jobPayload: { recordsProcessed: 3 } },
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

describe('IngestionService.syncSportEvent refusals', () => {
  const EVENT_ID = '3c9e1f4a-2b7d-4e8f-a1c6-9d0b5e2f7a13';
  const event = {
    id: EVENT_ID, sportLeagueId: 'pga-tour', sport: Sport.GOLF, status: 'IN_PROGRESS', syncProviderId: 'balldontlie',
    providerMappings: [{ providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', externalId: 'golf-open-2026' }],
  } as unknown as SportEvent;
  const sportEvents = () => fakeSportEventRepo({ findById: jest.fn().mockResolvedValue(event) });

  it('refuses with SportProviderNotFoundError an event whose provider is not running here, naming it, and records no run', async () => {
    const runs = syncRuns();

    await expect(service({ registry: registryWith(null), syncRuns: runs, sportEvents: sportEvents() }).syncSportEvent(EVENT_ID, ['SCORES'], 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'SportProviderNotFoundError', message: `Provider balldontlie, which syncs this ${Sport.GOLF} event, is not running here` });
    expect(runs.createWithJob).not.toHaveBeenCalled();
  });

  it('refuses with SportProviderNotFoundError an event linked to a provider that is not registered, even when another provider is running', async () => {
    const runs = syncRuns();

    await expect(service({ registry: registryWith(fakeSportDataProvider({ providerId: 'mock-provider' })), syncRuns: runs, sportEvents: sportEvents() })
      .syncSportEvent(EVENT_ID, ['SCORES'], 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'SportProviderNotFoundError' });
    expect(runs.createWithJob).not.toHaveBeenCalled();
  });
});
