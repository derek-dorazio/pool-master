import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryLeagueRedirect } from './contest-entry-league-redirect';

const { getContestMock, getLeagueMock } = vi.hoisted(() => ({ getContestMock: vi.fn(), getLeagueMock: vi.fn() }));

bindApiMocks({ getContest: getContestMock, getLeague: getLeagueMock });

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1', isRootAdmin: false }, clearSession: vi.fn() }),
}));

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderUnscopedEntryLink() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/contests/contest-1/entries/entry-1']}>
        <Routes>
          <Route element={<ContestEntryLeagueRedirect />} path="/contests/:contestId/entries/:entryId" />
          <Route element={<LocationProbe />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('An entry link without its league', () => {
  it('replaces the URL with the entry\'s address under the contest\'s league, for a member', async () => {
    getContestMock.mockResolvedValue({ data: { contest: { id: 'contest-1', leagueId: 'league-1', name: 'Masters Pool', status: 'OPEN' } } });
    getLeagueMock.mockResolvedValue({
      data: { league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs' }, membership: null, squadMembership: null },
    });

    renderUnscopedEntryLink();

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1/entries/entry-1');
  });

  it('shows the contest entry error, and goes nowhere, when the viewer may not read the contest', async () => {
    getContestMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_ACCESS_DENIED', message: 'You are not a member of this league.' } },
      status: 403,
    });

    renderUnscopedEntryLink();

    expect(await screen.findByTestId('contest-entry-redirect-error')).toHaveTextContent('We couldn\'t load this contest entry.');
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
    expect(getLeagueMock).not.toHaveBeenCalled();
  });
});
