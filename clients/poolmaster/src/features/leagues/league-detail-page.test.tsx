import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { LeagueDetailPage } from './league-detail-page';

const deleteLeagueMock = vi.fn();
const enterContestMock = vi.fn();
const generateInviteLinkMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const inactivateLeagueMock = vi.fn();
const leaveLeagueMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const sendLeagueInvitationsMock = vi.fn();
const updateLeagueDetailsMock = vi.fn();
const updateLeagueIconMock = vi.fn();

vi.mock('@/lib/api', () => ({
  deleteLeague: (...args: unknown[]) => deleteLeagueMock(...args),
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  generateInviteLink: (...args: unknown[]) => generateInviteLinkMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  inactivateLeague: (...args: unknown[]) => inactivateLeagueMock(...args),
  leaveLeague: (...args: unknown[]) => leaveLeagueMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  sendLeagueInvitations: (...args: unknown[]) => sendLeagueInvitationsMock(...args),
  updateLeagueDetails: (...args: unknown[]) => updateLeagueDetailsMock(...args),
  updateLeagueIcon: (...args: unknown[]) => updateLeagueIconMock(...args),
}));

function renderLeagueDetailPage() {
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
        <MemoryRouter initialEntries={['/league/BIGDAWGS']}>
          <Routes>
            <Route element={<LeagueDetailPage />} path="/league/:leagueCode" />
            <Route element={<div data-testid="team-page" />} path="/league/:leagueCode/teams/:teamId" />
            <Route
              element={<div data-testid="contest-page" />}
              path="/league/:leagueCode/contests/:contestId"
            />
            <Route element={<div data-testid="welcome-page" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCommonMocks({
  isRootAdmin = false,
  leagueRole = 'COMMISSIONER',
  isActive = true,
}: {
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
  isActive?: boolean;
} = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'commissioner@example.com',
        firstName: 'Casey',
        lastName: 'Commissioner',
        isActive: true,
        isRootAdmin,
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
        description: 'A test league',
        isActive,
        iconKey: 'TROPHY',
        memberCount: 2,
        activeContestCount: 1,
        role: leagueRole,
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
  listContestsMock.mockResolvedValue({
    data: {
      contests: [],
    },
  });
  listLeagueSquadsMock.mockResolvedValue({
    data: {
      squads: [
        {
          id: 'team-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: 'Casey Crushers',
          iconKey: 'CAPTAIN_SMILE_FIELD',
          status: 'ACTIVE',
          memberCount: 1,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          members: [
            {
              id: 'team-membership-1',
              squadId: 'team-1',
              leagueId: 'league-1',
              userId: 'user-1',
              firstName: 'Casey',
              lastName: 'Commissioner',
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
}

describe('LeagueDetailPage', () => {
  afterEach(() => {
    deleteLeagueMock.mockReset();
    enterContestMock.mockReset();
    generateInviteLinkMock.mockReset();
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    inactivateLeagueMock.mockReset();
    leaveLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
    updateLeagueDetailsMock.mockReset();
    updateLeagueIconMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('lets a commissioner update league details inline on league home', async () => {
    primeCommonMocks();
    updateLeagueDetailsMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Bigger Dawgs',
          description: 'Updated description',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 1,
          role: 'COMMISSIONER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(
      screen
        .getAllByRole('link', { name: 'Manage Contests' })
        .every((link) => link.getAttribute('href') === '/league/BIGDAWGS/contests/manage'),
    ).toBe(true);
    fireEvent.change(screen.getByTestId('league-details-name'), {
      target: { value: 'Bigger Dawgs' },
    });
    fireEvent.change(screen.getByTestId('league-details-description'), {
      target: { value: 'Updated description' },
    });
    fireEvent.click(screen.getByTestId('league-save-details'));

    await waitFor(() =>
      expect(updateLeagueDetailsMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: {
          name: 'Bigger Dawgs',
          description: 'Updated description',
        },
      }),
    );
  });

  it('shows a clear handoff message when the last commissioner tries to leave', async () => {
    primeCommonMocks();
    leaveLeagueMock.mockResolvedValue({
      error: {
        code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
        message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-leave'));

    expect(await screen.findByTestId('league-leave-error')).toHaveTextContent(
      'Appoint another commissioner before the last commissioner leaves or steps down.',
    );
  });

  it('shows only the current team entries on league contest tiles', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-1',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'SINGLE_EVENT',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 4,
          },
        ],
      },
    });
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 4,
        isJoined: true,
        myEntryId: 'entry-1',
        myEntryIds: ['entry-1', 'entry-2'],
        entries: [
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'team-1',
            squadName: 'Casey Crushers',
            entryNumber: 1,
            name: 'Casey Crushers Entry 1',
            status: 'ACTIVE',
            totalScore: 7,
            standingsPosition: 3,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'team-1',
            squadName: 'Casey Crushers',
            entryNumber: 2,
            name: 'Casey Crushers Entry 2',
            status: 'ACTIVE',
            totalScore: 3,
            standingsPosition: 1,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
          {
            id: 'entry-3',
            contestId: 'contest-1',
            squadId: 'team-9',
            squadName: 'Other Team',
            entryNumber: 1,
            name: 'Other Team Entry 1',
            status: 'ACTIVE',
            totalScore: 15,
            standingsPosition: 4,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });

    renderLeagueDetailPage();

    expect(await screen.findByTestId('league-contest-contest-1')).toBeInTheDocument();
    expect(await screen.findByTestId('league-contest-entry-entry-1')).toHaveTextContent(
      'Casey Crushers Entry 1',
    );
    expect(screen.getByTestId('league-contest-entry-entry-2')).toHaveTextContent(
      'Casey Crushers Entry 2',
    );
    expect(screen.queryByText('Other Team Entry 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-create-entry-contest-1')).toHaveTextContent('Create entry');
  });

  it('lets a root admin delete an inactive league after confirmation', async () => {
    primeCommonMocks({ isRootAdmin: true, leagueRole: 'MEMBER', isActive: false });
    deleteLeagueMock.mockResolvedValue({
      data: {
        success: true,
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.change(screen.getByTestId('league-delete-confirmation'), {
      target: { value: 'BIGDAWGS' },
    });
    fireEvent.click(screen.getByTestId('league-delete-submit'));

    await waitFor(() =>
      expect(deleteLeagueMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { leagueCode: 'BIGDAWGS' },
      }),
    );
  });
});
