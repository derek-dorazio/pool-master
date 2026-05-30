/**
 * Unit tests — IngestionScheduler
 *
 * Tests the scheduler logic with mocked providers and callbacks.
 * Covers syncSport, pollLiveScores, fetchEventResults, start/stop lifecycle.
 */

import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { IngestionCallbacks, SportSyncRequest } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { SyncOrchestratorRequest } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  DateRange,
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
  ProviderEventResult,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(overrides: Partial<SportDataProvider> = {}): SportDataProvider {
  return {
    providerId: 'mock-provider',
    providerName: 'Mock Provider',
    sportsCovered: ['GOLF' as Sport],
    getUpcomingEvents: jest.fn().mockResolvedValue([]),
    getEventDetails: jest.fn().mockResolvedValue(null),
    getParticipants: jest.fn().mockResolvedValue([]),
    getRankings: jest.fn().mockResolvedValue([]),
    getLiveScores: jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'evt-ext', rounds: [] } satisfies LiveScoreResult),
    getEventResults: jest.fn().mockResolvedValue(null),
    healthCheck: jest.fn().mockResolvedValue({
      providerId: 'mock-provider',
      status: 'HEALTHY',
      errorRateLastHour: 0,
      latencyMsP95: 50,
    }),
    ...overrides,
  };
}

function createMockCallbacks(): IngestionCallbacks {
  return {
    onEvents: jest.fn().mockResolvedValue(undefined),
    onEventDetail: jest.fn().mockResolvedValue(undefined),
    onRankings: jest.fn().mockResolvedValue(undefined),
    onLiveScores: jest.fn().mockResolvedValue(undefined),
    onJobComplete: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockRegistry(provider: SportDataProvider | null, supportedSports: Sport[] = []) {
  return {
    getProvider: jest.fn().mockReturnValue(provider),
    getSupportedSports: jest.fn().mockReturnValue(supportedSports),
    getAllProviders: jest.fn().mockReturnValue(provider ? [provider] : []),
    updateHealth: jest.fn(),
  } as any;
}

function createEnabledScheduleConfig() {
  return {
    scheduledSports: ['GOLF'],
    healthCheck: { enabled: true, intervalMinutes: 5 },
    eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
    eventParticipants: { enabled: true, intervalMinutes: 720 },
    participantRankings: { enabled: true, intervalMinutes: 1440 },
    eventLiveScores: { enabled: true, intervalSeconds: 30 },
    eventResults: { enabled: true, intervalMinutes: 30 },
    perSportOverrides: {},
  };
}

function createSyncOrchestratorSpy(now: Date) {
  const actualOrchestrator = new SyncOrchestrator({ now: () => now });
  return {
    normalizeRequest: jest.fn((request: SyncOrchestratorRequest) =>
      actualOrchestrator.normalizeRequest(request)),
  };
}

class DeferredPayloadCaptureProvider implements SportDataProvider, ProviderPayloadDiagnostics {
  readonly providerId = 'deferred-provider';
  readonly providerName = 'Deferred Provider';
  readonly sportsCovered = ['GOLF' as Sport];
  private readonly captureStorage = new AsyncLocalStorage<ProviderPayloadCapture[]>();
  private legacyPayloads: ProviderPayloadCapture[] = [];
  private callCount = 0;
  private readonly callResolvers: Array<() => void> = [];
  private readonly releaseResolvers = new Map<string, () => void>();

  clearProviderPayloads(): void {
    this.legacyPayloads = [];
  }

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    const payloads = this.legacyPayloads;
    this.legacyPayloads = [];
    return payloads;
  }

  beginProviderPayloadCapture() {
    const payloads: ProviderPayloadCapture[] = [];
    return {
      run: async <T>(work: () => Promise<T>): Promise<T> =>
        this.captureStorage.run(payloads, work),
      consumeProviderPayloads: (): ProviderPayloadCapture[] => {
        const captured = [...payloads];
        payloads.length = 0;
        return captured;
      },
    };
  }

  async waitForCallCount(count: number): Promise<void> {
    if (this.callCount >= count) {
      return;
    }
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.callCount >= count) {
          resolve();
          return;
        }
        this.callResolvers.push(check);
      };
      check();
    });
  }

  release(label: string): void {
    this.releaseResolvers.get(label)?.();
  }

  async getUpcomingEvents(_sport: Sport, _dateRange: DateRange): Promise<SportEvent[]> {
    this.callCount += 1;
    const label = this.callCount === 1 ? 'first' : 'second';
    this.record(`/capture/${label}/start`);
    this.callResolvers.splice(0).forEach((resolve) => resolve());
    await new Promise<void>((resolve) => {
      this.releaseResolvers.set(label, resolve);
    });
    this.record(`/capture/${label}/end`);
    return [];
  }

  getEventDetails = jest.fn().mockResolvedValue(null);
  getParticipants = jest.fn().mockResolvedValue([]);
  getRankings = jest.fn().mockResolvedValue([]);
  getLiveScores = jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'evt-ext', rounds: [] } satisfies LiveScoreResult);
  getEventResults = jest.fn().mockResolvedValue(null);
  healthCheck = jest.fn().mockResolvedValue({
    providerId: 'deferred-provider',
    status: 'HEALTHY',
    errorRateLastHour: 0,
    latencyMsP95: 50,
  });

  private record(path: string): void {
    const payload: ProviderPayloadCapture = {
      operation: 'deferred-provider.request',
      path,
      capturedAt: new Date('2026-05-30T12:00:00.000Z').toISOString(),
      raw: { path },
    };
    const activeCapture = this.captureStorage.getStore();
    if (activeCapture) {
      activeCapture.push(payload);
      return;
    }
    this.legacyPayloads.push(payload);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestionScheduler', () => {
  let mockProvider: SportDataProvider;
  let mockCallbacks: IngestionCallbacks;

  beforeEach(() => {
    mockProvider = createMockProvider();
    mockCallbacks = createMockCallbacks();
  });

  describe('syncSport', () => {
    it('calls getUpcomingEvents on the provider', async () => {
      const registry = createMockRegistry(mockProvider, ['GOLF' as Sport]);
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, {
        now: () => new Date('2026-04-05T12:00:00.000Z'),
      });

      await scheduler.syncSport('GOLF' as Sport);

      expect(registry.getProvider).toHaveBeenCalledWith('GOLF');
      expect(mockProvider.getUpcomingEvents).toHaveBeenCalledWith(
        'GOLF',
        expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) }),
      );
    });

    it('invokes onEvents and onJobComplete callbacks with fetched events', async () => {
      const mockEvents: SportEvent[] = [
        {
          externalId: 'evt-1',
          providerId: 'mock-provider',
          sport: 'GOLF' as Sport,
          name: 'The Masters',
          startDate: new Date(),
          status: 'SCHEDULED',
          fieldLocked: false,
          metadata: {},
        },
        {
          externalId: 'evt-2',
          providerId: 'mock-provider',
          sport: 'GOLF' as Sport,
          name: 'US Open',
          startDate: new Date(),
          status: 'SCHEDULED',
          fieldLocked: false,
          metadata: {},
        },
      ];
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue(mockEvents),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.syncSport('GOLF' as Sport);

      expect(mockCallbacks.onEvents).toHaveBeenCalledWith(mockEvents);
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'COMPLETED',
          jobType: 'EVENT_SCHEDULE_SYNC',
          recordsProcessed: 2,
        }),
      );
      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(2);
    });

    it('invokes onJobComplete with COMPLETED status on success', async () => {
      const registry = createMockRegistry(mockProvider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.syncSport('GOLF' as Sport);

      expect(job.status).toBe('COMPLETED');
      expect(job.errors).toBe(0);
      expect(job.errorLog).toEqual([]);
      expect(job.completedAt).toBeInstanceOf(Date);
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'COMPLETED' }),
      );
    });

    it('returns FAILED job when no provider is registered', async () => {
      const registry = createMockRegistry(null);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.syncSport('GOLF' as Sport);

      expect(job.status).toBe('FAILED');
      expect(job.errors).toBe(1);
      expect(job.providerId).toBe('none');
      expect(job.errorLog[0]).toEqual(
        expect.objectContaining({ error: 'No provider registered' }),
      );
      // onJobComplete should NOT be called for early-return failures
      expect(mockCallbacks.onJobComplete).not.toHaveBeenCalled();
    });

    it('returns FAILED job when provider throws an error', async () => {
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockRejectedValue(new Error('API timeout')),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.syncSport('GOLF' as Sport);

      expect(job.status).toBe('FAILED');
      expect(job.errors).toBe(1);
      expect(job.errorLog[0]).toEqual(
        expect.objectContaining({ error: 'API timeout' }),
      );
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'FAILED' }),
      );
    });

    it('pool-master-4k2 logs failed ingestion jobs with message fields', async () => {
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockRejectedValue(new Error('API timeout')),
      });
      const registry = createMockRegistry(provider);
      const logger = {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      } as any;
      const scheduler = new IngestionScheduler(registry, mockCallbacks, logger);

      await scheduler.syncSport('GOLF' as Sport);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'EVENT_SCHEDULE_SYNC',
          providerId: 'mock-provider',
          sport: 'GOLF',
          errorMessage: 'API timeout',
          errorName: 'Error',
        }),
        'Ingestion job failed',
      );
    });
  });

  describe('runSportSync', () => {
    it('pool-master-rop.68.2.7 isolates provider payload diagnostics for overlapping sync runs', async () => {
      const provider = new DeferredPayloadCaptureProvider();
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);
      const request: SportSyncRequest = {
        sport: 'GOLF' as Sport,
        feeds: ['EVENTSCHEDULE'],
        from: new Date('2026-05-30T12:00:00.000Z'),
        to: new Date('2026-06-29T12:00:00.000Z'),
      };

      const firstRun = scheduler.runSportSync(request);
      await provider.waitForCallCount(1);
      const secondRun = scheduler.runSportSync(request);
      await provider.waitForCallCount(2);

      provider.release('second');
      const [secondJob] = await secondRun;
      provider.release('first');
      const [firstJob] = await firstRun;

      expect(firstJob.providerPayload?.raw).toEqual([
        {
          operation: 'deferred-provider.request',
          path: '/capture/first/start',
          capturedAt: '2026-05-30T12:00:00.000Z',
          raw: { path: '/capture/first/start' },
        },
        {
          operation: 'deferred-provider.request',
          path: '/capture/first/end',
          capturedAt: '2026-05-30T12:00:00.000Z',
          raw: { path: '/capture/first/end' },
        },
      ]);
      expect(secondJob.providerPayload?.raw).toEqual([
        {
          operation: 'deferred-provider.request',
          path: '/capture/second/start',
          capturedAt: '2026-05-30T12:00:00.000Z',
          raw: { path: '/capture/second/start' },
        },
        {
          operation: 'deferred-provider.request',
          path: '/capture/second/end',
          capturedAt: '2026-05-30T12:00:00.000Z',
          raw: { path: '/capture/second/end' },
        },
      ]);
    });

    it('runs only the requested sport-level feeds', async () => {
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([
          {
            externalId: 'evt-1',
            providerId: 'mock-provider',
            sport: 'GOLF' as Sport,
            name: 'The Masters',
            startDate: new Date('2026-04-10T12:00:00.000Z'),
            status: 'SCHEDULED',
            fieldLocked: false,
            metadata: {},
          },
        ]),
        getRankings: jest.fn().mockResolvedValue([
          {
            providerId: 'mock-provider',
            participantExternalId: 'player-1',
            rankingType: 'OWGR',
            rank: 1,
            asOfDate: new Date('2026-04-09T12:00:00.000Z'),
          },
        ]),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const jobs = await scheduler.runSportSync({
        sport: 'GOLF' as Sport,
        feeds: ['EVENTSCHEDULE', 'PARTICIPANTRANKINGS'],
        from: new Date('2026-04-01T00:00:00.000Z'),
        to: new Date('2026-04-30T23:59:59.999Z'),
      });

      expect(provider.getUpcomingEvents).toHaveBeenCalledTimes(1);
      expect(provider.getEventDetails).not.toHaveBeenCalled();
      expect(provider.getRankings).toHaveBeenCalledWith('GOLF', 'OWGR');
      expect(mockCallbacks.onEvents).toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).not.toHaveBeenCalled();
      expect(jobs.map((job) => job.jobType)).toEqual(['EVENT_SCHEDULE_SYNC', 'PARTICIPANT_RANKINGS_SYNC']);
    });
  });

  describe('pollLiveScores', () => {
    it('pool-master-rop.78.3 — calls getLiveScores and forwards typed LiveScoreResult to onLiveScores', async () => {
      const mockResult: LiveScoreResult = {
        category: 'GOLF',
        externalEventId: 'evt-1',
        rounds: [
          {
            participantExternalId: 'player-1',
            round: 1,
            strokes: 72,
            scoreToPar: 0,
            status: 'IN_PROGRESS',
          },
        ],
      };
      const provider = createMockProvider({
        getLiveScores: jest.fn().mockResolvedValue(mockResult),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(mockResult, 'mock-provider');
      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(1);
    });

    it('succeeds with empty results', async () => {
      const empty: LiveScoreResult = { category: 'GOLF', externalEventId: 'evt-1', rounds: [] };
      const provider = createMockProvider({
        getLiveScores: jest.fn().mockResolvedValue(empty),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(0);
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(empty, 'mock-provider');
    });

    it('returns FAILED job when no provider is registered', async () => {
      const registry = createMockRegistry(null);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('FAILED');
      expect(job.jobType).toBe('EVENT_LIVE_SCORES_SYNC');
    });
  });

  describe('runEventSync', () => {
    it('runs only the requested event-level feeds', async () => {
      const detail: SportEventDetail = {
        externalId: 'evt-1',
        providerId: 'mock-provider',
        sport: 'GOLF' as Sport,
        name: 'The Masters',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        metadata: {},
        participants: [
          {
            externalId: 'player-1',
            providerId: 'mock-provider',
            sport: 'GOLF' as Sport,
            name: 'Player One',
            active: true,
            metadata: {},
          },
        ],
      };
      const provider = createMockProvider({
        getEventDetails: jest.fn().mockResolvedValue(detail),
        getLiveScores: jest.fn().mockResolvedValue({
          category: 'GOLF',
          externalEventId: 'evt-1',
          rounds: [
            {
              participantExternalId: 'player-1',
              round: 1,
              strokes: 69,
              scoreToPar: -3,
              status: 'IN_PROGRESS',
            },
          ],
        } satisfies LiveScoreResult),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const jobs = await scheduler.runEventSync({
        sport: 'GOLF' as Sport,
        eventId: 'evt-1',
        feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
      });

      expect(provider.getEventDetails).toHaveBeenCalledWith('evt-1');
      expect(mockCallbacks.onEventDetail).toHaveBeenCalledWith(detail);
      expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
      expect(jobs.map((job) => job.jobType)).toEqual(['EVENT_PARTICIPANTS_SYNC', 'EVENT_LIVE_SCORES_SYNC']);
    });

    it('pool-master-33l.8.8 passes mock event state controls only to supporting providers', async () => {
      const detail: SportEventDetail = {
        externalId: 'evt-1',
        providerId: 'mock-contest-feed',
        sport: 'GOLF' as Sport,
        name: 'Mock Golf Event',
        startDate: new Date('2026-04-30T12:00:00.000Z'),
        status: 'IN_PROGRESS',
        fieldLocked: true,
        metadata: {},
        participants: [],
      };
      const provider = createMockProvider({
        providerId: 'mock-contest-feed',
        getEventDetails: jest.fn().mockResolvedValue(detail),
        getLiveScores: jest.fn().mockResolvedValue({
          category: 'GOLF',
          externalEventId: 'evt-1',
          rounds: [],
        } satisfies LiveScoreResult),
      });
      const scheduler = new IngestionScheduler(createMockRegistry(provider), mockCallbacks);

      await scheduler.runEventSync({
        sport: 'GOLF' as Sport,
        eventId: 'evt-1',
        feeds: ['EVENTPARTICIPANTS', 'EVENTLIVESCORES'],
        mockEventState: 'live',
      });

      expect(provider.getEventDetails).toHaveBeenCalledWith('evt-1', { mockEventState: 'live' });
      expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1', { mockEventState: 'live' });

      const unsupportedProvider = createMockProvider({
        providerId: 'real-provider',
      });
      const unsupportedScheduler = new IngestionScheduler(
        createMockRegistry(unsupportedProvider),
        createMockCallbacks(),
      );

      const [job] = await unsupportedScheduler.runEventSync({
        sport: 'GOLF' as Sport,
        eventId: 'evt-1',
        feeds: ['EVENTLIVESCORES'],
        mockEventState: 'live',
      });

      expect(job).toEqual(expect.objectContaining({
        status: 'FAILED',
        providerId: 'real-provider',
        errors: 1,
      }));
      expect(unsupportedProvider.getLiveScores).not.toHaveBeenCalled();
    });

    it('pool-master-dxd.28 fails event participant sync when the provider cannot resolve the event id', async () => {
      const provider = createMockProvider({
        getEventDetails: jest.fn().mockResolvedValue(null),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const jobs = await scheduler.runEventSync({
        sport: 'GOLF' as Sport,
        eventId: 'masters-2026',
        feeds: ['EVENTPARTICIPANTS'],
      });

      expect(provider.getEventDetails).toHaveBeenCalledWith('masters-2026');
      expect(mockCallbacks.onEventDetail).not.toHaveBeenCalled();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toEqual(expect.objectContaining({
        jobType: 'EVENT_PARTICIPANTS_SYNC',
        eventExternalId: 'masters-2026',
        status: 'FAILED',
        recordsProcessed: 0,
        errors: 1,
      }));
      expect(jobs[0]?.errorLog[0]).toEqual(expect.objectContaining({
        error: 'Provider returned no event detail for event masters-2026',
      }));
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          eventExternalId: 'masters-2026',
          status: 'FAILED',
        }),
      );
    });
  });

  describe('scheduled sync orchestrator routing', () => {
    it('pool-master-rop.68.2.2 submits configured sport loops as scheduled system sync requests', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const provider = createMockProvider({
        getRankings: jest.fn().mockResolvedValue([]),
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
      });
      const config = createEnabledScheduleConfig();
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(config),
        getPerSportConfig: jest.fn().mockResolvedValue(config),
      };
      const syncOrchestrator = createSyncOrchestratorSpy(now);
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF' as Sport]),
        mockCallbacks,
        undefined,
        {
          configReader,
          now: () => now,
          syncOrchestrator,
        },
      );

      const runConfiguredSportScheduleSync = Reflect.get(
        scheduler,
        'runConfiguredSportScheduleSync',
      ) as (sport: Sport) => Promise<void>;
      await runConfiguredSportScheduleSync.call(scheduler, 'GOLF' as Sport);
      await (scheduler as any).runConfiguredSportFieldSync('GOLF' as Sport);
      await (scheduler as any).runConfiguredSportRankingSync('GOLF' as Sport);

      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'SPORT',
          sport: 'GOLF',
          feeds: ['EVENTSCHEDULE'],
          windowPolicy: { defaultLookaheadDays: 30 },
        },
      });
      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'SPORT',
          sport: 'GOLF',
          feeds: ['PARTICIPANTRANKINGS'],
        },
      });
      expect(syncOrchestrator.normalizeRequest).not.toHaveBeenCalledWith(expect.objectContaining({
        scope: expect.objectContaining({
          type: 'SPORT',
          feeds: ['EVENTPARTICIPANTS'],
        }),
      }));
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledTimes(2);
    });

    it('pool-master-rop.68.2.4 records configured sport syncs in the provider sync run ledger once per ingestion job', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
      });
      const config = createEnabledScheduleConfig();
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(config),
        getPerSportConfig: jest.fn().mockResolvedValue(config),
      };
      const syncRun = {
        id: 'scheduled-sync-run-1',
        providerId: 'mock-provider',
        sport: 'GOLF' as Sport,
        eventId: null,
        status: 'SUBMITTED' as const,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        payload: {
          requestedFeed: 'EVENTSCHEDULE',
        },
      };
      const syncRunLedger = {
        createSubmissions: jest.fn().mockResolvedValue([syncRun]),
        executeFeedRun: jest.fn(async (_syncRun: typeof syncRun, run: () => Promise<unknown>) => {
          const job = await run();
          return job as Awaited<ReturnType<IngestionScheduler['syncSport']>>;
        }),
      };
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF' as Sport]),
        mockCallbacks,
        undefined,
        {
          configReader,
          now: () => now,
          syncRunLedger,
        },
      );

      const runConfiguredSportScheduleSync = Reflect.get(
        scheduler,
        'runConfiguredSportScheduleSync',
      ) as (sport: Sport) => Promise<void>;
      await runConfiguredSportScheduleSync.call(scheduler, 'GOLF' as Sport);

      expect(syncRunLedger.createSubmissions).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'mock-provider',
        runType: 'SCHEDULED_SPORT_SYNC',
        submittedAt: now,
        normalizedRequest: expect.objectContaining({
          source: 'SCHEDULED',
          actor: { type: 'SYSTEM', name: 'scheduler' },
          scope: expect.objectContaining({
            type: 'SPORT',
            sport: 'GOLF',
            feeds: ['EVENTSCHEDULE'],
            effectiveWindow: {
              from: now,
              to: new Date('2026-05-28T12:00:00.000Z'),
              defaultedFrom: true,
              defaultedTo: true,
            },
          }),
        }),
      }));
      expect(syncRunLedger.executeFeedRun).toHaveBeenCalledWith(syncRun, expect.any(Function));
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledTimes(1);
    });

    it('pool-master-rop.68.2.4 records configured event syncs in the provider sync run ledger once per ingestion job', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const provider = createMockProvider({
        getLiveScores: jest.fn().mockResolvedValue({
          category: 'GOLF',
          externalEventId: 'live-event',
          rounds: [],
        } satisfies LiveScoreResult),
      });
      const config = createEnabledScheduleConfig();
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(config),
        getPerSportConfig: jest.fn().mockResolvedValue(config),
      };
      const eventReader = {
        listEventIdsForFeed: jest.fn().mockResolvedValue(['live-event']),
      };
      const syncRun = {
        id: 'scheduled-event-sync-run-1',
        providerId: 'mock-provider',
        sport: 'GOLF' as Sport,
        eventId: 'live-event',
        status: 'SUBMITTED' as const,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        payload: {
          requestedFeed: 'EVENTLIVESCORES',
        },
      };
      const syncRunLedger = {
        createSubmissions: jest.fn().mockResolvedValue([syncRun]),
        executeFeedRun: jest.fn(async (_syncRun: typeof syncRun, run: () => Promise<unknown>) => {
          const job = await run();
          return job as Awaited<ReturnType<IngestionScheduler['pollLiveScores']>>;
        }),
      };
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF' as Sport]),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
          syncRunLedger,
        },
      );

      const runConfiguredEventSyncSweep = Reflect.get(
        scheduler,
        'runConfiguredEventSyncSweep',
      ) as (sport: Sport, feed: 'EVENTLIVESCORES') => Promise<void>;
      await runConfiguredEventSyncSweep.call(scheduler, 'GOLF' as Sport, 'EVENTLIVESCORES');

      expect(syncRunLedger.createSubmissions).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'mock-provider',
        runType: 'SCHEDULED_EVENT_SYNC',
        submittedAt: now,
        normalizedRequest: expect.objectContaining({
          source: 'SCHEDULED',
          actor: { type: 'SYSTEM', name: 'scheduler' },
          scope: expect.objectContaining({
            type: 'EVENT',
            sport: 'GOLF',
            eventId: 'live-event',
            feeds: ['EVENTLIVESCORES'],
          }),
        }),
      }));
      expect(syncRunLedger.executeFeedRun).toHaveBeenCalledWith(syncRun, expect.any(Function));
      expect(provider.getLiveScores).toHaveBeenCalledWith('live-event');
      expect(mockCallbacks.onJobComplete).toHaveBeenCalledTimes(1);
    });

    it('pool-master-rop.68.2.2 submits configured event loops as scheduled system sync requests', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const provider = createMockProvider({
        getEventDetails: jest.fn().mockResolvedValue({
          externalId: 'active-event',
          providerId: 'mock-provider',
          sport: 'GOLF' as Sport,
          name: 'Active Event',
          startDate: now,
          status: 'IN_PROGRESS',
          fieldLocked: true,
          metadata: {},
          participants: [],
        } satisfies SportEventDetail),
        getLiveScores: jest.fn().mockResolvedValue({
          category: 'GOLF',
          externalEventId: 'live-event',
          rounds: [],
        } satisfies LiveScoreResult),
        getEventResults: jest.fn().mockResolvedValue(null),
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
      });
      const config = createEnabledScheduleConfig();
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(config),
        getPerSportConfig: jest.fn().mockResolvedValue(config),
      };
      const eventReader = {
        listEventIdsForFeed: jest.fn(async ({ feed }: { feed: string }) => {
          if (feed === 'EVENTPARTICIPANTS') return ['active-event'];
          if (feed === 'EVENTLIVESCORES') return ['live-event'];
          return ['result-event'];
        }),
      };
      const syncOrchestrator = createSyncOrchestratorSpy(now);
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF' as Sport]),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
          syncOrchestrator,
        },
      );

      await (scheduler as any).runConfiguredSportFieldSync('GOLF' as Sport);
      await (scheduler as any).runConfiguredEventSyncSweep('GOLF' as Sport, 'EVENTLIVESCORES');
      await (scheduler as any).runConfiguredEventSyncSweep('GOLF' as Sport, 'EVENTRESULTS');

      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith(expect.objectContaining({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'EVENT',
          sport: 'GOLF',
          eventId: 'active-event',
          feeds: ['EVENTPARTICIPANTS'],
        },
      }));
      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith(expect.objectContaining({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'EVENT',
          sport: 'GOLF',
          eventId: 'live-event',
          feeds: ['EVENTLIVESCORES'],
        },
      }));
      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith(expect.objectContaining({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'EVENT',
          sport: 'GOLF',
          eventId: 'result-event',
          feeds: ['EVENTRESULTS'],
        },
      }));
      expect(provider.getEventDetails).toHaveBeenCalledWith('active-event');
      expect(provider.getLiveScores).toHaveBeenCalledWith('live-event');
      expect(provider.getEventResults).toHaveBeenCalledWith('result-event');
    });
  });

  describe('configured participant sync', () => {
    it('pool-master-rop.68.1.2 hydrates persisted eligible events without sport-level provider discovery', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const fieldAvailableDetail: SportEventDetail = {
        externalId: 'field-available-event',
        providerId: 'mock-provider',
        sport: 'GOLF' as Sport,
        name: 'Field Available Event',
        startDate: new Date('2026-05-02T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        metadata: {},
        participants: [],
      };
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
        getEventDetails: jest.fn(async (eventId: string) => {
          if (eventId === 'field-available-event') return fieldAvailableDetail;
          return null;
        }),
      });
      const registry = createMockRegistry(provider, ['GOLF' as Sport]);
      const configReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: { enabled: true, intervalMinutes: 720 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          eventResults: { enabled: true, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: { enabled: true, intervalMinutes: 720 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          eventResults: { enabled: true, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
      };
      const eventReader = {
        listEventIdsForFeed: jest.fn().mockResolvedValue(['field-available-event']),
      };
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, {
        configReader,
        eventReader,
        now: () => now,
      });

      await (scheduler as any).runConfiguredSportFieldSync('GOLF' as Sport);

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listEventIdsForFeed).toHaveBeenCalledWith({
        sport: 'GOLF',
        feed: 'EVENTPARTICIPANTS',
        from: now,
        now,
        to: new Date('2026-05-28T12:00:00.000Z'),
      });
      expect(provider.getEventDetails).toHaveBeenCalledWith('field-available-event');
      expect(mockCallbacks.onEventDetail).toHaveBeenCalledWith(fieldAvailableDetail);
    });
  });

  describe('fetchEventResults', () => {
    it('pool-master-rop.78.3 — records the result count without bridging to onLiveScores', async () => {
      const mockResults: ProviderEventResult = {
        eventExternalId: 'evt-1',
        providerId: 'mock-provider',
        status: 'OFFICIAL',
        results: [
          {
            participantExternalId: 'player-1',
            finishPosition: 1,
            totalScore: -12,
            dnf: false,
            stats: { STROKES: 276 },
          },
          {
            participantExternalId: 'player-2',
            finishPosition: 2,
            totalScore: -10,
            dnf: false,
            stats: { STROKES: 278 },
          },
        ],
      };
      const provider = createMockProvider({
        getEventResults: jest.fn().mockResolvedValue(mockResults),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.fetchEventResults('GOLF' as Sport, 'evt-1');

      expect(provider.getEventResults).toHaveBeenCalledWith('evt-1');
      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(2);
      // The legacy bridge that synthesized FINISH_POSITION ProviderStatEvents
      // and routed them through onLiveScores was retired with the
      // typed LiveScoreResult contract; rop.78.7 reconstitutes the
      // final-result → contribution path on the typed substrate.
      expect(mockCallbacks.onLiveScores).not.toHaveBeenCalled();
    });

    it('returns 0 records when getEventResults returns null', async () => {
      const provider = createMockProvider({
        getEventResults: jest.fn().mockResolvedValue(null),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.fetchEventResults('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(0);
      expect(mockCallbacks.onLiveScores).not.toHaveBeenCalled();
    });

    it('returns FAILED job when no provider is registered', async () => {
      const registry = createMockRegistry(null);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.fetchEventResults('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('FAILED');
      expect(job.jobType).toBe('EVENT_RESULTS_SYNC');
    });
  });

  // -------------------------------------------------------------------------
  // start / stop lifecycle
  // -------------------------------------------------------------------------

  describe('start / stop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('pool-master-rop.68.2.7 preserves provider health check exception context', async () => {
      const provider = createMockProvider({
        healthCheck: jest.fn().mockRejectedValue(new Error('health endpoint timeout')),
      });
      const registry = createMockRegistry(provider);
      const logger = {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
      } as any;
      const scheduler = new IngestionScheduler(registry, mockCallbacks, logger);

      await (scheduler as any).runHealthChecks();

      expect(registry.updateHealth).toHaveBeenCalledWith('mock-provider', {
        providerId: 'mock-provider',
        status: 'DOWN',
        errorRateLastHour: 1,
        latencyMsP95: 0,
        message: 'Health check failed: health endpoint timeout',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'mock-provider',
          errorMessage: 'health endpoint timeout',
          errorName: 'Error',
        }),
        expect.any(String),
      );
    });

    it('start() begins polling and runs startup schedule, field, and ranking syncs', async () => {
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([
          {
            externalId: 'evt-1',
            providerId: 'mock-provider',
            sport: 'GOLF' as Sport,
            name: 'The Masters',
            startDate: new Date('2026-04-10T12:00:00.000Z'),
            status: 'SCHEDULED',
            fieldLocked: false,
            metadata: {},
          },
        ]),
        getEventDetails: jest.fn().mockResolvedValue({
          externalId: 'evt-1',
          providerId: 'mock-provider',
          sport: 'GOLF' as Sport,
          name: 'The Masters',
          startDate: new Date('2026-04-10T12:00:00.000Z'),
          status: 'SCHEDULED',
          fieldLocked: false,
          metadata: {},
          participants: [
            {
              externalId: 'player-1',
              providerId: 'mock-provider',
              sport: 'GOLF' as Sport,
              name: 'Player One',
              active: true,
              metadata: {},
            },
          ],
        }),
      });
      const registry = createMockRegistry(provider, ['GOLF' as Sport]);
      const eventReader = {
        listEventIdsForFeed: jest.fn().mockResolvedValue(['evt-1']),
      };
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, { eventReader });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      // Initial sync resolves configured sports and provider health before the feed loops run.
      expect(registry.getAllProviders).toHaveBeenCalled();
      expect(registry.getSupportedSports).toHaveBeenCalled();
      expect((provider.getUpcomingEvents as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(eventReader.listEventIdsForFeed).toHaveBeenCalledWith(expect.objectContaining({
        sport: 'GOLF',
        feed: 'EVENTPARTICIPANTS',
      }));
      expect(provider.getEventDetails).toHaveBeenCalled();
      expect(provider.getRankings).toHaveBeenCalledWith('GOLF', 'OWGR');
      expect(mockCallbacks.onEvents).toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).toHaveBeenCalled();
      expect(mockCallbacks.onRankings).toHaveBeenCalled();
    });

    it('pool-master-r04 schedules only sports enabled by ingestion sync config', async () => {
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
      });
      const registry = createMockRegistry(provider, [
        'GOLF' as Sport,
        'TENNIS' as Sport,
        'NCAA_BASKETBALL' as Sport,
      ]);
      const configReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: { enabled: true, intervalMinutes: 720 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: false, intervalSeconds: 30 },
          eventResults: { enabled: false, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: { enabled: true, intervalMinutes: 720 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: false, intervalSeconds: 30 },
          eventResults: { enabled: false, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
      };
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, {
        configReader,
      });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(provider.getUpcomingEvents).toHaveBeenCalled();
      const requestedSports = (provider.getUpcomingEvents as jest.Mock).mock.calls.map((call) => call[0]);
      expect(requestedSports).toContain('GOLF');
      expect(requestedSports).not.toContain('TENNIS');
      expect(requestedSports).not.toContain('NCAA_BASKETBALL');
    });

    it('start() is idempotent — calling twice does not double timers', () => {
      const provider = createMockProvider();
      const registry = createMockRegistry(provider, ['GOLF' as Sport]);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      scheduler.start();
      const firstCallCount = (registry.getAllProviders as jest.Mock).mock.calls.length;

      scheduler.start(); // second call should be no-op
      const secondCallCount = (registry.getAllProviders as jest.Mock).mock.calls.length;

      // No additional calls from the second start
      expect(secondCallCount).toBe(firstCallCount);

      scheduler.stop();
    });

    it('stop() clears the polling interval', () => {
      const provider = createMockProvider();
      const registry = createMockRegistry(provider, ['GOLF' as Sport]);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      scheduler.start();
      scheduler.stop();

      // Reset call counts after stop
      (registry.getAllProviders as jest.Mock).mockClear();
      (registry.getSupportedSports as jest.Mock).mockClear();

      // Advance past all interval durations — nothing should fire
      jest.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours

      expect(registry.getAllProviders).not.toHaveBeenCalled();
      expect(registry.getSupportedSports).not.toHaveBeenCalled();
    });
  });
});
