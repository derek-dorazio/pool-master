import { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { SportDataProvider } from '../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { ProviderRegistry } from '../../packages/core-api/src/modules/ingestion/core/provider-registry';

/**
 * A whole `SportDataProvider` of `jest.fn()`s with neutral defaults (#345 Phase 2 PR 3).
 *
 * Lifted from `ingestion-scheduler.test.ts` once a second file needed it. The literal is
 * typed against the interface and not cast, so a method the port adds is a compile error
 * here once. Override what the test cares about:
 *
 *     const provider = fakeSportDataProvider({
 *       providerId: 'mock-golf',
 *       getEventDetails: jest.fn().mockResolvedValue(null),
 *     });
 *
 * To hand one to a service that takes a `ProviderRegistry`, use `registryWith(provider)`
 * below rather than casting a literal `{ getProviderById }`.
 */
export function fakeSportDataProvider(overrides: Partial<SportDataProvider> = {}): SportDataProvider {
  return {
    providerId: 'mock-provider',
    providerName: 'Mock Provider',
    sportsCovered: [Sport.GOLF],
    getUpcomingEvents: jest.fn().mockResolvedValue([]),
    getEventDetails: jest.fn().mockResolvedValue(null),
    getParticipants: jest.fn().mockResolvedValue([]),
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

/**
 * A real `ProviderRegistry` with `provider` registered as PRIMARY for each sport it covers
 * (or an empty one for `null`), so `getProvider` / `getProviderById` are the real lookups
 * rather than stubs that agree with whatever the test assumed.
 */
export function registryWith(provider: SportDataProvider | null): ProviderRegistry {
  const registry = new ProviderRegistry();
  if (!provider) return registry;
  for (const sport of provider.sportsCovered) {
    registry.register(sport, provider, 'PRIMARY');
  }
  return registry;
}
