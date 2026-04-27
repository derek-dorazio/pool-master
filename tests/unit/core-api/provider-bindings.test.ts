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

  it('does not silently register hidden providers when the environment is unconfigured', () => {
    const registry = new ProviderRegistry();

    registerConfiguredProviders(registry, {});

    expect(registry.getSupportedSports()).toEqual([]);
  });
});
