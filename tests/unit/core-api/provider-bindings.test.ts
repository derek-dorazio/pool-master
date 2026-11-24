import { Sport } from '../../../packages/shared/domain';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import {
  loadProviderBindingsFromEnv,
  registerConfiguredProviders,
  type ProviderRows,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-bindings';
import type { ProviderSettings } from '../../../packages/shared/domain';
import { providerByCode } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeLogger } from '../../support/fake-logger';

/** A local run. `NODE_ENV` is what a bundler or Jest might set; it must not matter. */
const LOCAL = { POOLMASTER_ENVIRONMENT: 'development' } as const;

function rowsOf(providers: readonly ProviderSettings[]): ProviderRows {
  return {
    all: () => providers,
    byCode: (code) => providerByCode(providers, code),
    enabledLeagues: (code) => providerByCode(providers, code)?.leagues.filter((league) => league.isEnabled) ?? [],
  };
}

/** No Provider rows: only the environment-bound mock can register. */
const NO_ROWS = rowsOf([]);

describe('provider bindings', () => {
  it('loads provider binding configuration from environment variables', () => {
    const config = loadProviderBindingsFromEnv({
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'mock-contest-feed': {
            baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105',
          },
        },
      }),
    });

    expect(config.defaultProviderId).toBe('mock-contest-feed');
    expect(config.providers['mock-contest-feed']?.baseUrl).toBe(
      'http://mock-contest-feed-provider.qa.poolmaster.internal:3105',
    );
  });

  it('registers the mock provider as the primary golf provider when selected', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, NO_ROWS, {
      ...LOCAL,
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'mock-contest-feed': {
            baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105',
          },
        },
      }),
    });

    expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('mock-contest-feed');
  });

  it('pool-master-rop.5: rejects mock providers in production-like runtimes without an explicit override', () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, NO_ROWS, {
        NODE_ENV: 'production',
        POOLMASTER_ENVIRONMENT: 'prod',
        SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
          providers: {
            'mock-contest-feed': {
              baseUrl: 'http://mock-contest-feed-provider.prod.poolmaster.internal:3105',
            },
          },
        }),
      }),
    ).toThrow('Mock sport data provider "mock-contest-feed" is not allowed in this runtime.');
  });

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

  it('pool-master-rop.5: requires a reason for restricted-runtime mock provider overrides', () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, NO_ROWS, {
        NODE_ENV: 'production',
        POOLMASTER_ENVIRONMENT: 'prod',
        SPORT_DATA_ALLOW_MOCK_PROVIDER_IN_STRICT_RUNTIME: 'true',
        SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON: ' test ',
        SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
          providers: {
            'mock-contest-feed': {
              baseUrl: 'http://mock-contest-feed-provider.prod.poolmaster.internal:3105',
            },
          },
        }),
      }),
    ).toThrow('Mock sport data provider override requires SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON.');
  });

  it('pool-master-rop.5: allows mock providers in QA and only allows restricted-runtime override when explicit', () => {
    const qaRegistry = new ProviderRegistry();
    const productionOverrideRegistry = new ProviderRegistry();

    registerConfiguredProviders(qaRegistry, NO_ROWS, {
      NODE_ENV: 'production',
      POOLMASTER_ENVIRONMENT: 'qa',
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'mock-contest-feed': {
            baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105',
          },
        },
      }),
    });

    registerConfiguredProviders(productionOverrideRegistry, NO_ROWS, {
      NODE_ENV: 'production',
      POOLMASTER_ENVIRONMENT: 'prod',
      SPORT_DATA_ALLOW_MOCK_PROVIDER_IN_STRICT_RUNTIME: 'true',
      SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON: 'emergency provider outage drill',
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'mock-contest-feed': {
            baseUrl: 'http://mock-contest-feed-provider.prod.poolmaster.internal:3105',
          },
        },
      }),
    });

    expect(qaRegistry.getProvider(Sport.GOLF)?.providerId).toBe('mock-contest-feed');
    expect(productionOverrideRegistry.getProvider(Sport.GOLF)?.providerId).toBe('mock-contest-feed');
  });

  it('rejects the mock provider in prod with the exact values Terraform sets (NODE_ENV=production, POOLMASTER_ENVIRONMENT=prod)', () => {
    expect(() =>
      registerConfiguredProviders(new ProviderRegistry(), NO_ROWS, {
        NODE_ENV: 'production',
        POOLMASTER_ENVIRONMENT: 'prod',
        SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
          providers: { 'mock-contest-feed': { baseUrl: 'http://mock.prod.internal:3105' } },
        }),
      }),
    ).toThrow('Mock sport data provider "mock-contest-feed" is not allowed in this runtime.');
  });

  it('ignores the retired ENVIRONMENT variable, so setting it cannot change provider selection', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, NO_ROWS, {
      ENVIRONMENT: 'prod',
      POOLMASTER_ENVIRONMENT: 'development',
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: { 'mock-contest-feed': { baseUrl: 'http://localhost:3105' } },
      }),
    });

    expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('mock-contest-feed');
  });

  it('pool-master-rop.68.1.1: rejects stale Golf provider adapter IDs instead of registering removed providers', () => {
    const registry = new ProviderRegistry();
    const oddsRegistry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, NO_ROWS, {
        ...LOCAL,
        SPORT_DATA_DEFAULT_PROVIDER: 'pga-tour',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
          providers: {
            'pga-tour': {},
          },
        }),
      }),
    ).toThrow('Unsupported sport data provider "pga-tour" configured for this service runtime.');

    expect(() =>
      registerConfiguredProviders(oddsRegistry, NO_ROWS, {
        ...LOCAL,
        SPORT_DATA_DEFAULT_PROVIDER: 'the-odds-api',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
          providers: {
            'the-odds-api': {},
          },
        }),
      }),
    ).toThrow('Unsupported sport data provider "the-odds-api" configured for this service runtime.');

    // pool-master-w3x: the speculative espn/openf1 adapters were never configured,
    // tested, or backed by a real subscription — removed as dead code. Their
    // provider ids must now be rejected like any other unregistered adapter.
    for (const removedProviderId of ['espn', 'openf1']) {
      expect(() =>
        registerConfiguredProviders(new ProviderRegistry(), NO_ROWS, {
          ...LOCAL,
          SPORT_DATA_DEFAULT_PROVIDER: removedProviderId,
          SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
            providers: {
              [removedProviderId]: {},
            },
          }),
        }),
      ).toThrow(`Unsupported sport data provider "${removedProviderId}" configured for this service runtime.`);
    }
  });

  it('does not silently register hidden providers when the environment is unconfigured', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, NO_ROWS, { ...LOCAL });

    expect(registry.getSupportedSports()).toEqual([]);
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
  it('fails startup with a clear message when the bindings JSON cannot be parsed', () => {
    expect(() => loadProviderBindingsFromEnv({
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: '{ not json',
    })).toThrow(/^Invalid SPORT_DATA_PROVIDER_BINDINGS_JSON: /);
  });

  it('reads bindings with no providers key as no providers bound', () => {
    expect(loadProviderBindingsFromEnv({
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: '{}',
    }).providers).toEqual({});
  });

  it('fails startup when the default provider has no binding, rather than running without one', () => {
    const registry = new ProviderRegistry();

    expect(() => registerConfiguredProviders(registry, NO_ROWS, {
      ...LOCAL,
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({ providers: {} }),
    })).toThrow('Configured default provider "mock-contest-feed" is missing from SPORT_DATA_PROVIDER_BINDINGS_JSON.');
    expect(registry.getAllProviders()).toEqual([]);
  });

  it('fails startup when the mock provider is bound without a baseUrl', () => {
    const registry = new ProviderRegistry();

    expect(() => registerConfiguredProviders(registry, NO_ROWS, {
      ...LOCAL,
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({ providers: { 'mock-contest-feed': {} } }),
    })).toThrow('Provider "mock-contest-feed" requires a baseUrl binding.');
    expect(registry.getAllProviders()).toEqual([]);
  });

  describe('the Provider rows', () => {
    const MOCK_BINDINGS = JSON.stringify({ providers: { 'mock-contest-feed': { baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105' } } });

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

    it('registers the bound mock first when it is the environment\'s default, with the BALLDONTLIE row as a secondary for golf', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, rowsOf([balldontlieTestProvider()]), {
        ...LOCAL,
        SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: MOCK_BINDINGS,
        BALLDONTLIE_API_KEY: 'a-key',
      });

      expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('mock-contest-feed');
      expect(registry.getProvidersForSport(Sport.GOLF).map((provider) => provider.providerId).sort()).toEqual(['balldontlie', 'mock-contest-feed']);
    });

    it('registers the row first and the bound mock after it when the mock is not the default', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, rowsOf([balldontlieTestProvider()]), {
        ...LOCAL,
        SPORT_DATA_PROVIDER_BINDINGS_JSON: MOCK_BINDINGS,
        BALLDONTLIE_API_KEY: 'a-key',
      });

      expect(registry.getProvider(Sport.GOLF)?.providerId).toBe('balldontlie');
      expect(registry.getProviderById('mock-contest-feed')?.providerId).toBe('mock-contest-feed');
    });

    it('ignores a BALLDONTLIE entry left in the environment\'s bindings, since its settings now live in its row', () => {
      const registry = new ProviderRegistry();

      registerConfiguredProviders(registry, NO_ROWS, {
        ...LOCAL,
        SPORT_DATA_DEFAULT_PROVIDER: 'balldontlie',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({ providers: { balldontlie: { baseUrl: 'https://api.balldontlie.io' } } }),
      });

      expect(registry.getAllProviders()).toEqual([]);
    });
  });

  it('fails startup and registers nothing, not even the default, when another bound provider is unsupported', () => {
    const registry = new ProviderRegistry();

    expect(() => registerConfiguredProviders(registry, NO_ROWS, {
      ...LOCAL,
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'mock-contest-feed': { baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105' },
          'retired-feed': { baseUrl: 'https://retired.example.test' },
        },
      }),
    })).toThrow('Unsupported sport data provider "retired-feed" configured for this service runtime.');
    expect(registry.getAllProviders()).toEqual([]);
  });
});
