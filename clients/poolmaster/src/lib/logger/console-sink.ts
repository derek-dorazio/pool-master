import type { LogLevel, LogMeta, LogPayload, LogSink } from './types';

function resolveConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case 'fatal':
    case 'error':
      return console.error;
    case 'warn':
      return console.warn;
    case 'info':
      return console.info;
    case 'debug':
    default:
      return console.debug;
  }
}

export const consoleSink: LogSink = {
  write(level: LogLevel, payload: LogPayload, msg: string | undefined, meta: LogMeta) {
    resolveConsoleMethod(level)({
      level,
      msg,
      ...meta,
      ...payload,
    });
  },
};
