import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { buildContestResult } from '@/features/championships/test/fixtures';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquadMember,
  getLeagueByCodeData,
} from '@/features/leagues/test/fixtures';
import { LeagueContestHistoryPage } from './league-contest-history-page';
import { buildContest } from './test/contest-admin-fixtures';

const { getCurrentUserMock, getLeagueByCodeMock, listContestResultsMock, listContestsMock, refreshTokenMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getLeagueByCodeMock: vi.fn(),
  listContestResultsMock: vi.fn(),
  listContestsMock: vi.fn(),
  refreshTokenMock: vi.fn(),
}));

bindApiMocks({
  getLeagueByCode: getLeagueByCodeMock,
  getUser: getCurrentUserMock,
  listContestResults: listContestResultsMock,
  listContests: listContestsMock,
  refreshToken: refreshTokenMock,
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderHistory(path = '/league/BIGDAWGS/contests/history') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route element={<LeagueContestHistoryPage />} path="/league/:leagueCode/contests/history" />
            <Route element={<div data-testid="contest-destination" />} path="/league/:leagueCode/contests/:contestId" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** Completed contests in 2026 and 2025 (the 2025 one final at 11pm New York on New Year's Eve), and one still open. */
const CONTESTS = [
  buildContest({ id: 'contest-open', status: 'OPEN', endsAt: null }),
  buildContest({ id: 'contest-1', status: 'COMPLETED', endsAt: '2026-04-13T22:00:00.000Z' }),
  buildContest({ id: 'contest-0', status: 'COMPLETED', endsAt: '2026-01-01T04:00:00.000Z' }),
];

function prime(contests = CONTESTS) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership(), squadMembership: buildLeagueSquadMember() },
  )));
  listContestsMock.mockResolvedValue(apiSuccess({ contests }));
  listContestResultsMock.mockImplementation(({ query }: { query: { year: number } }) => Promise.resolve(apiSuccess({
    contests: query.year === 2026
      ? [buildContestResult({ contestId: 'contest-1' })]
      : [buildContestResult({ contestId: 'contest-0', name: 'New Year Bowl', completedAt: '2026-01-01T04:00:00.000Z', count: 'NOT_COUNTED' })],
  })));
}

describe('LeagueContestHistoryPage', () => {
  it('opens on the newest year with a completed contest, each row naming its winner and opening the contest', async () => {
    prime();

    renderHistory();

    const row = await screen.findByTestId('league-history-contest-contest-1');
    expect(row).toHaveTextContent('Masters Tiers');
    expect(row).toHaveTextContent('Won by Birdie Bandits · 12 entries');
    expect(row).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
    expect(screen.getByTestId('league-contests-history')).toHaveTextContent('Completed in 2026');
    expect(listContestResultsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { year: 2026 } }));
  });

  it('offers each year a contest went final in, US Eastern, newest first, and shows the year chosen, kept in the link', async () => {
    prime();
    renderHistory();
    const picker = await screen.findByTestId('league-contests-history-year');

    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['2026', '2025']);

    fireEvent.change(picker, { target: { value: '2025' } });

    expect(await screen.findByTestId('league-history-contest-contest-0')).toHaveTextContent('Not counted');
    expect(screen.queryByTestId('league-history-contest-contest-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/history?year=2025');
  });

  it('opens the year in the link, and the newest one for a year with no completed contest', async () => {
    prime();
    const { unmount } = renderHistory('/league/BIGDAWGS/contests/history?year=2025');

    expect(await screen.findByTestId('league-history-contest-contest-0')).toBeInTheDocument();
    unmount();

    renderHistory('/league/BIGDAWGS/contests/history?year=2019');

    expect(await screen.findByTestId('league-history-contest-contest-1')).toBeInTheDocument();
  });

  it('says the league has no completed contests yet, and asks for no year', async () => {
    prime([CONTESTS[0] ?? buildContest()]);

    renderHistory();

    expect(await screen.findByText('This league does not have any completed contests yet.')).toBeInTheDocument();
    expect(listContestResultsMock).not.toHaveBeenCalled();
  });

  it('says so when the year\'s contests cannot be loaded', async () => {
    prime();
    listContestResultsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderHistory();

    await waitFor(() => expect(screen.getByTestId('league-contests-history-error')).toHaveTextContent('We couldn\'t load the contests completed in 2026.'));
  });
});
