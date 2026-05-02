import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
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
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

vi.mock('@/lib/api', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  listLeagueMembers: (...args: unknown[]) => listLeagueMembersMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  listSquadOwnerInvitations: (...args: unknown[]) => listSquadOwnerInvitationsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  removeSquadOwner: (...args: unknown[]) => removeSquadOwnerMock(...args),
  changeMemberRole: (...args: unknown[]) => changeMemberRoleMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
}));

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

function buildLeagueDetail(role: 'COMMISSIONER' | 'MEMBER' = 'COMMISSIONER', isRootAdmin = false) {
  return {
    id: 'league-1',
    leagueCode: 'BIGDAWGS',
    name: 'Big Dawgs',
    isActive: true,
    iconKey: 'TROPHY',
    memberCount: 2,
    activeContestCount: 0,
    memberType: role,
    leagueRelationship: {
      leagueMember: true,
      commissioner: role === 'COMMISSIONER',
    },
    isRootAdmin,
    joinPolicy: 'COMMISSIONER_ONLY',
    createdAt: '2026-04-16T00:00:00.000Z',
  } as const;
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
    teamRelationship: {
      leagueMember: true,
      owner: true,
      commissioner: true,
    },
    isRootAdmin: false,
    members: [
      {
        id: 'membership-1',
        squadId: 'team-1',
        leagueId: 'league-1',
        userId: 'user-1',
        firstName: 'Derek',
        lastName: 'Dorazio',
        status: 'ACTIVE',
        joinedAt: '2026-04-16T00:00:00.000Z',
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
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
    useSessionStore.getState().clearSession();
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
      data: {
        league: buildLeagueDetail('COMMISSIONER'),
      },
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
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'COMMISSIONER',
            joinedAt: '2026-04-16T00:00:00.000Z',
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
      data: {
        league: buildLeagueDetail('COMMISSIONER'),
      },
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
                firstName: 'Derek',
                lastName: 'Dorazio',
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
                firstName: 'Fran',
                lastName: 'Lane',
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
            userId: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            role: 'COMMISSIONER',
            joinedAt: '2026-04-16T00:00:00.000Z',
          },
          {
            id: 'league-member-2',
            userId: 'user-2',
            email: 'fran@example.com',
            firstName: 'Fran',
            lastName: 'Lane',
            role: 'MEMBER',
            joinedAt: '2026-04-16T00:00:00.000Z',
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
