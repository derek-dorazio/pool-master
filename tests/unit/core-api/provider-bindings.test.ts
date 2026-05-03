import { Sport } from '../../../packages/shared/domain';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import {
  loadProviderBindingsFromEnv,
  registerConfiguredProviders,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-bindings';

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

  it('registers the mock provider as primary for all provider-supported sports when selected', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, {
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
    expect(registry.getProvider(Sport.TENNIS)?.providerId).toBe('mock-contest-feed');
    expect(registry.getProvider(Sport.NCAA_BASKETBALL)?.providerId).toBe('mock-contest-feed');
    expect(registry.getProvider(Sport.NFL)).toBeNull();
  });

  it('pool-master-rop.5: registers configured real sport-data adapters instead of limiting registry to mock-contest-feed', () => {
    const pgaRegistry = new ProviderRegistry();
    const openF1Registry = new ProviderRegistry();
    const espnRegistry = new ProviderRegistry();

    registerConfiguredProviders(pgaRegistry, {
      SPORT_DATA_DEFAULT_PROVIDER: 'pga-tour',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'pga-tour': {},
        },
      }),
    });
    registerConfiguredProviders(openF1Registry, {
      SPORT_DATA_DEFAULT_PROVIDER: 'openf1',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          openf1: {},
        },
      }),
    });
    registerConfiguredProviders(espnRegistry, {
      SPORT_DATA_DEFAULT_PROVIDER: 'espn',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          espn: {},
        },
      }),
    });

    expect(pgaRegistry.getProvider(Sport.GOLF)?.providerId).toBe('pga-tour');
    expect(openF1Registry.getProvider(Sport.F1)?.providerId).toBe('openf1');
    expect(espnRegistry.getProvider(Sport.NFL)?.providerId).toBe('espn');
  });

  it('pool-master-rop.5: rejects mock providers in production-like runtimes without an explicit override', () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, {
        ENVIRONMENT: 'production',
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
      registerConfiguredProviders(registry, {
        ENVIRONMENT: 'production',
      }),
    ).toThrow('No sport data provider is configured for this runtime.');

    expect(() =>
      registerConfiguredProviders(qaRegistry, {
        ENVIRONMENT: 'qa',
      }),
    ).toThrow('No sport data provider is configured for this runtime.');
  });

  it('pool-master-rop.5: requires a reason for restricted-runtime mock provider overrides', () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, {
        ENVIRONMENT: 'production',
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

    registerConfiguredProviders(qaRegistry, {
      ENVIRONMENT: 'qa',
      SPORT_DATA_DEFAULT_PROVIDER: 'mock-contest-feed',
      SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
        providers: {
          'mock-contest-feed': {
            baseUrl: 'http://mock-contest-feed-provider.qa.poolmaster.internal:3105',
          },
        },
      }),
    });

    registerConfiguredProviders(productionOverrideRegistry, {
      ENVIRONMENT: 'production',
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

  it('pool-master-rop.5: rejects the odds adapter when its API key is not configured', () => {
    const registry = new ProviderRegistry();

    expect(() =>
      registerConfiguredProviders(registry, {
        SPORT_DATA_DEFAULT_PROVIDER: 'the-odds-api',
        SPORT_DATA_PROVIDER_BINDINGS_JSON: JSON.stringify({
          providers: {
            'the-odds-api': {},
          },
        }),
      }),
    ).toThrow('Provider "the-odds-api" requires ODDS_API_KEY.');
  });

  it('does not silently register hidden providers when the environment is unconfigured', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, {});

    expect(registry.getSupportedSports()).toEqual([]);
  });
});
