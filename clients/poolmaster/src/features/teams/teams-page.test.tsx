import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { TeamsPage } from './teams-page';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const listSquadOwnerInvitationsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  listSquadOwnerInvitations: (...args: unknown[]) => listSquadOwnerInvitationsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  revokeSquadOwnerInvitation: (...args: unknown[]) => revokeSquadOwnerInvitationMock(...args),
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
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('TeamsPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listLeagueSquadsMock.mockReset();
    listSquadOwnerInvitationsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    revokeSquadOwnerInvitationMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('shows joined teams and pending invites for commissioners', async () => {
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
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 0,
          role: 'COMMISSIONER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-16T00:00:00.000Z',
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
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-16T00:00:00.000Z',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
              },
            ],
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
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      data: {
        invitation: {
          id: 'invite-1',
          leagueId: 'league-1',
          squadId: 'team-1',
          email: 'friend@example.com',
          inviteCode: 'TEAM123',
          status: 'REVOKED',
          invitedBy: 'user-1',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
          team: {
            id: 'team-1',
            name: 'Beer Bellies',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          },
        },
      },
    });

    renderTeamsPage();

    await screen.findByTestId('teams-page');
    expect(screen.getByTestId('league-team-team-1')).toBeInTheDocument();
    expect(screen.getByTestId('team-owner-invitation-invite-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage team/i })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/team?teamId=team-1',
    );

    fireEvent.click(screen.getByTestId('team-owner-invitation-revoke-invite-1'));

    await waitFor(() =>
      expect(revokeSquadOwnerInvitationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', invitationId: 'invite-1' },
      }),
    );
  });
});
