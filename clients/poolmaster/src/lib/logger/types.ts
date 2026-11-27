import type { ClientLogEntry } from '@/lib/api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogData = Record<string, unknown>;

/** What a log call names: the entry's action and data as the ingest contract has them, and the error it reports. */
export type LogPayload = Pick<ClientLogEntry, 'action' | 'data'> & {
  err?: unknown;
};

export type LogMeta = {
  ts: string;
  clientTraceId: string;
  webappVersion: string;
  userAgent: string;
  route?: string;
  // No identity fields. The server keeps the session in the JWT's `sid` claim and reads both
  // session and user from the token on ingest (#206), so neither is transmitted. `userId` used
  // to linger here for the console sink alone, which meant every log call read the React Query
  // cache to populate a field only local development ever saw.
};

export type LogSink = {
  write: (level: LogLevel, payload: LogPayload, msg: string | undefined, meta: LogMeta) => void;
};

export type LoggerContext = {
  route?: string;
  webappVersion: string;
};

export type PoolmasterLogger = {
  debug: (payload: LogPayload, msg?: string) => void;
  info: (payload: LogPayload, msg?: string) => void;
  warn: (payload: LogPayload, msg?: string) => void;
  error: (payload: LogPayload, msg?: string) => void;
  fatal: (payload: LogPayload, msg?: string) => void;
  child: (bindings: LogData) => PoolmasterLogger;
};
