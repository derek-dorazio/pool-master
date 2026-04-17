import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { JoinLeaguePage } from './join-league-page';

const acceptInvitationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getInvitationPreviewMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

vi.mock('@/lib/api', () => ({
  acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getInvitationPreview: (...args: unknown[]) => getInvitationPreviewMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  updateLeagueSquad: (...args: unknown[]) => updateLeagueSquadMock(...args),
}));

function renderJoinLeaguePage(initialEntry = '/invite/LEAGUE123') {
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
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<JoinLeaguePage />} path="/invite/:inviteCode" />
            <Route element={<div data-testid="league-destination" />} path="/league/:leagueCode" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('JoinLeaguePage', () => {
  afterEach(() => {
    acceptInvitationMock.mockReset();
    getCurrentUserMock.mockReset();
    getInvitationPreviewMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    updateLeagueSquadMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('lets an authenticated member set team name and icon during join', async () => {
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
    getInvitationPreviewMock.mockResolvedValue({
      data: {
        invitation: {
          inviteCode: 'LEAGUE123',
          status: 'PENDING',
          league: {
            id: 'league-1',
            leagueCode: 'BIGDAWGS',
            name: 'Big Dawgs',
          },
        },
      },
    });
    acceptInvitationMock.mockResolvedValue({
      data: {
        membership: {
          id: 'membership-1',
          leagueId: 'league-1',
          userId: 'user-1',
          role: 'MEMBER',
          status: 'ACTIVE',
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
            name: "Derek Dorazio's Team",
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
    updateLeagueSquadMock.mockResolvedValue({
      data: {
        squad: {
          id: 'team-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: 'Beer Bellies',
          iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT,
          status: 'ACTIVE',
          memberCount: 1,
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
          members: [],
        },
      },
    });

    renderJoinLeaguePage();

    await screen.findByTestId('join-league-page');
    fireEvent.change(screen.getByTestId('join-league-team-name'), {
      target: { value: 'Beer Bellies' },
    });
    fireEvent.click(screen.getByTestId(`join-league-team-icon-${TeamIconKey.TURBO_TURTLE_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('invite-accept'));

    await waitFor(() =>
      expect(updateLeagueSquadMock).toHaveBeenCalledWith({
        path: { id: 'league-1', squadId: 'team-1' },
        body: { name: 'Beer Bellies', iconKey: TeamIconKey.TURBO_TURTLE_MIDNIGHT },
      }),
    );
    await screen.findByTestId('league-destination');
  });
});
