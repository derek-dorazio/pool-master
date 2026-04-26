/**
 * Unit tests — IngestionScheduler
 *
 * Tests the scheduler logic with mocked providers and callbacks.
 * Covers syncSport, pollLiveScores, fetchEventResults, start/stop lifecycle.
 */

import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { IngestionCallbacks } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type {
  SportDataProvider,
  SportEvent,
  SportEventDetail,
  ProviderStatEvent,
  ProviderEventResult,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';

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
    getLiveScores: jest.fn().mockResolvedValue([]),
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
  });

  describe('runSportSync', () => {
    it('runs only the requested sport-level feeds', async () => {
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
        getEventDetails: jest.fn().mockResolvedValue(detail),
        getRankings: jest.fn().mockResolvedValue([
          {
            participantExternalId: 'player-1',
            rankingType: 'default',
            rank: 1,
            asOfDate: new Date('2026-04-09T12:00:00.000Z'),
          },
        ]),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const jobs = await scheduler.runSportSync({
        sport: 'GOLF' as Sport,
        feeds: ['EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'],
        from: new Date('2026-04-01T00:00:00.000Z'),
        to: new Date('2026-04-30T23:59:59.999Z'),
      });

      expect(provider.getUpcomingEvents).toHaveBeenCalledTimes(1);
      expect(provider.getEventDetails).toHaveBeenCalledWith('evt-1');
      expect(mockCallbacks.onEventDetail).toHaveBeenCalledWith(detail);
      expect(provider.getRankings).toHaveBeenCalledWith('GOLF', 'default');
      expect(mockCallbacks.onEvents).not.toHaveBeenCalled();
      expect(jobs.map((job) => job.jobType)).toEqual(['EVENT_PARTICIPANTS_SYNC', 'PARTICIPANT_RANKINGS_SYNC']);
    });
  });

  describe('pollLiveScores', () => {
    it('calls getLiveScores and invokes onLiveScores callback', async () => {
      const mockScores: ProviderStatEvent[] = [
        {
          id: 'score-1',
          eventExternalId: 'evt-1',
          participantExternalId: 'player-1',
          statKey: 'STROKES',
          statValue: 72,
          timestamp: new Date(),
          isCorrection: false,
          providerId: 'mock-provider',
        },
      ];
      const provider = createMockProvider({
        getLiveScores: jest.fn().mockResolvedValue(mockScores),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(provider.getLiveScores).toHaveBeenCalledWith('evt-1');
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(mockScores);
      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(1);
    });

    it('succeeds with empty results', async () => {
      const provider = createMockProvider({
        getLiveScores: jest.fn().mockResolvedValue([]),
      });
      const registry = createMockRegistry(provider);
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(0);
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith([]);
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
        getLiveScores: jest.fn().mockResolvedValue([
          {
            id: 'score-1',
            eventExternalId: 'evt-1',
            participantExternalId: 'player-1',
            statKey: 'TOTAL_SCORE',
            statValue: -3,
            timestamp: new Date(),
            isCorrection: false,
            providerId: 'mock-provider',
          },
        ]),
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

  describe('fetchEventResults', () => {
    it('calls getEventResults and converts results to stat events', async () => {
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
      expect(mockCallbacks.onLiveScores).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            eventExternalId: 'evt-1',
            participantExternalId: 'player-1',
            statKey: 'FINISH_POSITION',
            statValue: 1,
          }),
          expect.objectContaining({
            eventExternalId: 'evt-1',
            participantExternalId: 'player-2',
            statKey: 'FINISH_POSITION',
            statValue: 2,
          }),
        ]),
      );
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
      const scheduler = new IngestionScheduler(registry, mockCallbacks);

      scheduler.start();

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      // Initial sync calls getSupportedSports (from syncAllSchedules, syncAllFields, syncAllRankings)
      // and getAllProviders (from runHealthChecks)
      expect(registry.getAllProviders).toHaveBeenCalled();
      expect(registry.getSupportedSports).toHaveBeenCalled();
      expect((provider.getUpcomingEvents as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(provider.getEventDetails).toHaveBeenCalled();
      expect(provider.getRankings).toHaveBeenCalledWith('GOLF', 'default');
      expect(mockCallbacks.onEvents).toHaveBeenCalled();
      expect(mockCallbacks.onEventDetail).toHaveBeenCalled();
      expect(mockCallbacks.onRankings).toHaveBeenCalled();
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
