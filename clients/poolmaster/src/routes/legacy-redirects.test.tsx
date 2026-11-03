import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  LegacyContestCreateRedirect,
  LegacyContestManageRedirect,
  LegacyContestTypesRedirect,
  LegacyGolfManageRedirect,
  LegacyManageContestsRedirect,
} from './legacy-redirects';

const { getLeagueByCodeMock } = vi.hoisted(() => ({ getLeagueByCodeMock: vi.fn() }));

bindApiMocks({ getLeagueByCode: getLeagueByCodeMock });

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1', isRootAdmin: false }, clearSession: vi.fn() }),
}));

afterEach(() => {
  getLeagueByCodeMock.mockReset();
});

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<LegacyManageContestsRedirect />} path="/league/:leagueCode/contests/manage" />
        <Route element={<LegacyContestCreateRedirect />} path="/league/:leagueCode/contests/new" />
        <Route element={<LegacyContestManageRedirect />} path="/league/:leagueCode/contests/:contestId/manage" />
        <Route element={<LocationProbe />} path="/league/:leagueCode/admin/*" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Contest setup links from before Commissioner tools', () => {
  it('sends the old Manage Contests link to the Commissioner tools contest list', () => {
    renderAt('/league/BIGDAWGS/contests/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contests');
  });

  it('sends the old Create contest link to Create contest in Commissioner tools', () => {
    renderAt('/league/BIGDAWGS/contests/new');

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contests/new');
  });

  it('sends an old manage-contest link to that contest\'s setup page in Commissioner tools', () => {
    renderAt('/league/BIGDAWGS/contests/contest-9/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contests/contest-9');
  });
});

function SearchProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderGolfLinkAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<LegacyGolfManageRedirect />} path="/manage/golf/*" />
        <Route element={<SearchProbe />} path="/manage/sports/*" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Golf Manage links from before every sport shared one set of pages', () => {
  it('sends an old tournament list link to golf\'s events', () => {
    renderGolfLinkAt('/manage/golf/tournaments');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events');
  });

  it('sends an old tournament scores link to that event\'s results page', () => {
    renderGolfLinkAt('/manage/golf/tournaments/evt-1/scores');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events/evt-1/results');
  });

  it('sends an old player link to that golfer\'s participant page and keeps the query', () => {
    renderGolfLinkAt('/manage/golf/players/p-1?tab=affiliations');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/participants/p-1?tab=affiliations');
  });

  it('sends an old tour link to the same tour under golf\'s leagues', () => {
    renderGolfLinkAt('/manage/golf/leagues/league-1/edit');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/leagues/league-1/edit');
  });

  it('sends the old golf root, or a list that no longer exists, to golf\'s events', () => {
    renderGolfLinkAt('/manage/golf/rankings');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events');
  });
});

describe('The Contest types link from before it moved to Commissioner tools', () => {
  function renderContestTypesLink(role: 'COMMISSIONER' | 'MEMBER') {
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs', isActive: true },
        membership: { id: 'membership-1', leagueId: 'league-1', userId: 'user-1', role, status: 'ACTIVE' },
        squadMembership: null,
      },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/league/BIGDAWGS/contest-types']}>
          <Routes>
            <Route element={<LegacyContestTypesRedirect />} path="/league/:leagueCode/contest-types" />
            <Route element={<LocationProbe />} path="/league/:leagueCode/admin/*" />
            <Route element={<LocationProbe />} path="/how-to-play" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('opens Contest types in Commissioner tools for a commissioner', async () => {
    renderContestTypesLink('COMMISSIONER');

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contest-types');
  });

  it('opens How to Play, which explains every contest type, for a member', async () => {
    renderContestTypesLink('MEMBER');

    expect(await screen.findByTestId('location')).toHaveTextContent('/how-to-play');
  });
});
