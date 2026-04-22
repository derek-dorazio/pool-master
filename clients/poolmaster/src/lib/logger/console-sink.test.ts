import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleSink } from './console-sink';

const META = {
  ts: '2026-04-22T00:00:00.000Z',
  clientTraceId: 'trace-123',
  webappVersion: '0.1.0',
  userAgent: 'vitest',
  route: '/test',
  sessionId: null,
  userId: 'user-1',
} as const;

describe('console sink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes debug logs to console.debug', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    consoleSink.write('debug', { action: 'test.debug' }, 'debug message', META);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        action: 'test.debug',
        msg: 'debug message',
      }),
    );
  });

  it('routes info logs to console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    consoleSink.write('info', { action: 'test.info' }, 'info message', META);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        action: 'test.info',
        msg: 'info message',
      }),
    );
  });

  it('routes warn logs to console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    consoleSink.write('warn', { action: 'test.warn' }, 'warn message', META);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        action: 'test.warn',
        msg: 'warn message',
      }),
    );
  });

  it('routes error and fatal logs to console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    consoleSink.write('error', { action: 'test.error' }, 'error message', META);
    consoleSink.write('fatal', { action: 'test.fatal' }, 'fatal message', META);

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        level: 'error',
        action: 'test.error',
      }),
    );
    expect(errorSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        level: 'fatal',
        action: 'test.fatal',
      }),
    );
  });
});
