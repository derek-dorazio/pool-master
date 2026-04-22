import { getOrCreateClientTraceId } from './client-trace-id';
import { redactPayload } from './redact';
import type {
  LogData,
  LoggerContext,
  LogLevel,
  LogPayload,
  LogSink,
  PoolmasterLogger,
} from './types';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const LOGGER_FAILURE_MESSAGE = 'PoolMaster logger sink failure';

function resolveUserAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
}

function normalizeError(err: unknown): unknown {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause !== undefined ? { cause: err.cause } : {}),
    };
  }

  if (err === undefined) {
    return undefined;
  }

  if (typeof err === 'string') {
    return {
      message: err,
    };
  }

  return err;
}

function resolveDefaultContext(): LoggerContext {
  return {
    webappVersion: 'unknown',
  };
}

function mergeBindings(
  childBindings: LogData,
  data: LogData | undefined,
): LogData | undefined {
  if (!data && Object.keys(childBindings).length === 0) {
    return undefined;
  }

  return {
    ...childBindings,
    ...(data ?? {}),
  };
}

function shouldWrite(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function emitLoggerFailure(error: unknown) {
  console.error(LOGGER_FAILURE_MESSAGE, error);
}

export function resolveDefaultLogLevel(mode: string): LogLevel {
  if (mode === 'test') {
    return 'warn';
  }

  if (mode === 'development') {
    return 'debug';
  }

  return 'info';
}

type CreateLoggerOptions = {
  sinks: LogSink[];
  minLevel: LogLevel;
  getContext: () => LoggerContext;
};

export function createLogger(options: CreateLoggerOptions): PoolmasterLogger {
  function buildLogger(childBindings: LogData): PoolmasterLogger {
    const write = (level: LogLevel, payload: LogPayload, msg?: string) => {
      if (!shouldWrite(level, options.minLevel)) {
        return;
      }

      const context = (() => {
        try {
          return options.getContext();
        } catch {
          return resolveDefaultContext();
        }
      })();

      const normalizedPayload = redactPayload({
        action: payload.action,
        data: mergeBindings(childBindings, payload.data),
        err: normalizeError(payload.err),
      });

      const meta = {
        ts: new Date().toISOString(),
        clientTraceId: getOrCreateClientTraceId(),
        userAgent: resolveUserAgent(),
        route: context.route,
        sessionId: context.sessionId ?? null,
        userId: context.userId ?? null,
        webappVersion: context.webappVersion,
      };

      for (const sink of options.sinks) {
        try {
          sink.write(level, normalizedPayload, msg, meta);
        } catch (error) {
          emitLoggerFailure(error);
        }
      }
    };

    return {
      debug: (payload, msg) => write('debug', payload, msg),
      info: (payload, msg) => write('info', payload, msg),
      warn: (payload, msg) => write('warn', payload, msg),
      error: (payload, msg) => write('error', payload, msg),
      fatal: (payload, msg) => write('fatal', payload, msg),
      child: (bindings) =>
        buildLogger({
          ...childBindings,
          ...bindings,
        }),
    };
  }

  return buildLogger({});
}
