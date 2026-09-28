import { isLocalRuntimeMode, poolMasterConfig } from '@/lib/config';
import { getEmbeddedVersionInfo } from '@/lib/version-info';
import { consoleSink } from './console-sink';
import { createNetworkSink } from './network-sink';
import { createLogger, resolveConfiguredLogLevel } from './logger';

function getEmbeddedWebappVersion() {
  try {
    return getEmbeddedVersionInfo().webapp.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Resolved on every log call, so it holds only what is cheap and always true.
 *
 * It used to read the authenticated user out of the React Query cache to stamp `userId`. That
 * field was never transmitted — #206 moved user identity to the JWT the ingest route reads — so
 * the read existed to populate something only the console sink displayed, and it coupled the
 * logger to the auth feature and the query client.
 */
function getLoggerContext() {
  return {
    route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    webappVersion: getEmbeddedWebappVersion(),
  };
}

export const logger = createLogger({
  sinks: isLocalRuntimeMode(poolMasterConfig.mode)
    ? [consoleSink]
    : [consoleSink, createNetworkSink()],
  minLevel: resolveConfiguredLogLevel(poolMasterConfig.logLevel, poolMasterConfig.mode),
  getContext: getLoggerContext,
});

export function getLogger() {
  return logger;
}

export * from './types';
export * from './client-trace-id';
export * from './console-sink';
export * from './network-sink';
export * from './logger';
export * from './redact';
