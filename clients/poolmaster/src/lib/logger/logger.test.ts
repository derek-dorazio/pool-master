import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, resolveConfiguredLogLevel, resolveDefaultLogLevel } from './logger';
import type { LogSink } from './types';
import { resetClientTraceIdForTests } from './client-trace-id';

describe('logger', () => {
  beforeEach(() => {
    resetClientTraceIdForTests();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rule: logger filters logs below the configured level', () => {
    const sink: LogSink = {
      write: vi.fn(),
    };

    const logger = createLogger({
      sinks: [sink],
      minLevel: 'warn',
      getContext: () => ({
        webappVersion: '0.1.0',
        route: '/tests',
      }),
    });

    logger.info({ action: 'contest.loaded' }, 'should not write');
    logger.warn({ action: 'contest.loadFailed' }, 'should write');

    expect(sink.write).toHaveBeenCalledTimes(1);
    expect(sink.write).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        action: 'contest.loadFailed',
      }),
      'should write',
      expect.objectContaining({
        route: '/tests',
      }),
    );
  });

  it('rule: logger redacts sensitive payload data before dispatching to sinks', () => {
    const sink: LogSink = {
      write: vi.fn(),
    };

    const logger = createLogger({
      sinks: [sink],
      minLevel: 'debug',
      getContext: () => ({
        webappVersion: '0.1.0',
      }),
    });

    logger.error({
      action: 'auth.login.failed',
      data: {
        password: 'secret',
        nested: {
          refreshToken: 'refresh-secret',
        },
      },
      err: new Error('failed'),
    });

    expect(sink.write).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        data: {
          password: '[REDACTED]',
          nested: {
            refreshToken: '[REDACTED]',
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        err: expect.objectContaining({
          message: 'failed',
        }),
      }),
      undefined,
      expect.any(Object),
    );
  });

  it('rule: logger isolates sink failures and continues writing to the remaining sinks', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const brokenSink: LogSink = {
      write: vi.fn(() => {
        throw new Error('sink exploded');
      }),
    };
    const healthySink: LogSink = {
      write: vi.fn(),
    };

    const logger = createLogger({
      sinks: [brokenSink, healthySink],
      minLevel: 'debug',
      getContext: () => ({
        webappVersion: '0.1.0',
      }),
    });

    logger.info({ action: 'app.bootstrap.mounted' }, 'mounted');

    expect(healthySink.write).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'PoolMaster logger sink failure',
      expect.any(Error),
    );
  });

  it('rule: logger merges child bindings into payload data', () => {
    const sink: LogSink = {
      write: vi.fn(),
    };

    const logger = createLogger({
      sinks: [sink],
      minLevel: 'debug',
      getContext: () => ({
        webappVersion: '0.1.0',
        route: '/league/abc',
      }),
    }).child({
      feature: 'league-detail',
      leagueCode: 'abc',
    });

    logger.info({
      action: 'league.view.loaded',
      data: {
        contestCount: 3,
      },
    });

    expect(sink.write).toHaveBeenCalledWith(
      'info',
      {
        action: 'league.view.loaded',
        data: {
          feature: 'league-detail',
          leagueCode: 'abc',
          contestCount: 3,
        },
      },
      undefined,
      expect.objectContaining({
        route: '/league/abc',
      }),
    );
  });

  it('rule: logger honors an explicit configured log level', () => {
    expect(resolveConfiguredLogLevel('debug', 'production')).toBe('debug');
    expect(resolveConfiguredLogLevel('verbose', 'production')).toBe('info');
  });

  it('defaults to warn in tests, debug in development and info everywhere else', () => {
    expect(resolveDefaultLogLevel('test')).toBe('warn');
    expect(resolveDefaultLogLevel('development')).toBe('debug');
    expect(resolveDefaultLogLevel('production')).toBe('info');
    expect(resolveConfiguredLogLevel('loud', 'development')).toBe('debug');
  });

  it('sends an error as its name, message, stack and cause, and a string error as a message', () => {
    const sink: LogSink = { write: vi.fn() };
    const logger = createLogger({ sinks: [sink], minLevel: 'debug', getContext: () => ({ webappVersion: '0.1.0' }) });
    const cause = new Error('socket closed');

    logger.error({ action: 'with.cause', err: new Error('save failed', { cause }) });
    logger.error({ action: 'with.string', err: 'plain text failure' });
    logger.error({ action: 'with.object', err: { code: 'E_RANGE' } });

    const payloads = vi.mocked(sink.write).mock.calls.map(([, payload]) => payload);
    expect(payloads[0]?.err).toMatchObject({
      name: 'Error',
      message: 'save failed',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.stringContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
      stack: expect.stringContaining('save failed'),
    });
    expect(payloads[0]?.err).toHaveProperty('cause');
    expect(payloads[1]?.err).toEqual({ message: 'plain text failure' });
    expect(payloads[2]?.err).toEqual({ code: 'E_RANGE' });
  });

  it('still writes with an unknown version and no route when reading the context throws', () => {
    const sink: LogSink = { write: vi.fn() };
    const logger = createLogger({
      sinks: [sink],
      minLevel: 'debug',
      getContext: () => {
        throw new Error('no window');
      },
    });

    logger.info({ action: 'context.missing' }, 'still logged');

    expect(sink.write).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({ action: 'context.missing' }),
      'still logged',
      expect.objectContaining({ webappVersion: 'unknown', route: undefined }),
    );
  });

  it('writes at every level through a child logger', () => {
    const sink: LogSink = { write: vi.fn() };
    const logger = createLogger({ sinks: [sink], minLevel: 'debug', getContext: () => ({ webappVersion: '0.1.0' }) })
      .child({ feature: 'levels' });

    const levels = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
    for (const level of levels) {
      logger[level]({ action: `wrote.${level}` });
    }

    expect(vi.mocked(sink.write).mock.calls.map(([level]) => level)).toEqual([...levels]);
  });
});
