/**
 * Unit tests: EventFeedSync (#2009), one event's field or scores feed from its league's provider,
 * with fake providers and callbacks: the job record each run answers, its provider payloads, and
 * its failures.
 */

import { expect } from '@jest/globals';
import { emptySyncWriteDiagnostics } from '../../../packages/core-api/src/modules/ingestion/core/sync-write-diagnostics';
import { EventFeedSync } from '../../../packages/core-api/src/modules/ingestion/core/event-feed-sync';
import type { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import type { EventSyncRequest, IngestionCallbacks } from '../../../packages/core-api/src/modules/ingestion/core/event-feed-sync';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { fakeLogger } from '../../support/fake-logger';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { ProviderCode, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

/** A second Provider code, for a registry running two providers. */
const OTHER_PROVIDER = 'OTHER_FEED' as ProviderCode;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventFeedSync', () => {
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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks, logger);

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
      const scheduler = new EventFeedSync(createMockRegistry(provider), mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks);
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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(0);
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(empty, 'mock-provider');
    });

    it('returns FAILED job when no provider is registered', async () => {
      const registry = createMockRegistry(null);
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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
      const scheduler = new EventFeedSync(registry, mockCallbacks);

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

});

describe('EventFeedSync job outcomes', () => {
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
    const scheduler = new EventFeedSync(createMockRegistry(null), callbacks);

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', kinds: ['FIELD'] });

    expect(job).toMatchObject({ status: 'FAILED', providerId: 'mock-provider', errorLog: [expect.objectContaining({ error: 'No provider registered' })] });
    expect(callbacks.onEventDetail).not.toHaveBeenCalled();
  });

  it('completes a field sync of an empty field with a NO_PROVIDER_PARTICIPANTS warning, so an admin sees why nothing loaded', async () => {
    const provider = fakeSportDataProvider({ getEventDetails: jest.fn().mockResolvedValue(detail([])) });
    const scheduler = new EventFeedSync(createMockRegistry(provider), createMockCallbacks());

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'evt-1', kinds: ['FIELD'] });

    expect(job).toMatchObject({
      status: 'COMPLETED',
      recordsProcessed: 0,
      warnings: [expect.objectContaining({ code: 'NO_PROVIDER_PARTICIPANTS' })],
    });
  });

  it('records a non-Error thrown by a provider as the failed job\'s message', async () => {
    const provider = fakeSportDataProvider({ getLiveScores: jest.fn().mockRejectedValue('socket hang up') });
    const scheduler = new EventFeedSync(createMockRegistry(provider), createMockCallbacks(), fakeLogger());

    const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

    expect(job).toMatchObject({ status: 'FAILED', errors: 1, errorLog: [expect.objectContaining({ error: 'socket hang up' })] });
  });

  it.each([
    [{ category: 'GOLF', externalEventId: 'evt-1', rounds: [{}, {}] }, 2],
    [{ category: 'GOLF', externalEventId: 'evt-1', rounds: [] }, 0],
  ])('counts a golf live-score result\'s rounds as the records the job processed (%o)', async (result, expected) => {
    const provider = fakeSportDataProvider({ getLiveScores: jest.fn().mockResolvedValue(result) });
    const scheduler = new EventFeedSync(createMockRegistry(provider), createMockCallbacks());

    const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

    expect(job).toMatchObject({ status: 'COMPLETED', recordsProcessed: expected });
  });
});

describe('EventFeedSync with two providers running', () => {
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
    const scheduler = new EventFeedSync(registry, callbacks);

    const job = await scheduler.pollLiveScores('GOLF', 'balldontlie', '41');

    expect(job).toMatchObject({ status: 'COMPLETED', providerId: 'balldontlie' });
    expect(secondary.getLiveScores).toHaveBeenCalledWith('41');
    expect(primary.getLiveScores).not.toHaveBeenCalled();
    expect(callbacks.onLiveScores).toHaveBeenCalledWith(liveScores('41'), 'balldontlie');
  });

  it('fails the sync, calling no provider, when the linked provider is not running here', async () => {
    const { primary, secondary, registry } = twoGolfProviders();
    const scheduler = new EventFeedSync(registry, createMockCallbacks());

    const job = await scheduler.pollLiveScores('GOLF', 'sportradar', '41');

    expect(job).toMatchObject({ status: 'FAILED', providerId: 'sportradar', errorLog: [expect.objectContaining({ error: 'No provider registered' })] });
    expect(secondary.getLiveScores).not.toHaveBeenCalled();
    expect(primary.getLiveScores).not.toHaveBeenCalled();
  });
});

describe('EventFeedSync with a provider that keeps its own payloads', () => {
  it('clears a provider\'s kept payloads before a run, and reports the ones the run kept, when the provider opens no capture session', async () => {
    const capturedAt = '2026-05-30T12:00:00.000Z';
    const kept: ProviderPayloadCapture[] = [{ operation: 'provider.request', path: '/v1/scores', capturedAt, raw: { scores: [] }, bytes: 12 }];
    const clearProviderPayloads = jest.fn();
    const provider: SportDataProvider & ProviderPayloadDiagnostics = Object.assign(fakeSportDataProvider(), {
      clearProviderPayloads,
      consumeProviderPayloads: () => kept,
    });
    const scheduler = new EventFeedSync(createMockRegistry(provider), createMockCallbacks());

    const [job] = await scheduler.runEventSync({ sport: 'GOLF', providerId: 'mock-provider', eventId: 'e1', kinds: ['SCORES'] });

    expect(clearProviderPayloads).toHaveBeenCalledTimes(1);
    expect(job.providerPayload).toEqual({ rawCaptured: true, rawTruncated: false, raw: kept });
  });
});
