/**
 * Unit tests — IngestionScheduler
 *
 * Tests the scheduler logic with mocked providers and callbacks.
 * Covers ingestion jobs, pollLiveScores, runEventSync, scheduled routing, start/stop lifecycle.
 */

import { expect } from '@jest/globals';
import { emptySyncWriteDiagnostics } from '../../../packages/core-api/src/modules/ingestion/core/sync-write-diagnostics';
import { IngestionScheduler, LIVE_SCORE_SWEEP_TICK_MS } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type {
  EventSyncRequest,
  IngestionCallbacks,
  LiveScoreEventRef,
  ScheduledEventRef,
} from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { fakeSportDataProvider } from '../../support/fake-sport-data-provider';
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
import { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An event reader listing these events to load fields for, and these in progress for scores. */
function readerOf({ fields = [], live = [] }: { fields?: ScheduledEventRef[]; live?: Array<ScheduledEventRef & Partial<LiveScoreEventRef>> }) {
  return {
    listEventsForFeed: jest.fn().mockResolvedValue(fields),
    listLiveScoreEvents: jest.fn().mockResolvedValue(live.map((event): LiveScoreEventRef => ({
      playedInRounds: true,
      playUnderwaySince: null,
      lastProviderNotificationAt: null,
      ...event,
    }))),
  };
}

function createMockCallbacks(): IngestionCallbacks {
  return {
    onEventDetail: jest.fn().mockResolvedValue({ writeDiagnostics: emptySyncWriteDiagnostics(), unlinkedRankedParticipants: [] }),
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
  jest.spyOn(registry, 'getProviderById').mockImplementation((providerId) =>
    provider?.providerId === providerId ? provider : null);
  jest.spyOn(registry, 'getSupportedSports').mockReturnValue(supportedSports);
  jest.spyOn(registry, 'getAllProviders').mockReturnValue(provider ? [provider] : []);
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
        sport: 'GOLF',
        name: 'The Masters',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        metadata: {},
        participants: [
          { externalId: 'player-1', providerId: 'mock-provider', sport: 'GOLF', name: 'Player One', active: true, metadata: {} },
          { externalId: 'player-2', providerId: 'mock-provider', sport: 'GOLF', name: 'Player Two', active: true, metadata: {} },
        ],
      };
      const provider = fakeSportDataProvider({
        getEventDetails: jest.fn().mockResolvedValue(detail),
      });
      const registry = createMockRegistry(provider);
      mockCallbacks.onEventDetail = jest.fn().mockResolvedValue({ unlinkedRankedParticipants: [], writeDiagnostics: {
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

    it.each([
      ['one ranked participant', [{ participantId: 'p-1', name: 'Luka Dončić', ranking: 2 }],
        '1 ranked participant has no mock-provider mapping, so its scores will not reach it: Luka Dončić (rank 2). Merge or map each by hand.'],
      ['two ranked participants, best rank first', [{ participantId: 'p-1', name: 'Jayson Tatum', ranking: 1 }, { participantId: 'p-2', name: 'Luka Dončić', ranking: 2 }],
        '2 ranked participants have no mock-provider mapping, so its scores will not reach them: Jayson Tatum (rank 1), Luka Dončić (rank 2). Merge or map each by hand.'],
      ['more ranked participants than the warning names, counting the rest',
        Array.from({ length: 22 }, (_, index) => ({ participantId: `p-${String(index + 1)}`, name: `Golfer ${String(index + 1)}`, ranking: index + 1 })),
        `22 ranked participants have no mock-provider mapping, so its scores will not reach them: ${Array.from({ length: 20 }, (_, index) => `Golfer ${String(index + 1)} (rank ${String(index + 1)})`).join(', ')} and 2 more. Merge or map each by hand.`],
    ])('warns, naming them, when a field sync leaves %s of the field unlinked from the provider (#1664)', async (_label, unlinkedRankedParticipants, message) => {
      const detail: SportEventDetail = {
        externalId: 'evt-1', providerId: 'mock-provider', sport: 'GOLF', name: 'The Masters', startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED', fieldLocked: false, metadata: {},
        participants: [{ externalId: 'player-1', providerId: 'mock-provider', sport: 'GOLF', name: 'Player One', active: true, metadata: {} }],
      };
      const registry = createMockRegistry(fakeSportDataProvider({ getEventDetails: jest.fn().mockResolvedValue(detail) }));
      mockCallbacks.onEventDetail = jest.fn().mockResolvedValue({ writeDiagnostics: emptySyncWriteDiagnostics(), unlinkedRankedParticipants });

      const [job] = await new IngestionScheduler(registry, mockCallbacks).runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTPARTICIPANTS'] });

      expect(job.warnings).toEqual([{ code: 'RANKED_PARTICIPANTS_UNLINKED', message }]);
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
        sport: 'GOLF',
        providerId: 'deferred-provider',
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
        metadata: {},
        participants: [
          {
            externalId: 'player-1',
            providerId: 'mock-provider',
            sport: 'GOLF',
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
        sport: 'GOLF',
        providerId: 'mock-provider',
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
        sport: 'GOLF',
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
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
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
        sport: 'GOLF',
        providerId: 'real-provider',
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
        sport: 'GOLF',
        providerId: 'mock-provider',
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
      const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'live-event' }] });
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
        createMockRegistry(provider, ['GOLF']),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
          syncRunLedger,
        },
      );

      await scheduler['runConfiguredLiveScoreSweep']('GOLF');

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
      const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'live-event' }] });
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF']),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
        },
      );

      const firstRun = scheduler['runConfiguredLiveScoreSweep']('GOLF');
      await liveScoreCallStarted;
      await scheduler['runConfiguredLiveScoreSweep']('GOLF');
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
      const eventReader = readerOf({
        fields: [{ providerId: 'mock-provider', externalId: 'active-event' }],
        live: [{ providerId: 'mock-provider', externalId: 'live-event' }],
      });
      const syncOrchestrator = createSyncOrchestratorSpy(now);
      const scheduler = new IngestionScheduler(
        createMockRegistry(provider, ['GOLF']),
        mockCallbacks,
        undefined,
        {
          configReader,
          eventReader,
          now: () => now,
          syncOrchestrator,
        },
      );

      await scheduler['runConfiguredSportFieldSync']('GOLF');
      await scheduler['runConfiguredLiveScoreSweep']('GOLF');

      expect(syncOrchestrator.normalizeRequest).toHaveBeenCalledWith(expect.objectContaining({
        source: 'SCHEDULED',
        actor: { type: 'SYSTEM', name: 'scheduler' },
        scope: {
          type: 'EVENT',
          sport: 'GOLF',
          providerId: 'mock-provider',
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
          providerId: 'mock-provider',
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
        sport: 'GOLF',
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
      const registry = createMockRegistry(provider, ['GOLF']);
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
      const eventReader = readerOf({ fields: [{ providerId: 'mock-provider', externalId: 'field-available-event' }] });
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, {
        configReader,
        eventReader,
        now: () => now,
      });

      await scheduler['runConfiguredSportFieldSync']('GOLF');

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listEventsForFeed).toHaveBeenCalledWith({
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
      const registry = createMockRegistry(provider, ['GOLF']);
      const eventReader = readerOf({
        fields: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
        live: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
      });
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
      expect(eventReader.listEventsForFeed).toHaveBeenCalledWith(expect.objectContaining({
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
      const registry = createMockRegistry(provider, ['GOLF']);
      const eventReader = readerOf({
        fields: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
        live: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
      });
      const scheduler = new IngestionScheduler(registry, mockCallbacks, undefined, { eventReader });

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
      expect(eventReader.listLiveScoreEvents).toHaveBeenCalledWith(expect.objectContaining({ sport: 'GOLF' }));
      expect(eventReader.listEventsForFeed).not.toHaveBeenCalled();
      expect(provider.getEventDetails).not.toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).not.toHaveBeenCalled();
    });

    it('schedules no feed for a covered sport the ingestion sync config does not enable', async () => {
      const provider = fakeSportDataProvider();
      const eventReader = readerOf({});
      const registry = createMockRegistry(provider, [Sport.GOLF]);
      const configReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: [],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
          eventLiveScores: { enabled: false, intervalSeconds: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn().mockResolvedValue({
          scheduledSports: [],
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

      expect(eventReader.listEventsForFeed).not.toHaveBeenCalled();
      expect(eventReader.listLiveScoreEvents).not.toHaveBeenCalled();
    });

    it('start() is idempotent — calling twice does not double timers', () => {
      const provider = fakeSportDataProvider();
      const registry = createMockRegistry(provider, ['GOLF']);
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
      const registry = createMockRegistry(provider, ['GOLF']);
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
    const registry = createMockRegistry(provider, ['GOLF']);
    const config = configWithHealthCheck(false);
    const configReader = {
      getConfig: jest.fn().mockResolvedValue(config),
      getPerSportConfig: jest.fn().mockResolvedValue(config),
    };
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), undefined, {
      configReader,
      eventReader: readerOf({}),
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    scheduler.stop();

    expect(provider.healthCheck).not.toHaveBeenCalled();
  });

  it('checks provider health on the configured interval while health checks are on', async () => {
    const provider = fakeSportDataProvider();
    const registry = createMockRegistry(provider, ['GOLF']);
    const config = configWithHealthCheck(true);
    const configReader = {
      getConfig: jest.fn().mockResolvedValue(config),
      getPerSportConfig: jest.fn().mockResolvedValue(config),
    };
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), undefined, {
      configReader,
      eventReader: readerOf({}),
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    scheduler.stop();

    // Once at start, then every five minutes: at 5 and 10 minutes.
    expect(provider.healthCheck).toHaveBeenCalledTimes(3);
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
    metadata: {},
    participants,
  });

  it('fails a field sync with "No provider registered" when no provider serves the sport, without calling back', async () => {
    const callbacks = createMockCallbacks();
    const scheduler = new IngestionScheduler(createMockRegistry(null), callbacks);

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTPARTICIPANTS'] });

    expect(job).toMatchObject({ status: 'FAILED', providerId: 'mock-provider', errorLog: [expect.objectContaining({ error: 'No provider registered' })] });
    expect(callbacks.onEventDetail).not.toHaveBeenCalled();
  });

  it('completes a field sync of an empty field with a NO_PROVIDER_PARTICIPANTS warning, so an admin sees why nothing loaded', async () => {
    const provider = fakeSportDataProvider({ getEventDetails: jest.fn().mockResolvedValue(detail([])) });
    const scheduler = new IngestionScheduler(createMockRegistry(provider), createMockCallbacks());

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', feeds: ['EVENTPARTICIPANTS'] });

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

  it('warns about a scheduled sport no provider is registered for, and runs no feed for it', async () => {
    const logger = fakeLogger();
    const config = { ...createEnabledScheduleConfig(), scheduledSports: ['GOLF', 'TENNIS'] };
    const configReader = { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) };
    const eventReader = readerOf({});
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider(), ['GOLF']), createMockCallbacks(), logger, { configReader, eventReader });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ unregisteredSports: ['TENNIS'] }),
      'Configured scheduled ingestion sports have no registered provider',
    );
    expect(eventReader.listEventsForFeed).not.toHaveBeenCalledWith(expect.objectContaining({ sport: 'TENNIS' }));
    expect(eventReader.listLiveScoreEvents).not.toHaveBeenCalledWith(expect.objectContaining({ sport: 'TENNIS' }));
  });

  it('warns about the same unregistered scheduled sports once, logs repeats at debug, and warns again when the set changes', async () => {
    const logger = fakeLogger();
    let config = { ...createEnabledScheduleConfig(), scheduledSports: [Sport.HORSE_RACING] as Sport[] };
    const configReader = { getConfig: jest.fn(() => Promise.resolve(config)), getPerSportConfig: jest.fn(() => Promise.resolve(config)) };
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider(), []), createMockCallbacks(), logger, { configReader });
    const unregisteredWarnings = () => logger.warn.mock.calls.filter(
      ([, message]) => message === 'Configured scheduled ingestion sports have no registered provider',
    );

    scheduler.start();
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000 + 1);

    expect(unregisteredWarnings()).toHaveLength(1);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ unregisteredSports: [Sport.HORSE_RACING] }),
      'Configured scheduled ingestion sports still have no registered provider',
    );

    config = { ...config, scheduledSports: [Sport.HORSE_RACING, Sport.GOLF] };
    await jest.advanceTimersByTimeAsync(60 * 1000 + 1);
    scheduler.stop();

    expect(unregisteredWarnings()).toHaveLength(2);
    expect(unregisteredWarnings()[1][0]).toMatchObject({ unregisteredSports: [Sport.HORSE_RACING, Sport.GOLF] });
  });

  it('keeps every loop alive on the one-minute recheck when the ingestion config cannot be read', async () => {
    const logger = fakeLogger();
    const configReader = {
      getConfig: jest.fn().mockRejectedValue(new Error('config table missing')),
      getPerSportConfig: jest.fn().mockRejectedValue(new Error('config table missing')),
    };
    const scheduler = new IngestionScheduler(createMockRegistry(fakeSportDataProvider(), ['GOLF']), createMockCallbacks(), logger, { configReader });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);
    scheduler.stop();

    expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'Failed to reconcile configured sport ingestion loops');
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'Falling back to config recheck delay because policy resolution failed');
    // Start, then a recheck at one and two minutes.
    expect(configReader.getConfig.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('runs no scheduled live-score sweep when no event reader is wired, since it has no events to poll', async () => {
    const provider = fakeSportDataProvider();
    const scheduler = new IngestionScheduler(createMockRegistry(provider, ['GOLF']), createMockCallbacks());

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(provider.getLiveScores).not.toHaveBeenCalled();
  });

  it('polls live scores on an interval given in minutes when no seconds interval is set', async () => {
    const provider = fakeSportDataProvider();
    const config = { ...createEnabledScheduleConfig(), eventLiveScores: { enabled: true, intervalMinutes: 10 } };
    const configReader = { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) };
    const eventReader = readerOf({ live: [{ providerId: 'mock-provider', externalId: 'evt-1' }] });
    const scheduler = new IngestionScheduler(createMockRegistry(provider, ['GOLF']), createMockCallbacks(), undefined, { configReader, eventReader });

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
    const configReader = { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) };
    const eventReader = readerOf({
      fields: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
      live: [{ providerId: 'mock-provider', externalId: 'evt-1' }],
    });
    const scheduler = new IngestionScheduler(createMockRegistry(provider, ['GOLF']), createMockCallbacks(), undefined, { configReader, eventReader, jobLock });
    return { provider, scheduler };
  }

  it('calls no provider when another server task holds the locks of the health check and the sport loops', async () => {
    const jobLock = heldElsewhere();
    const { provider, scheduler } = golfLoops(jobLock);

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(provider.healthCheck).not.toHaveBeenCalled();
    expect(provider.getEventDetails).not.toHaveBeenCalled();
    expect(provider.getLiveScores).not.toHaveBeenCalled();
    expect(new Set(jobLock.keys)).toEqual(new Set([
      'ingestion:health-checks',
      'ingestion:GOLF:participants',
      'ingestion:GOLF:live-scores',
    ]));
  });

  it('runs the health check and the sport loops when this task holds their locks', async () => {
    const { provider, scheduler } = golfLoops(heldHere());

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.stop();

    expect(provider.healthCheck).toHaveBeenCalled();
    expect(provider.getEventDetails).toHaveBeenCalledWith('evt-1');
    expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
  });
});

describe('IngestionScheduler with two providers serving one sport', () => {
  const liveScores = (eventId: string): LiveScoreResult => ({ category: 'GOLF', externalEventId: eventId, rounds: [] });

  function twoGolfProviders() {
    const primary = fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      getLiveScores: jest.fn().mockResolvedValue(liveScores('mock-1')),
    });
    const secondary = fakeSportDataProvider({
      providerId: 'balldontlie',
      getLiveScores: jest.fn().mockResolvedValue(liveScores('41')),
    });
    const registry = new ProviderRegistry();
    registry.register('GOLF', primary, 'PRIMARY');
    registry.register('GOLF', secondary, 'SECONDARY');
    return { primary, secondary, registry };
  }

  it('polls each event\'s live scores from the provider it is linked to, not the sport\'s primary', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const callbacks = createMockCallbacks();
    const scheduler = new IngestionScheduler(registry, callbacks);

    const job = await scheduler.pollLiveScores('GOLF', 'balldontlie', '41');

    expect(job).toMatchObject({ status: 'COMPLETED', providerId: 'balldontlie' });
    expect(secondary.getLiveScores).toHaveBeenCalledWith('41');
    expect(primary.getLiveScores).not.toHaveBeenCalled();
    expect(callbacks.onLiveScores).toHaveBeenCalledWith(liveScores('41'), 'balldontlie');
  });

  it('fails the sync, calling no provider, when the linked provider is registered but does not serve the event\'s sport', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const scheduler = new IngestionScheduler(registry, createMockCallbacks());

    const job = await scheduler.pollLiveScores('BASKETBALL', 'balldontlie', '41');

    expect(job).toMatchObject({ status: 'FAILED', providerId: 'balldontlie', errorLog: [expect.objectContaining({ error: 'No provider registered' })] });
    expect(secondary.getLiveScores).not.toHaveBeenCalled();
    expect(primary.getLiveScores).not.toHaveBeenCalled();
  });

  it('sweeps live events from both providers, each from its own provider, even when both use the same event id', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const config = createEnabledScheduleConfig();
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), undefined, {
      configReader: { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) },
      eventReader: readerOf({
        live: [
          { providerId: 'mock-contest-feed', externalId: '41' },
          { providerId: 'balldontlie', externalId: '41' },
        ],
      }),
    });

    await scheduler['runConfiguredLiveScoreSweep']('GOLF');

    expect(primary.getLiveScores).toHaveBeenCalledWith('41');
    expect(secondary.getLiveScores).toHaveBeenCalledWith('41');
  });
});

describe('IngestionScheduler webhook-triggered event syncs (#1498)', () => {
  const now = new Date('2026-11-12T18:00:00.000Z');
  const notified = { sport: Sport.GOLF, providerId: 'mock-provider', eventId: 'live-event' };

  function schedulerFor(config: ReturnType<typeof createEnabledScheduleConfig>) {
    const provider = fakeSportDataProvider();
    const syncRun = {
      id: 'webhook-sync-run-1',
      providerId: 'mock-provider',
      sport: Sport.GOLF,
      eventId: 'live-event',
      status: 'SUBMITTED' as const,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      payload: { requestedFeed: 'EVENTLIVESCORES' as const },
    };
    const syncRunLedger = {
      createSubmissions: jest.fn().mockResolvedValue([syncRun]),
      executeFeedRun: jest.fn(async (_syncRun: typeof syncRun, run: () => Promise<unknown>) =>
        await run() as Awaited<ReturnType<IngestionScheduler['pollLiveScores']>>),
    };
    const scheduler = new IngestionScheduler(createMockRegistry(provider, [Sport.GOLF]), createMockCallbacks(), fakeLogger(), {
      configReader: { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) },
      now: () => now,
      syncRunLedger,
    });
    return { scheduler, provider, syncRunLedger };
  }

  it('syncs the notified event\'s live scores from its provider and records the run as a WEBHOOK sync by the webhook receiver', async () => {
    const { scheduler, provider, syncRunLedger } = schedulerFor(createEnabledScheduleConfig());

    const job = await scheduler.runNotifiedEventSync(notified);

    expect(job?.status).toBe('COMPLETED');
    expect(provider.getLiveScores).toHaveBeenCalledWith('live-event');
    expect(syncRunLedger.createSubmissions).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'mock-provider',
      runType: 'WEBHOOK_EVENT_SYNC',
      normalizedRequest: expect.objectContaining({
        source: 'WEBHOOK',
        actor: { type: 'SYSTEM', name: 'webhook' },
        scope: expect.objectContaining({ sport: Sport.GOLF, eventId: 'live-event', feeds: ['EVENTLIVESCORES'] }),
      }),
    }));
  });

  it('syncs nothing for a sport not scheduled for ingestion, as the scheduled sweep would not', async () => {
    const { scheduler, provider, syncRunLedger } = schedulerFor({ ...createEnabledScheduleConfig(), scheduledSports: ['AMERICAN_FOOTBALL'] });

    expect(await scheduler.runNotifiedEventSync(notified)).toBeNull();
    expect(provider.getLiveScores).not.toHaveBeenCalled();
    expect(syncRunLedger.createSubmissions).not.toHaveBeenCalled();
  });

  it('syncs nothing while live score syncs are switched off for the sport', async () => {
    const { scheduler, provider } = schedulerFor({
      ...createEnabledScheduleConfig(),
      eventLiveScores: { enabled: false, intervalSeconds: 30 },
    });

    expect(await scheduler.runNotifiedEventSync(notified)).toBeNull();
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
    scheduledSports: ['GOLF', 'AMERICAN_FOOTBALL'],
    eventLiveScores: { enabled: true, intervalSeconds: 5 * 60 },
  };

  function paced(options: { cadence?: typeof cadence; config?: typeof adminConfig } = {}) {
    const clock = { now: T0 };
    let live: LiveScoreEventRef[] = [];
    const notified = fakeSportDataProvider({
      providerId: 'balldontlie',
      sportsCovered: [Sport.GOLF, Sport.AMERICAN_FOOTBALL],
      getLiveScores: jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'x', rounds: [] } satisfies LiveScoreResult),
    });
    const polled = fakeSportDataProvider({
      providerId: 'mock-contest-feed',
      sportsCovered: [Sport.GOLF, Sport.AMERICAN_FOOTBALL],
      getLiveScores: jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'x', rounds: [] } satisfies LiveScoreResult),
    });
    const registry = new ProviderRegistry();
    for (const sport of [Sport.GOLF, Sport.AMERICAN_FOOTBALL]) {
      registry.register(sport, polled, 'PRIMARY');
      registry.register(sport, notified, 'SECONDARY');
    }
    const config = options.config ?? adminConfig;
    const logger = fakeLogger();
    const scheduler = new IngestionScheduler(registry, createMockCallbacks(), logger, {
      configReader: { getConfig: jest.fn().mockResolvedValue(config), getPerSportConfig: jest.fn().mockResolvedValue(config) },
      eventReader: { listEventsForFeed: jest.fn().mockResolvedValue([]), listLiveScoreEvents: jest.fn(async () => live) },
      now: () => clock.now,
      notifiedProviderCadence: 'cadence' in options ? options.cadence : cadence,
    });
    const sweepAt = async (sport: Sport, minutes: number, events: LiveScoreEventRef[]) => {
      clock.now = new Date(T0.getTime() + minutes * MINUTE);
      live = events;
      await scheduler['runConfiguredLiveScoreSweep'](sport);
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
    playedInRounds: false,
    playUnderwaySince: null,
    lastProviderNotificationAt: null,
    ...live,
  });

  it('keeps the admin\'s live-score interval for the sweep with no notified provider, and ticks every minute with one', async () => {
    expect(await paced({ cadence: undefined }).scheduler['getLiveScoreSweepDelayMs'](Sport.GOLF)).toBe(5 * MINUTE);
    expect(await paced().scheduler['getLiveScoreSweepDelayMs'](Sport.GOLF)).toBe(LIVE_SCORE_SWEEP_TICK_MS);
    const fast = { ...adminConfig, eventLiveScores: { enabled: true, intervalSeconds: 30 } };
    expect(await paced({ config: fast }).scheduler['getLiveScoreSweepDelayMs'](Sport.GOLF)).toBe(30_000);
  });

  it('polls a notified provider\'s game event only every 15 minutes, even while a match is in play, and another provider\'s every admin interval, on a one-minute tick', async () => {
    const { sweepAt, pollsOf, notified, polled } = paced();
    const events = [event('balldontlie', 'nfl-week-11', { playUnderwaySince: T0, lastProviderNotificationAt: T0 }), event('mock-contest-feed', 'mock-week-11')];

    for (let minute = 0; minute <= 30; minute += 1) {
      await sweepAt(Sport.AMERICAN_FOOTBALL, minute, events);
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

    await sweepAt(Sport.AMERICAN_FOOTBALL, 0, events);
    await sweepAt(Sport.AMERICAN_FOOTBALL, 15 - 4 / 60, events);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
  });

  it('polls an event again at once when it drops out of the sweep and comes back, since it keeps no pace for events no longer listed', async () => {
    const { sweepAt, pollsOf, notified } = paced();
    const events = [event('balldontlie', 'nfl-week-11')];

    await sweepAt(Sport.AMERICAN_FOOTBALL, 0, events);
    await sweepAt(Sport.AMERICAN_FOOTBALL, 1, []);
    await sweepAt(Sport.AMERICAN_FOOTBALL, 2, events);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
  });

  it('warns once per quiet window about a notified event in play with no notification for its window (here 20 minutes)', async () => {
    const { sweepAt, quietWarnings } = paced();
    const quiet = event('balldontlie', 'nfl-week-11', {
      playUnderwaySince: new Date(T0.getTime() - 60 * MINUTE),
      lastProviderNotificationAt: new Date(T0.getTime() - 25 * MINUTE),
    });

    await sweepAt(Sport.AMERICAN_FOOTBALL, 0, [quiet]);
    await sweepAt(Sport.AMERICAN_FOOTBALL, 1, [quiet]);
    await sweepAt(Sport.AMERICAN_FOOTBALL, 19, [quiet]);
    expect(quietWarnings()).toHaveLength(1);
    expect(quietWarnings()[0]?.[0]).toEqual({
      action: 'ingestion.providerNotifications.quiet',
      data: {
        sport: Sport.AMERICAN_FOOTBALL,
        providerId: 'balldontlie',
        eventId: 'nfl-week-11',
        playUnderwaySince: new Date(T0.getTime() - 60 * MINUTE).toISOString(),
        lastProviderNotificationAt: new Date(T0.getTime() - 25 * MINUTE).toISOString(),
        quietMinutes: 25,
      },
    });

    await sweepAt(Sport.AMERICAN_FOOTBALL, 20, [quiet]);
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

    await sweepAt(Sport.AMERICAN_FOOTBALL, 0, [
      event('balldontlie', 'between-games', { lastProviderNotificationAt: longAgo }),
      event('balldontlie', 'recently-heard', { playUnderwaySince: longAgo, lastProviderNotificationAt: new Date(T0.getTime() - 5 * MINUTE) }),
      event('mock-contest-feed', 'polled-only', { playUnderwaySince: longAgo }),
    ]);

    expect(quietWarnings()).toHaveLength(0);
  });

  it('warns about nothing and polls every event each sweep while no provider sends notifications', async () => {
    const { sweepAt, pollsOf, quietWarnings, notified } = paced({ cadence: undefined });
    const quiet = event('balldontlie', 'nfl-week-11', { playUnderwaySince: new Date(T0.getTime() - 60 * MINUTE) });

    await sweepAt(Sport.AMERICAN_FOOTBALL, 0, [quiet]);
    await sweepAt(Sport.AMERICAN_FOOTBALL, 1, [quiet]);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
    expect(quietWarnings()).toHaveLength(0);
  });

  it('forgets every event\'s pace when stopped', async () => {
    const { scheduler, sweepAt, pollsOf, notified } = paced();
    const events = [event('balldontlie', 'nfl-week-11')];

    await sweepAt(Sport.AMERICAN_FOOTBALL, 0, events);
    scheduler.stop();
    await sweepAt(Sport.AMERICAN_FOOTBALL, 1, events);

    expect(pollsOf(notified, 'nfl-week-11')).toBe(2);
  });
});
