import type { FastifyBaseLogger } from 'fastify';
import { mockFn } from './mock-fn';

/**
 * `fakeLogger()` — a whole `FastifyBaseLogger` of `jest.fn()`s (#345 Phase 2 PR 3).
 *
 * Before this, eight test files each wrote a local `createLogger()` returning four to six
 * `jest.fn()`s and handed it to the service as `createLogger() as any` — 47 casts, each of
 * which hid that the double was not a logger. A service that called `logger.trace` or
 * `logger.child` would have compiled against it and failed at run time.
 *
 * The literal below is typed `jest.Mocked<FastifyBaseLogger>` and NOT cast, so a method the
 * interface adds is a compile error here, once, the same way `repo-fakes.ts` works for ports.
 * It satisfies every narrower logger type the services declare (`Pick<FastifyBaseLogger, ...>`)
 * as well, and each method stays a `jest.Mock` for `toHaveBeenCalledWith` and `.mock.calls`.
 *
 * `child()` returns the same fake, so a log written through a child logger is asserted on
 * the parent.
 */
export function fakeLogger(): jest.Mocked<FastifyBaseLogger> {
  const logger: jest.Mocked<FastifyBaseLogger> = {
    level: 'info',
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    silent: jest.fn(),
    child: mockFn<FastifyBaseLogger['child']>(() => logger),
  };
  return logger;
}
