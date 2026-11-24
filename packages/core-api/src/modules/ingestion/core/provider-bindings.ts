/**
 * The sport data providers this task runs (#1997). Each enabled Provider row builds its adapter,
 * with its base URL and rate read from the row on every request and its enabled leagues read at
 * startup; its API key comes from Secrets Manager through the task definition. Lower priority
 * serves a sport first.
 *
 * The QA mock feed has no row: until it is removed (#2039) it is still bound by
 * SPORT_DATA_DEFAULT_PROVIDER and SPORT_DATA_PROVIDER_BINDINGS_JSON, and serves first when it is
 * the environment's default. A BALLDONTLIE entry in those variables is no longer read.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ProviderCode, providerSourceIdOf, type ProviderLeagueSettings, type ProviderSettings } from '@poolmaster/shared/domain';
import type { SportDataProvider } from './provider-interface';
import type { ProviderRegistry } from './provider-registry';
import { BalldontlieAdapter, MockContestFeedAdapter } from '../adapters';
import { AppEnvironment, isDeployedEnvironment, readAppEnv } from '../../../core/config';
import { errorMessage } from '../../../core/error-message';
import { readBackgroundJobMaxTasks } from '../../background-jobs/background-job-runner';

const MOCK_PROVIDER_ID = 'mock-contest-feed';

export interface ProviderBinding {
  readonly baseUrl?: string;
}

export interface ProviderBindingsConfig {
  readonly defaultProviderId?: string;
  // Partial: the default provider id comes from a separate env var, so a lookup can miss.
  readonly providers: Partial<Record<string, ProviderBinding>>;
}

interface ProviderBindingsEnvelope {
  readonly providers?: Record<string, ProviderBinding>;
}

/** The Provider rows as the adapters read them: a row by code, and its enabled leagues. */
export interface ProviderRows {
  all(): readonly ProviderSettings[];
  byCode(code: ProviderCode): ProviderSettings | undefined;
  enabledLeagues(code: ProviderCode): ProviderLeagueSettings[];
}

type RowFactory = (row: ProviderSettings, rows: ProviderRows, env: NodeJS.ProcessEnv, logger?: FastifyBaseLogger) => SportDataProvider | null;

/** Each Provider code's adapter. One whose secret is not set here is not built, and says so. */
const rowFactories: Readonly<Record<ProviderCode, RowFactory>> = {
  [ProviderCode.BALLDONTLIE]: (row, rows, env, logger) => {
    const apiKey = env['BALLDONTLIE_API_KEY']?.trim();
    if (!apiKey) {
      logger?.error(
        { action: 'ingestion.providers.apiKeyMissing', providerCode: row.code },
        'BALLDONTLIE is enabled but BALLDONTLIE_API_KEY is not set, so it does not run here',
      );
      return null;
    }
    return new BalldontlieAdapter({
      // The row as last read, so a Providers page edit reaches the next request.
      connection: () => {
        const current = rows.byCode(row.code) ?? row;
        return { baseUrl: current.baseUrl, requestsPerMinute: current.requestsPerMinute };
      },
      apiKey,
      leagues: rows.enabledLeagues(row.code),
      maxTasks: readBackgroundJobMaxTasks(env),
      ...(logger && { logger }),
    });
  },
};

/** Staging and prod refuse the mock provider unless an override says why. */
function isMockRestrictedRuntimeEnvironment(env: NodeJS.ProcessEnv): boolean {
  const environment = readAppEnv(env);
  return environment === AppEnvironment.STAGING || environment === AppEnvironment.PROD;
}

function requireDefaultProviderConfigured(
  env: NodeJS.ProcessEnv,
  logger?: FastifyBaseLogger,
): void {
  if (!isDeployedEnvironment(readAppEnv(env))) {
    return;
  }

  const message = 'No sport data provider is configured for this runtime.';
  logger?.error(
    {
      action: 'ingestion.providers.unconfigured',
      environment: readAppEnv(env),
      strictRuntime: true,
    },
    message,
  );
  throw new Error(message);
}

function isMockProviderOverrideEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SPORT_DATA_ALLOW_MOCK_PROVIDER_IN_STRICT_RUNTIME === 'true';
}

function getMockProviderOverrideReason(env: NodeJS.ProcessEnv): string | undefined {
  const reason = env.SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON?.trim();
  return reason && reason.length >= 12 ? reason : undefined;
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
    const reason = getMockProviderOverrideReason(env);
    if (!reason) {
      throw new Error('Mock sport data provider override requires SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON.');
    }

    logger?.error(
      {
        action: 'ingestion.providers.mockProviderOverride',
        environment: readAppEnv(env),
        providerId,
        reason,
      },
      'Mock sport data provider override enabled in restricted runtime.',
    );
    return;
  }

  const message = `Mock sport data provider "${providerId}" is not allowed in this runtime.`;
  logger?.error(
    {
      action: 'ingestion.providers.mockProviderRejected',
      environment: readAppEnv(env),
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
        errorMessage(error)
      }`,
      { cause: error },
    );
  }

  return {
    defaultProviderId,
    providers: parsed.providers ?? {},
  };
}

export function registerConfiguredProviders(
  registry: ProviderRegistry,
  rows: ProviderRows,
  env: NodeJS.ProcessEnv = process.env,
  logger?: FastifyBaseLogger,
): void {
  const bindings = loadProviderBindingsFromEnv(env);
  // Every provider is built before any is registered, so one bad binding registers none.
  const mock = buildBoundMock(bindings, env, logger);
  const fromRows = [...rows.all()]
    .filter((row) => row.isEnabled)
    .sort((a, b) => a.priority - b.priority)
    .flatMap((row) => rowFactories[row.code](row, rows, env, logger) ?? []);
  const mockFirst = mock !== null && bindings.defaultProviderId === MOCK_PROVIDER_ID;
  const ordered = mockFirst ? [mock, ...fromRows] : [...fromRows, ...(mock === null ? [] : [mock])];

  if (ordered.length === 0) {
    requireDefaultProviderConfigured(env, logger);
    logger?.error(
      { action: 'ingestion.providers.unconfigured', strictRuntime: isMockRestrictedRuntimeEnvironment(env) },
      'No sport data provider is configured. Ingestion will remain disabled until a provider is enabled with its key set.',
    );
    return;
  }

  // The first provider covering a sport serves it as PRIMARY; the rest serve the events linked to them (#1495).
  const served = new Set<string>();
  for (const provider of ordered) {
    const priorities = provider.sportsCovered.map((sport) => {
      const priority = served.has(sport) ? 'SECONDARY' : 'PRIMARY';
      served.add(sport);
      registry.register(sport, provider, priority);
      return { sport, priority };
    });
    logger?.info(
      { action: 'ingestion.providers.registered', providerId: provider.providerId, priorities },
      'Registered configured sport data provider.',
    );
  }
}

/** The QA mock feed while the environment still binds it (#2039); null when it is not bound. */
function buildBoundMock(bindings: ProviderBindingsConfig, env: NodeJS.ProcessEnv, logger?: FastifyBaseLogger): SportDataProvider | null {
  for (const providerId of Object.keys(bindings.providers)) {
    if (providerId === MOCK_PROVIDER_ID || providerId === providerSourceIdOf(ProviderCode.BALLDONTLIE)) continue;
    const message = `Unsupported sport data provider "${providerId}" configured for this service runtime.`;
    logger?.error({ action: 'ingestion.providers.unsupported', providerId }, message);
    throw new Error(message);
  }
  const defaultId = bindings.defaultProviderId;
  if (defaultId !== undefined && defaultId !== MOCK_PROVIDER_ID && defaultId !== providerSourceIdOf(ProviderCode.BALLDONTLIE)) {
    const message = `Unsupported sport data provider "${defaultId}" configured for this service runtime.`;
    logger?.error({ action: 'ingestion.providers.unsupported', providerId: defaultId }, message);
    throw new Error(message);
  }
  const binding = bindings.providers[MOCK_PROVIDER_ID];
  if (binding === undefined) {
    if (defaultId === MOCK_PROVIDER_ID) {
      const message = `Configured default provider "${MOCK_PROVIDER_ID}" is missing from SPORT_DATA_PROVIDER_BINDINGS_JSON.`;
      logger?.error({ action: 'ingestion.providers.bindingMissing', providerId: MOCK_PROVIDER_ID }, message);
      throw new Error(message);
    }
    return null;
  }
  if (!binding.baseUrl) {
    throw new Error(`Provider "${MOCK_PROVIDER_ID}" requires a baseUrl binding.`);
  }
  requireMockProviderAllowed(MOCK_PROVIDER_ID, env, logger);
  return new MockContestFeedAdapter(binding.baseUrl);
}
