import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { refreshAfterWrite, useInvalidatingMutation } from './mutation-hooks';
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
          // eslint-disable-next-line @typescript-eslint/require-await -- mutationFn must return a Promise per MutationFunction's type.
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

  it('a list read still in flight when the save lands is read again, so a page opened after the save shows the saved row', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const listKey = QueryKeys.rootAdmin.manageSport.sportLeagues('golf');
    let savedTours = ['Tour A'];
    let releaseFirstRead: () => void = () => undefined;
    const firstReadHeld = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let reads = 0;
    const readTours = async (): Promise<string[]> => {
      reads += 1;
      // What the server answers is fixed when the read reaches it, not when the answer arrives.
      const answer = [...savedTours];
      if (reads === 1) {
        await firstReadHeld;
      }
      return answer;
    };

    // The list page asked for the list, and the admin left for the New page before it answered.
    void queryClient.query({ queryKey: listKey, queryFn: readTours }).catch(() => undefined);

    const { result: save } = renderHook(
      () =>
        useInvalidatingMutation({
          // eslint-disable-next-line @typescript-eslint/require-await -- mutationFn must return a Promise per MutationFunction's type.
          mutationFn: async () => {
            savedTours = [...savedTours, 'Tour B'];
          },
          invalidates: [QueryKeys.rootAdmin.manageSport.leagues],
        }),
      { wrapper: createWrapper(queryClient) },
    );
    save.current.mutate();
    await waitFor(() => expect(save.current.isSuccess).toBe(true));

    // Back on the list page; the read from before the save answers only now.
    const { result: list } = renderHook(
      () => useQuery({ queryKey: listKey, queryFn: readTours }),
      { wrapper: createWrapper(queryClient) },
    );
    releaseFirstRead();

    await waitFor(() => expect(list.current.data).toEqual(['Tour A', 'Tour B']));
  });

  it('marking reads stale without refetching still cancels a read in flight, so its pre-write answer is never kept and the next reader reads again', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const entriesKey = QueryKeys.contestEntries.byContest('contest-1');
    let entryStatus = 'SUBMITTED';
    let releaseFirstRead: () => void = () => undefined;
    const firstReadHeld = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let reads = 0;
    const readEntries = async (): Promise<string> => {
      reads += 1;
      const answer = entryStatus;
      if (reads === 1) {
        await firstReadHeld;
      }
      return answer;
    };
    void queryClient.query({ queryKey: entriesKey, queryFn: readEntries }).catch(() => undefined);

    // A pick change sends the entry back to draft; nothing on this page reads the list again.
    entryStatus = 'DRAFT';
    await refreshAfterWrite(queryClient, [entriesKey], { refetchType: 'none' });
    releaseFirstRead();
    expect(reads).toBe(1);

    const { result: entries } = renderHook(
      () => useQuery({ queryKey: entriesKey, queryFn: readEntries }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(entries.current.data).toBe('DRAFT'));
  });

  it('pool-master-rop.78.10: supports explicit no-invalidation mutations', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () =>
        useInvalidatingMutation({
          // eslint-disable-next-line @typescript-eslint/require-await -- mutationFn must return a Promise per MutationFunction's type.
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
