import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardRedirect, ContestPage } from './contest-page';

const { getContestMock } = vi.hoisted(() => ({ getContestMock: vi.fn() }));

bindApiMocks({ getContest: getContestMock });

// Each view has its own tests; here they only say which one the page chose.
vi.mock('./contest-entry-list-page', () => ({ ContestEntryListPage: () => <div data-testid="entry-list-view" /> }));
vi.mock('./contest-leaderboard-page', () => ({ ContestLeaderboardPage: () => <div data-testid="leaderboard-view" /> }));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(url: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={<><ContestPage /><LocationProbe /></>} path="/league/:leagueCode/contests/:contestId" />
          <Route element={<ContestLeaderboardRedirect />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeContest(status: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED') {
  getContestMock.mockResolvedValue({ data: { contest: { id: 'contest-1', leagueId: 'league-1', name: 'Masters Pool', status, sportEvents: [] } } });
}

afterEach(() => {
  getContestMock.mockReset();
});

describe('ContestPage — one page per contest, its view following the stage', () => {
  it.each(['DRAFT', 'OPEN'] as const)('lists the entries while the contest is %s', async (status) => {
    primeContest(status);

    renderAt('/league/BIGDAWGS/contests/contest-1');

    expect(await screen.findByTestId('entry-list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('leaderboard-view')).not.toBeInTheDocument();
  });

  it.each(['ACTIVE', 'COMPLETED'] as const)('shows the leaderboard at the same address once the contest is %s', async (status) => {
    primeContest(status);

    renderAt('/league/BIGDAWGS/contests/contest-1');

    expect(await screen.findByTestId('leaderboard-view')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/BIGDAWGS\/contests\/contest-1$/);
  });

  it('holds the page frame while the contest loads', async () => {
    getContestMock.mockReturnValue(new Promise(() => {}));

    renderAt('/league/BIGDAWGS/contests/contest-1');

    expect(await screen.findByTestId('contest-page-pending-header')).toBeInTheDocument();
  });

  it('says the contest could not load, with Retry, when its read fails', async () => {
    getContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_NOT_FOUND', message: 'No contest' } }, status: 404 });

    renderAt('/league/BIGDAWGS/contests/contest-1');

    expect(await screen.findByText("We couldn't load this contest.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('redirects an old /leaderboard link to the contest\'s one page', async () => {
    primeContest('ACTIVE');

    renderAt('/league/BIGDAWGS/contests/contest-1/leaderboard');

    expect(await screen.findByTestId('leaderboard-view')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/BIGDAWGS\/contests\/contest-1$/);
  });
});
