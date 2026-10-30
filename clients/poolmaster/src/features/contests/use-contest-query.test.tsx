import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ContestStatus } from '@poolmaster/shared/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS } from './contest-status';
import { bracketContestFixture } from './test/bracket-fixtures';
import { useLiveContestQuery } from './use-contest-query';

const getContestMock = vi.fn();

bindApiMocks({ getContest: getContestMock });

const DEPENDENT_KEY = ['poolmaster', 'test', 'board'] as const;

function renderLiveContest(contestId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const dependentKey = vi.fn(() => DEPENDENT_KEY);
  const view = renderHook(() => useLiveContestQuery(contestId, dependentKey), { wrapper });
  const refetchInterval = () => {
    const options = queryClient.getQueryCache().find({ queryKey: QueryKeys.contests.detail(contestId) })?.observers[0]?.options as
      { refetchInterval?: unknown } | undefined;
    const interval = options?.refetchInterval;
    return typeof interval === 'function' ? (interval as (query: unknown) => unknown)(queryClient.getQueryCache().find({ queryKey: QueryKeys.contests.detail(contestId) })) : interval;
  };
  return { ...view, dependentKey, invalidateSpy, refetchInterval };
}

describe('useLiveContestQuery', () => {
  beforeEach(() => {
    getContestMock.mockReset();
  });

  it('polls the contest while it is live', async () => {
    getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ status: ContestStatus.ACTIVE }) } });
    const { refetchInterval, result } = renderLiveContest('contest-live');

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(refetchInterval()).toBe(CONTEST_POLL_INTERVAL_MS);
  });

  it('stops polling once the contest is final', async () => {
    getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ status: ContestStatus.COMPLETED }) } });
    const { refetchInterval, result } = renderLiveContest('contest-final');

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(refetchInterval()).toBe(false);
  });

  it('reads the page\'s dependent read again when the contest\'s status changes, and not on the first read', async () => {
    getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ id: 'contest-1', status: ContestStatus.OPEN }) } });
    const { dependentKey, invalidateSpy, result } = renderLiveContest('contest-1');
    await waitFor(() => expect(result.current.data?.status).toBe(ContestStatus.OPEN));
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: DEPENDENT_KEY });

    getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ id: 'contest-1', status: ContestStatus.ACTIVE }) } });
    await result.current.refetch();

    await waitFor(() => expect(result.current.data?.status).toBe(ContestStatus.ACTIVE));
    expect(dependentKey).toHaveBeenLastCalledWith(expect.objectContaining({ status: ContestStatus.ACTIVE }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DEPENDENT_KEY });
  });
});
