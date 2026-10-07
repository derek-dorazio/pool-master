/**
 * Unit tests — IngestionScheduler
 *
 * Tests the scheduler logic with mocked providers and callbacks.
 * Covers ingestion jobs, pollLiveScores, runEventSync, scheduled routing, start/stop lifecycle.
 */

import { expect } from '@jest/globals';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type { EventSyncRequest, IngestionCallbacks } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { fakeSportDataProvider } from '../../support/fake-sport-data-provider';
import { fakeLogger } from '../../support/fake-logger';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { SyncOrchestratorRequest } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCallbacks(): IngestionCallbacks {
  return {
    onEventDetail: jest.fn().mockResolvedValue(undefined),
    onLiveScores: jest.fn().mockResolvedValue(emptyLiveScorePersistenceResult()),
  };
}

function emptyLiveScorePersistenceResult() {
  return {
    updatesReturned: 0,
    updatesPersisted: 0,
    updatesSkipped: 0,
    writeDiagnostics: {
      summary: {
        total: 0,
        unchanged: 0,
        created: 0,
        updated: 0,
        deleted: 0,
      },
      rows: [],
    },
  };
}

/**
 * A real `ProviderRegistry` with the four methods the scheduler reads stubbed, so the double
 * is the scheduler's actual parameter type rather than an `any`-cast literal of it.
 */
function createMockRegistry(
  provider: SportDataProvider | null,
  supportedSports: Sport[] = [],
): ProviderRegistry {
  const registry = new ProviderRegistry();
  jest.spyOn(registry, 'getProvider').mockReturnValue(provider);
  jest.spyOn(registry, 'getSupportedSports').mockReturnValue(supportedSports);
  jest.spyOn(registry, 'getAllProviders').mockReturnValue(provider ? [provider] : []);
  jest.spyOn(registry, 'updateHealth').mockImplementation(() => undefined);
  return registry;
}

function createEnabledScheduleConfig() {
  return {
    scheduledSports: ['GOLF'],
    healthCheck: { enabled: true, intervalMinutes: 5 },
    eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
    eventLiveScores: { enabled: true, intervalSeconds: 30 },
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

  getUpcomingEvents = jest.fn().mockResolvedValue([]);

  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    this.callCount += 1;
    const label = this.callCount === 1 ? 'first' : 'second';
    this.record(`/capture/${label}/start`);
    this.callResolvers.splice(0).forEach((resolve) => resolve());
    await new Promise<void>((resolve) => {
      this.releaseResolvers.set(label, resolve);
    });
    this.record(`/capture/${label}/end`);
    return { category: 'GOLF', externalEventId: eventId, rounds: [] };
  }

  getEventDetails = jest.fn().mockResolvedValue(null);
  getParticipants = jest.fn().mockResolvedValue([]);
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
    mockProvider = fakeSportDataProvider();
    mockCallbacks = createMockCallbacks();
  });

  describe('ingestion jobs', () => {
    it('carries write diagnostics from the persistence callback into the completed participant-sync job', async () => {
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
          { externalId: 'player-1', providerId: 'mock-provider', sport: 'GOLF' as Sport, name: 'Player One', active: true, metadata: {} },
          { externalId: 'player-2', providerId: 'mock-provider', sport: 'GOLF' as Sport, name: 'Player Two', active: true, metadata: {} },
        ],
      };
      const provider = fakeSportDataProvider({
        getEventDetails: jest.fn().mockResolvedValue(detail),
      });
      const registry = createMockRegistry(provider);
      mockCallbacks.onEventDetail = jest.fn().mockResolvedValue({
        summary: {
          total: 2,
          unchanged: 1,
          created: 1,
          updated: 0,
          deleted: 0,
        },
        rows: [
          {
            id: 'sport-event-participant:evt-1:player-1',
            entityType: 'SportEventParticipant',
            disposition: 'CREATED',
            providerId: 'mock-provider',
            externalId: 'player-1',
            name: 'Player One',
          },
          {
            id: 'sport-event-participant:evt-1:player-2',
            entityType: 'SportEventParticipant',
            disposition: 'UNCHANGED',
            providerId: 'mock-provider',
            externalId: 'player-2',
            name: 'Player Two',
          },
        ],
      });
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const [job] = await scheduler.runEventSync({
        sport: 'GOLF' as Sport,
        eventId: 'evt-1',
        feeds: ['EVENTPARTICIPANTS'],
      });

      expect(mockCallbacks.onEventDetail).toHaveBeenCalledWith(detail);
      expect(job).toEqual(
        expect.objectContaining({
          status: 'COMPLETED',
          jobType: 'EVENT_PARTICIPANTS_SYNC',
          recordsProcessed: 2,
          stats: expect.objectContaining({
            writeRows: 2,
            writeUnchanged: 1,
            writeCreated: 1,
            writeUpdated: 0,
            writeDeleted: 0,
          }),
          writeDiagnostics: expect.objectContaining({
            summary: expect.objectContaining({
              total: 2,
              unchanged: 1,
              created: 1,
            }),
          }),
        }),
      );
      expect(job.writeDiagnostics?.rows).toHaveLength(2);
    });

    it('returns a COMPLETED job with no errors when the provider call succeeds', async () => {
      const registry = createMockRegistry(mockProvider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.errors).toBe(0);
      expect(job.errorLog).toEqual([]);
      expect(job.completedAt).toBeInstanceOf(Date);
    });

    it('returns a FAILED job carrying the error when the provider throws', async () => {
      const provider = fakeSportDataProvider({
        getLiveScores: jest.fn().mockRejectedValue(new Error('API timeout')),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('FAILED');
      expect(job.errors).toBe(1);
      expect(job.errorLog[0]).toEqual(
        expect.objectContaining({ error: 'API timeout' }),
      );
    });

    it('logs a failed ingestion job with its job type, provider, sport and error message', async () => {
      const provider = fakeSportDataProvider({
        getLiveScores: jest.fn().mockRejectedValue(new Error('API timeout')),
      });
      const registry = createMockRegistry(provider);
      const logger = fakeLogger();
      const scheduler = new IngestionScheduler(registry, mockCallbacks, logger);

      await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'EVENT_LIVE_SCORES_SYNC',
          providerId: 'mock-provider',
          sport: 'GOLF',
          errorMessage: 'API timeout',
          errorName: 'Error',
        }),
        'Ingestion job failed',
      );
    });

    it('marks a sync run\'s provider payload truncated when the capture left out a response past its size budget', async () => {
      const capturedAt = '2026-05-30T12:00:00.000Z';
      const captured: ProviderPayloadCapture[] = [
        { operation: 'mock-contest-feed.request', path: '/v1/scenarios', capturedAt, raw: { scenarios: [] }, bytes: 16 },
        { operation: 'mock-contest-feed.request', path: '/v1/scenarios/pga-tour-2026/events/e1/scores', capturedAt, rawOmitted: true, bytes: 5_000_000 },
      ];
      const provider: SportDataProvider & ProviderPayloadDiagnostics = Object.assign(fakeSportDataProvider(), {
        clearProviderPayloads: () => undefined,
        consumeProviderPayloads: () => [],
        beginProviderPayloadCapture: () => ({
          run: async <T>(work: () => Promise<T>): Promise<T> => work(),
          consumeProviderPayloads: () => captured,
        }),
      });
      const scheduler = new IngestionScheduler(createMockRegistry(provider), mockCallbacks);

      const [job] = await scheduler.runEventSync({
        sport: 'GOLF' as Sport,
        eventId: 'e1',
        feeds: ['EVENTLIVESCORES'],
      });

      expect(job.providerPayload).toEqual({
        operation: 'EVENTLIVESCORES',
        rawCaptured: true,
        rawTruncated: true,
        raw: captured,
      });
    });

    it('keeps each of two overlapping sync runs\' provider payload diagnostics to its own requests', async () => {
      const provider = new DeferredPayloadCaptureProvider();
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);
      const request: EventSyncRequest = {
        sport: 'GOLF' as Sport,
        eventId: 'evt-ext',
        feeds: ['EVENTLIVESCORES'],
      };

      const firstRun = scheduler.runEventSync(request);
      await provider.waitForCallCount(1);
      const secondRun = scheduler.runEventSync(request);
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
      const provider = fakeSportDataProvider({
        getLiveScores: jest.fn().mockResolvedValue(mockResult),
      });
      const registry = createMockRegistry(provider);
      mockCallbacks.onLiveScores = jest.fn().mockResolvedValue({
        updatesReturned: 1,
        updatesPersisted: 1,
        updatesSkipped: 0,
        writeDiagnostics: {
          summary: {
            total: 2,
            unchanged: 1,
            created: 1,
            updated: 0,
            deleted: 0,
          },
          rows: [
            {
              id: 'golf-round:sep-1:1',
              entityType: 'SportEventParticipantGolfRound',
              disposition: 'CREATED',
            },
            {
              id: 'golf-standing:sep-1',
              entityType: 'SportEventParticipantGolfStanding',
              disposition: 'UNCHANGED',
            },
          ],
        },
      });
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(mockResult, 'mock-provider');
      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(1);
      expect(job.stats).toMatchObject({
        providerRecordsReturned: 1,
        liveScoreUpdatesReturned: 1,
        liveScoreUpdatesProcessed: 1,
        liveScoreUpdatesSkipped: 0,
        writeRows: 2,
        writeUnchanged: 1,
        writeCreated: 1,
        writeUpdated: 0,
        writeDeleted: 0,
      });
      expect(job.writeDiagnostics?.rows).toHaveLength(2);
    });

    it('succeeds with empty results', async () => {
      const empty: LiveScoreResult = { category: 'GOLF', externalEventId: 'evt-1', rounds: [] };
      const provider = fakeSportDataProvider({
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
      const provider = fakeSportDataProvider({
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
      const provider = fakeSportDataProvider({
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

      const unsupportedProvider = fakeSportDataProvider({
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
      const provider = fakeSportDataProvider({
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
    });
  });

  describe('scheduled sync orchestrator routing', () => {
    it('runs no sport-scoped sync: the scheduler has no schedule, results or ranking job left to run', () => {
      const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), mockCallbacks);

      // #126 — EVENTSCHEDULE and EVENTRESULTS are retired; #125 retired PARTICIPANTRANKINGS.
      for (const retired of [
        'syncSport',
        'runSportSync',
        'runConfiguredSportScheduleSync',
        'fetchEventResults',
        'runConfiguredSportRankingSync',
      ]) {
        expect(Reflect.get(scheduler, retired)).toBeUndefined();
      }
    });

    it('pool-master-rop.68.2.4 records configured event syncs in the provider sync run ledger once per ingestion job', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const provider = fakeSportDataProvider({
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

      await scheduler['runConfiguredLiveScoreSweep']('GOLF' as Sport);

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
      expect(syncRunLedger.executeFeedRun).toHaveBeenCalledTimes(1);
    });

    it('pool-master-eux.3 skips duplicate scheduled live-score runs while the same event/feed is in flight', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      let releaseLiveScore: (() => void) | undefined;
      let markLiveScoreCallStarted: (() => void) | undefined;
      const liveScoreCallStarted = new Promise<void>((resolve) => {
        markLiveScoreCallStarted = resolve;
      });
      const getLiveScores = jest.fn(() => {
        markLiveScoreCallStarted?.();
        return new Promise<LiveScoreResult>((resolve) => {
          releaseLiveScore = () => resolve({
            category: 'GOLF',
            externalEventId: 'live-event',
            rounds: [],
          });
        });
      });
      const provider = fakeSportDataProvider({
        getLiveScores,
      });
      const config = createEnabledScheduleConfig();
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(config),
        getPerSportConfig: jest.fn().mockResolvedValue(config),
      };
      const eventReader = {
        listEventIdsForFeed: jest.fn().mockResolvedValue(['live-event']),
      };
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF' as Sport]),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
        },
      );

      const firstRun = scheduler['runConfiguredLiveScoreSweep']('GOLF' as Sport);
      await liveScoreCallStarted;
      await scheduler['runConfiguredLiveScoreSweep']('GOLF' as Sport);
      expect(provider.getLiveScores).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onLiveScores).not.toHaveBeenCalled();

      releaseLiveScore?.();
      await firstRun;
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledTimes(1);
    });

    it('pool-master-rop.68.2.2 submits configured event loops as scheduled system sync requests', async () => {
      const now = new Date('2026-04-28T12:00:00.000Z');
      const provider = fakeSportDataProvider({
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
      });
      const config = createEnabledScheduleConfig();
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(config),
        getPerSportConfig: jest.fn().mockResolvedValue(config),
      };
      const eventReader = {
        listEventIdsForFeed: jest.fn(async ({ feed }: { feed: string }) => {
          if (feed === 'EVENTPARTICIPANTS') return ['active-event'];
          return ['live-event'];
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

      await scheduler['runConfiguredSportFieldSync']('GOLF' as Sport);
      await scheduler['runConfiguredLiveScoreSweep']('GOLF' as Sport);

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
      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledTimes(2);
      expect(provider.getEventDetails).toHaveBeenCalledWith('active-event');
      expect(provider.getLiveScores).toHaveBeenCalledWith('live-event');
      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
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
      const provider = fakeSportDataProvider({
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
          eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
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

      await scheduler['runConfiguredSportFieldSync']('GOLF' as Sport);

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listEventIdsForFeed).toHaveBeenCalledWith({
        sport: 'GOLF',
        feed: 'EVENTPARTICIPANTS',
        from: now,
        now,
        to: new Date('2026-05-12T12:00:00.000Z'),
      });
      expect(provider.getEventDetails).toHaveBeenCalledWith('field-available-event');
      expect(mockCallbacks.onEventDetail).toHaveBeenCalledWith(fieldAvailableDetail);
    });
  });

  describe('start / stop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('pool-master-rop.68.2.7 preserves provider health check exception context', async () => {
      const provider = fakeSportDataProvider({
        healthCheck: jest.fn().mockRejectedValue(new Error('health endpoint timeout')),
      });
      const registry = createMockRegistry(provider);
      const logger = fakeLogger();
      const scheduler = new IngestionScheduler(registry, mockCallbacks, logger);

      await scheduler['runHealthChecks']();

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

    it('start() with the field sync enabled in config runs the startup field sync and never pulls the provider schedule', async () => {
      const provider = fakeSportDataProvider({
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
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()),
        getPerSportConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()),
      };
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, { eventReader, configReader });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      // Initial sync resolves configured sports and provider health before the feed loops run.
      expect(registry.getAllProviders).toHaveBeenCalled();
      expect(registry.getSupportedSports).toHaveBeenCalled();
      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listEventIdsForFeed).toHaveBeenCalledWith(expect.objectContaining({
        sport: 'GOLF',
        feed: 'EVENTPARTICIPANTS',
      }));
      expect(provider.getEventDetails).toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).toHaveBeenCalled();
    });

    it('start() with the default config runs no scheduled field sync: fields load only when an admin asks', async () => {
      const provider = fakeSportDataProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
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

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listEventIdsForFeed).toHaveBeenCalledWith(expect.objectContaining({
        feed: 'EVENTLIVESCORES',
      }));
      expect(eventReader.listEventIdsForFeed).not.toHaveBeenCalledWith(expect.objectContaining({
        feed: 'EVENTPARTICIPANTS',
      }));
      expect(provider.getEventDetails).not.toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).not.toHaveBeenCalled();
    });

    it('pool-master-r04 schedules only sports enabled by ingestion sync config', async () => {
      const provider = fakeSportDataProvider();
      const eventReader = {
        listEventIdsForFeed: jest.fn().mockResolvedValue([]),
      };
      const registry = createMockRegistry(provider, [
        'GOLF' as Sport,
        'TENNIS' as Sport,
        'NCAA_BASKETBALL' as Sport,
      ]);
      const configReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
          eventLiveScores: { enabled: false, intervalSeconds: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn().mockResolvedValue({
          scheduledSports: ['GOLF'],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
          eventLiveScores: { enabled: false, intervalSeconds: 30 },
          perSportOverrides: {},
        }),
      };
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, {
        configReader,
        eventReader,
      });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(eventReader.listEventIdsForFeed).toHaveBeenCalled();
      const requestedSports = eventReader.listEventIdsForFeed.mock.calls.map(([input]) => (input as { sport: Sport }).sport);
      expect(requestedSports).toContain('GOLF');
      expect(requestedSports).not.toContain('TENNIS');
      expect(requestedSports).not.toContain('NCAA_BASKETBALL');
    });

    it('start() is idempotent — calling twice does not double timers', () => {
      const provider = fakeSportDataProvider();
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
      const provider = fakeSportDataProvider();
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

describe('IngestionScheduler provider health checks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function configWithHealthCheck(enabled: boolean) {
    return { ...createEnabledScheduleConfig(), healthCheck: { enabled, intervalMinutes: 5 } };
  }

  it('never calls a provider\'s health check while health checks are switched off in config', async () => {
    const provider = fakeSportDataProvider();
    const registry = createMockRegistry(provider, ['GOLF' as Sport]);
    const config = configWithHealthCheck(false);
    const configReader = {
      getConfig: jest.fn().mockResolvedValue(config),
      getPerSportConfig: jest.fn().mockResolvedValue(config),
    };
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), undefined, {
      configReader,
      eventReader: { listEventIdsForFeed: jest.fn().mockResolvedValue([]) },
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    scheduler.stop();

    expect(provider.healthCheck).not.toHaveBeenCalled();
    expect(registry.updateHealth).not.toHaveBeenCalled();
  });

  it('checks provider health on the configured interval while health checks are on', async () => {
    const provider = fakeSportDataProvider();
    const registry = createMockRegistry(provider, ['GOLF' as Sport]);
    const config = configWithHealthCheck(true);
    const configReader = {
      getConfig: jest.fn().mockResolvedValue(config),
      getPerSportConfig: jest.fn().mockResolvedValue(config),
    };
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), undefined, {
      configReader,
      eventReader: { listEventIdsForFeed: jest.fn().mockResolvedValue([]) },
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    scheduler.stop();

    // Once at start, then every five minutes: at 5 and 10 minutes.
    expect(provider.healthCheck).toHaveBeenCalledTimes(3);
    expect(registry.updateHealth).toHaveBeenCalledWith('mock-provider', expect.objectContaining({ status: 'HEALTHY' }));
  });
});
