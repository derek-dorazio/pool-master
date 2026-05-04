import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGlobalBrowserFailureHandlers } from './browser-failure-handlers';
import type { PoolmasterLogger } from './types';

function createLogger(): PoolmasterLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createLogger()),
  };
}

describe('registerGlobalBrowserFailureHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rule: frontend fatal logging captures window errors', () => {
    const logger = createLogger();
    const teardown = registerGlobalBrowserFailureHandlers(logger);

    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'boom',
        error: new Error('boom'),
        filename: 'app.tsx',
        lineno: 12,
        colno: 7,
      }),
    );

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app.unhandledError',
        err: expect.any(Error),
        data: {
          filename: 'app.tsx',
          lineno: 12,
          colno: 7,
        },
      }),
      'Unhandled browser error',
    );

    teardown();
  });

  it('rule: frontend fatal logging captures unhandled promise rejections', () => {
    const logger = createLogger();
    const teardown = registerGlobalBrowserFailureHandlers(logger);
    const rejectionEvent = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejectionEvent, 'reason', {
      configurable: true,
      value: new Error('rejected'),
    });

    window.dispatchEvent(rejectionEvent);

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app.unhandledRejection',
        err: expect.any(Error),
      }),
      'Unhandled promise rejection',
    );

    teardown();
  });

  it('rule: browser failure handlers remove listeners on teardown', () => {
    const logger = createLogger();
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const teardown = registerGlobalBrowserFailureHandlers(logger);
    teardown();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'unhandledrejection',
      expect.any(Function),
    );
  });
});
