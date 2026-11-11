import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ContestStatus } from '@poolmaster/shared/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS } from './contest-status';
import { buildContestEntry } from './test/contest-admin-fixtures';
import { useContestEntriesQuery, useMyContestEntries } from './use-contest-entries';

const listContestEntriesMock = vi.fn();
const listMyContestEntriesMock = vi.fn();

bindApiMocks({ listContestEntries: listContestEntriesMock, listMyContestEntries: listMyContestEntriesMock });

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

describe('useMyContestEntries', () => {
  function renderMine() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useMyContestEntries('league-1', true), { wrapper });
  }

  it('groups the viewer\'s entries by contest and keeps each contest\'s best place, the lowest position', async () => {
    listMyContestEntriesMock.mockResolvedValue({
      data: {
        entries: [
          buildContestEntry({ id: 'a-1', contestId: 'contest-a' }),
          buildContestEntry({ id: 'a-2', contestId: 'contest-a', entryNumber: 2 }),
          buildContestEntry({ id: 'b-1', contestId: 'contest-b' }),
        ],
        places: [
          { entryId: 'a-1', position: 7, displayPosition: '7' },
          { entryId: 'a-2', position: 3, displayPosition: 'T3' },
          { entryId: 'b-1', position: 1, displayPosition: '1' },
          // A place for an entry the response does not list belongs to no contest here.
          { entryId: 'elsewhere', position: 1, displayPosition: '1' },
        ],
      },
    });

    const { result } = renderMine();

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.entriesByContestId.get('contest-a')?.map((entry) => entry.id)).toEqual(['a-1', 'a-2']);
    expect(Object.fromEntries(result.current.bestPlaceByContestId)).toEqual({
      'contest-a': { entryId: 'a-2', position: 3, displayPosition: 'T3' },
      'contest-b': { entryId: 'b-1', position: 1, displayPosition: '1' },
    });
  });

  it('has no places before the entries are read', () => {
    listMyContestEntriesMock.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderMine();

    expect(result.current.state).toBe('loading');
    expect(result.current.bestPlaceByContestId.size).toBe(0);
  });
});
