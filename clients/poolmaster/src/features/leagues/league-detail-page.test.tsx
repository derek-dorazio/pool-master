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
const getContestMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const activateLeagueMock = vi.fn();
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
  activateLeague: (...args: unknown[]) => activateLeagueMock(...args),
  deleteLeague: (...args: unknown[]) => deleteLeagueMock(...args),
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  generateInviteLink: (...args: unknown[]) => generateInviteLinkMock(...args),
  getContest: (...args: unknown[]) => getContestMock(...args),
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

  const renderResult = render(
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
            <Route element={<div data-testid="manage-leagues-page" />} path="/manage/leagues" />
            <Route element={<div data-testid="welcome-page" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );

  return {
    ...renderResult,
    queryClient,
  };
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
        memberType: leagueRole,
        leagueRelationship: {
          leagueMember: true,
          commissioner: leagueRole === 'COMMISSIONER',
        },
        isRootAdmin,
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
    activateLeagueMock.mockReset();
    deleteLeagueMock.mockReset();
    enterContestMock.mockReset();
    generateInviteLinkMock.mockReset();
    getContestMock.mockReset();
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

  it('updates league details by syncing the cached league detail instead of refetching it', async () => {
    primeCommonMocks();
    const { queryClient } = renderLeagueDetailPage();
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
          memberType: 'COMMISSIONER',
          leagueRelationship: {
            leagueMember: true,
            commissioner: true,
          },
          isRootAdmin: false,
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-open-details'));
    await screen.findByTestId('league-details-modal');
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
    expect(getLeagueByCodeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('league-home')).toBeVisible();
    expect(queryClient.getQueryData(['poolmaster', 'league', 'BIGDAWGS'])).toMatchObject({
      name: 'Bigger Dawgs',
      description: 'Updated description',
    });
    expect(queryClient.getQueryData(['poolmaster', 'leagues'])).toEqual([
      expect.objectContaining({
        id: 'league-1',
        name: 'Bigger Dawgs',
      }),
    ]);
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
    fireEvent.click(screen.getByTestId('league-leave-open'));
    await screen.findByTestId('league-leave-modal');
    fireEvent.click(screen.getByTestId('league-leave'));

    expect(await screen.findByTestId('league-leave-error')).toHaveTextContent(
      'Appoint another commissioner before the last commissioner leaves or steps down.',
    );
  });

  // pool-master-7j3 / pool-master-9r6 — League Home no longer owns contest
  // lists or completed history; League Contests owns both surfaces.
  it('does not load or render contest lists on League Home', async () => {
    primeCommonMocks();

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.queryByTestId('league-contest-contest-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('league-history-contest-contest-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Completed contest history')).not.toBeInTheDocument();
    expect(listContestsMock).not.toHaveBeenCalled();
    expect(listContestEntriesMock).not.toHaveBeenCalled();
    expect(getContestMock).not.toHaveBeenCalled();
  });

  it('pool-master-zi0 renders join policy and lifecycle in the details/actions layout', async () => {
    primeCommonMocks();

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');

    expect(screen.getByTestId('league-details-tile')).toHaveTextContent('Join policy');
    expect(screen.getByTestId('league-join-policy')).toHaveTextContent('COMMISSIONER_ONLY');

    expect(screen.getByTestId('league-actions-tile')).toHaveTextContent('Inactivate');
    expect(screen.getByTestId('league-lifecycle-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('league-lifecycle-helper')).toHaveTextContent(
      'The league is currently Active, inactivating the league will prevent further usage but will maintain history. The league can be deleted after being made inactive.',
    );
    expect(screen.getByTestId('league-inactivate')).toHaveTextContent('Inactivate');
    expect(screen.queryByTestId('league-activate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('league-delete-open')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-lifecycle-section')).not.toHaveTextContent(
      'Lifecycle stays inline on League Home',
    );
  });

  // pool-master-4uq — inactive leagues expose activate/delete in the compact lifecycle row.
  it('shows inactive lifecycle actions and activates immediately', async () => {
    primeCommonMocks({ isActive: false });
    activateLeagueMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          description: 'A test league',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 1,
          memberType: 'COMMISSIONER',
          leagueRelationship: {
            leagueMember: true,
            commissioner: true,
          },
          isRootAdmin: false,
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.getByTestId('league-lifecycle-status')).toHaveTextContent('Inactive');
    expect(screen.getByTestId('league-lifecycle-status')).toHaveClass('text-destructive');
    expect(screen.getByTestId('league-lifecycle-helper')).toHaveTextContent(
      'The league is currently Inactive, click Activate to reactivate your league.',
    );
    expect(screen.getByTestId('league-activate')).toBeInTheDocument();
    expect(screen.getByTestId('league-delete-open')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('league-activate'));

    await waitFor(() =>
      expect(activateLeagueMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
      }),
    );
  });

  // pool-master-8lt — commissioners can create and copy a join URL without email delivery.
  it('creates a copyable join URL from League details', async () => {
    primeCommonMocks();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    generateInviteLinkMock.mockResolvedValue({
      data: {
        invitation: {
          inviteCode: 'invite-abc',
        },
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.getByTestId('league-join-url')).toHaveValue('');

    fireEvent.click(screen.getByTestId('league-create-join-url'));

    await waitFor(() =>
      expect(generateInviteLinkMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: {},
      }),
    );
    expect(screen.getByTestId('league-join-url')).toHaveValue(
      'http://localhost:3000/invite/invite-abc',
    );

    fireEvent.click(screen.getByTestId('league-copy-join-url'));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/invite/invite-abc')),
    );
  });

  // pool-master-dxd.16 — the current league icon is derived from query cache,
  // with only the modal draft held locally while editing.
  it('updates the league icon from a modal and returns to League Home with the new icon', async () => {
    primeCommonMocks();
    updateLeagueIconMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          description: 'A test league',
          isActive: true,
          iconKey: 'GOLF_BALL',
          memberCount: 2,
          activeContestCount: 1,
          memberType: 'COMMISSIONER',
          leagueRelationship: {
            leagueMember: true,
            commissioner: true,
          },
          isRootAdmin: false,
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.getByTestId('league-current-icon-label')).toHaveTextContent('Trophy');

    fireEvent.click(screen.getByTestId('league-change-icon'));
    await screen.findByTestId('league-icon-modal');

    fireEvent.click(screen.getByTestId('league-icon-GOLF_BALL'));
    fireEvent.click(screen.getByTestId('league-save-icon'));

    await waitFor(() =>
      expect(updateLeagueIconMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { iconKey: 'GOLF_BALL' },
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('league-icon-modal')).not.toBeInTheDocument());
    expect(screen.getByTestId('league-current-icon-label')).toHaveTextContent('Golf Ball');
  });

  it('lets a commissioner delete an inactive league after modal confirmation', async () => {
    primeCommonMocks({ isActive: false });
    deleteLeagueMock.mockResolvedValue({
      data: {
        success: true,
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-delete-open'));
    expect(await screen.findByTestId('league-delete-modal')).toBeInTheDocument();
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

  it('pool-master-hna returns root admins to Manage Leagues after deleting an inactive league', async () => {
    primeCommonMocks({ isActive: false, isRootAdmin: true });
    deleteLeagueMock.mockResolvedValue({
      data: {
        success: true,
      },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-delete-open'));
    expect(await screen.findByTestId('league-delete-modal')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('league-delete-confirmation'), {
      target: { value: 'BIGDAWGS' },
    });
    fireEvent.click(screen.getByTestId('league-delete-submit'));

    expect(await screen.findByTestId('manage-leagues-page')).toBeVisible();
  });
});
