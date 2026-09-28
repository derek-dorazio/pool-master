import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/query-client';
import { getLogger, logger } from './index';

describe('pool-master-dxd.24: logger accessor naming', () => {
  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('exports getLogger for singleton access without pretending to be a React hook', () => {
    expect(getLogger()).toBe(logger);
  });
});
