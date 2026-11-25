/**
 * The sport data providers this task runs (#1997). Each enabled Provider row builds its adapter,
 * with its base URL and rate read from the row on every request and its enabled leagues read at
 * startup; its API key comes from Secrets Manager through the task definition. A sport league
 * syncs from the provider its selected mapping names (#2073), so no provider serves a sport ahead
 * of another. Nothing about which providers run is read from the environment (#2039).
 */
import type { FastifyBaseLogger } from 'fastify';
import { ProviderCode, type ProviderLeagueSettings, type ProviderSettings } from '@poolmaster/shared/domain';
import type { SportDataProvider } from './provider-interface';
import type { ProviderRegistry } from './provider-registry';
import { BalldontlieAdapter } from '../adapters';
import { isDeployedEnvironment, readAppEnv } from '../../../core/config';
import { readBackgroundJobMaxTasks } from '../../background-jobs/background-job-runner';
import type { ProviderRateLimitObserver } from './provider-call-policy';

/** The Provider rows as the adapters read them: a row by code, and its enabled leagues. */
export interface ProviderRows {
  all(): readonly ProviderSettings[];
  byCode(code: ProviderCode): ProviderSettings | undefined;
  enabledLeagues(code: ProviderCode): ProviderLeagueSettings[];
}

/**
 * Builds the providers a task runs from the Provider rows. The app takes it as a
 * dependency, so a functional or integration test registers its own fake provider from test code.
 */
export type SportDataProviderFactory = (rows: ProviderRows, env: NodeJS.ProcessEnv, logger?: FastifyBaseLogger, rateLimits?: ProviderRateLimitObservers) => SportDataProvider[];

/** Each Provider's observer of how its calls end, for its rate-limit finding (league model 1c). */
export type ProviderRateLimitObservers = (code: ProviderCode) => ProviderRateLimitObserver;

type RowFactory = (row: ProviderSettings, rows: ProviderRows, env: NodeJS.ProcessEnv, logger?: FastifyBaseLogger, rateLimits?: ProviderRateLimitObservers) => SportDataProvider | null;

/** Each Provider code's adapter. One whose secret is not set here is not built, and says so. */
const rowFactories: Readonly<Record<ProviderCode, RowFactory>> = {
  [ProviderCode.BALLDONTLIE]: (row, rows, env, logger, rateLimits) => {
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
      ...(rateLimits && { rateLimits: rateLimits(row.code) }),
      ...(logger && { logger }),
    });
  },
};

/** The enabled Provider rows' adapters; a row whose secret is not set is left out. */
export const buildProvidersFromRows: SportDataProviderFactory = (rows, env, logger, rateLimits) => rows.all()
  .filter((row) => row.isEnabled)
  .flatMap((row) => rowFactories[row.code](row, rows, env, logger, rateLimits) ?? []);

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
    },
    message,
  );
  throw new Error(message);
}

export function registerConfiguredProviders(
  registry: ProviderRegistry,
  rows: ProviderRows,
  env: NodeJS.ProcessEnv = process.env,
  logger?: FastifyBaseLogger,
  buildProviders: SportDataProviderFactory = buildProvidersFromRows,
  rateLimits?: ProviderRateLimitObservers,
): void {
  // Every provider is built before any is registered.
  const providers = buildProviders(rows, env, logger, rateLimits);

  if (providers.length === 0) {
    requireDefaultProviderConfigured(env, logger);
    logger?.error(
      { action: 'ingestion.providers.unconfigured' },
      'No sport data provider is configured. Ingestion will remain disabled until a provider is enabled with its key set.',
    );
    return;
  }

  // Each is registered by its Provider code; a league reaches it through its selected mapping (#2073).
  for (const provider of providers) {
    registry.register(provider);
    logger?.info(
      { action: 'ingestion.providers.registered', providerId: provider.providerId, providerCode: provider.providerCode },
      'Registered configured sport data provider.',
    );
  }
}
