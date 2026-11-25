/**
 * Unit tests — Ingestion module (ProviderRegistry, IngestionScheduler)
 *
 * Tests the core ingestion classes with mocked providers.
 */

import { LeagueProviderNotResolvedError, ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { IngestionCallbacks } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { emptySyncWriteDiagnostics } from '../../../packages/core-api/src/modules/ingestion/core/sync-write-diagnostics';
import type {
  SportDataProvider,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { ProviderCode } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

// ---------------------------------------------------------------------------
// Helpers — mock provider
// ---------------------------------------------------------------------------

function createMockProvider(overrides: Partial<SportDataProvider> = {}): SportDataProvider {
  return {
    providerId: 'mock-provider',
    providerCode: ProviderCode.BALLDONTLIE,
    providerName: 'Mock Provider',
    servesLeague: jest.fn().mockReturnValue(true),
    getUpcomingEvents: jest.fn().mockResolvedValue([]),
    getEventDetails: jest.fn().mockResolvedValue(null),
    getParticipants: jest.fn().mockResolvedValue([]),
    getLiveScores: jest.fn().mockResolvedValue({ category: 'GOLF', externalEventId: 'evt-ext', rounds: [] } satisfies LiveScoreResult),
    ...overrides,
  };
}

function createMockCallbacks(overrides: Partial<IngestionCallbacks> = {}): IngestionCallbacks {
  return {
    onEventDetail: jest.fn().mockResolvedValue({ writeDiagnostics: emptySyncWriteDiagnostics() }),
    onLiveScores: jest.fn().mockResolvedValue(emptyLiveScorePersistenceResult()),
    ...overrides,
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

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

/** A second Provider code, which only test code has: production has one Provider. */
const OTHER_PROVIDER = 'OTHER_FEED' as ProviderCode;

/** A sport league whose selected mapping names the provider with this code. */
function leagueSyncedFrom(name: string, providerCode: ProviderCode) {
  return { name, selectedProviderMapping: { providerCode, providerName: `${providerCode} feed`, providerLeagueCode: name.toLowerCase() } };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('finds a running provider by its Provider code and by the id its feed carries, and none for a code not running', () => {
    const provider = createMockProvider({ providerId: 'balldontlie' });
    registry.register(provider);

    expect(registry.byCode(ProviderCode.BALLDONTLIE)).toBe(provider);
    expect(registry.bySourceId('balldontlie')).toBe(provider);
    expect(registry.byCode(OTHER_PROVIDER)).toBeNull();
    expect(registry.bySourceId('nonexistent')).toBeNull();
    expect(registry.all()).toEqual([provider]);
  });

  it('replaces a Provider\'s earlier adapter, which its old feed id no longer finds', () => {
    const first = createMockProvider({ providerId: 'feed-v1' });
    const second = createMockProvider({ providerId: 'feed-v2' });
    registry.register(first);
    registry.register(second);

    expect(registry.byCode(ProviderCode.BALLDONTLIE)).toBe(second);
    expect(registry.bySourceId('feed-v1')).toBeNull();
    expect(registry.all()).toEqual([second]);
  });

  it('resolves a sport league to the provider its selected mapping names, with that mapping', () => {
    const provider = createMockProvider();
    registry.register(provider);
    const league = leagueSyncedFrom('NBA', ProviderCode.BALLDONTLIE);

    expect(registry.forLeague(league)).toEqual({ provider, mapping: league.selectedProviderMapping });
  });

  it('resolves two leagues of one sport synced from different providers to each one\'s own provider', () => {
    const balldontlie = createMockProvider({ providerId: 'balldontlie' });
    const other = createMockProvider({ providerId: 'other-feed', providerCode: OTHER_PROVIDER });
    registry.register(balldontlie);
    registry.register(other);

    expect(registry.forLeague(leagueSyncedFrom('NBA', ProviderCode.BALLDONTLIE)).provider).toBe(balldontlie);
    expect(registry.forLeague(leagueSyncedFrom('WNBA', OTHER_PROVIDER)).provider).toBe(other);
  });

  it('refuses a league with no selected mapping as not synced (422), with no fallback to a provider of its sport', () => {
    registry.register(createMockProvider());

    const refusal = (() => {
      try {
        registry.forLeague({ name: 'US Thoroughbred', selectedProviderMapping: null });
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(refusal).toBeInstanceOf(LeagueProviderNotResolvedError);
    expect(refusal).toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
  });

  it('refuses a league whose selected provider is not running here (404 PROVIDER_NOT_FOUND)', () => {
    registry.register(createMockProvider());

    expect(() => registry.forLeague(leagueSyncedFrom('EPL', OTHER_PROVIDER))).toThrow(
      expect.objectContaining({ code: 'PROVIDER_NOT_FOUND', statusCode: 404 }) as Error,
    );
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
      registry.register(provider);

      const scheduler = new IngestionScheduler(registry, callbacks);
      const job = await scheduler.pollLiveScores('GOLF', 'mock-provider', 'evt-1');

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
