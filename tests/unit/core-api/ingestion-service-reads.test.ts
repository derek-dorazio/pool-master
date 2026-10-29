import { expect } from '@jest/globals';
import {
  DEFAULT_SYNC_RUN_WINDOW_HOURS,
  IngestionService,
  ProviderSyncRunNotFoundError,
  type IngestionServiceDependencies,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { readPayload } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import { memoizedRead, ReadMemoKey, runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import type { PrismaClient } from '@prisma/client';
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
      id: `run-${String(readPayload(input).requestedFeed)}`,
      createdAt: new Date('2026-05-30T12:00:00.000Z'),
      ...input,
    })),
    update: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),    clearDetailsBatchSubmittedBefore: jest.fn().mockResolvedValue(0),    deleteBatchSubmittedBefore: jest.fn().mockResolvedValue(0),
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
  it('lists a provider with its live health and its event activity', async () => {
    const provider = fakeSportDataProvider({ providerId: 'zebra', providerName: 'Zebra Feed', sportsCovered: [Sport.GOLF] });
    const lastChangedAt = new Date('2026-05-30T09:00:00.000Z');
    const sportEvents = fakeSportEventRepo({
      summarizeByProviders: jest.fn().mockResolvedValue(new Map([['zebra', { activeEventCount: 3, lastChangedAt }]])),
    });

    const providers = await service({ registry: registryWith(provider), sportEvents, ingestionConfigReader: configReader() }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: 'zebra', status: 'HEALTHY', lastEventAt: lastChangedAt, activeEventCount: 3, sportsCovered: [Sport.GOLF],
      }),
    ]);
  });

  it('lists none of a provider\'s sports as covered when they are not scheduled, and falls back to its last successful poll', async () => {
    const provider = fakeSportDataProvider({
      providerId: 'alpha',
      sportsCovered: [Sport.GOLF],
      healthCheck: jest.fn().mockResolvedValue({
        providerId: 'alpha', status: 'DEGRADED', errorRateLastHour: 0.2, latencyMsP95: 900,
        lastSuccessfulPoll: new Date('2026-05-01T00:00:00.000Z'),
      }),
    });

    const providers = await service({
      registry: registryWith(provider), ingestionConfigReader: configReader({ ...GOLF_ONLY_CONFIG, scheduledSports: [] }),
    }).listProviders();

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: 'alpha', status: 'DEGRADED', errorRate: 0.2, latencyMs: 900,
        lastEventAt: new Date('2026-05-01T00:00:00.000Z'), activeEventCount: 0,
        sportsCovered: [], supportsLiveSimulation: false,
      }),
    ]);
  });

  it('lists every sport a provider covers when no ingestion config is wired, and a null last-event time when it has none', async () => {
    const provider = fakeSportDataProvider({ sportsCovered: [Sport.GOLF] });

    const [summary] = await service({ registry: registryWith(provider) }).listProviders();

    expect(summary).toMatchObject({ sportsCovered: [Sport.GOLF], lastEventAt: null });
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
  it('lists the competitors each provider reports for its scheduled sports that no participant is mapped to', async () => {
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
      registry: registryWith(provider), participantMappings, ingestionConfigReader: configReader(),
    }).getUnmappedParticipants();

    expect(provider.getParticipants).toHaveBeenCalledTimes(1);
    expect(provider.getParticipants).toHaveBeenCalledWith(Sport.GOLF);
    expect(participantMappings.findByProviderExternalIds).toHaveBeenCalledWith('feed', ['p-1', 'p-2']);
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
      registry: registryWith(provider), participantMappings, ingestionConfigReader: configReader(),
    }).getUnmappedParticipants({ providerId: 'feed', externalId: 'p-2' });

    expect(participantMappings.findByProviderExternalIds).toHaveBeenCalledWith('feed', ['p-2']);
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
    const reads = service({ registry: registryWith(provider), participantMappings, ingestionConfigReader: configReader() });

    await expect(reads.getUnmappedParticipants({ providerId: 'other-feed' })).resolves.toEqual([]);
    expect(provider.getParticipants).not.toHaveBeenCalled();
    await expect(reads.getUnmappedParticipants({ providerId: 'feed', externalId: 'gone' })).resolves.toEqual([]);
    expect(participantMappings.findByProviderExternalIds).not.toHaveBeenCalled();
  });

  it('never asks a provider for the competitors of a sport that is not scheduled', async () => {
    const provider = fakeSportDataProvider({ sportsCovered: [Sport.GOLF], getParticipants: jest.fn().mockResolvedValue([]) });

    const unmapped = await service({
      registry: registryWith(provider), ingestionConfigReader: configReader({ ...GOLF_ONLY_CONFIG, scheduledSports: [] }),
    }).getUnmappedParticipants();

    expect(provider.getParticipants).not.toHaveBeenCalled();
    expect(unmapped).toEqual([]);
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

  it('runs outside the submitting request\'s read memo, so the background sync reads afresh', async () => {
    // Stands in for the root Prisma client, the only one whose reads are remembered.
    const root = { $transaction: jest.fn() } as unknown as PrismaClient;
    const load = jest.fn(async () => linkedEvent());
    let finished!: () => void;
    const done = new Promise<void>((resolve) => { finished = resolve; });
    const runEventSync = jest.fn(async () => {
      await memoizedRead(root, `${ReadMemoKey.sportEvent}event-1`, load);
      await memoizedRead(root, `${ReadMemoKey.sportEvent}event-1`, load);
      finished();
      return [];
    });
    const scheduler = stubInstance(IngestionScheduler, { runEventSync });
    const sportEvents = fakeSportEventRepo({ findByProviderRef: jest.fn().mockResolvedValue(linkedEvent()) });
    const ingestion = service({ registry: registryWith(fakeSportDataProvider()), scheduler, sportEvents });

    await runWithReadMemo(async () => {
      await memoizedRead(root, `${ReadMemoKey.sportEvent}event-1`, load);
      await ingestion.syncEventData({ sport: Sport.GOLF, eventId: 'evt-1', feeds: ['EVENTLIVESCORES'] }, 'admin', 'a@x.test');
    });
    await done;

    expect(load).toHaveBeenCalledTimes(3);
  });
});
