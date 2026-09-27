import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { TeamsPage } from './teams-page';

const {
  getCurrentUserMock,
  getLeagueByCodeMock,
  listLeagueMembersMock,
  listLeagueSquadsMock,
  listSquadOwnerInvitationsMock,
  logoutUserMock,
  mockLogger,
  removeSquadOwnerMock,
  changeMemberRoleMock,
  refreshTokenMock,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    getCurrentUserMock: vi.fn(),
    getLeagueByCodeMock: vi.fn(),
    listLeagueMembersMock: vi.fn(),
    listLeagueSquadsMock: vi.fn(),
    listSquadOwnerInvitationsMock: vi.fn(),
    logoutUserMock: vi.fn(),
    mockLogger: logger,
    removeSquadOwnerMock: vi.fn(),
    changeMemberRoleMock: vi.fn(),
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
  listLeagueMembers: listLeagueMembersMock,
  listLeagueSquads: listLeagueSquadsMock,
  listSquadOwnerInvitations: listSquadOwnerInvitationsMock,
  logoutUser: logoutUserMock,
  removeSquadOwner: removeSquadOwnerMock,
  changeMemberRole: changeMemberRoleMock,
  refreshToken: refreshTokenMock,
});

function renderTeamsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/league/BIGDAWGS/teams']}>
          <Routes>
            <Route element={<TeamsPage />} path="/league/:leagueCode/teams" />
            <Route element={<div data-testid="user-route-destination" />} path="/users/:userId" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const VIEWER_USER = {
  id: 'user-1',
  email: 'derek@example.com',
  username: 'derek@example.com',
  firstName: 'Derek',
  lastName: 'Dorazio',
  isActive: true,
  isRootAdmin: false,
  createdAt: '2026-04-16T00:00:00.000Z',
} as const;

function buildLeague() {
  return {
    id: 'league-1',
    leagueCode: 'BIGDAWGS',
    name: 'Big Dawgs',
    isActive: true,
    iconKey: 'TROPHY',
    memberCount: 2,
    activeContestCount: 0,
    joinPolicy: 'COMMISSIONER_ONLY',
    createdAt: '2026-04-16T00:00:00.000Z',
  } as const;
}

/**
 * #202 (A8) — the league-context read: the league plus the viewer's own edges in it, once. The
 * viewer's role used to be `memberType` and `leagueRelationship` on the league, and their own
 * squad a `teamRelationship.owner` flag repeated on every squad in the directory.
 */
function leagueContext(role: 'COMMISSIONER' | 'MEMBER' = 'COMMISSIONER') {
  return {
    league: buildLeague(),
    membership: {
      id: 'league-member-1',
      leagueId: 'league-1',
      userId: VIEWER_USER.id,
      user: VIEWER_USER,
      role,
      status: 'ACTIVE',
      joinedAt: '2026-04-16T00:00:00.000Z',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
    squadMembership: {
      id: 'membership-1',
      squadId: 'team-1',
      leagueId: 'league-1',
      userId: VIEWER_USER.id,
      user: VIEWER_USER,
      status: 'ACTIVE',
      joinedAt: '2026-04-16T00:00:00.000Z',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
  };
}

function buildTeamSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1',
    leagueId: 'league-1',
    createdBy: 'user-1',
    name: 'Beer Bellies',
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    status: 'ACTIVE',
    memberCount: 1,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    members: [
      {
        id: 'membership-1',
        squadId: 'team-1',
        leagueId: 'league-1',
        userId: 'user-1',
        user: { ...VIEWER_USER, id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' },
        status: 'ACTIVE',
        joinedAt: '2026-04-16T00:00:00.000Z',
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function primeAuthenticatedLeague(role: 'COMMISSIONER' | 'MEMBER' = 'COMMISSIONER') {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'derek@example.com',
        firstName: 'Derek',
        lastName: 'Dorazio',
        isActive: true,
        isRootAdmin: false,
        createdAt: '2026-04-16T00:00:00.000Z',
      },
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue({
    data: leagueContext(role),
  });
  listLeagueMembersMock.mockResolvedValue({
    data: {
      members: [
        {
          id: 'league-member-1',
          leagueId: 'league-1',
          userId: 'user-1',
          user: { ...VIEWER_USER, id: 'user-1', email: 'derek@example.com', username: 'derek@example.com', firstName: 'Derek', lastName: 'Dorazio' },
          role: role,
          status: 'ACTIVE',
          joinedAt: '2026-04-16T00:00:00.000Z',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      ],
    },
  });
  listSquadOwnerInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
}

describe('TeamsPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listLeagueMembersMock.mockReset();
    listLeagueSquadsMock.mockReset();
    listSquadOwnerInvitationsMock.mockReset();
    logoutUserMock.mockReset();
    removeSquadOwnerMock.mockReset();
    changeMemberRoleMock.mockReset();
    refreshTokenMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('pool-master-7wj.7 shows the teams loading state while the directory loads', async () => {
    primeAuthenticatedLeague();
    listLeagueSquadsMock.mockReturnValue(new Promise(() => undefined));

    renderTeamsPage();

    const loading = await screen.findByTestId('teams-page-teams-loading');
    expect(loading).toHaveAttribute('role', 'status');
  });

  it('pool-master-7wj.7 shows the teams error state when the directory fails', async () => {
    primeAuthenticatedLeague();
    listLeagueSquadsMock.mockRejectedValue(new Error('Teams unavailable'));

    renderTeamsPage();

    const error = await screen.findByTestId('teams-page-teams-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent("We couldn't load teams for this league.");
  });

  it('pool-master-7wj.7 shows the teams empty state when no teams exist', async () => {
    primeAuthenticatedLeague();
    listLeagueSquadsMock.mockResolvedValue({ data: { squads: [] } });

    renderTeamsPage();

    expect(await screen.findByTestId('teams-page-teams-empty')).toHaveTextContent('No teams yet');
  });

  it('renders the read-only teams and owners directory with team-home and owner links', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: leagueContext('COMMISSIONER'),
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [buildTeamSummary()],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            leagueId: 'league-1',
            userId: 'user-1',
            user: { ...VIEWER_USER, id: 'user-1', email: 'derek@example.com', username: 'derek@example.com', firstName: 'Derek', lastName: 'Dorazio' },
            role: 'COMMISSIONER',
            status: 'ACTIVE',
            joinedAt: '2026-04-16T00:00:00.000Z',
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          {
            id: 'invite-1',
            leagueId: 'league-1',
            squadId: 'team-1',
            email: 'friend@example.com',
            inviteCode: 'TEAM123',
            status: 'PENDING',
            invitedBy: 'user-1',
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
            team: {
              id: 'team-1',
              name: 'Beer Bellies',
              iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            },
          },
        ],
      },
    });

    renderTeamsPage();

    await screen.findByTestId('league-team-team-1');
    expect(screen.getByRole('heading', { name: 'Teams and Owners' })).toBeInTheDocument();
    expect(screen.getByTestId('league-team-team-1')).toBeInTheDocument();
    expect(screen.getByTestId('league-team-home-link-team-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/teams/team-1',
    );
    expect(screen.getByTestId('league-team-owner-link-team-1-user-1')).toHaveAttribute(
      'href',
      '/users/user-1',
    );
    expect(screen.getByTestId('teams-owner-actions-trigger-team-1-user-1')).toBeInTheDocument();
    expect(screen.getByTestId('league-team-owner-invitation-team-1-invite-1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
  });

  it('lets a commissioner promote an owner to commissioner from the teams directory', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: leagueContext('COMMISSIONER'),
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          buildTeamSummary({
            memberCount: 2,
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                user: { ...VIEWER_USER, id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' },
                status: 'ACTIVE',
                joinedAt: '2026-04-16T00:00:00.000Z',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
              },
              {
                id: 'membership-2',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-2',
                user: { ...VIEWER_USER, id: 'user-2', firstName: 'Fran', lastName: 'Lane' },
                status: 'ACTIVE',
                joinedAt: '2026-04-16T00:00:00.000Z',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
              },
            ],
          }),
        ],
      },
    });
    listLeagueMembersMock.mockResolvedValue({
      data: {
        members: [
          {
            id: 'league-member-1',
            leagueId: 'league-1',
            userId: 'user-1',
            user: { ...VIEWER_USER, id: 'user-1', email: 'derek@example.com', username: 'derek@example.com', firstName: 'Derek', lastName: 'Dorazio' },
            role: 'COMMISSIONER',
            status: 'ACTIVE',
            joinedAt: '2026-04-16T00:00:00.000Z',
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
          {
            id: 'league-member-2',
            leagueId: 'league-1',
            userId: 'user-2',
            user: { ...VIEWER_USER, id: 'user-2', email: 'fran@example.com', username: 'fran@example.com', firstName: 'Fran', lastName: 'Lane' },
            role: 'MEMBER',
            status: 'ACTIVE',
            joinedAt: '2026-04-16T00:00:00.000Z',
            createdAt: '2026-04-16T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    changeMemberRoleMock.mockResolvedValue({
      data: {
        membership: {
          id: 'league-member-2',
          leagueId: 'league-1',
          userId: 'user-2',
          role: 'COMMISSIONER',
          status: 'ACTIVE',
          joinedAt: '2026-04-16T00:00:00.000Z',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });

    renderTeamsPage();

    await screen.findByTestId('league-team-owner-team-1-user-2');
    fireEvent.click(screen.getByTestId('teams-owner-actions-trigger-team-1-user-2'));
    fireEvent.click(screen.getByTestId('teams-owner-actions-promote-team-1-user-2'));
    await screen.findByTestId('teams-owner-actions-dialog-team-1-user-2');
    fireEvent.click(screen.getByTestId('teams-owner-actions-confirm-promote-team-1-user-2'));

    await waitFor(() =>
      expect(changeMemberRoleMock).toHaveBeenCalledWith({
        path: { id: 'league-1', uid: 'user-2' },
        body: { role: 'COMMISSIONER' },
      }),
    );
  });

  it('shows the load failure state when the league detail cannot be loaded', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockRejectedValue(new Error('League missing'));
    listLeagueMembersMock.mockResolvedValue({ data: { members: [] } });

    renderTeamsPage();

    await screen.findByText("We couldn't load this league.");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'teams.league.failed',
      }),
      expect.any(String),
    );
  });
});
