import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { MyTeamPage } from './my-team-page';

const createLeagueSquadMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

vi.mock('@/lib/api', () => ({
  createLeagueSquad: (...args: unknown[]) => createLeagueSquadMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
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
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
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
});
