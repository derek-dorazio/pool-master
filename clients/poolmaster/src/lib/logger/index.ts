import { useSessionStore } from '@/features/auth/session-store';
import { getEmbeddedVersionInfo } from '@/lib/version-info';
import { consoleSink } from './console-sink';
import { createNetworkSink } from './network-sink';
import { createLogger, resolveDefaultLogLevel } from './logger';

function getLoggerContext() {
  const { sessionId, user } = useSessionStore.getState();

  return {
    route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    sessionId,
    userId: user?.id ?? null,
    webappVersion: getEmbeddedVersionInfo().webapp.version,
  };
}

export const logger = createLogger({
  sinks: import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test'
    ? [consoleSink]
    : [consoleSink, createNetworkSink()],
  minLevel: resolveDefaultLogLevel(import.meta.env.MODE),
  getContext: getLoggerContext,
});

export function useLogger() {
  return logger;
}

export * from './types';
export * from './client-trace-id';
export * from './console-sink';
export * from './network-sink';
export * from './logger';
export * from './redact';
