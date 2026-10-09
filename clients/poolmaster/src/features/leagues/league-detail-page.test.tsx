import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LeagueDetailPage } from './league-detail-page';
import {
  activateLeagueData,
  apiSuccess,
  buildCurrentUser,
  buildLeagueMembership,
  buildLeague,
  buildLeagueSquad,
  buildLeagueSquadMember,
  deleteLeagueData,
  getLeagueByCodeData,
  inactivateLeagueData,
  listLeagueSquadsData,
  listLeaguesData,
  updateLeagueDetailsData,
  updateLeagueIconData,
} from './test/fixtures';
import { QueryKeys } from '@/lib/query-keys';

const deleteLeagueMock = vi.fn();
const enterContestMock = vi.fn();
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
const updateLeagueDetailsMock = vi.fn();
const updateLeagueIconMock = vi.fn();

bindApiMocks({
  activateLeague: activateLeagueMock,
  deleteLeague: deleteLeagueMock,
  enterContest: enterContestMock,
  getContest: getContestMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  inactivateLeague: inactivateLeagueMock,
  leaveLeague: leaveLeagueMock,
  listContestEntries: listContestEntriesMock,
  listContests: listContestsMock,
  listLeagueSquads: listLeagueSquadsMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
  updateLeagueDetails: updateLeagueDetailsMock,
  updateLeagueIcon: updateLeagueIconMock,
});

/** Shows the current history entry's state, so a test can see what Back or a reload would bring back. */
function HistoryStateProbe() {
  return <div data-testid="history-state">{JSON.stringify(useLocation().state ?? null)}</div>;
}

function LeagueRouteControls() {
  const navigate = useNavigate();

  return (
    <button data-testid="go-next-league" onClick={() => navigate('/league/NEWDOGS')} type="button">
      Next league
    </button>
  );
}

function renderLeagueDetailPage(initialEntry: string | { pathname: string; state: unknown } = '/league/BIGDAWGS') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              element={(
                <>
                  <LeagueRouteControls />
                  <HistoryStateProbe />
                  <LeagueDetailPage />
                </>
              )}
              path="/league/:leagueCode"
            />
            <Route element={<div data-testid="team-page" />} path="/league/:leagueCode/teams/:teamId" />
            <Route
              element={<div data-testid="contest-page" />}
              path="/league/:leagueCode/contests/:contestId"
            />
            <Route element={<div data-testid="manage-leagues-page" />} path="/manage/leagues" />
            <Route element={<div data-testid="welcome-page" />} path="/welcome" />
            <Route element={<div data-testid="signed-out-home" />} path="/" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );

  return {
    ...view,
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
  getCurrentUserMock.mockResolvedValue(apiSuccess({
    user: buildCurrentUser({ isRootAdmin }),
  }));
  refreshTokenMock.mockResolvedValue({ data: null });
  // #202 (A8) — the viewer's role now rides on their membership in the league context, and
  // root admin on the cached session user, not on the league.
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ isActive }),
    { membership: buildLeagueMembership({ role: leagueRole }) },
  )));
  listContestsMock.mockResolvedValue({
    data: {
      contests: [],
    },
  });
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
    buildLeagueSquad({
      members: [buildLeagueSquadMember()],
    }),
  ])));
}

describe('pool-master-rop.23: LeagueDetailPage generated DTO fixtures', () => {
  afterEach(() => {
    activateLeagueMock.mockReset();
    deleteLeagueMock.mockReset();
    enterContestMock.mockReset();
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
    updateLeagueDetailsMock.mockReset();
    updateLeagueIconMock.mockReset();
  });

  it('pool-master-rop.23: updates league details by syncing the cached league detail instead of refetching it', async () => {
    primeCommonMocks();
    const { queryClient } = renderLeagueDetailPage();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({
      name: 'Bigger Dawgs',
      description: 'Updated description',
    }))));

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
    // #202 — the league-context cache holds the league WITH the viewer's edges, and the list
    // cache holds `{ leagues, memberships }`. A rename replaces only the league part of each.
    expect(queryClient.getQueryData(QueryKeys.leagues.detail('BIGDAWGS'))).toMatchObject({
      league: {
        name: 'Bigger Dawgs',
        description: 'Updated description',
      },
    });
    expect(queryClient.getQueryData(QueryKeys.leagues.list)).toMatchObject({
      leagues: [
        expect.objectContaining({
          id: 'league-1',
          name: 'Bigger Dawgs',
        }),
      ],
    });
  });

  it('pool-master-rop.20 preserves unsaved league detail drafts across query refetches', async () => {
    primeCommonMocks();
    const { queryClient } = renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-open-details'));
    await screen.findByTestId('league-details-modal');
    fireEvent.change(screen.getByTestId('league-details-name'), {
      target: { value: 'Unsaved League Name' },
    });
    fireEvent.change(screen.getByTestId('league-details-description'), {
      target: { value: 'Unsaved description' },
    });

    getLeagueByCodeMock.mockResolvedValueOnce(apiSuccess(getLeagueByCodeData(buildLeague({
      name: 'Server Snapshot League',
      description: 'Server snapshot description',
    }))));

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: QueryKeys.leagues.detail('BIGDAWGS') });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(QueryKeys.leagues.detail('BIGDAWGS'))).toMatchObject({
        league: {
          name: 'Server Snapshot League',
          description: 'Server snapshot description',
        },
      }),
    );

    expect(screen.getByTestId('league-details-name')).toHaveValue('Unsaved League Name');
    expect(screen.getByTestId('league-details-description')).toHaveValue('Unsaved description');
  });

  it('pool-master-rop.20 reseeds league detail drafts when the league identity changes', async () => {
    primeCommonMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({
      id: 'league-2',
      leagueCode: 'NEWDOGS',
      name: 'Renamed New Dawgs',
      description: 'Updated new description',
    }))));
    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByTestId('league-open-details'));
    await screen.findByTestId('league-details-modal');
    fireEvent.change(screen.getByTestId('league-details-name'), {
      target: { value: 'Unsaved League Name' },
    });
    fireEvent.change(screen.getByTestId('league-details-description'), {
      target: { value: 'Unsaved description' },
    });

    getLeagueByCodeMock.mockResolvedValueOnce(apiSuccess(getLeagueByCodeData(buildLeague({
      id: 'league-2',
      leagueCode: 'NEWDOGS',
      name: 'New Dawgs',
      description: 'New league description',
    }))));

    fireEvent.click(screen.getByTestId('go-next-league'));

    await waitFor(() => expect(screen.getByTestId('league-details-name')).toHaveValue('New Dawgs'));
    expect(screen.getByTestId('league-details-description')).toHaveValue('New league description');

    fireEvent.change(screen.getByTestId('league-details-name'), {
      target: { value: 'Renamed New Dawgs' },
    });
    fireEvent.change(screen.getByTestId('league-details-description'), {
      target: { value: 'Updated new description' },
    });
    fireEvent.click(screen.getByTestId('league-save-details'));

    await waitFor(() =>
      expect(updateLeagueDetailsMock).toHaveBeenCalledWith({
        path: { id: 'league-2' },
        body: {
          name: 'Renamed New Dawgs',
          description: 'Updated new description',
        },
      }),
    );
    expect(updateLeagueDetailsMock).not.toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
    }));
  });

  it('pool-master-rop.23: shows a clear handoff message when the last commissioner tries to leave', async () => {
    primeCommonMocks();
    leaveLeagueMock.mockResolvedValue({
      error: {
        error: {
          code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
          message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
        },
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

  it('pool-master-dxd.37 opens active league inactivation in a confirmation modal', async () => {
    primeCommonMocks();
    inactivateLeagueMock.mockResolvedValue(apiSuccess(inactivateLeagueData(buildLeague({
      isActive: false,
    }))));

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');

    expect(screen.getByTestId('league-details-tile')).toHaveTextContent('Join policy');
    expect(screen.getByTestId('league-join-policy')).toHaveTextContent('COMMISSIONER_ONLY');

    expect(screen.getByTestId('league-actions-tile')).toHaveTextContent('Inactivate league');
    expect(screen.getByTestId('league-lifecycle-status')).toHaveTextContent('Active');
    expect(screen.queryByTestId('league-lifecycle-helper')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-inactivate-open')).toHaveTextContent('Open');
    expect(screen.queryByTestId('league-activate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('league-delete-open')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('league-inactivate-open'));

    expect(await screen.findByTestId('league-inactivate-modal')).toHaveTextContent(
      'The league is currently Active, inactivating the league will prevent further usage but will maintain history. The league can be deleted after being made inactive.',
    );
    fireEvent.click(screen.getByTestId('league-inactivate'));

    await waitFor(() =>
      expect(inactivateLeagueMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
      }),
    );
  });

  // pool-master-4uq — inactive leagues expose activate/delete in the compact lifecycle row.
  it('shows inactive lifecycle actions and activates immediately', async () => {
    primeCommonMocks({ isActive: false });
    activateLeagueMock.mockResolvedValue(apiSuccess(activateLeagueData(buildLeague({
      isActive: true,
    }))));

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

  it('offers no Invite members action on League Home, which lives on Teams and Owners now', async () => {
    primeCommonMocks();

    renderLeagueDetailPage();

    await screen.findByTestId('league-open-details');
    expect(screen.queryByTestId('league-open-invite-members')).not.toBeInTheDocument();
    expect(screen.queryByTestId('league-invitations-section')).not.toBeInTheDocument();
  });

  // pool-master-dxd.16 — the current league icon is derived from query cache,
  // with only the modal draft held locally while editing.
  it('updates the league icon from a modal and returns to League Home with the new icon', async () => {
    primeCommonMocks();
    updateLeagueIconMock.mockResolvedValue(apiSuccess(updateLeagueIconData(buildLeague({
      iconKey: 'GOLF_BALL',
    }))));

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

  it('pool-master-rop.23: lets a commissioner delete an inactive league after modal confirmation', async () => {
    primeCommonMocks({ isActive: false });
    deleteLeagueMock.mockResolvedValue(apiSuccess(deleteLeagueData()));

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
    deleteLeagueMock.mockResolvedValue(apiSuccess(deleteLeagueData()));

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

describe('League Home use cases', () => {
  afterEach(() => {
    for (const mock of [
      activateLeagueMock, deleteLeagueMock, enterContestMock, getContestMock,
      getCurrentUserMock, getLeagueByCodeMock, inactivateLeagueMock, leaveLeagueMock,
      listContestEntriesMock, listContestsMock, listLeagueSquadsMock, logoutUserMock, refreshTokenMock,
      updateLeagueDetailsMock, updateLeagueIconMock,
    ]) {
      mock.mockReset();
    }
  });

  async function confirmLeave() {
    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: /^Leave league/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Leave league' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Leave league' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'OK' }));
  }

  it('shows a member no commissioner actions, labels their role Member, and still lets them leave', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change league details/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Invite members/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Inactivate league/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Leave league/ })).toBeEnabled();
  });

  it('gives a root admin the commissioner actions under a Root Admin label, with no leave action', async () => {
    primeCommonMocks({ isRootAdmin: true, leagueRole: 'MEMBER' });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(await screen.findByText('Root Admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Change league details/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Leave league/ })).not.toBeInTheDocument();
  });

  it('tells a member who just joined that their team name and icon did not save, pointing them to Team Home', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });

    renderLeagueDetailPage({ pathname: '/league/BIGDAWGS', state: { teamSetupFailed: true } });

    const notice = await screen.findByTestId('league-team-setup-failed');
    expect(notice).toHaveTextContent("We couldn't save your team name and icon.");
    expect(within(notice).getByRole('link', { name: 'Team Home' })).toHaveAttribute('href', '/league/BIGDAWGS/team');
  });

  it('shows the team-setup notice once, clearing it from history so Back or a reload does not bring it back', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });

    renderLeagueDetailPage({ pathname: '/league/BIGDAWGS', state: { teamSetupFailed: true } });

    expect(await screen.findByTestId('league-team-setup-failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('history-state')).toHaveTextContent('null'));
    expect(screen.getByTestId('league-team-setup-failed')).toBeInTheDocument();
  });

  it('does not carry the team-setup notice to another league', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });

    renderLeagueDetailPage({ pathname: '/league/BIGDAWGS', state: { teamSetupFailed: true } });
    await screen.findByTestId('league-team-setup-failed');
    fireEvent.click(screen.getByTestId('go-next-league'));

    await waitFor(() => expect(screen.queryByTestId('league-team-setup-failed')).not.toBeInTheDocument());
  });

  it('shows no team-setup notice on an ordinary visit to League Home', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.queryByTestId('league-team-setup-failed')).not.toBeInTheDocument();
  });

  it('makes an inactive league read-only: editing and leaving are disabled', async () => {
    primeCommonMocks({ isActive: false });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    expect(screen.getByText('This league is not currently active.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Change league details/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Change league icon/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Leave league/ })).toBeDisabled();
  });

  it('after leaving, takes the viewer to their next active league rather than an inactive one', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });
    leaveLeagueMock.mockResolvedValue(apiSuccess({ success: true }));
    const { queryClient } = renderLeagueDetailPage();
    queryClient.setQueryData(QueryKeys.leagues.list, listLeaguesData([
      buildLeague(),
      buildLeague({ id: 'league-2', leagueCode: 'OLDDOGS', isActive: false }),
      buildLeague({ id: 'league-3', leagueCode: 'NEWDOGS' }),
    ]));

    await confirmLeave();

    await waitFor(() => expect(getLeagueByCodeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: { leagueCode: 'NEWDOGS' } }),
    ));
    expect(logoutUserMock).not.toHaveBeenCalled();
  });

  it('after leaving their last league, keeps the viewer signed in and lands them on the welcome page', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });
    leaveLeagueMock.mockResolvedValue(apiSuccess({ success: true }));
    logoutUserMock.mockResolvedValue(apiSuccess({ success: true }));
    const { queryClient } = renderLeagueDetailPage();
    queryClient.setQueryData(QueryKeys.leagues.list, listLeaguesData([buildLeague()]));

    await confirmLeave();

    expect(await screen.findByTestId('welcome-page')).toBeVisible();
    expect(logoutUserMock).not.toHaveBeenCalled();
  });

  it('after leaving, sends the viewer through welcome rather than straight into a remaining league that is inactive', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });
    leaveLeagueMock.mockResolvedValue(apiSuccess({ success: true }));
    const { queryClient } = renderLeagueDetailPage();
    queryClient.setQueryData(QueryKeys.leagues.list, listLeaguesData([
      buildLeague(),
      buildLeague({ id: 'league-2', leagueCode: 'OLDDOGS', isActive: false }),
    ]));

    await confirmLeave();

    expect(await screen.findByTestId('welcome-page')).toBeVisible();
  });

  it('saving details with the description emptied sends no description, which the contract treats as clearing it', async () => {
    primeCommonMocks();
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
      buildLeague({ description: 'Old description' }),
      { membership: buildLeagueMembership() },
    )));
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({
      description: null,
    }))));

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: /^Change league details/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Change league details' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Description' }), { target: { value: '   ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(updateLeagueDetailsMock).toHaveBeenCalledWith({
      path: { id: 'league-1' },
      body: { name: 'Big Dawgs' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('keeps the details modal open with the reason when saving fails, and blocks saving a blank name', async () => {
    primeCommonMocks();
    updateLeagueDetailsMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'League name is already taken.' } },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: /^Change league details/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Change league details' }));
    const nameField = dialog.getByRole('textbox', { name: 'League name' });
    fireEvent.change(nameField, { target: { value: '  ' } });
    expect(dialog.getByRole('button', { name: 'Save details' })).toBeDisabled();

    fireEvent.change(nameField, { target: { value: 'Taken Name' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save details' }));

    expect(await dialog.findByText('League name is already taken.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Change league details' })).toBeVisible();
  });

  it('enables delete only once the typed code matches the league code, ignoring case and surrounding spaces', async () => {
    primeCommonMocks({ isActive: false });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete league' }));
    const codeField = dialog.getByRole('textbox', { name: 'League code' });
    const deleteButton = dialog.getByRole('button', { name: 'Delete league' });

    expect(deleteButton).toBeDisabled();
    fireEvent.change(codeField, { target: { value: 'BIGDAWG' } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(codeField, { target: { value: '  bigdawgs ' } });
    expect(deleteButton).toBeEnabled();
  });

  it('shows the reason and stays on League Home when deleting the league fails', async () => {
    primeCommonMocks({ isActive: false });
    deleteLeagueMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_DELETE_FAILED', message: 'The league could not be deleted.' } },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete league' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'League code' }), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete league' }));

    expect(await dialog.findByText('The league could not be deleted.')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-page')).not.toBeInTheDocument();
  });

  it('shows the reason when reactivating an inactive league fails, leaving it inactive', async () => {
    primeCommonMocks({ isActive: false });
    activateLeagueMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_ACTIVATE_FAILED', message: 'The league could not be activated.' } },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(await screen.findByText('The league could not be activated.')).toBeInTheDocument();
    expect(screen.getByTestId('league-lifecycle-status')).toHaveTextContent('Inactive');
  });

  it('shows the reason inside the confirmation when inactivating the league fails, leaving it active', async () => {
    primeCommonMocks();
    inactivateLeagueMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INACTIVATE_FAILED', message: 'The league could not be inactivated.' } },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: /^Inactivate league/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Inactivate league' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Inactivate' }));

    expect(await dialog.findByText('The league could not be inactivated.')).toBeInTheDocument();
    expect(screen.getByTestId('league-lifecycle-status')).toHaveTextContent('Active');
  });

  it('keeps the icon picker open with the reason when saving the icon fails, and leaves the current icon unchanged', async () => {
    primeCommonMocks();
    updateLeagueIconMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'That icon is not available.' } },
    });

    renderLeagueDetailPage();

    await screen.findByTestId('league-home');
    fireEvent.click(screen.getByRole('button', { name: /^Change league icon/ }));
    await screen.findByTestId('league-icon-modal');
    fireEvent.click(screen.getByTestId('league-icon-GOLF_BALL'));
    fireEvent.click(screen.getByTestId('league-save-icon'));

    expect(await screen.findByText('That icon is not available.')).toBeInTheDocument();
    expect(screen.getByTestId('league-icon-modal')).toBeVisible();
    expect(screen.getByTestId('league-current-icon-label')).toHaveTextContent('Trophy');
  });

  it('shows the load-error copy with a way back to welcome when the league cannot be loaded', async () => {
    primeCommonMocks();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'League not found.' } },
      status: 404,
    });

    renderLeagueDetailPage();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
    expect(screen.queryByTestId('league-home')).not.toBeInTheDocument();
  });
});
