import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LeagueMenuBar } from './league-menu-bar';
import { buildLeagueMenuItems } from './league-menu-items';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  getLeagueByCodeData,
} from './test/fixtures';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  refreshToken: refreshTokenMock,
});

function renderMenu({
  isRootAdmin = false,
  leagueRole = 'MEMBER',
  path = '/league/BIGDAWGS',
}: {
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
  path?: string;
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership({ role: leagueRole }) },
  )));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LeagueMenuBar leagueCode="BIGDAWGS" />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LeagueMenuBar', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('gives members Home, Contests, My team and Teams', async () => {
    renderMenu();

    const menu = within(await screen.findByRole('navigation', { name: 'League' }));
    expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/league/BIGDAWGS');
    expect(menu.getByRole('link', { name: 'Contests' })).toHaveAttribute('href', '/league/BIGDAWGS/contests');
    expect(menu.getByRole('link', { name: 'My team' })).toHaveAttribute('href', '/league/BIGDAWGS/team');
    expect(menu.getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/league/BIGDAWGS/teams');
  });

  it('never shows a member the Commissioner tools button', async () => {
    renderMenu({ leagueRole: 'MEMBER' });

    await screen.findByRole('navigation', { name: 'League' });
    await vi.waitFor(() => expect(getLeagueByCodeMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /Commissioner tools/ })).not.toBeInTheDocument();
  });

  it('shows a commissioner the Commissioner tools button', async () => {
    renderMenu({ leagueRole: 'COMMISSIONER' });

    expect(await screen.findByRole('link', { name: /Commissioner tools/ })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/admin',
    );
  });

  it('shows a root admin looking at the league the Commissioner tools button', async () => {
    renderMenu({ isRootAdmin: true, leagueRole: 'MEMBER' });

    expect(await screen.findByRole('link', { name: /Commissioner tools/ })).toBeInTheDocument();
  });
});

describe('buildLeagueMenuItems', () => {
  function activeLabel(pathname: string) {
    return buildLeagueMenuItems('BIGDAWGS', pathname).filter((item) => item.isActive).map((item) => item.label);
  }

  it('marks only Home on League Home', () => {
    expect(activeLabel('/league/BIGDAWGS')).toEqual(['Home']);
  });

  it('keeps Contests marked on a contest\'s own pages', () => {
    expect(activeLabel('/league/BIGDAWGS/contests/contest-1/leaderboard')).toEqual(['Contests']);
  });

  it('marks My team on the team history page it links to', () => {
    expect(activeLabel('/league/BIGDAWGS/history')).toEqual(['My team']);
  });

  it('marks Teams, not My team, on another team\'s page', () => {
    expect(activeLabel('/league/BIGDAWGS/teams/team-2')).toEqual(['Teams']);
  });
});
