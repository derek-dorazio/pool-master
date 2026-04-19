import { Sport } from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './provider-registry';
import { EspnAdapter, MockContestFeedAdapter, OpenF1Adapter, PgaTourAdapter } from '../adapters';

export interface ProviderBinding {
  readonly baseUrl: string;
}

export interface ProviderBindingsConfig {
  readonly defaultProviderId?: string;
  readonly providers: Record<string, ProviderBinding>;
}

interface ProviderBindingsEnvelope {
  readonly providers?: Record<string, ProviderBinding>;
}

export function loadProviderBindingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProviderBindingsConfig {
  const defaultProviderId = env.SPORT_DATA_DEFAULT_PROVIDER?.trim() || undefined;
  const rawBindings = env.SPORT_DATA_PROVIDER_BINDINGS_JSON?.trim();

  if (!rawBindings) {
    return { defaultProviderId, providers: {} };
  }

  let parsed: ProviderBindingsEnvelope;
  try {
    parsed = JSON.parse(rawBindings) as ProviderBindingsEnvelope;
  } catch (error) {
    throw new Error(
      `Invalid SPORT_DATA_PROVIDER_BINDINGS_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    defaultProviderId,
    providers: parsed.providers ?? {},
  };
}

export function registerConfiguredProviders(
  registry: ProviderRegistry,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const bindings = loadProviderBindingsFromEnv(env);
  const mockBinding = bindings.providers['mock-contest-feed'];
  const useMockAsPrimary = bindings.defaultProviderId === 'mock-contest-feed' && mockBinding;
  const mockProvider = mockBinding ? new MockContestFeedAdapter(mockBinding.baseUrl) : null;

  if (useMockAsPrimary && mockProvider) {
    registry.register(Sport.GOLF, mockProvider, 'PRIMARY');
    registry.register(Sport.TENNIS, mockProvider, 'PRIMARY');
    registry.register(Sport.NCAA_BASKETBALL, mockProvider, 'PRIMARY');
  } else {
    registry.register(Sport.GOLF, new PgaTourAdapter(), 'PRIMARY');
    registry.register(Sport.TENNIS, new EspnAdapter(), 'PRIMARY');
    registry.register(Sport.NCAA_BASKETBALL, new EspnAdapter(), 'PRIMARY');
  }

  registry.register(Sport.F1, new OpenF1Adapter(), 'PRIMARY');
  registry.register(Sport.NFL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NBA, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.MLB, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NHL, new EspnAdapter(), 'PRIMARY');
}
