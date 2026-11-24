import { Sport } from '../../../packages/shared/domain';
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

    expect(registry.getSupportedSports()).toEqual([]);
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

    expect(registry.getAllProviders()).toEqual([]);
  });

  it('pool-master-cgb: refuses to register a provider claiming the reserved manual-admin providerId', () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registry.register(Sport.GOLF, {
        providerId: 'manual-admin',
        providerName: 'Should never register',
        sportsCovered: [Sport.GOLF],
      } as never, 'PRIMARY'),
    ).toThrow(/reserved manual-admin providerId/);
    expect(registry.getProvider(Sport.GOLF)).toBeNull();
  });

  describe('the Provider rows', () => {
    it('registers an enabled BALLDONTLIE row as the primary provider of every sport its leagues cover, with the key from the environment', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, rowsOf([balldontlieTestProvider()]), { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' });

      expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('balldontlie');
      expect(registry.getProvider(Sport.BASEBALL)?.providerId).toBe('balldontlie');
    });

    it('registers nothing for a row that is switched off', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, rowsOf([balldontlieTestProvider({ isEnabled: false })]), { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' });

      expect(registry.getAllProviders()).toEqual([]);
    });

    it('skips an enabled row whose key is missing or blank and logs why, rather than calling the vendor unauthenticated', () => {
      const logger = fakeLogger();
      const missing = new ProviderRegistry();
      const blank = new ProviderRegistry();

      registerConfiguredProviders(missing, rowsOf([balldontlieTestProvider()]), LOCAL, logger);
      registerConfiguredProviders(blank, rowsOf([balldontlieTestProvider()]), { ...LOCAL, BALLDONTLIE_API_KEY: '  ' }, logger);

      expect(missing.getAllProviders()).toEqual([]);
      expect(blank.getAllProviders()).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.providers.apiKeyMissing', providerCode: 'BALLDONTLIE' }), expect.any(String));
    });

    it('fails a deployed startup when its only row is skipped for a missing key, as with nothing configured', () => {
      expect(() => registerConfiguredProviders(new ProviderRegistry(), rowsOf([balldontlieTestProvider()]), { NODE_ENV: 'production', POOLMASTER_ENVIRONMENT: 'qa' }))
        .toThrow('No sport data provider is configured for this runtime.');
    });

    it('builds the enabled rows\' adapters lowest priority first', () => {
      const rows = rowsOf([balldontlieTestProvider({ priority: 2 })]);

      const providers = buildProvidersFromRows(rows, { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' });

      expect(providers.map((provider) => provider.providerId)).toEqual(['balldontlie']);
    });
  });

  describe('an injected provider factory', () => {
    it('registers the providers it builds in its order: the first covering a sport is its primary, the rest secondary', () => {
      const registry = new ProviderRegistry();
      const first = fakeSportDataProvider({ providerId: 'feed-a', sportsCovered: [Sport.GOLF] });
      const second = fakeSportDataProvider({ providerId: 'feed-b', sportsCovered: [Sport.GOLF, Sport.BASEBALL] });

      registerConfiguredProviders(registry, NO_ROWS, LOCAL, undefined, () => [first, second]);

      expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('feed-a');
      expect(registry.getProvider(Sport.BASEBALL)?.providerId).toBe('feed-b');
      expect(registry.getProvidersForSport(Sport.GOLF).map((provider) => provider.providerId).sort()).toEqual(['feed-a', 'feed-b']);
    });

    it('is handed the Provider rows and environment, so a factory can add its fake to the rows\' adapters', () => {
      const registry = new ProviderRegistry();
      const rows = rowsOf([balldontlieTestProvider()]);
      const env = { ...LOCAL, BALLDONTLIE_API_KEY: 'a-key' };
      const fake = fakeSportDataProvider({ providerId: 'feed-a', sportsCovered: [Sport.GOLF] });

      registerConfiguredProviders(registry, rows, env, undefined, (givenRows, givenEnv, logger) => [fake, ...buildProvidersFromRows(givenRows, givenEnv, logger)]);

      expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('feed-a');
      expect(registry.getProvider(Sport.BASEBALL)?.providerId).toBe('balldontlie');
    });

    it('fails a deployed startup when it builds no provider, as with nothing configured', () => {
      expect(() => registerConfiguredProviders(new ProviderRegistry(), NO_ROWS, { NODE_ENV: 'production', POOLMASTER_ENVIRONMENT: 'prod' }, undefined, () => []))
        .toThrow('No sport data provider is configured for this runtime.');
    });
  });
});
