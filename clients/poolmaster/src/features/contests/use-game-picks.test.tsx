import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS } from './contest-status';
import { bracketContestFixture, gamePicksFixture } from './test/bracket-fixtures';
import { useGamePicks } from './use-game-picks';

const getGamePicksMock = vi.fn();
const saveGamePicksMock = vi.fn();
const submitGamePicksMock = vi.fn();

bindApiMocks({ getGamePicks: getGamePicksMock, saveGamePicks: saveGamePicksMock, submitGamePicks: submitGamePicksMock });

const ENTRY_ID = 'entry-1';
const EVENT_ID = 'event-1';

function renderGamePicks(contestStatus: ContestStatus = ContestStatus.OPEN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated: unknown[] = [];
  const invalidate = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push(filters?.queryKey);
    return invalidate(filters);
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const contest = bracketContestFixture({ status: contestStatus });
  const view = renderHook(() => useGamePicks({
    action: 'bracket',
    contest,
    entryId: ENTRY_ID,
    feature: 'test',
    picksName: 'Bracket',
    sportEventId: EVENT_ID,
    submitInvalidates: [QueryKeys.contests.bracketLeaderboard(contest.id)],
  }), { wrapper });
  const picksKey = QueryKeys.gamePicks.detail(contest.id, ENTRY_ID, EVENT_ID);
  const refetchInterval = () => (queryClient.getQueryCache().find({ queryKey: picksKey })?.observers[0]?.options as { refetchInterval?: unknown } | undefined)?.refetchInterval;
  return { ...view, contest, invalidated, picksKey, queryClient, refetchInterval };
}

describe('useGamePicks', () => {
  beforeEach(() => {
    getGamePicksMock.mockReset();
    saveGamePicksMock.mockReset();
    submitGamePicksMock.mockReset();
    getGamePicksMock.mockResolvedValue({ data: gamePicksFixture() });
  });

  it('reads the entry\'s picks for the one event', async () => {
    const { contest, result } = renderGamePicks();

    await waitFor(() => expect(result.current.gamePicksQuery.data).toEqual(gamePicksFixture()));
    expect(getGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: contest.id, entryId: ENTRY_ID, sportEventId: EVENT_ID } }));
  });

  it('polls the picks while the contest is live, so each pick\'s mark moves with the results, and not before', () => {
    expect(renderGamePicks(ContestStatus.ACTIVE).refetchInterval()).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(renderGamePicks(ContestStatus.OPEN).refetchInterval()).toBe(false);
  });

  it('replaces the picks with the save\'s answer and drops the typed tiebreaker for the saved one', async () => {
    const saved = gamePicksFixture({ tiebreakerValue: 151 });
    saveGamePicksMock.mockResolvedValue({ data: saved });
    const { picksKey, queryClient, result } = renderGamePicks();
    await waitFor(() => expect(result.current.gamePicksQuery.data).toBeDefined());

    act(() => result.current.setTiebreakerDraft('151'));
    expect(result.current.tiebreakerDraft).toBe('151');
    await act(() => result.current.saveMutation.mutateAsync({ picks: [], tiebreakerValue: 151 }));

    expect(queryClient.getQueryData(picksKey)).toEqual(saved);
    expect(result.current.tiebreakerDraft).toBeNull();
  });

  it('reads the picks again after a refused save, since the ones on screen are no longer the server\'s', async () => {
    saveGamePicksMock.mockResolvedValue({ error: { error: { code: 'PREDICTION_GAME_STARTED', message: 'Started.' } }, status: 409 });
    const { invalidated, picksKey, result } = renderGamePicks();
    await waitFor(() => expect(result.current.gamePicksQuery.data).toBeDefined());

    await act(async () => {
      await result.current.saveMutation.mutateAsync({ picks: [] }).catch(() => undefined);
    });

    expect(invalidated).toContainEqual(picksKey);
  });

  it('keeps the submitted picks and refreshes the entry list and the reads the page names, such as its leaderboard', async () => {
    const submitted = gamePicksFixture({ status: ContestEntryStatus.SUBMITTED });
    submitGamePicksMock.mockResolvedValue({ data: submitted });
    const { contest, invalidated, picksKey, queryClient, result } = renderGamePicks();
    await waitFor(() => expect(result.current.gamePicksQuery.data).toBeDefined());

    await act(() => result.current.submitMutation.mutateAsync());

    expect(queryClient.getQueryData(picksKey)).toEqual(submitted);
    expect(invalidated).toContainEqual(QueryKeys.contestEntries.byContest(contest.id));
    expect(invalidated).toContainEqual(QueryKeys.contests.bracketLeaderboard(contest.id));
  });
});
