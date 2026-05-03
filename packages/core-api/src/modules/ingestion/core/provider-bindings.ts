import { Sport } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { SportDataProvider } from './provider-interface';
import type { ProviderRegistry } from './provider-registry';
import {
  EspnAdapter,
  MockContestFeedAdapter,
  OddsApiAdapter,
  OpenF1Adapter,
  PgaTourAdapter,
} from '../adapters';

export interface ProviderBinding {
  readonly baseUrl?: string;
}

export interface ProviderBindingsConfig {
  readonly defaultProviderId?: string;
  readonly providers: Record<string, ProviderBinding>;
}

interface ProviderBindingsEnvelope {
  readonly providers?: Record<string, ProviderBinding>;
}

type ProviderFactory = (binding: ProviderBinding, env: NodeJS.ProcessEnv) => SportDataProvider;

const providerFactories: Readonly<Record<string, ProviderFactory>> = {
  'mock-contest-feed': (binding) => {
    if (!binding.baseUrl) {
      throw new Error('Provider "mock-contest-feed" requires a baseUrl binding.');
    }
    return new MockContestFeedAdapter(binding.baseUrl);
  },
  espn: () => new EspnAdapter(),
  openf1: () => new OpenF1Adapter(),
  'pga-tour': () => new PgaTourAdapter(),
  'the-odds-api': (_binding, env) => {
    const apiKey = env.ODDS_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Provider "the-odds-api" requires ODDS_API_KEY.');
    }
    return new OddsApiAdapter(apiKey);
  },
};

function isMockRestrictedRuntimeEnvironment(env: NodeJS.ProcessEnv): boolean {
  const runtime = (env.ENVIRONMENT ?? env.NODE_ENV ?? '').trim().toLowerCase();
  return runtime === 'staging' || runtime === 'prod' || runtime === 'production';
}

function requireDefaultProviderConfigured(
  env: NodeJS.ProcessEnv,
  logger?: FastifyBaseLogger,
): void {
  if (!isMockRestrictedRuntimeEnvironment(env)) {
    return;
  }

  const message = 'No sport data provider is configured for this runtime.';
  logger?.error(
    {
      action: 'ingestion.providers.unconfigured',
      environment: env.ENVIRONMENT ?? env.NODE_ENV,
      strictRuntime: true,
    },
    message,
  );
  throw new Error(message);
}

function isMockProviderOverrideEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SPORT_DATA_ALLOW_MOCK_PROVIDER_IN_STRICT_RUNTIME === 'true';
}

function requireMockProviderAllowed(
  providerId: string,
  env: NodeJS.ProcessEnv,
  logger?: FastifyBaseLogger,
): void {
  if (providerId !== 'mock-contest-feed' || !isMockRestrictedRuntimeEnvironment(env)) {
    return;
  }

  if (isMockProviderOverrideEnabled(env)) {
    logger?.error(
      {
        action: 'ingestion.providers.mockProviderOverride',
        environment: env.ENVIRONMENT ?? env.NODE_ENV,
        providerId,
        reason: env.SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON ?? 'No reason supplied',
      },
      'Mock sport data provider override enabled in restricted runtime.',
    );
    return;
  }

  const message = `Mock sport data provider "${providerId}" is not allowed in this runtime.`;
  logger?.error(
    {
      action: 'ingestion.providers.mockProviderRejected',
      environment: env.ENVIRONMENT ?? env.NODE_ENV,
      providerId,
    },
    message,
  );
  throw new Error(message);
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
  logger?: FastifyBaseLogger,
): void {
  const bindings = loadProviderBindingsFromEnv(env);

  if (!bindings.defaultProviderId) {
    requireDefaultProviderConfigured(env, logger);
    logger?.error(
      {
        action: 'ingestion.providers.unconfigured',
        strictRuntime: isMockRestrictedRuntimeEnvironment(env),
      },
      'No sport data provider is configured. Ingestion will remain disabled until a provider binding is supplied.',
    );
    return;
  }

  const binding = bindings.providers[bindings.defaultProviderId];
  if (!binding) {
    const message = `Configured default provider "${bindings.defaultProviderId}" is missing from SPORT_DATA_PROVIDER_BINDINGS_JSON.`;
    logger?.error(
      {
        action: 'ingestion.providers.bindingMissing',
        providerId: bindings.defaultProviderId,
      },
      message,
    );
    throw new Error(message);
  }

  const providerFactory = providerFactories[bindings.defaultProviderId];
  if (!providerFactory) {
    const message = `Unsupported sport data provider "${bindings.defaultProviderId}" configured for this service runtime.`;
    logger?.error(
      {
        action: 'ingestion.providers.unsupported',
        providerId: bindings.defaultProviderId,
      },
      message,
    );
    throw new Error(message);
  }

  requireMockProviderAllowed(bindings.defaultProviderId, env, logger);

  const provider = providerFactory(binding, env);
  for (const sport of provider.sportsCovered) {
    registry.register(sport as Sport, provider, 'PRIMARY');
  }

  logger?.info(
    {
      action: 'ingestion.providers.registered',
      providerId: provider.providerId,
      sportsCovered: provider.sportsCovered,
    },
    'Registered configured sport data provider.',
  );
}
