import {
  AUTH_ME_QUERY_KEY,
  type AuthSessionData,
} from '@/features/auth/auth-session-cache';
import { queryClient } from '@/lib/query-client';
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

function getLoggerContext() {
  const user = queryClient.getQueryData<AuthSessionData>(AUTH_ME_QUERY_KEY);

  return {
    route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    sessionId: user?.sessionId ?? null,
    userId: user?.id ?? null,
    webappVersion: getEmbeddedWebappVersion(),
  };
}

export const logger = createLogger({
  sinks: import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test'
    ? [consoleSink]
    : [consoleSink, createNetworkSink()],
  minLevel: resolveConfiguredLogLevel(import.meta.env.VITE_LOG_LEVEL, import.meta.env.MODE),
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
