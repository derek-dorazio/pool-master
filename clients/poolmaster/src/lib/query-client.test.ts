import { describe, expect, it } from 'vitest';
import { queryClient } from './query-client';

describe('pool-master-dxd.20: query client defaults', () => {
  it('uses an explicit no-retry default unless a query opts in', () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});
