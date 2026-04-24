import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { MyTeamPage } from './my-team-page';

const createLeagueSquadMock = vi.fn();
const enterContestMock = vi.fn();
const createSquadOwnerInvitationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const inactivateLeagueSquadMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const listSquadOwnerInvitationsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const removeSquadOwnerMock = vi.fn();
const replaceSquadOwnerMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();
const updateContestEntryMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

vi.mock('@/lib/api', () => ({
  createLeagueSquad: (...args: unknown[]) => createLeagueSquadMock(...args),
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  createSquadOwnerInvitation: (...args: unknown[]) => createSquadOwnerInvitationMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  inactivateLeagueSquad: (...args: unknown[]) => inactivateLeagueSquadMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  listSquadOwnerInvitations: (...args: unknown[]) => listSquadOwnerInvitationsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  removeSquadOwner: (...args: unknown[]) => removeSquadOwnerMock(...args),
  replaceSquadOwner: (...args: unknown[]) => replaceSquadOwnerMock(...args),
  revokeSquadOwnerInvitation: (...args: unknown[]) => revokeSquadOwnerInvitationMock(...args),
  updateContestEntry: (...args: unknown[]) => updateContestEntryMock(...args),
  updateLeagueSquad: (...args: unknown[]) => updateLeagueSquadMock(...args),
}));

function renderMyTeamPage() {
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
        <MemoryRouter initialEntries={['/league/BIGDAWGS/team']}>
          <Routes>
            <Route element={<MyTeamPage />} path="/league/:leagueCode/team" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('MyTeamPage', () => {
  afterEach(() => {
    createLeagueSquadMock.mockReset();
    enterContestMock.mockReset();
    createSquadOwnerInvitationMock.mockReset();
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    inactivateLeagueSquadMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    listLeagueSquadsMock.mockReset();
    listSquadOwnerInvitationsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    removeSquadOwnerMock.mockReset();
    replaceSquadOwnerMock.mockReset();
    revokeSquadOwnerInvitationMock.mockReset();
    updateContestEntryMock.mockReset();
    updateLeagueSquadMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('creates a team when the current user does not yet belong to one', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 0,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    createLeagueSquadMock.mockResolvedValue({
      data: {
        squad: {
          id: 'team-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: 'Derek Squad',
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          status: 'ACTIVE',
          memberCount: 1,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          members: [
            {
              id: 'membership-1',
              squadId: 'team-1',
              leagueId: 'league-1',
              userId: 'user-1',
              firstName: 'Derek',
              lastName: 'Dorazio',
              status: 'ACTIVE',
              joinedAt: '2026-04-15T00:00:00.000Z',
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T00:00:00.000Z',
            },
          ],
        },
      },
    });

    renderMyTeamPage();

    await screen.findByTestId('my-team-page');
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Derek Squad' },
    });
    fireEvent.click(screen.getByTestId('my-team-save'));

    await waitFor(() =>
      expect(createLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { name: 'Derek Squad', iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD },
      }),
    );
  });

  it('updates the current team name when the user already belongs to a team', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 0,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          {
            id: 'team-1',
            leagueId: 'league-1',
            createdBy: 'user-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            status: 'ACTIVE',
            memberCount: 1,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    updateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: {
          id: 'team-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: 'Updated Team',
          iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT,
          status: 'ACTIVE',
          memberCount: 1,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          members: [
            {
              id: 'membership-1',
              squadId: 'team-1',
              leagueId: 'league-1',
              userId: 'user-1',
              firstName: 'Derek',
              lastName: 'Dorazio',
              status: 'ACTIVE',
              joinedAt: '2026-04-15T00:00:00.000Z',
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T00:00:00.000Z',
            },
          ],
        },
      },
    });

    renderMyTeamPage();

    await screen.findByDisplayValue('Original Team');
    fireEvent.click(screen.getByTestId(`my-team-icon-${TeamIconKey.TURBO_TURTLE_MIDNIGHT}`));
    fireEvent.change(screen.getByTestId('my-team-name'), {
      target: { value: 'Updated Team' },
    });
    fireEvent.click(screen.getByTestId('my-team-save'));

    await waitFor(() =>
      expect(updateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { name: 'Updated Team', iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT },
      }),
    );
  });

  it('creates, replaces, removes, and revokes owner invites for an existing team', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 0,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          {
            id: 'team-1',
            leagueId: 'league-1',
            createdBy: 'user-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            status: 'ACTIVE',
            memberCount: 2,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
              {
                id: 'membership-2',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-2',
                firstName: 'Brendan',
                lastName: 'Haley',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          {
            id: 'invite-1',
            leagueId: 'league-1',
            squadId: 'team-1',
            email: 'pending@example.com',
            inviteCode: 'TEAM123',
            status: 'PENDING',
            invitedBy: 'user-1',
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            team: {
              id: 'team-1',
              name: 'Original Team',
              iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            },
          },
        ],
      },
    });
    createSquadOwnerInvitationMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-2',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'owner@example.com',
          inviteCode: 'TEAM124',
          status: 'PENDING',
          invitedBy: 'user-1',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });
    replaceSquadOwnerMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-3',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'replacement@example.com',
          inviteCode: 'TEAM125',
          status: 'PENDING',
          invitedBy: 'user-1',
          replacementForUserId: 'user-2',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });
    removeSquadOwnerMock.mockResolvedValue({
      data: {
        membership: {
          id: 'membership-2',
          squadId: 'team-1',
          leagueId: 'league-1',
          userId: 'user-2',
          status: 'INACTIVE',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-1',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'pending@example.com',
          inviteCode: 'TEAM123',
          status: 'REVOKED',
          invitedBy: 'user-1',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });

    renderMyTeamPage();

    await screen.findByDisplayValue('Original Team');

    fireEvent.change(screen.getByTestId('my-team-owner-email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByTestId('my-team-owner-invite'));

    await waitFor(() =>
      expect(createSquadOwnerInvitationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { email: 'owner@example.com' },
      }),
    );

    fireEvent.click(screen.getByTestId('my-team-open-replace-user-2'));
    fireEvent.change(screen.getByTestId('my-team-replace-email'), {
      target: { value: 'replacement@example.com' },
    });
    fireEvent.click(screen.getByTestId('my-team-replace-submit'));

    await waitFor(() =>
      expect(replaceSquadOwnerMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
        body: { email: 'replacement@example.com' },
      }),
    );

    fireEvent.click(screen.getByTestId('my-team-remove-owner-user-2'));

    await waitFor(() =>
      expect(removeSquadOwnerMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
      }),
    );

    fireEvent.click(screen.getByTestId('my-team-revoke-owner-invitation-invite-1'));

    await waitFor(() =>
      expect(revokeSquadOwnerInvitationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', invitationId: 'invite-1' },
      }),
    );
  });

  it('inactivates the current team', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 0,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          {
            id: 'team-1',
            leagueId: 'league-1',
            createdBy: 'user-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            status: 'ACTIVE',
            memberCount: 1,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    inactivateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: {
          id: 'team-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: 'Original Team',
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          status: 'INACTIVE',
          memberCount: 0,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          members: [],
        },
      },
    });

    renderMyTeamPage();

    await screen.findByDisplayValue('Original Team');
    fireEvent.click(screen.getByTestId('my-team-inactivate'));

    await waitFor(() =>
      expect(inactivateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
      }),
    );
  });

  it('routes active entry management and history to their dedicated pages', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 2,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          {
            id: 'team-1',
            leagueId: 'league-1',
            createdBy: 'user-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            status: 'ACTIVE',
            memberCount: 1,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    });
    listSquadOwnerInvitationsMock.mockResolvedValue({
      data: {
        invitations: [],
      },
    });
    renderMyTeamPage();

    expect(await screen.findByTestId('my-team-open-my-entries')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/entries',
    );
    expect(screen.getByTestId('my-team-open-my-history')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/history',
    );
    expect(screen.queryByTestId('my-team-history-contest-contest-complete')).not.toBeInTheDocument();
  });
});
