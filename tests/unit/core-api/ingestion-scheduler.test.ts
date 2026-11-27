/**
 * Unit tests — IngestionScheduler
 *
 * Tests the scheduler logic with mocked providers and callbacks.
 * Covers ingestion jobs, pollLiveScores, runEventSync, scheduled routing, start/stop lifecycle.
 */

import { syncRunOutcome } from '../../support/sync-run-payload';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';
import { expect } from '@jest/globals';
import { emptySyncWriteDiagnostics } from '../../../packages/core-api/src/modules/ingestion/core/sync-write-diagnostics';
import { IngestionScheduler, LIVE_SCORE_SWEEP_TICK_MS } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type {
  EventSyncRequest,
  IngestionCallbacks,
  LiveScoreEventRef,
  ScheduledEventRef,
} from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import type { SyncOrchestratorRequest } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { JobTrigger, ProviderCode, Sport, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import { ProviderRateLimitedError } from '../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

/** A second Provider code, for a registry running two providers. */
const OTHER_PROVIDER = 'OTHER_FEED' as ProviderCode;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An event reader listing these sports as synced, these events to load fields for, and these in progress for scores. */
function readerOf({ fields = [], live = [], sports = [Sport.GOLF] }: { fields?: ScheduledEventRef[]; live?: Array<ScheduledEventRef & Partial<LiveScoreEventRef>>; sports?: Sport[] }) {
  return {
    listSyncedSports: jest.fn().mockResolvedValue(sports),
    listFieldSyncEvents: jest.fn().mockResolvedValue(fields),
    listLiveScoreEvents: jest.fn().mockResolvedValue(live.map((event): LiveScoreEventRef => ({
      providerLeagueCode: 'pga',
      playedInRounds: true,
      playUnderwaySince: null,
      lastProviderNotificationAt: null,
      ...event,
    }))),
  };
}

function createMockCallbacks(): IngestionCallbacks {
  return {
    onEventDetail: jest.fn().mockResolvedValue({ writeDiagnostics: emptySyncWriteDiagnostics() }),
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
 * A real `ProviderRegistry` running this provider (or none), with `all` spied on so a test can
 * count the scheduler's reads of it; the lookups are the registry's own.
 */
function createMockRegistry(provider: SportDataProvider | null): ProviderRegistry {
  const registry = registryWith(provider);
  jest.spyOn(registry, 'all');
  return registry;
}

function createEnabledScheduleConfig() {
  return {
    FIELD: { intervalMinutes: 360, lookaheadDays: 14 },
    SCORES: { enabled: true, intervalSeconds: 30 },
    EVENTS: { enabled: true, intervalMinutes: 360 },
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
  readonly providerCode = ProviderCode.BALLDONTLIE;

  servesLeague(): boolean {
    return true;
  }
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
        sport: 'GOLF',
        name: 'The Masters',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        providerSlots: [],
        participants: [
          { externalId: 'player-1', providerId: 'mock-provider', sport: 'GOLF', name: 'Player One', status: SportEventParticipantStatus.ACTIVE, metadata: {} },
          { externalId: 'player-2', providerId: 'mock-provider', sport: 'GOLF', name: 'Player Two', status: SportEventParticipantStatus.ACTIVE, metadata: {} },
        ],
      };
      const provider = fakeSportDataProvider({
        getEventDetails: jest.fn().mockResolvedValue(detail),
      });
      const registry = createMockRegistry(provider);
      mockCallbacks.onEventDetail = jest.fn().mockResolvedValue({ writeDiagnostics: {
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
      } });
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const [job] = await scheduler.runEventSync({
        sport: 'GOLF',
        providerId: 'mock-provider',
        eventId: 'evt-1',
        kinds: ['FIELD'],
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

      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

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

      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

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

      await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

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
        sport: 'GOLF',
        providerId: 'mock-provider',
        eventId: 'e1',
        kinds: ['SCORES'],
      });

      expect(job.providerPayload).toEqual({
        
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
        sport: 'GOLF',
        providerId: 'deferred-provider',
        eventId: 'evt-ext',
        kinds: ['SCORES'],
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

      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

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

      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(0);
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(empty, 'mock-provider');
    });

    it('returns FAILED job when no provider is registered', async () => {
      const registry = createMockRegistry(null);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

      expect(job.status).toBe('FAILED');
      expect(job.jobType).toBe('EVENT_LIVE_SCORES_SYNC');
    });
  });

  describe('runEventSync', () => {
    it('runs only the requested event-level feeds', async () => {
      const detail: SportEventDetail = {
        externalId: 'evt-1',
        providerId: 'mock-provider',
        sport: 'GOLF',
        name: 'The Masters',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        providerSlots: [],
        participants: [
          {
            externalId: 'player-1',
            providerId: 'mock-provider',
            sport: 'GOLF',
            name: 'Player One',
            status: SportEventParticipantStatus.ACTIVE,
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
        sport: 'GOLF',
        providerId: 'mock-provider',
        eventId: 'evt-1',
        kinds: ['FIELD', 'SCORES'],
      });

      expect(provider.getEventDetails).toHaveBeenCalledWith('evt-1');
      expect(mockCallbacks.onEventDetail).toHaveBeenCalledWith(detail);
      expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
      expect(jobs.map((job) => job.jobType)).toEqual(['EVENT_PARTICIPANTS_SYNC', 'EVENT_LIVE_SCORES_SYNC']);
    });

    it('pool-master-dxd.28 fails event participant sync when the provider cannot resolve the event id', async () => {
      const provider = fakeSportDataProvider({
        getEventDetails: jest.fn().mockResolvedValue(null),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const jobs = await scheduler.runEventSync({
        sport: 'GOLF',
        providerId: 'mock-provider',
        eventId: 'masters-2026',
        kinds: ['FIELD'],
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
      };
      const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'live-event' }] });
      const syncRun = {
        id: 'scheduled-event-sync-run-1',
        providerId: 'provider-row-1',
        providerName: 'Mock Provider',
        sport: 'GOLF' as Sport,
        eventId: 'live-event',
        ...SCHEDULED_SCORES_RUN,
        status: 'SUBMITTED' as const,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        ...syncRunOutcome(),
      };
      const syncRunLedger = {
        createSubmissions: jest.fn().mockResolvedValue([syncRun]),
        executeFeedRun: jest.fn(async (_syncRun: typeof syncRun, run: () => Promise<unknown>) => {
          const job = await run();
          return job as Awaited<ReturnType<IngestionScheduler['pollLiveScores']>>;
        }),
      };
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
          syncRunLedger,
        },
      );

      await scheduler['runConfiguredLiveScoreSweep']('GOLF', eventReader);

      expect(syncRunLedger.createSubmissions).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'mock-provider',
        trigger: JobTrigger.SCHEDULE,
        submittedAt: now,
        normalizedRequest: expect.objectContaining({
          source: 'SCHEDULED',
          actor: { type: 'SYSTEM', name: 'scheduler' },
          scope: expect.objectContaining({
            type: 'EVENT',
            sport: 'GOLF',
            eventId: 'live-event',
            kinds: ['SCORES'],
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
      };
      const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'live-event' }] });
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
        },
      );

      const firstRun = scheduler['runConfiguredLiveScoreSweep']('GOLF', eventReader);
      await liveScoreCallStarted;
      await scheduler['runConfiguredLiveScoreSweep']('GOLF', eventReader);
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
          providerSlots: [],
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
      };
      const eventReader = readerOf({
        fields: [{ providerId: 'mock-provider', externalId: 'active-event' }],
        live: [{ providerId: 'mock-provider', externalId: 'live-event' }],
      });
      const syncOrchestrator = createSyncOrchestratorSpy(now);
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
          syncOrchestrator,
        },
      );

      await scheduler['runConfiguredSportFieldSync']('GOLF', eventReader);
      await scheduler['runConfiguredLiveScoreSweep']('GOLF', eventReader);

      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith(expect.objectContaining({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'EVENT',
          sport: 'GOLF',
          providerId: 'mock-provider',
          eventId: 'active-event',
          kinds: ['FIELD'],
        },
      }));
      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith(expect.objectContaining({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'EVENT',
          sport: 'GOLF',
          providerId: 'mock-provider',
          eventId: 'live-event',
          kinds: ['SCORES'],
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
        sport: 'GOLF',
        name: 'Field Available Event',
        startDate: new Date('2026-05-02T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        providerSlots: [],
        participants: [],
      };
      const provider = fakeSportDataProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
        getEventDetails: jest.fn(async (eventId: string) => {
          if (eventId === 'field-available-event') return fieldAvailableDetail;
          return null;
        }),
      });
      const registry = createMockRegistry(provider);
      const configReader = {
        getConfig: jest.fn().mockResolvedValue({
                FIELD: { intervalMinutes: 360, lookaheadDays: 14 },
          SCORES: { enabled: true, intervalSeconds: 30 },
          EVENTS: { enabled: true, intervalMinutes: 360 },
        }),
      };
      const eventReader = readerOf({ fields: [{ providerId: 'mock-provider', externalId: 'field-available-event' }] });
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, {
        configReader,
        eventReader,
        now: () => now,
      });

      await scheduler['runConfiguredSportFieldSync']('GOLF', eventReader);

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listFieldSyncEvents).toHaveBeenCalledWith({
        sport: 'GOLF',
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
          providerSlots: [],
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
      const registry = createMockRegistry(provider);
      const eventReader = readerOf({
        fields: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
        live: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
      });
      const configReader = {
        getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()),
      };
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, { eventReader, configReader });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(eventReader.listSyncedSports).toHaveBeenCalledWith({ providerCodes: [ProviderCode.BALLDONTLIE] });
      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listFieldSyncEvents).toHaveBeenCalledWith(expect.objectContaining({
        sport: 'GOLF',
      }));
      expect(provider.getEventDetails).toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).toHaveBeenCalled();
    });

    it('start() with the default config loads only synced sport leagues\' fields, never discovering events from the provider', async () => {
      const provider = fakeSportDataProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue([]),
      });
      const registry = createMockRegistry(provider);
      const eventReader = readerOf({
        fields: [],
        live: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
      });
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, { eventReader });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listLiveScoreEvents).toHaveBeenCalledWith(expect.objectContaining({ sport: 'GOLF' }));
      expect(eventReader.listFieldSyncEvents).toHaveBeenCalledWith(expect.objectContaining({ sport: 'GOLF' }));
    });

    it('paces the field loop at the admin\'s participant interval, since the field sync has no switch, never the short config recheck', async () => {
      const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), mockCallbacks, undefined, {
        configReader: { getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()) },
        eventReader: readerOf({}),
      });

      expect(await scheduler['getFieldSyncDelayMs']()).toBe(360 * 60_000);
    });

    it('start() is idempotent — calling twice does not double timers', () => {
      const provider = fakeSportDataProvider();
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      scheduler.start();
      const firstCallCount = (registry.all as jest.Mock).mock.calls.length;

      scheduler.start(); // second call should be no-op
      const secondCallCount = (registry.all as jest.Mock).mock.calls.length;

      // No additional calls from the second start
      expect(secondCallCount).toBe(firstCallCount);

      scheduler.stop();
    });

    it('stop() clears the polling interval', () => {
      const provider = fakeSportDataProvider();
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      scheduler.start();
      scheduler.stop();

      // Reset call counts after stop
      (registry.all as jest.Mock).mockClear();

      // Advance past all interval durations — nothing should fire
      jest.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours

      expect(registry.all).not.toHaveBeenCalled();
    });
  });
});

describe('IngestionScheduler job outcomes', () => {
  const detail = (participants: SportEventDetail['participants']): SportEventDetail => ({
    externalId: 'evt-1',
    providerId: 'mock-provider',
    sport: 'GOLF',
    name: 'The Masters',
    startDate: new Date('2026-04-10T12:00:00.000Z'),
    status: 'SCHEDULED',
    fieldLocked: false,
    providerSlots: [],
    participants,
  });

  it('fails a field sync with "No provider registered" when no provider serves the sport, without calling back', async () => {
    const callbacks = createMockCallbacks();
    const scheduler = new IngestionScheduler(createMockRegistry(null), callbacks);

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', kinds: ['FIELD'] });

    expect(job).toMatchObject({ status: 'FAILED', providerId: 'mock-provider', errorLog: [expect.objectContaining({ error: 'No provider registered' })] });
    expect(callbacks.onEventDetail).not.toHaveBeenCalled();
  });

  it('completes a field sync of an empty field with a NO_PROVIDER_PARTICIPANTS warning, so an admin sees why nothing loaded', async () => {
    const provider = fakeSportDataProvider({ getEventDetails: jest.fn().mockResolvedValue(detail([])) });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks());

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', kinds: ['FIELD'] });

    expect(job).toMatchObject({
      status: 'COMPLETED',
      recordsProcessed: 0,
      warnings: [expect.objectContaining({ code: 'NO_PROVIDER_PARTICIPANTS' })],
    });
  });

  it('records a non-Error thrown by a provider as the failed job\'s message', async () => {
    const provider = fakeSportDataProvider({ getLiveScores: jest.fn().mockRejectedValue('socket hang up') });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks(), fakeLogger());

    const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

    expect(job).toMatchObject({ status: 'FAILED', errors: 1, errorLog: [expect.objectContaining({ error: 'socket hang up' })] });
  });

  it.each([
    [{ category: 'GOLF', externalEventId: 'evt-1', rounds: [{}, {}] }, 2],
    [{ category: 'GOLF', externalEventId: 'evt-1', rounds: [] }, 0],
  ])('counts a golf live-score result\'s rounds as the records the job processed (%o)', async (result, expected) => {
    const provider = fakeSportDataProvider({ getLiveScores: jest.fn().mockResolvedValue(result) });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks());

    const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

    expect(job).toMatchObject({ status: 'COMPLETED', recordsProcessed: expected });
  });
});

describe('IngestionScheduler scheduled loops', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps every loop alive on the one-minute recheck when the ingestion config cannot be read', async () => {
    const logger = fakeLogger();
    const configReader = {
      getConfig: jest.fn().mockRejectedValue(new Error('config table missing')),
    };
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), createMockCallbacks(), logger, { configReader, eventReader: readerOf({}) });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);
    scheduler.stop();

    expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'Falling back to config recheck delay because policy resolution failed');
    // Start, then a recheck at one and two minutes.
    expect(configReader.getConfig.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('runs no sport\'s loops, never asking which sports are synced, while no provider is running here', async () => {
    const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'evt-1' }] });
    const scheduler = new IngestionScheduler(createMockRegistry(null), createMockCallbacks(), undefined, {
      configReader: { getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()) },
      eventReader,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(eventReader.listSyncedSports).not.toHaveBeenCalled();
    expect(eventReader.listLiveScoreEvents).not.toHaveBeenCalled();
    expect(eventReader.listFieldSyncEvents).not.toHaveBeenCalled();
  });

  it('runs loops only for the sports an active league syncs from a running provider', async () => {
    const eventReader = readerOf({ sports: [Sport.BASKETBALL] });
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), createMockCallbacks(), undefined, {
      configReader: { getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()) },
      eventReader,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    const sportsAsked = eventReader.listLiveScoreEvents.mock.calls.map(([input]) => (input as { sport: Sport }).sport);
    expect(sportsAsked.length).toBeGreaterThan(0);
    expect(new Set(sportsAsked)).toEqual(new Set([Sport.BASKETBALL]));
  });

  it('runs no scheduled live-score sweep when no event reader is wired, since it has no events to poll', async () => {
    const provider = fakeSportDataProvider();
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks());

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(provider.getLiveScores).not.toHaveBeenCalled();
  });

  it('polls live scores on an interval given in minutes when no seconds interval is set', async () => {
    const provider = fakeSportDataProvider();
    const config = { ...createEnabledScheduleConfig(), SCORES: { enabled: true, intervalMinutes: 10 } };
    const configReader = { getConfig: jest.fn().mockResolvedValue(config) };
    const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'evt-1' }] });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks(), undefined, { configReader, eventReader });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(9 * 60 * 1000);
    const beforeTenMinutes = (provider.getLiveScores as jest.Mock).mock.calls.length;
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    scheduler.stop();

    expect(beforeTenMinutes).toBe(1);
    expect(provider.getLiveScores).toHaveBeenCalledTimes(2);
  });
});

describe('IngestionScheduler loops across server tasks (#1159)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function golfLoops(jobLock: ReturnType<typeof heldHere>) {
    const provider = fakeSportDataProvider();
    const config = createEnabledScheduleConfig();
    const configReader = { getConfig: jest.fn().mockResolvedValue(config) };
    const eventReader = readerOf({
      fields: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
      live: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
    });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks(), undefined, { configReader, eventReader, jobLock });
    return { provider, scheduler };
  }

  it('calls no provider when another server task holds the locks of the sport loops, and runs no health check loop', async () => {
    const jobLock = heldElsewhere();
    const { provider, scheduler } = golfLoops(jobLock);

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(provider.getEventDetails).not.toHaveBeenCalled();
    expect(provider.getLiveScores).not.toHaveBeenCalled();
    expect(new Set(jobLock.keys)).toEqual(new Set([
      'ingestion:GOLF:participants',
      'ingestion:GOLF:live-scores',
    ]));
  });

  it('runs the sport loops when this task holds their locks', async () => {
    const { provider, scheduler } = golfLoops(heldHere());

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(provider.getEventDetails).toHaveBeenCalledWith('evt-1');
    expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
  });
});

describe('IngestionScheduler with two providers running', () => {
  const liveScores = (eventId: string): LiveScoreResult => ({ category: 'GOLF', externalEventId: eventId, rounds: [] });

  function twoGolfProviders() {
    const primary = fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      providerCode: OTHER_PROVIDER,
      getLiveScores: jest.fn().mockResolvedValue(liveScores('mock-1')),
    });
    const secondary = fakeSportDataProvider({
      providerId: 'balldontlie',
      getLiveScores: jest.fn().mockResolvedValue(liveScores('41')),
    });
    return { primary, secondary, registry: registryWith(primary, secondary) };
  }

  it('polls each event\'s live scores from the provider it is linked to, and no other running provider', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const callbacks = createMockCallbacks();
    const scheduler = new IngestionScheduler(registry, callbacks);

    const job = await scheduler.pollLiveScores('GOLF', 'balldontlie', '41');

    expect(job).toMatchObject({ status: 'COMPLETED', providerId: 'balldontlie' });
    expect(secondary.getLiveScores).toHaveBeenCalledWith('41');
    expect(primary.getLiveScores).not.toHaveBeenCalled();
    expect(callbacks.onLiveScores).toHaveBeenCalledWith(liveScores('41'), 'balldontlie');
  });

  it('fails the sync, calling no provider, when the linked provider is not running here', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const scheduler = new IngestionScheduler(registry, createMockCallbacks());

    const job = await scheduler.pollLiveScores('GOLF', 'sportradar', '41');

    expect(job).toMatchObject({ status: 'FAILED', providerId: 'sportradar', errorLog: [expect.objectContaining({ error: 'No provider registered' })] });
    expect(secondary.getLiveScores).not.toHaveBeenCalled();
    expect(primary.getLiveScores).not.toHaveBeenCalled();
  });

  it('sweeps live events from both providers, each from its own provider, even when both use the same event id', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const config = createEnabledScheduleConfig();
    const eventReader = readerOf({
      live: [
        { providerId: 'mock-contest-feed', externalId: '41' },
        { providerId: 'balldontlie', externalId: '41' },
      ],
    });
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), undefined, {
      configReader: { getConfig: jest.fn().mockResolvedValue(config) },
      eventReader,
    });

    await scheduler['runConfiguredLiveScoreSweep']('GOLF', eventReader);

    expect(primary.getLiveScores).toHaveBeenCalledWith('41');
    expect(secondary.getLiveScores).toHaveBeenCalledWith('41');
  });
});

describe('IngestionScheduler webhook-triggered event syncs (#1498)', () => {
  const now = new Date('2026-11-12T18:00:00.000Z');
  const notified = { sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'live-event' };

  function schedulerFor(config: ReturnType<typeof createEnabledScheduleConfig>, provider = fakeSportDataProvider()) {
    const syncRun = {
      id: 'webhook-sync-run-1',
      providerId: 'provider-row-1',
      providerName: 'Mock Provider',
      sport: Sport.GOLF,
      eventId: 'live-event',
      ...SCHEDULED_SCORES_RUN,
      trigger: 'WEBHOOK' as const,
      status: 'SUBMITTED' as const,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      ...syncRunOutcome(),
    };
    const syncRunLedger = {
      createSubmissions: jest.fn().mockResolvedValue([syncRun]),
      executeFeedRun: jest.fn(async (_syncRun: typeof syncRun, run: () => Promise<unknown>) =>
        await run() as Awaited<ReturnType<IngestionScheduler['pollLiveScores']>>),
    };
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks(), fakeLogger(), {
      configReader: { getConfig: jest.fn().mockResolvedValue(config) },
      now: () => now,
      syncRunLedger,
    });
    return { scheduler, provider, syncRunLedger };
  }

  it('syncs the notified event\'s live scores from its provider and records the run with its job\'s WEBHOOK trigger, by the webhook receiver', async () => {
    const { scheduler, provider, syncRunLedger } = schedulerFor(createEnabledScheduleConfig());

    const job = await scheduler.runNotifiedEventSync(notified, { jobId: 'job-1', trigger: JobTrigger.WEBHOOK });

    expect(job?.status).toBe('COMPLETED');
    expect(provider.getLiveScores).toHaveBeenCalledWith('live-event');
    expect(syncRunLedger.createSubmissions).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'mock-provider',
      trigger: JobTrigger.WEBHOOK,
      backgroundJobId: 'job-1',
      normalizedRequest: expect.objectContaining({
        source: 'WEBHOOK',
        actor: { type: 'SYSTEM', name: 'webhook' },
        scope: expect.objectContaining({ sport: Sport.GOLF, eventId: 'live-event', kinds: ['SCORES'] }),
      }),
    }));
  });

  it('throws a provider\'s rate-limit refusal out of the sync, so its job is queued again for when the provider answers', async () => {
    const refusal = new ProviderRateLimitedError('mock-provider', new Date(now.getTime() + 60_000), 'its circuit is open');
    const { scheduler } = schedulerFor(createEnabledScheduleConfig(), fakeSportDataProvider({ getLiveScores: jest.fn().mockRejectedValue(refusal) }));

    await expect(scheduler.runNotifiedEventSync(notified, { jobId: 'job-1', trigger: JobTrigger.WEBHOOK })).rejects.toBe(refusal);
  });

  it('keeps any other provider failure as the run\'s FAILED outcome, as before', async () => {
    const { scheduler } = schedulerFor(createEnabledScheduleConfig(), fakeSportDataProvider({ getLiveScores: jest.fn().mockRejectedValue(new Error('503 down')) }));

    const job = await scheduler.runNotifiedEventSync(notified, { jobId: 'job-1', trigger: JobTrigger.WEBHOOK });

    expect(job?.status).toBe('FAILED');
  });

  it('syncs nothing, and calls no provider, for a notification from a provider not running here', async () => {
    const { scheduler, provider, syncRunLedger } = schedulerFor(createEnabledScheduleConfig());

    expect(await scheduler.runNotifiedEventSync({ ...notified, providerId: 'not-running-here' }, { jobId: 'job-1', trigger: JobTrigger.WEBHOOK })).toBeNull();
    expect(provider.getLiveScores).not.toHaveBeenCalled();
    expect(syncRunLedger.createSubmissions).not.toHaveBeenCalled();
  });

  it('fails the sync, calling no provider, when the ledger records no run for it', async () => {
    const { scheduler, provider, syncRunLedger } = schedulerFor(createEnabledScheduleConfig());
    syncRunLedger.createSubmissions.mockResolvedValueOnce([]);

    await expect(scheduler.runNotifiedEventSync(notified, { jobId: 'job-1', trigger: JobTrigger.WEBHOOK }))
      .rejects.toThrow('Scheduled sync ledger did not create a provider sync run.');
    expect(provider.getLiveScores).not.toHaveBeenCalled();
  });

  it('syncs nothing while live score syncs are switched off for the sport', async () => {
    const { scheduler, provider } = schedulerFor({
      ...createEnabledScheduleConfig(),
      SCORES: { enabled: false, intervalSeconds: 30 },
    });

    expect(await scheduler.runNotifiedEventSync(notified, { jobId: 'job-1', trigger: JobTrigger.WEBHOOK })).toBeNull();
    expect(provider.getLiveScores).not.toHaveBeenCalled();
  });
});

describe('IngestionScheduler pace for providers that send webhook notifications (#1499)', () => {
  const T0 = new Date('2026-11-15T18:00:00.000Z');
  const MINUTE = 60_000;
  const cadence = {
    providerIds: ['balldontlie'],
    pollIntervalMs: 15 * MINUTE,
    roundPollIntervalMs: 2 * MINUTE,
    // A 20-minute window for every event but `six-hour-round`, whose league's gap is longer.
    quietAfterMs: (_sport: Sport, quietEvent: { externalId: string }) => (quietEvent.externalId === 'six-hour-round' ? 360 : 20) * MINUTE,
  };
  const adminConfig = {
    ...createEnabledScheduleConfig(),
    SCORES: { enabled: true, intervalSeconds: 5 * 60 },
  };

  function paced(options: { cadence?: typeof cadence; config?: typeof adminConfig } = {}) {
    const clock = { now: T0 };
    let live: LiveScoreEventRef[] = [];
    const notified = fakeSportDataProvider({
      providerId: 'balldontlie',
      getLiveScores: jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'x', rounds: [] } satisfies LiveScoreResult),
    });
    const polled = fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      providerCode: OTHER_PROVIDER,
      getLiveScores: jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'x', rounds: [] } satisfies LiveScoreResult),
    });
    const registry = registryWith(polled, notified);
    const config = options.config ?? adminConfig;
    const logger = fakeLogger();
    const eventReader = { ...readerOf({ sports: [Sport.GOLF, Sport.FOOTBALL] }), listLiveScoreEvents: jest.fn(async () => live) };
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), logger, {
      configReader: { getConfig: jest.fn().mockResolvedValue(config) },
      eventReader,
      now: () => clock.now,
      notifiedProviderCadence: () => ('cadence' in options ? options.cadence : cadence),
    });
    const sweepAt = async (sport: Sport, minutes: number, events: LiveScoreEventRef[]) => {
      clock.now = new Date(T0.getTime() + minutes * MINUTE);
      live = events;
      await scheduler['runConfiguredLiveScoreSweep'](sport, eventReader);
    };
    const pollsOf = (provider: SportDataProvider, eventId: string) =>
      (provider.getLiveScores as jest.Mock<unknown, [string]>).mock.calls.filter(([id]) => id === eventId).length;
    const quietWarnings = () => (logger.warn as unknown as jest.Mock<void, [{ action?: string }, string]>).mock.calls
      .filter(([fields]) => fields.action === 'ingestion.providerNotifications.quiet');
    return { scheduler, sweepAt, pollsOf, quietWarnings, notified, polled };
  }

  const event = (providerId: string, externalId: string, live: Partial<LiveScoreEventRef> = {}): LiveScoreEventRef => ({
    providerId,
    externalId,
    providerLeagueCode: 'pga',
    playedInRounds: false,
    playUnderwaySince: null,
    lastProviderNotificationAt: null,
    ...live,
  });

  it('keeps the admin\'s live-score interval for the sweep with no notified provider, and ticks every minute with one', async () => {
    expect(await paced({ cadence: undefined }).scheduler['getLiveScoreSweepDelayMs']()).toBe(5 * MINUTE);
    expect(await paced().scheduler['getLiveScoreSweepDelayMs']()).toBe(LIVE_SCORE_SWEEP_TICK_MS);
    const fast = { ...adminConfig, SCORES: { enabled: true, intervalSeconds: 30 } };
    expect(await paced({ config: fast }).scheduler['getLiveScoreSweepDelayMs']()).toBe(30_000);
  });

  it('polls a notified provider\'s game event only every 15 minutes, even while a match is in play, and another provider\'s every admin interval, on a one-minute tick', async () => {
    const { sweepAt, pollsOf, notified, polled } = paced();
    const events = [event('balldontlie', 'nfl-week-11', { playUnderwaySince: T0, lastProviderNotificationAt: T0 }), event('mock-contest-feed', 'mock-week-11')];

    for (let minute = 0; minute <= 30; minute += 1) {
      await sweepAt(Sport.FOOTBALL, minute, events);
    }

    expect(pollsOf(notified, 'nfl-week-11')).toBe(3); // 0, 15, 30
    expect(pollsOf(polled, 'mock-week-11')).toBe(7); // 0, 5, ..., 30
  });

  it('polls a notified golf event every 2 minutes while a round is under way, and every 15 minutes between rounds', async () => {
    const { sweepAt, pollsOf, notified } = paced();
    const inRound = event('balldontlie', '1133', { playedInRounds: true, playUnderwaySince: T0, lastProviderNotificationAt: T0 });
    const betweenRounds = event('balldontlie', '1133', { playedInRounds: true });

    for (let minute = 0; minute < 10; minute += 1) {
      await sweepAt(Sport.GOLF, minute, [inRound]);
    }
    expect(pollsOf(notified, '1133')).toBe(5); // 0, 2, 4, 6, 8

    for (let minute = 10; minute < 30; minute += 1) {
      await sweepAt(Sport.GOLF, minute, [betweenRounds]);
    }
    expect(pollsOf(notified, '1133')).toBe(6); // 8 + 15 = 23
  });

  it('polls an event at its interval even when the tick runs a few seconds early', async () => {
    const { sweepAt, pollsOf, notified } = paced();
    const events = [event('balldontlie', 'nfl-week-11')];

    await sweepAt(Sport.FOOTBALL, 0, events);
    await sweepAt(Sport.FOOTBALL, 15 - 4 / 60, events);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
  });

  it('polls an event again at once when it drops out of the sweep and comes back, since it keeps no pace for events no longer listed', async () => {
    const { sweepAt, pollsOf, notified } = paced();
    const events = [event('balldontlie', 'nfl-week-11')];

    await sweepAt(Sport.FOOTBALL, 0, events);
    await sweepAt(Sport.FOOTBALL, 1, []);
    await sweepAt(Sport.FOOTBALL, 2, events);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
  });

  it('warns once per quiet window about a notified event in play with no notification for its window (here 20 minutes)', async () => {
    const { sweepAt, quietWarnings } = paced();
    const quiet = event('balldontlie', 'nfl-week-11', {
      playUnderwaySince: new Date(T0.getTime() - 60 * MINUTE),
      lastProviderNotificationAt: new Date(T0.getTime() - 25 * MINUTE),
    });

    await sweepAt(Sport.FOOTBALL, 0, [quiet]);
    await sweepAt(Sport.FOOTBALL, 1, [quiet]);
    await sweepAt(Sport.FOOTBALL, 19, [quiet]);
    expect(quietWarnings()).toHaveLength(1);
    expect(quietWarnings()[0]?.[0]).toEqual({
      action: 'ingestion.providerNotifications.quiet',
      data: {
        sport: Sport.FOOTBALL,
        providerId: 'balldontlie',
        eventId: 'nfl-week-11',
        playUnderwaySince: new Date(T0.getTime() - 60 * MINUTE).toISOString(),
        lastProviderNotificationAt: new Date(T0.getTime() - 25 * MINUTE).toISOString(),
        quietMinutes: 25,
      },
    });

    await sweepAt(Sport.FOOTBALL, 20, [quiet]);
    expect(quietWarnings()).toHaveLength(2);
  });

  it('counts quiet from when play began while no notification has arrived yet, so play just starting is not quiet', async () => {
    const { sweepAt, quietWarnings } = paced();
    const starting = event('balldontlie', '1133', { playUnderwaySince: new Date(T0.getTime() - 19 * MINUTE) });

    await sweepAt(Sport.GOLF, 0, [starting]);
    expect(quietWarnings()).toHaveLength(0);
    await sweepAt(Sport.GOLF, 1, [starting]);
    expect(quietWarnings()).toEqual([[expect.objectContaining({ data: expect.objectContaining({ lastProviderNotificationAt: null, quietMinutes: 20 }) }), expect.any(String)]]);
  });

  it('takes each event\'s own quiet window, so an event whose league is quiet for hours in normal play is not warned about early', async () => {
    const { sweepAt, quietWarnings } = paced();
    const round = event('balldontlie', 'six-hour-round', { playUnderwaySince: new Date(T0.getTime() - 300 * MINUTE) });

    await sweepAt(Sport.GOLF, 0, [round]);
    await sweepAt(Sport.GOLF, 59, [round]);
    expect(quietWarnings()).toHaveLength(0);
    await sweepAt(Sport.GOLF, 60, [round]);
    expect(quietWarnings()).toEqual([[expect.objectContaining({ data: expect.objectContaining({ eventId: 'six-hour-round', quietMinutes: 360 }) }), expect.any(String)]]);
  });

  it('does not warn about an event out of play, one notified recently, or one whose provider sends no notifications', async () => {
    const { sweepAt, quietWarnings } = paced();
    const longAgo = new Date(T0.getTime() - 120 * MINUTE);

    await sweepAt(Sport.FOOTBALL, 0, [
      event('balldontlie', 'between-games', { lastProviderNotificationAt: longAgo }),
      event('balldontlie', 'recently-heard', { playUnderwaySince: longAgo, lastProviderNotificationAt: new Date(T0.getTime() - 5 * MINUTE) }),
      event('mock-contest-feed', 'polled-only', { playUnderwaySince: longAgo }),
    ]);

    expect(quietWarnings()).toHaveLength(0);
  });

  it('warns about nothing and polls every event each sweep while no provider sends notifications', async () => {
    const { sweepAt, pollsOf, quietWarnings, notified } = paced({ cadence: undefined });
    const quiet = event('balldontlie', 'nfl-week-11', { playUnderwaySince: new Date(T0.getTime() - 60 * MINUTE) });

    await sweepAt(Sport.FOOTBALL, 0, [quiet]);
    await sweepAt(Sport.FOOTBALL, 1, [quiet]);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
    expect(quietWarnings()).toHaveLength(0);
  });

  it('forgets every event\'s pace when stopped', async () => {
    const { scheduler, sweepAt, pollsOf, notified } = paced();
    const events = [event('balldontlie', 'nfl-week-11')];

    await sweepAt(Sport.FOOTBALL, 0, events);
    scheduler.stop();
    await sweepAt(Sport.FOOTBALL, 1, events);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
  });
});

describe('IngestionScheduler loops, defaults and a provider that keeps its own payloads', () => {
  const now = new Date('2026-11-12T18:00:00.000Z');
  const flush = () => new Promise((resolve) => { setImmediate(resolve); });

  it('starts no sport loop when stopped while it reads which sports to run', async () => {
    let answer!: (sports: Sport[]) => void;
    const eventReader = { ...readerOf({}), listSyncedSports: jest.fn(() => new Promise<Sport[]>((resolve) => { answer = resolve; })) };
    const logger = fakeLogger();
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), createMockCallbacks(), logger, {
      configReader: { getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()) },
      eventReader,
    });

    scheduler.start();
    await flush();
    scheduler.stop();
    answer([Sport.GOLF]);
    await flush();

    expect(eventReader.listSyncedSports).toHaveBeenCalled();
    expect(eventReader.listFieldSyncEvents).not.toHaveBeenCalled();
    expect(eventReader.listLiveScoreEvents).not.toHaveBeenCalled();
  });

  it('logs a failed read of which sports to run, rather than leaving the loop an unhandled rejection', async () => {
    const eventReader = { ...readerOf({}), listSyncedSports: jest.fn().mockRejectedValue(new Error('db down')) };
    const logger = fakeLogger();
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), createMockCallbacks(), logger, {
      configReader: { getConfig: jest.fn().mockResolvedValue(createEnabledScheduleConfig()) },
      eventReader,
    });

    scheduler.start();
    await flush();
    scheduler.stop();

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }), 'Failed to reconcile configured sport ingestion loops');
  });

  it('polls no live event while live score syncs are switched off', async () => {
    const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'evt-1' }] });
    const provider = fakeSportDataProvider();
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks(), undefined, {
      configReader: { getConfig: jest.fn().mockResolvedValue({ ...createEnabledScheduleConfig(), SCORES: { enabled: false, intervalSeconds: 30 } }) },
      eventReader,
    });

    await scheduler['runConfiguredLiveScoreSweep']('GOLF', eventReader);

    expect(eventReader.listLiveScoreEvents).not.toHaveBeenCalled();
    expect(provider.getLiveScores).not.toHaveBeenCalled();
  });

  it('loads fields for the next 14 days when the field sync names no lookahead', async () => {
    const eventReader = readerOf({});
    const config = { ...createEnabledScheduleConfig(), FIELD: { intervalMinutes: 360 } };
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider()), createMockCallbacks(), undefined, {
      configReader: { getConfig: jest.fn().mockResolvedValue(config) },
      eventReader,
      now: () => now,
    });

    await scheduler['runConfiguredSportFieldSync']('GOLF', eventReader);

    expect(eventReader.listFieldSyncEvents).toHaveBeenCalledWith(expect.objectContaining({
      from: now,
      to: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    }));
  });

  it('clears a provider\'s kept payloads before a run, and reports the ones the run kept, when the provider opens no capture session', async () => {
    const capturedAt = '2026-05-30T12:00:00.000Z';
    const kept: ProviderPayloadCapture[] = [{ operation: 'provider.request', path: '/v1/scores', capturedAt, raw: { scores: [] }, bytes: 12 }];
    const clearProviderPayloads = jest.fn();
    const provider: SportDataProvider & ProviderPayloadDiagnostics = Object.assign(fakeSportDataProvider(), {
      clearProviderPayloads,
      consumeProviderPayloads: () => kept,
    });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks());

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'e1', kinds: ['SCORES'] });

    expect(clearProviderPayloads).toHaveBeenCalledTimes(1);
    expect(job.providerPayload).toEqual({ rawCaptured: true, rawTruncated: false, raw: kept });
  });
});
