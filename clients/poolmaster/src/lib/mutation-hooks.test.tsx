import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useInvalidatingMutation } from './mutation-hooks';
import { QueryKeys } from './query-keys';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('pool-master-rop.78.10: useInvalidatingMutation invalidation contract', () => {
  it('pool-master-rop.78.10: declares invalidation keys from mutation variables and invalidates them on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const invalidates = vi.fn((variables: { contestId: string }) => [
      QueryKeys.contests.detail(variables.contestId),
      QueryKeys.contestEntries.byContest(variables.contestId),
    ]);

    const { result } = renderHook(
      () =>
        useInvalidatingMutation({
          mutationFn: async (variables: { contestId: string }) => ({
            saved: true,
            contestId: variables.contestId,
          }),
          invalidates: (_data, variables) => invalidates(variables),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    result.current.mutate({ contestId: 'contest-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidates).toHaveBeenCalledWith({ contestId: "contest-1" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: QueryKeys.contests.detail('contest-1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: QueryKeys.contestEntries.byContest('contest-1'),
    });
  });

  it('pool-master-rop.78.10: supports explicit no-invalidation mutations', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () =>
        useInvalidatingMutation({
          mutationFn: async () => ({ updated: true }),
          invalidates: [],
        }),
      { wrapper: createWrapper(queryClient) },
    );

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
