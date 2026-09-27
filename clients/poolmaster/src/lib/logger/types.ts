export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogData = Record<string, unknown>;

export type LogPayload = {
  action: string;
  data?: LogData;
  err?: unknown;
};

export type LogMeta = {
  ts: string;
  clientTraceId: string;
  webappVersion: string;
  userAgent: string;
  route?: string;
  // #206 — no sessionId. The server keeps it in the JWT's `sid` claim and stamps it on
  // ingest; the browser never receives it. `userId` stays because the client does know
  // its own user, but it is only shown by the console sink and is never transmitted:
  // the ingest route reads user identity from the token too.
  userId?: string | null;
};

export type LogSink = {
  write: (level: LogLevel, payload: LogPayload, msg: string | undefined, meta: LogMeta) => void;
};

export type LoggerContext = {
  route?: string;
  userId?: string | null;
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
