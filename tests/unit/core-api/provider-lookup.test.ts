import { ProviderCode } from '@poolmaster/shared/domain';
import { NO_PROVIDERS, providerLookupOf } from '../../../packages/core-api/src/modules/ingestion/provider-lookup';
import { ProviderSettingsStore } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { BALLDONTLIE_TEST_LEAGUES, balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';

// What a sport league's event sync asks of the providers (#1997): a provider league with its
// provider from the rows, and the running provider from the registry.

describe('providerLookupOf', () => {
  it('finds a provider league with its provider from the rows, and nothing for an id no row has', async () => {
    const store = new ProviderSettingsStore({ findAll: () => Promise.resolve([balldontlieTestProvider()]) });
    await store.load();
    const lookup = providerLookupOf(store, registryWith(null));
    const nfl = BALLDONTLIE_TEST_LEAGUES.find((league) => league.code === 'nfl');

    expect(lookup.findLeague(nfl?.id ?? '')).toMatchObject({ provider: { code: 'BALLDONTLIE' }, league: { code: 'nfl' } });
    expect(lookup.findLeague('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('says a league is read when its Provider is running here and its adapter reads that league, and not otherwise', () => {
    const running = fakeSportDataProvider({ providerId: 'balldontlie', providerName: 'BALLDONTLIE', servesLeague: (code) => code === 'nfl' });
    const lookup = providerLookupOf({ findLeague: () => undefined }, registryWith(running));
    const nothingRunning = providerLookupOf({ findLeague: () => undefined }, registryWith(null));

    expect(lookup.readsLeague(ProviderCode.BALLDONTLIE, 'nfl')).toBe(true);
    expect(lookup.readsLeague(ProviderCode.BALLDONTLIE, 'lpga')).toBe(false);
    expect(nothingRunning.readsLeague(ProviderCode.BALLDONTLIE, 'nfl')).toBe(false);
  });
});

describe('NO_PROVIDERS', () => {
  it('finds no provider league and no running provider, so turning a league\'s sync on is refused', () => {
    expect(NO_PROVIDERS.findLeague('any')).toBeUndefined();
    expect(NO_PROVIDERS.readsLeague(ProviderCode.BALLDONTLIE, 'nfl')).toBe(false);
  });
});
