import { Sport } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import { MockContestFeedAdapter } from '../adapters';

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

function isStrictRuntimeEnvironment(env: NodeJS.ProcessEnv): boolean {
  const runtime = (env.ENVIRONMENT ?? env.NODE_ENV ?? '').trim().toLowerCase();
  return runtime === 'qa' || runtime === 'staging' || runtime === 'prod' || runtime === 'production';
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
    logger?.error(
      {
        action: 'ingestion.providers.unconfigured',
        strictRuntime: isStrictRuntimeEnvironment(env),
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

  if (bindings.defaultProviderId !== 'mock-contest-feed') {
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

  const provider = new MockContestFeedAdapter(binding.baseUrl);
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
