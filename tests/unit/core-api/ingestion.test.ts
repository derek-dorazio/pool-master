/**
 * Unit tests — Ingestion module (ProviderRegistry, IngestionScheduler, publishStatEvents)
 *
 * Tests the core ingestion classes with mocked providers and event bus.
 */

import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { IngestionCallbacks } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type {
  SportDataProvider,
  ProviderHealthStatus,
  SportEvent,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

// ---------------------------------------------------------------------------
// Helpers — mock provider
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
    } as ProviderHealthStatus),
    ...overrides,
  };
}

function createMockCallbacks(overrides: Partial<IngestionCallbacks> = {}): IngestionCallbacks {
  return {
    onEvents: jest.fn().mockResolvedValue(undefined),
    onEventDetail: jest.fn().mockResolvedValue(undefined),
    onRankings: jest.fn().mockResolvedValue(undefined),
    onLiveScores: jest.fn().mockResolvedValue(undefined),
    onJobComplete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('registers a provider and retrieves it by sport', () => {
    const provider = createMockProvider();
    registry.register('GOLF' as Sport, provider, 'PRIMARY');

    const result = registry.getProvider('GOLF' as Sport);
    expect(result).toBe(provider);
  });

  it('returns null when no provider is registered for a sport', () => {
    const result = registry.getProvider('NFL' as Sport);
    expect(result).toBeNull();
  });

  it('getSupportedSports returns all sports with registered providers', () => {
    const golfProvider = createMockProvider({ providerId: 'golf-api' });
    const nflProvider = createMockProvider({ providerId: 'nfl-api' });

    registry.register('GOLF' as Sport, golfProvider, 'PRIMARY');
    registry.register('NFL' as Sport, nflProvider, 'PRIMARY');

    const sports = registry.getSupportedSports();
    expect(sports).toHaveLength(2);
    expect(sports).toContain('GOLF');
    expect(sports).toContain('NFL');
  });

  it('getHealthReport returns health for all unique providers', () => {
    const provider = createMockProvider({ providerId: 'espn' });
    registry.register('GOLF' as Sport, provider, 'PRIMARY');
    registry.register('NFL' as Sport, provider, 'PRIMARY');

    const report = registry.getHealthReport();
    // Same provider registered twice — should appear once
    expect(report).toHaveLength(1);
    expect(report[0].providerId).toBe('espn');
    expect(report[0].status).toBe('HEALTHY');
  });

  it('still returns the explicitly configured provider when it is degraded or down', () => {
    const primary = createMockProvider({ providerId: 'primary-api' });

    registry.register('GOLF' as Sport, primary, 'PRIMARY');

    registry.updateHealth('primary-api', {
      providerId: 'primary-api',
      status: 'DOWN',
      errorRateLastHour: 1,
      latencyMsP95: 0,
    });

    const result = registry.getProvider('GOLF' as Sport);
    expect(result).toBe(primary);
  });

  // --- Additional edge case tests (lines 60-88) ---

  it('getAllProviders returns all registered providers with deduplication', () => {
    const sharedProvider = createMockProvider({ providerId: 'espn-api' });
    const nflProvider = createMockProvider({ providerId: 'nfl-api' });

    // Register the same provider for two sports — should appear once in results
    registry.register('GOLF' as Sport, sharedProvider, 'PRIMARY');
    registry.register('NFL' as Sport, sharedProvider, 'PRIMARY');
    registry.register('NFL' as Sport, nflProvider, 'PRIMARY');

    const all = registry.getAllProviders();
    expect(all).toHaveLength(2);
    const ids = all.map((p) => p.providerId);
    expect(ids).toContain('espn-api');
    expect(ids).toContain('nfl-api');
  });

  it('getHealthReport includes error count and last error time from updateHealth', () => {
    const provider = createMockProvider({ providerId: 'degraded-api' });
    registry.register('GOLF' as Sport, provider, 'PRIMARY');

    const lastSuccess = new Date('2026-03-29T12:00:00Z');
    registry.updateHealth('degraded-api', {
      providerId: 'degraded-api',
      status: 'DEGRADED',
      errorRateLastHour: 0.35,
      latencyMsP95: 2500,
      lastSuccessfulPoll: lastSuccess,
      message: 'High latency detected',
    });

    const report = registry.getHealthReport();
    expect(report).toHaveLength(1);
    expect(report[0].status).toBe('DEGRADED');
    expect(report[0].errorRateLastHour).toBe(0.35);
    expect(report[0].latencyMsP95).toBe(2500);
    expect(report[0].lastSuccessfulPoll).toEqual(lastSuccess);
    expect(report[0].message).toBe('High latency detected');
  });

  it('getProviderById returns the matching provider or null', () => {
    const golfProvider = createMockProvider({ providerId: 'golf-stats' });
    const nflProvider = createMockProvider({ providerId: 'nfl-stats' });

    registry.register('GOLF' as Sport, golfProvider, 'PRIMARY');
    registry.register('NFL' as Sport, nflProvider, 'PRIMARY');

    expect(registry.getProviderById('golf-stats')).toBe(golfProvider);
    expect(registry.getProviderById('nfl-stats')).toBe(nflProvider);
    expect(registry.getProviderById('nonexistent')).toBeNull();
  });

  it('getProvidersForSport returns the explicitly configured provider for a sport', () => {
    const primary = createMockProvider({ providerId: 'primary-golf' });

    registry.register('GOLF' as Sport, primary, 'PRIMARY');

    const providers = registry.getProvidersForSport('GOLF' as Sport);
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBe(primary);
  });

  it('getSupportedSports returns unique sport list across all registrations', () => {
    const sharedProvider = createMockProvider({ providerId: 'multi-sport-api' });

    // Same provider registered for multiple sports.
    registry.register('GOLF' as Sport, sharedProvider, 'PRIMARY');
    registry.register('NFL' as Sport, sharedProvider, 'PRIMARY');
    registry.register('NBA' as Sport, sharedProvider, 'PRIMARY');

    const sports = registry.getSupportedSports();
    expect(sports).toHaveLength(3);
    expect(sports).toContain('GOLF');
    expect(sports).toContain('NFL');
    expect(sports).toContain('NBA');
  });
});

// ---------------------------------------------------------------------------
// IngestionScheduler
// ---------------------------------------------------------------------------

describe('IngestionScheduler', () => {
  let registry: ProviderRegistry;
  let callbacks: IngestionCallbacks;

  beforeEach(() => {
    registry = new ProviderRegistry();
    callbacks = createMockCallbacks();
  });

  describe('syncSport', () => {
    it('returns FAILED job when no provider is registered', async () => {
      const scheduler = new IngestionScheduler(registry, callbacks);

      const job = await scheduler.syncSport('GOLF' as Sport);
      expect(job.status).toBe('FAILED');
      expect(job.errors).toBe(1);
      expect(job.errorLog[0]).toEqual(expect.objectContaining({ error: 'No provider registered' }));
    });

    it('syncs events from the provider and calls onEvents callback', async () => {
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
      ];
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockResolvedValue(mockEvents),
      });
      registry.register('GOLF' as Sport, provider, 'PRIMARY');

      const scheduler = new IngestionScheduler(registry, callbacks);
      const job = await scheduler.syncSport('GOLF' as Sport);

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(1);
      expect(callbacks.onEvents).toHaveBeenCalledWith(mockEvents);
      expect(callbacks.onJobComplete).toHaveBeenCalledWith(expect.objectContaining({ status: 'COMPLETED' }));
    });

    it('returns FAILED job when provider throws', async () => {
      const provider = createMockProvider({
        getUpcomingEvents: jest.fn().mockRejectedValue(new Error('API timeout')),
      });
      registry.register('GOLF' as Sport, provider, 'PRIMARY');

      const scheduler = new IngestionScheduler(registry, callbacks);
      const job = await scheduler.syncSport('GOLF' as Sport);

      expect(job.status).toBe('FAILED');
      expect(job.errors).toBe(1);
      expect(job.errorLog[0]).toEqual(expect.objectContaining({ error: 'API timeout' }));
    });
  });

  describe('pollLiveScores', () => {
    it('pool-master-rop.78.3 — polls live scores and forwards typed LiveScoreResult', async () => {
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
      registry.register('GOLF' as Sport, provider, 'PRIMARY');

      const scheduler = new IngestionScheduler(registry, callbacks);
      const job = await scheduler.pollLiveScores('GOLF' as Sport, 'evt-1');

      expect(job.status).toBe('COMPLETED');
      expect(job.recordsProcessed).toBe(1);
      expect(callbacks.onLiveScores).toHaveBeenCalledWith(mockResult, 'mock-provider');
    });
  });
});

// publishStatEvents and the legacy stat.received bus event were retired in
// pool-master-rop.78.3 (plans/117 §10.3). The replacement
// publishLiveScoreUpdate is exercised by
// tests/unit/core-api/score-publisher.test.ts.
