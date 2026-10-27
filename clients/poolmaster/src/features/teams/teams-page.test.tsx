import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SquadMembershipStatus } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
  listLeagueSquadsData,
} from '@/features/leagues/test/fixtures';
import { TeamsPage } from './teams-page';

const { getCurrentUserMock, getLeagueByCodeMock, listLeagueSquadsMock, mockLogger, refreshTokenMock } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getCurrentUserMock: vi.fn(),
    getLeagueByCodeMock: vi.fn(),
    listLeagueSquadsMock: vi.fn(),
    mockLogger: logger,
    refreshTokenMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listLeagueSquads: listLeagueSquadsMock,
  refreshToken: refreshTokenMock,
});

function renderTeamsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/league/BIGDAWGS/teams']}>
          <Routes>
            <Route element={<TeamsPage />} path="/league/:leagueCode/teams" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function owner(userId: string, firstName: string, lastName: string, teamId: string) {
  return buildLeagueSquadMember({
    id: `membership-${userId}`,
    squadId: teamId,
    userId,
    user: buildCurrentUser({ id: userId, firstName, lastName }),
  });
}

function primeMemberViewer() {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership({ role: 'MEMBER' }) },
  )));
}

afterEach(() => {
  for (const mock of [getCurrentUserMock, getLeagueByCodeMock, listLeagueSquadsMock, refreshTokenMock, mockLogger.warn]) {
    mock.mockReset();
  }
});

describe('Members directory', () => {
  it('shows a loading state while the teams load', async () => {
    primeMemberViewer();
    listLeagueSquadsMock.mockReturnValue(new Promise(() => undefined));

    renderTeamsPage();

    expect(await screen.findByTestId('teams-page-teams-loading')).toHaveAttribute('role', 'status');
  });

  it('says the members could not be loaded when the list fails', async () => {
    primeMemberViewer();
    listLeagueSquadsMock.mockRejectedValue(new Error('Teams unavailable'));

    renderTeamsPage();

    expect(await screen.findByTestId('teams-page-teams-error')).toHaveTextContent("We couldn't load this league's members.");
  });

  it('says no one has joined yet when the league has no squads', async () => {
    primeMemberViewer();
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([])));

    renderTeamsPage();

    expect(await screen.findByTestId('teams-table')).toHaveTextContent('No one has joined this league yet.');
  });

  it('titles the page Members and lists every squad by name with a link to its page, its active owners by name and the date it joined, marking inactive ones', async () => {
    primeMemberViewer();
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
      buildLeagueSquad({
        members: [
          owner('user-1', 'Casey', 'Commissioner', 'team-1'),
          owner('user-3', 'Riley', 'Cowner', 'team-1'),
          { ...owner('user-4', 'Former', 'Owner', 'team-1'), status: SquadMembershipStatus.INACTIVE },
        ],
      }),
      buildLeagueSquad({ id: 'team-2', name: 'Retired Rockets', isActive: false, members: [] }),
    ])));

    renderTeamsPage();

    const first = within(await screen.findByTestId('league-team-team-1'));
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(first.getByTestId('league-team-home-link-team-1')).toHaveAttribute('href', '/league/BIGDAWGS/teams/team-1');
    expect(first.getByText('Casey Commissioner, Riley Cowner')).toBeInTheDocument();
    expect(first.queryByText(/Former/)).not.toBeInTheDocument();
    expect(first.queryByText('Inactive')).not.toBeInTheDocument();

    expect(first.getByText('4/14/2026')).toBeInTheDocument();

    const second = within(screen.getByTestId('league-team-team-2'));
    expect(second.getByText('Inactive')).toBeInTheDocument();
    expect(second.getByText('No owners')).toBeInTheDocument();
  });

  it('finds a member by an owner\'s name and offers no management actions to a member', async () => {
    primeMemberViewer();
    listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
      buildLeagueSquad(),
      buildLeagueSquad({ id: 'team-2', name: 'Second Team', members: [owner('user-2', 'Morgan', 'Member', 'team-2')] }),
    ])));

    renderTeamsPage();

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find a member or owner' }), {
      target: { value: 'morgan' },
    });

    expect(await screen.findByTestId('league-team-team-2')).toBeInTheDocument();
    expect(screen.queryByTestId('league-team-team-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a member or owner' }), {
      target: { value: 'nobody' },
    });
    expect(await screen.findByText('No members match that search.')).toBeInTheDocument();
  });

  it('shows the league load failure and logs it when the league cannot be loaded', async () => {
    primeMemberViewer();
    getLeagueByCodeMock.mockRejectedValue(new Error('League missing'));

    renderTeamsPage();

    expect(await screen.findByText("We couldn't load this league.")).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'teams.league.failed' }),
      expect.any(String),
    );
  });
});
