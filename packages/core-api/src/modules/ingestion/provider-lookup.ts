/**
 * The providers as a sport league's event sync needs them (#1997): its provider leagues from the
 * Provider rows, and which providers are running in this task, and read which leagues, from the
 * registry (by Provider code, #2073).
 */
import type { SportDataProviderLookup } from '../sport-catalog/sport-league-service';
import type { ProviderRegistry } from './core/provider-registry';
import type { ProviderSettingsStore } from './provider-settings-store';

export function providerLookupOf(
  store: Pick<ProviderSettingsStore, 'findLeague'>,
  registry: Pick<ProviderRegistry, 'byCode'>,
): SportDataProviderLookup {
  return {
    findLeague: (providerLeagueId) => store.findLeague(providerLeagueId),
    readsLeague: (providerCode, providerLeagueCode) => registry.byCode(providerCode)?.servesLeague(providerLeagueCode) ?? false,
  };
}

/** No provider at all: turning a sport league's sync on is refused. */
export const NO_PROVIDERS: SportDataProviderLookup = {
  findLeague: () => undefined,
  readsLeague: () => false,
};
