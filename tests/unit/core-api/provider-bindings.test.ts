import { ProviderCode } from '../../../packages/shared/domain';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import {
  buildProvidersFromRows,
  registerConfiguredProviders,
  type ProviderRows,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-bindings';
import type { ProviderSettings } from '../../../packages/shared/domain';
import { providerByCode } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeLogger } from '../../support/fake-logger';
import { fakeSportDataProvider } from '../../support/fake-sport-data-provider';

/** A local run. `NODE_ENV` is what a bundler or Jest might set; it must not matter. */
const LOCAL = { POOLMASTER_ENVIRONMENT: 'development' } as const;

function rowsOf(providers: readonly ProviderSettings[]): ProviderRows {
  return {
    all: () => providers,
    byCode: (code) => providerByCode(providers, code),
    enabledLeagues: (code) => providerByCode(providers, code)?.leagues.filter((league) => league.isEnabled) ?? [],
  };
}

const NO_ROWS = rowsOf([]);

describe('provider bindings', () => {
  it('pool-master-rop.5: rejects missing default providers in deployed runtimes', () => {
    const registry = new ProviderRegistry();
    const qaRegistry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, NO_ROWS, {
        NODE_ENV: 'production',
        POOLMASTER_ENVIRONMENT: 'prod',
      }),
    ).toThrow('No sport data provider is configured for this runtime.');

    expect(() =>
      registerConfiguredProviders(qaRegistry, NO_ROWS, {
        NODE_ENV: 'production',
        POOLMASTER_ENVIRONMENT: 'qa',
      }),
    ).toThrow('No sport data provider is configured for this runtime.');
  });

  it('does not silently register hidden providers when the environment is unconfigured', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, NO_ROWS, { ...LOCAL });

    expect(registry.all()).toEqual([]);
  });

  it('reads no provider from the retired SPORT_DATA_DEFAULT_PROVIDER and SPORT_DATA_PROVIDER_BINDINGS_JSON, so the old QA mock binding registers nothing', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, NO_ROWS, {
      ...LOCAL,
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: { 'mock-contest-feed': { baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105' } },
      }),
    });

    expect(registry.all()).toEqual([]);
  });

  describe('the Provider rows', () => {
    it('registers an enabled BALLDONTLIE row by its Provider code, reading its enabled leagues, with the key from the environment', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, rowsOf([balldontlieTestProvider()]), { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' });

      const provider = registry.byCode(ProviderCode.BALLDONTLIE);
      expect(provider?.providerId).toBe('balldontlie');
      expect(provider?.servesLeague('pga')).toBe(true);
      expect(provider?.servesLeague('mlb')).toBe(true);
    });

    it('registers nothing for a row that is switched off', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, rowsOf([balldontlieTestProvider({ isEnabled: false })]), { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' });

      expect(registry.all()).toEqual([]);
    });

    it('skips an enabled row whose key is missing or blank and logs why, rather than calling the vendor unauthenticated', () => {
      const logger = fakeLogger();
      const missing = new ProviderRegistry();
      const blank = new ProviderRegistry();

      registerConfiguredProviders(missing, rowsOf([balldontlieTestProvider()]), LOCAL, logger);
      registerConfiguredProviders(blank, rowsOf([balldontlieTestProvider()]), { ...LOCAL, BALLDONTLIE_API_KEY: '  ' }, logger);

      expect(missing.all()).toEqual([]);
      expect(blank.all()).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.providers.apiKeyMissing', providerCode: 'BALLDONTLIE' }), expect.any(String));
    });

    it('fails a deployed startup when its only row is skipped for a missing key, as with nothing configured', () => {
      expect(() => registerConfiguredProviders(new ProviderRegistry(), rowsOf([balldontlieTestProvider()]), { NODE_ENV: 'production', POOLMASTER_ENVIRONMENT: 'qa' }))
        .toThrow('No sport data provider is configured for this runtime.');
    });

    it('builds an adapter for each enabled row', () => {
      const rows = rowsOf([balldontlieTestProvider()]);

      const providers = buildProvidersFromRows(rows, { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' });

      expect(providers.map((provider) => provider.providerId)).toEqual(['balldontlie']);
    });

    it('hands each built adapter its Provider\'s rate-limit observer, so a rate-limiting Provider raises its finding', () => {
      const observer = { refused: jest.fn(), answered: jest.fn() };
      const rateLimits = jest.fn(() => observer);

      registerConfiguredProviders(new ProviderRegistry(), rowsOf([balldontlieTestProvider()]), { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' }, undefined, buildProvidersFromRows, rateLimits);

      expect(rateLimits).toHaveBeenCalledWith('BALLDONTLIE');
    });
  });

  describe('an injected provider factory', () => {
    it('registers each provider it builds by its own Provider code, none ahead of another', () => {
      const registry = new ProviderRegistry();
      const first = fakeSportDataProvider({ providerId: 'feed-a' });
      const second = fakeSportDataProvider({ providerId: 'feed-b', providerCode: 'OTHER_FEED' as ProviderCode });

      registerConfiguredProviders(registry, NO_ROWS, LOCAL, undefined, () => [first, second]);

      expect(registry.byCode(ProviderCode.BALLDONTLIE)).toBe(first);
      expect(registry.byCode('OTHER_FEED' as ProviderCode)).toBe(second);
      expect(registry.all()).toEqual([first, second]);
    });

    it('is handed the Provider rows and environment, so a factory can add its fake beside the rows\' adapters', () => {
      const registry = new ProviderRegistry();
      const rows = rowsOf([balldontlieTestProvider()]);
      const env = { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' };
      const fake = fakeSportDataProvider({ providerId: 'feed-a', providerCode: 'OTHER_FEED' as ProviderCode });

      registerConfiguredProviders(registry, rows, env, undefined, (givenRows, givenEnv, logger) => [fake, ...buildProvidersFromRows(givenRows, givenEnv, logger)]);

      expect(registry.byCode('OTHER_FEED' as ProviderCode)).toBe(fake);
      expect(registry.byCode(ProviderCode.BALLDONTLIE)?.providerId).toBe('balldontlie');
    });

    it('fails a deployed startup when it builds no provider, as with nothing configured', () => {
      expect(() => registerConfiguredProviders(new ProviderRegistry(), NO_ROWS, { NODE_ENV: 'production', POOLMASTER_ENVIRONMENT: 'prod' }, undefined, () => []))
        .toThrow('No sport data provider is configured for this runtime.');
    });
  });
});
