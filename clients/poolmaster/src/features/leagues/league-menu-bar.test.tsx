import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
} from './test/fixtures';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listLeagueSquads: listLeagueSquadsMock,
  refreshToken: refreshTokenMock,
});

function renderMenu({
  hasSquad = true,
  isRootAdmin = false,
  leagueRole = 'MEMBER',
  path = '/league/BIGDAWGS',
  squads = [buildLeagueSquad({ id: 'team-1', name: "Derek's Great Golf Guys" })],
}: {
  hasSquad?: boolean;
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
  path?: string;
  squads?: ReturnType<typeof buildLeagueSquad>[];
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    {
      membership: buildLeagueMembership({ role: leagueRole }),
      squadMembership: hasSquad ? buildLeagueSquadMember({ squadId: 'team-1' }) : null,
    },
  )));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess({ squads }));
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
    listLeagueSquadsMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('gives members Home, Contests, Championships, Contest types, their own squad by its name, and Members', async () => {
    renderMenu();

    const menu = within(await screen.findByRole('navigation', { name: 'League' }));
    expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/league/BIGDAWGS');
    expect(menu.getByRole('link', { name: 'Contests' })).toHaveAttribute('href', '/league/BIGDAWGS/contests');
    expect(menu.getByRole('link', { name: 'Championships' })).toHaveAttribute('href', '/league/BIGDAWGS/championships');
    expect(menu.getByRole('link', { name: 'Contest types' })).toHaveAttribute('href', '/league/BIGDAWGS/contest-types');
    expect(await menu.findByRole('link', { name: "Derek's Great Golf Guys" })).toHaveAttribute('href', '/league/BIGDAWGS/team');
    expect(menu.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/league/BIGDAWGS/teams');
    expect(menu.queryByRole('link', { name: /team/i })).not.toBeInTheDocument();
  });

  it('labels the viewer\'s own entry "Yours" when the viewer has no squad in the league', async () => {
    renderMenu({ hasSquad: false });

    const menu = within(await screen.findByRole('navigation', { name: 'League' }));
    await vi.waitFor(() => expect(listLeagueSquadsMock).toHaveBeenCalled());
    expect(menu.getByTestId('league-menu-my-team')).toHaveTextContent('Yours');
    expect(menu.queryByRole('link', { name: "Derek's Great Golf Guys" })).not.toBeInTheDocument();
  });

  it('labels the viewer\'s own entry "Yours" while their squad\'s name is still loading', async () => {
    renderMenu();
    listLeagueSquadsMock.mockReturnValue(new Promise(() => undefined));

    const menu = within(await screen.findByRole('navigation', { name: 'League' }));
    await vi.waitFor(() => expect(listLeagueSquadsMock).toHaveBeenCalled());
    expect(menu.getByTestId('league-menu-my-team')).toHaveTextContent('Yours');
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

  it('marks only Contest types on the contest types page, not Contests', () => {
    expect(activeLabel('/league/BIGDAWGS/contest-types')).toEqual(['Contest types']);
  });

  it('keeps Championships marked on every page of a year, down to a squad\'s cup points', () => {
    expect(activeLabel('/league/BIGDAWGS/championships/2026/race/pga/squads/team-2')).toEqual(['Championships']);
  });

  it('marks Championships, not the viewer\'s own entry, on All years', () => {
    expect(activeLabel('/league/BIGDAWGS/history')).toEqual(['Championships']);
  });

  it('marks Members, not the viewer\'s own entry, on another squad\'s page', () => {
    expect(activeLabel('/league/BIGDAWGS/teams/team-2')).toEqual(['Members']);
  });

  it('labels the viewer\'s own entry with their squad\'s name when one is given, and "Yours" otherwise', () => {
    const labelOf = (name?: string | null) => buildLeagueMenuItems('BIGDAWGS', '/league/BIGDAWGS', name)
      .find((item) => item.testId === 'league-menu-my-team')?.label;

    expect(labelOf("Derek's Great Golf Guys")).toBe("Derek's Great Golf Guys");
    expect(labelOf(null)).toBe('Yours');
    expect(labelOf()).toBe('Yours');
  });
});
