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
  sessionId?: string | null;
  userId?: string | null;
};

export type LogSink = {
  write: (level: LogLevel, payload: LogPayload, msg: string | undefined, meta: LogMeta) => void;
};

export type LoggerContext = {
  route?: string;
  sessionId?: string | null;
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
