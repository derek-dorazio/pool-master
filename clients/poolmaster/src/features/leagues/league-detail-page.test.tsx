import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { LeagueDetailPage } from './league-detail-page';

const changeMemberRoleMock = vi.fn();
const enterContestMock = vi.fn();
const generateInviteLinkMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const leaveLeagueMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const removeMemberMock = vi.fn();
const sendLeagueInvitationsMock = vi.fn();

vi.mock('@/lib/api', () => ({
  changeMemberRole: (...args: unknown[]) => changeMemberRoleMock(...args),
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  generateInviteLink: (...args: unknown[]) => generateInviteLinkMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  leaveLeague: (...args: unknown[]) => leaveLeagueMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueMembers: (...args: unknown[]) => listLeagueMembersMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
  sendLeagueInvitations: (...args: unknown[]) => sendLeagueInvitationsMock(...args),
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
            <Route element={<div data-testid="team-page" />} path="/league/:leagueCode/team" />
            <Route element={<div data-testid="contest-page" />} path="/contests/:contestId" />
            <Route element={<div data-testid="welcome-page" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCommonMocks() {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'commissioner@example.com',
        firstName: 'Casey',
        lastName: 'Commissioner',
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
        description: 'A test league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 2,
        activeContestCount: 0,
        role: 'COMMISSIONER',
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
  listLeagueMembersMock.mockResolvedValue({
    data: {
      members: [
        {
          id: 'membership-1',
          userId: 'user-1',
          email: 'commissioner@example.com',
          firstName: 'Casey',
          lastName: 'Commissioner',
          role: 'COMMISSIONER',
          joinedAt: '2026-04-15T00:00:00.000Z',
        },
        {
          id: 'membership-2',
          userId: 'user-2',
          email: 'member@example.com',
          firstName: 'Morgan',
          lastName: 'Member',
          role: 'MEMBER',
          joinedAt: '2026-04-16T00:00:00.000Z',
        },
      ],
    },
  });
}

describe('LeagueDetailPage', () => {
  afterEach(() => {
    changeMemberRoleMock.mockReset();
    enterContestMock.mockReset();
    generateInviteLinkMock.mockReset();
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    leaveLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    listLeagueMembersMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    removeMemberMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('allows a commissioner to promote a member from the roster', async () => {
    primeCommonMocks();
    changeMemberRoleMock.mockResolvedValue({
      data: {
        membership: {
          id: 'membership-2',
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

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-member-promote-membership-2'));

    await waitFor(() =>
      expect(changeMemberRoleMock).toHaveBeenCalledWith({
        path: { id: 'league-1', uid: 'user-2' },
        body: { role: 'COMMISSIONER' },
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

  it('creates another entry for the current team from league home', async () => {
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
            entryCount: 1,
          },
        ],
      },
    });
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 1,
        isJoined: true,
        myEntryId: 'entry-1',
        myEntryIds: ['entry-1'],
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
        ],
      },
    });
    enterContestMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        entry: {
          id: 'entry-2',
          contestId: 'contest-1',
          squadId: 'team-1',
          squadName: 'Casey Crushers',
          entryNumber: 2,
          name: 'Casey Crushers Entry 2',
          status: 'ACTIVE',
          totalScore: 0,
          standingsPosition: undefined,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    renderLeagueDetailPage();

    expect(await screen.findByTestId('league-create-entry-contest-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('league-create-entry-contest-1'));

    await waitFor(() =>
      expect(enterContestMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1' },
      }),
    );
  });
});
