import { vi } from 'vitest';
import type { PoolmasterLogger } from './types';

export function createTestLogger(): PoolmasterLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(function child() {
      return createTestLogger();
    }),
  };
}
