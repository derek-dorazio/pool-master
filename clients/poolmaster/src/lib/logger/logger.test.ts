import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';
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

  it('filters logs below the configured level', () => {
    const sink: LogSink = {
      write: vi.fn(),
    };

    const logger = createLogger({
      sinks: [sink],
      minLevel: 'warn',
      getContext: () => ({
        webappVersion: '0.1.0',
        route: '/tests',
        sessionId: null,
        userId: 'user-1',
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
        userId: 'user-1',
      }),
    );
  });

  it('redacts sensitive payload data before dispatching to sinks', () => {
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
        err: expect.objectContaining({
          message: 'failed',
        }),
      }),
      undefined,
      expect.any(Object),
    );
  });

  it('isolates sink failures and continues writing to the remaining sinks', () => {
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

  it('merges child bindings into payload data', () => {
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
});
