import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryKeys } from '@/lib/query-keys';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { CommissionerToolsLayout } from './commissioner-tools-layout';
import { EditLeaguePage } from './edit-league-page';
import { LeagueSettingsPage } from './league-settings-page';
import {
  activateLeagueData,
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
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

const activateLeagueMock = vi.fn();
const deleteLeagueMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const inactivateLeagueMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateLeagueDetailsMock = vi.fn();
const updateLeagueIconMock = vi.fn();

bindApiMocks({
  activateLeague: activateLeagueMock,
  deleteLeague: deleteLeagueMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  inactivateLeague: inactivateLeagueMock,
  listLeagueMembers: listLeagueMembersMock,
  listLeagueSquads: listLeagueSquadsMock,
  refreshToken: refreshTokenMock,
  updateLeagueDetails: updateLeagueDetailsMock,
  updateLeagueIcon: updateLeagueIconMock,
});

function renderCommissionerTools(path = '/league/BIGDAWGS/admin') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<MemberRouteGuard />}>
              <Route element={<CommissionerRouteGuard />} path="/league/:leagueCode/admin">
                <Route element={<CommissionerToolsLayout />}>
                  <Route element={<LeagueSettingsPage />} index />
                  <Route element={<EditLeaguePage />} path="edit" />
                </Route>
              </Route>
            </Route>
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
            <Route element={<div data-testid="manage-leagues-page" />} path="/manage/leagues" />
            <Route element={<div data-testid="welcome-page" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function primeMocks({
  isActive = true,
  isRootAdmin = false,
  leagueRole = 'COMMISSIONER',
}: {
  isActive?: boolean;
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ isActive }),
    { membership: buildLeagueMembership({ role: leagueRole }) },
  )));
  listLeagueMembersMock.mockResolvedValue(apiSuccess({
    members: [
      buildLeagueMembership({ id: 'm-1', userId: 'user-1', role: 'COMMISSIONER' }),
      buildLeagueMembership({ id: 'm-2', userId: 'user-2', role: 'MEMBER' }),
    ],
  }));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
    buildLeagueSquad({ members: [buildLeagueSquadMember()] }),
    buildLeagueSquad({
      id: 'team-2',
      name: 'Second Team',
      members: [buildLeagueSquadMember({
        id: 'team-membership-2',
        squadId: 'team-2',
        userId: 'user-2',
        user: buildCurrentUser({ id: 'user-2', firstName: 'Morgan', lastName: 'Member' }),
      })],
    }),
  ])));
}

afterEach(() => {
  for (const mock of [
    activateLeagueMock, deleteLeagueMock, getCurrentUserMock, getLeagueByCodeMock,
    inactivateLeagueMock, listLeagueMembersMock, listLeagueSquadsMock, refreshTokenMock,
    updateLeagueDetailsMock, updateLeagueIconMock,
  ]) {
    mock.mockReset();
  }
});

describe('Commissioner tools guard', () => {
  it('sends a member who opens Commissioner tools to League Home', async () => {
    primeMocks({ leagueRole: 'MEMBER' });

    renderCommissionerTools();

    expect(await screen.findByTestId('league-home-destination')).toBeInTheDocument();
    expect(screen.queryByTestId('league-settings-page')).not.toBeInTheDocument();
  });

  it('lets a commissioner into League settings', async () => {
    primeMocks();

    renderCommissionerTools();

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to league' })).toHaveAttribute('href', '/league/BIGDAWGS');
  });

  it('lets a root admin who is not a commissioner into League settings', async () => {
    primeMocks({ isRootAdmin: true, leagueRole: 'MEMBER' });

    renderCommissionerTools();

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
  });

  it('shows the league load error with a way back when the league cannot be loaded', async () => {
    primeMocks();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'Not found' } },
      response: { status: 404 },
    });

    renderCommissionerTools();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
  });
});

describe('League settings', () => {
  it('shows the league properties and its commissioners by name', async () => {
    primeMocks();

    renderCommissionerTools();

    const general = within(await screen.findByTestId('league-settings-general'));
    expect(general.getByText('Big Dawgs')).toBeInTheDocument();
    expect(general.getByText('A test league')).toBeInTheDocument();
    expect(general.getByText('BIGDAWGS')).toBeInTheDocument();
    expect(await general.findByText('Casey Commissioner')).toBeInTheDocument();
    expect(general.queryByText('Morgan Member')).not.toBeInTheDocument();
    expect(general.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/edit');
  });

  it('inactivates the league only after the commissioner confirms', async () => {
    primeMocks();
    inactivateLeagueMock.mockResolvedValue(apiSuccess(inactivateLeagueData(buildLeague({ isActive: false }))));
    const { queryClient } = renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Inactivate league' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Inactivate league' }));
    expect(inactivateLeagueMock).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Inactivate' }));

    expect(await screen.findByRole('button', { name: 'Activate league' })).toBeInTheDocument();
    expect(screen.getByTestId('league-inactive-banner')).toBeInTheDocument();
    expect(queryClient.getQueryData(QueryKeys.leagues.detail('BIGDAWGS'))).toMatchObject({ league: { isActive: false } });
  });

  it('shows the reason inside the confirmation when inactivating fails, leaving the league active', async () => {
    primeMocks();
    inactivateLeagueMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Inactivation unavailable' } },
    });

    renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Inactivate league' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Inactivate league' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Inactivate' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Inactivation unavailable');
    expect(screen.queryByTestId('league-inactive-banner')).not.toBeInTheDocument();
  });

  it('keeps Delete league disabled while the league is active', async () => {
    primeMocks();

    renderCommissionerTools();

    expect(await screen.findByRole('button', { name: 'Delete league' })).toBeDisabled();
  });

  it('makes an inactive league read-only: Edit is unavailable and Activate replaces Inactivate', async () => {
    primeMocks({ isActive: false });

    renderCommissionerTools();

    expect(await screen.findByTestId('league-inactive-banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: 'Inactivate league' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate league' })).toBeEnabled();
  });

  it('activates an inactive league straight away', async () => {
    primeMocks({ isActive: false });
    activateLeagueMock.mockResolvedValue(apiSuccess(activateLeagueData(buildLeague({ isActive: true }))));

    renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate league' }));

    expect(await screen.findByRole('button', { name: 'Inactivate league' })).toBeInTheDocument();
    expect(screen.queryByTestId('league-inactive-banner')).not.toBeInTheDocument();
  });

  it('shows the reason when activating fails, leaving the league inactive', async () => {
    primeMocks({ isActive: false });
    activateLeagueMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Activation unavailable' } },
    });

    renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate league' }));

    expect(await screen.findByText('Activation unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('league-inactive-banner')).toBeInTheDocument();
  });

  it('enables delete only once the typed code matches the league code, ignoring case and surrounding spaces', async () => {
    primeMocks({ isActive: false });
    deleteLeagueMock.mockResolvedValue(apiSuccess(deleteLeagueData()));

    renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete league' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete league' }));
    const confirm = dialog.getByRole('button', { name: 'Delete league' });
    expect(confirm).toBeDisabled();

    fireEvent.change(dialog.getByLabelText('League code'), { target: { value: 'BIGDOGS' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('League code'), { target: { value: '  bigdawgs ' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);

    expect(await screen.findByTestId('welcome-page')).toBeInTheDocument();
    expect(deleteLeagueMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { leagueCode: 'BIGDAWGS' },
    }));
  });

  it('returns a root admin to Manage Leagues after deleting an inactive league', async () => {
    primeMocks({ isActive: false, isRootAdmin: true, leagueRole: 'MEMBER' });
    deleteLeagueMock.mockResolvedValue(apiSuccess(deleteLeagueData()));

    renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete league' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete league' }));
    fireEvent.change(dialog.getByLabelText('League code'), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete league' }));

    expect(await screen.findByTestId('manage-leagues-page')).toBeInTheDocument();
  });

  it('shows the reason and keeps the league when deleting fails', async () => {
    primeMocks({ isActive: false });
    deleteLeagueMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Delete unavailable' } },
    });

    renderCommissionerTools();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete league' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete league' }));
    fireEvent.change(dialog.getByLabelText('League code'), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete league' }));

    expect(await dialog.findByText('Delete unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('league-settings-page')).toBeInTheDocument();
  });
});

describe('Edit league', () => {
  it('saves name, description and icon with one Save and returns to League settings', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({
      name: 'Bigger Dawgs',
      description: 'Updated description',
    }))));
    updateLeagueIconMock.mockResolvedValue(apiSuccess(updateLeagueIconData(buildLeague({
      name: 'Bigger Dawgs',
      description: 'Updated description',
      iconKey: 'GOLF_FLAG',
    }))));
    const { queryClient } = renderCommissionerTools('/league/BIGDAWGS/admin/edit');
    queryClient.setQueryData(QueryKeys.leagues.list, listLeaguesData([buildLeague()]));

    fireEvent.change(await screen.findByLabelText('League name'), { target: { value: 'Bigger Dawgs' } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Updated description' } });
    fireEvent.click(screen.getByRole('button', { name: /Golf Flag/ }));
    // League settings reads the league again on arrival, as the server now has it.
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(buildLeague({
      name: 'Bigger Dawgs',
      description: 'Updated description',
      iconKey: 'GOLF_FLAG',
    }))));
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    const general = within(await screen.findByTestId('league-settings-general'));
    expect(await general.findByText('Bigger Dawgs')).toBeInTheDocument();
    expect(updateLeagueDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { name: 'Bigger Dawgs', description: 'Updated description' },
    }));
    expect(updateLeagueIconMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { iconKey: 'GOLF_FLAG' },
    }));
    // The league selector reads the leagues list, which is updated from the save, not refetched.
    expect(queryClient.getQueryData(QueryKeys.leagues.list)).toMatchObject({
      leagues: [expect.objectContaining({ name: 'Bigger Dawgs', iconKey: 'GOLF_FLAG' })],
    });
  });

  it('leaves the icon alone when only the name changes', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ name: 'Bigger Dawgs' }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText('League name'), { target: { value: 'Bigger Dawgs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(updateLeagueIconMock).not.toHaveBeenCalled();
  });

  it('sends no description when it is emptied, which the contract treats as clearing it', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ description: null }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText(/Description/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    await waitFor(() => expect(updateLeagueDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: 'Big Dawgs' },
    })));
  });

  it('blocks saving a blank name and says why next to the field', async () => {
    primeMocks();

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText('League name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    expect(await screen.findByText('League name is required')).toBeInTheDocument();
    expect(updateLeagueDetailsMock).not.toHaveBeenCalled();
  });

  it('stays on the form with the reason when saving fails', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Save unavailable' } },
    });

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText('League name'), { target: { value: 'Bigger Dawgs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText('League name')).toHaveValue('Bigger Dawgs');
  });

  it('keeps what the commissioner typed when the league is read again in the background', async () => {
    primeMocks();
    const { queryClient } = renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText('League name'), { target: { value: 'Unsaved name' } });
    getLeagueByCodeMock.mockResolvedValueOnce(apiSuccess(getLeagueByCodeData(buildLeague({ name: 'Server name' }))));

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: QueryKeys.leagues.detail('BIGDAWGS') });
    });

    await waitFor(() => expect(queryClient.getQueryData(QueryKeys.leagues.detail('BIGDAWGS'))).toMatchObject({
      league: { name: 'Server name' },
    }));
    expect(screen.getByLabelText('League name')).toHaveValue('Unsaved name');
  });

  it('shows the league code as read-only, because it is permanent', async () => {
    primeMocks();

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    expect(await screen.findByLabelText(/League code/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/League code/)).toHaveValue('BIGDAWGS');
  });

  it('sends a commissioner who opens Edit league on an inactive league back to the read-only settings', async () => {
    primeMocks({ isActive: false });

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(screen.getByTestId('league-inactive-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-league-page')).not.toBeInTheDocument();
  });

  it('Cancel goes back to League settings without saving', async () => {
    primeMocks();

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.click(await screen.findByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(updateLeagueDetailsMock).not.toHaveBeenCalled();
  });
});

// The leagues list is only touched by delete; it must drop the league.
describe('League settings delete and the leagues list', () => {
  it('removes a deleted league from the cached leagues list', async () => {
    primeMocks({ isActive: false });
    deleteLeagueMock.mockResolvedValue(apiSuccess(deleteLeagueData()));
    const { queryClient } = renderCommissionerTools();
    queryClient.setQueryData(QueryKeys.leagues.list, listLeaguesData([buildLeague({ isActive: false })]));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete league' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete league' }));
    fireEvent.change(dialog.getByLabelText('League code'), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete league' }));

    await screen.findByTestId('welcome-page');
    expect(queryClient.getQueryData(QueryKeys.leagues.list)).toMatchObject({ leagues: [] });
  });
});
