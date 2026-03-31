import { describe, it, expect } from 'vitest';
import { queryClient } from '@/lib/query-client';
import { QueryClient } from '@tanstack/react-query';

describe('query-client', () => {
  it('exports a QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('default staleTime is 30 seconds', () => {
    const staleTime = queryClient.getDefaultOptions().queries?.staleTime;
    expect(staleTime).toBe(30_000);
  });

  it('retry count is configured to 1', () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    expect(retry).toBe(1);
  });

  it('refetchOnWindowFocus is enabled', () => {
    const refetch = queryClient.getDefaultOptions().queries?.refetchOnWindowFocus;
    expect(refetch).toBe(true);
  });
});
