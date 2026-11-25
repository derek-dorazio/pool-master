import { ProviderCode } from '@poolmaster/shared/domain';
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
 * below rather than casting a literal registry.
 */
export function fakeSportDataProvider(overrides: Partial<SportDataProvider> = {}): SportDataProvider {
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

/**
 * A real `ProviderRegistry` with these providers registered by their Provider codes (or an empty
 * one for `null`), so `byCode` / `bySourceId` / `forLeague` are the real lookups rather than stubs
 * that agree with whatever the test assumed.
 */
export function registryWith(...providers: Array<SportDataProvider | null>): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const provider of providers) {
    if (provider) registry.register(provider);
  }
  return registry;
}
