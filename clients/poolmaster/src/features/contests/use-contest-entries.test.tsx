import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ContestStatus } from '@poolmaster/shared/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS } from './contest-status';
import { useContestEntriesQuery } from './use-contest-entries';

const listContestEntriesMock = vi.fn();

bindApiMocks({ listContestEntries: listContestEntriesMock });

function renderEntries(contestId: string, status: ContestStatus | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useContestEntriesQuery(contestId, status), { wrapper });
  const refetchInterval = () => {
    const query = queryClient.getQueryCache().find({ queryKey: QueryKeys.contestEntries.byContest(contestId) });
    return (query?.observers[0]?.options as { refetchInterval?: unknown } | undefined)?.refetchInterval;
  };
  return { ...view, refetchInterval };
}

describe('useContestEntriesQuery', () => {
  beforeEach(() => {
    listContestEntriesMock.mockReset();
    listContestEntriesMock.mockResolvedValue({ data: { entries: [], picksRevealed: true } });
  });

  it('reads the one contest\'s entries and whether its picks are revealed', async () => {
    const { result } = renderEntries('contest-1', ContestStatus.OPEN);

    await waitFor(() => expect(result.current.data).toEqual({ entries: [], picksRevealed: true }));
    expect(listContestEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
  });

  it('reads nothing before the contest id is known', () => {
    const { result } = renderEntries('', ContestStatus.OPEN);

    expect(result.current.fetchStatus).toBe('idle');
    expect(listContestEntriesMock).not.toHaveBeenCalled();
  });

  it('polls while the contest is live and not before or after', () => {
    expect(renderEntries('contest-live', ContestStatus.ACTIVE).refetchInterval()).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(renderEntries('contest-open', ContestStatus.OPEN).refetchInterval()).toBe(false);
    expect(renderEntries('contest-final', ContestStatus.COMPLETED).refetchInterval()).toBe(false);
  });

  it('surfaces a failed read as an error rather than an empty list', async () => {
    listContestEntriesMock.mockResolvedValue({ error: { error: { code: 'NOT_FOUND', message: 'No such contest.' } }, status: 404 });
    const { result } = renderEntries('contest-1', ContestStatus.OPEN);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
