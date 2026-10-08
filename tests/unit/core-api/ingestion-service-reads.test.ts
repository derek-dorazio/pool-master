import { expect } from '@jest/globals';
import {
  DEFAULT_SYNC_RUN_WINDOW_HOURS,
  IngestionService,
  type IngestionServiceDependencies,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type { SportDataProvider } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { ProviderSyncRunRepository } from '../../../packages/shared/db';
import { Sport, SportEventSyncScope, type SportEvent } from '../../../packages/shared/domain';
import { fakeParticipantProviderMappingRepo, fakeSportEventRepo } from '../../support/repo-fakes';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';
import { stubInstance } from '../../support/stub-instance';

// The root-admin reads over ingestion (provider list, sync-run history, unmapped competitors)
// and the manual sync submission's refusals and its background worker.

const GOLF_ONLY_CONFIG = {
  scheduledSports: [Sport.GOLF],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventParticipants: { enabled: false, intervalMinutes: 360, lookaheadDays: 14 },
  eventLiveScores: { enabled: true, intervalSeconds: 300 },
  perSportOverrides: {},
};

function configReader(config = GOLF_ONLY_CONFIG) {
  return { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) };
}

function syncRuns(overrides: Partial<ProviderSyncRunRepository> = {}): ProviderSyncRunRepository {
  return {
    create: mockFn<ProviderSyncRunRepository['create']>(async (input) => ({
      id: `run-${String(input.payload.requestedFeed)}`,
      createdAt: new Date('2026-05-30T12:00:00.000Z'),
      ...input,
    })),
    update: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function service(deps: Partial<IngestionServiceDependencies> & Pick<IngestionServiceDependencies, 'registry'>) {
  return new IngestionService({
    sportEvents: fakeSportEventRepo(),
    participantMappings: fakeParticipantProviderMappingRepo(),
    syncRuns: syncRuns(),
    logger: fakeLogger(),
    ...deps,
  });
}

/** Runs the deferred background worker the submission hands to setImmediate. */
async function runDeferredWorker(run: () => Promise<unknown>): Promise<void> {
  let deferred: (() => void) | undefined;
  const spy = jest.spyOn(global, 'setImmediate').mockImplementation((callback: () => void) => {
    deferred = callback;
    return 0 as unknown as NodeJS.Immediate;
  });
  try {
    await run();
    deferred?.();
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    spy.mockRestore();
  }
}

describe('IngestionService.listProviders', () => {
  it('lists each provider with its live health, its configured sports only, and its event activity, sorted by name', async () => {
    const zebra = fakeSportDataProvider({ providerId: 'zebra', providerName: 'Zebra Feed', sportsCovered: [Sport.GOLF, Sport.TENNIS] });
    const alpha = fakeSportDataProvider({
      providerId: 'alpha',
      providerName: 'Alpha Feed',
      sportsCovered: [Sport.NFL],
      healthCheck: jest.fn().mockResolvedValue({
        providerId: 'alpha', status: 'DEGRADED', errorRateLastHour: 0.2, latencyMsP95: 900,
        lastSuccessfulPoll: new Date('2026-05-01T00:00:00.000Z'),
      }),
    });
    const registry = new ProviderRegistry();
    registry.register(Sport.GOLF, zebra, 'PRIMARY');
    registry.register(Sport.NFL, alpha, 'PRIMARY');
    const lastChangedAt = new Date('2026-05-30T09:00:00.000Z');
    const sportEvents = fakeSportEventRepo({
      summarizeByProviders: jest.fn().mockResolvedValue(new Map([['zebra', { activeEventCount: 3, lastChangedAt }]])),
    });

    const providers = await service({ registry, sportEvents, ingestionConfigReader: configReader() }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: 'alpha', status: 'DEGRADED', errorRate: 0.2, latencyMs: 900,
        // No event activity, so the provider's own last successful poll stands in.
        lastEventAt: new Date('2026-05-01T00:00:00.000Z'), activeEventCount: 0,
        // NFL is not a scheduled sport, so it is not listed as covered.
        sportsCovered: [], supportsLiveSimulation: false,
      }),
      expect.objectContaining({
        providerId: 'zebra', status: 'HEALTHY', lastEventAt: lastChangedAt, activeEventCount: 3, sportsCovered: [Sport.GOLF],
      }),
    ]);
  });

  it('lists every sport a provider covers when no ingestion config is wired, and a null last-event time when it has none', async () => {
    const provider = fakeSportDataProvider({ sportsCovered: [Sport.GOLF, Sport.TENNIS] });

    const [summary] = await service({ registry: registryWith(provider) }).listProviders();

    expect(summary).toMatchObject({ sportsCovered: [Sport.GOLF, Sport.TENNIS], lastEventAt: null });
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

describe('IngestionService.getUnmappedParticipants', () => {
  it('lists the competitors each provider reports for its scheduled sports that no participant is mapped to', async () => {
    const provider = fakeSportDataProvider({
      providerId: 'feed', providerName: 'Feed', sportsCovered: [Sport.GOLF, Sport.TENNIS],
      getParticipants: jest.fn().mockResolvedValue([
        { externalId: 'p-1', providerId: 'feed', sport: Sport.GOLF, name: 'Mapped Golfer', active: true, metadata: {} },
        { externalId: 'p-2', providerId: 'feed', sport: Sport.GOLF, name: 'New Golfer', active: true, metadata: {} },
      ]),
    });
    const participantMappings = fakeParticipantProviderMappingRepo({
      findByProviderExternalIds: jest.fn().mockResolvedValue([{ externalId: 'p-1' }]),
    });

    const unmapped = await service({
      registry: registryWith(provider), participantMappings, ingestionConfigReader: configReader(),
    }).getUnmappedParticipants();

    // Tennis is not scheduled, so the provider is only asked for golf.
    expect(provider.getParticipants).toHaveBeenCalledTimes(1);
    expect(provider.getParticipants).toHaveBeenCalledWith(Sport.GOLF);
    expect(participantMappings.findByProviderExternalIds).toHaveBeenCalledWith('feed', ['p-1', 'p-2']);
    expect(unmapped).toEqual([
      { providerId: 'feed', providerName: 'Feed', externalId: 'p-2', externalName: 'New Golfer', sport: Sport.GOLF },
    ]);
  });

  it('returns nothing when no provider is registered', async () => {
    await expect(service({ registry: registryWith(null) }).getUnmappedParticipants()).resolves.toEqual([]);
  });
});

describe('IngestionService.syncEventData refusals', () => {
  const REQUEST = { sport: Sport.GOLF, eventId: 'evt-1', feeds: ['EVENTLIVESCORES' as const] };

  it('fails when no scheduler is wired, since a manual sync has nothing to run it', async () => {
    await expect(service({ registry: registryWith(fakeSportDataProvider()) }).syncEventData(REQUEST, 'admin', 'a@x.test'))
      .rejects.toThrow('Ingestion scheduler is required for manual event sync');
  });

  it('refuses a sport no provider is registered for with SportProviderNotFoundError, and records no run', async () => {
    const runs = syncRuns();
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn() });

    await expect(service({ registry: registryWith(null), scheduler, syncRuns: runs }).syncEventData(REQUEST, 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'SportProviderNotFoundError' });
    expect(runs.create).not.toHaveBeenCalled();
  });

  it('refuses a mock event state for a provider that has no mock controls, and records no run', async () => {
    const runs = syncRuns();
    const scheduler = stubInstance(IngestionScheduler, { runEventSync: jest.fn() });

    await expect(service({ registry: registryWith(fakeSportDataProvider()), scheduler, syncRuns: runs })
      .syncEventData({ ...REQUEST, mockEventState: 'live' }, 'admin', 'a@x.test'))
      .rejects.toMatchObject({ name: 'MockEventStateUnsupportedError' });
    expect(runs.create).not.toHaveBeenCalled();
  });
});

describe('IngestionService manual sync background worker', () => {
  function linkedEvent(): SportEvent {
    return { id: 'event-1', syncScope: SportEventSyncScope.SCORES_ONLY } as SportEvent;
  }

  it('runs each requested feed as its own run, and keeps going after one feed fails', async () => {
    const runs = syncRuns();
    const runEventSync = jest.fn()
      .mockRejectedValueOnce(new Error('field feed exploded'))
      .mockResolvedValueOnce([{
        jobType: 'EVENT_LIVE_SCORES_SYNC', providerId: 'mock-provider', sport: Sport.GOLF, eventExternalId: 'evt-1',
        status: 'COMPLETED', recordsProcessed: 0, errors: 0, errorLog: [], warnings: [],
      }]);
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const provider: SportDataProvider = fakeSportDataProvider();
    const sportEvents = fakeSportEventRepo({ findByProviderRef: jest.fn().mockResolvedValue(linkedEvent()) });
    const ingestion = service({ registry: registryWith(provider), scheduler, syncRuns: runs, sportEvents });

    await runDeferredWorker(() => ingestion.syncEventData({
      sport: Sport.GOLF, eventId: 'evt-1', feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
    }, 'admin', 'a@x.test'));

    expect(runEventSync).toHaveBeenNthCalledWith(1, expect.objectContaining({ feeds: ['EVENTPARTICIPANTS'] }));
    expect(runEventSync).toHaveBeenNthCalledWith(2, expect.objectContaining({ feeds: ['EVENTLIVESCORES'] }));
    expect(runs.update).toHaveBeenCalledWith('run-EVENTPARTICIPANTS', expect.objectContaining({ status: 'FAILED' }));
    expect(runs.update).toHaveBeenCalledWith('run-EVENTLIVESCORES', expect.objectContaining({ status: 'COMPLETED' }));
  });
});
