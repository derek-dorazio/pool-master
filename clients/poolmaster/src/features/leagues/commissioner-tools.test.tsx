import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryKeys } from '@/lib/query-keys';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { EditChampionshipSettingsPage } from '@/features/championships/edit-championship-settings-page';
import { LeaguePlanEditRedirect, LeaguePlanPage } from '@/features/plans/league-plan-page';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';
import { sportLeagueFixture } from '@/features/root-admin/sport-test-fixtures';
import { CommissionerToolsLayout } from './commissioner-tools-layout';
import { EditEventEmailsPage } from './edit-event-emails-page';
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
} from './test/fixtures';

const activateLeagueMock = vi.fn();
const deleteLeagueMock = vi.fn();
const extendLeaguePlanRenewalMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const getLeaguePlanUsageMock = vi.fn();
const inactivateLeagueMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const listLeaguePaymentsMock = vi.fn();
const listLeaguePlansMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const listSportLeaguesMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateLeagueCupSettingsMock = vi.fn();
const updateLeagueDetailsMock = vi.fn();
const updateLeagueEventEmailSettingsMock = vi.fn();
const updateLeaguePlanMock = vi.fn();

bindApiMocks({
  activateLeague: activateLeagueMock,
  deleteLeague: deleteLeagueMock,
  extendLeaguePlanRenewal: extendLeaguePlanRenewalMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  getLeaguePlanUsage: getLeaguePlanUsageMock,
  inactivateLeague: inactivateLeagueMock,
  listLeagueMembers: listLeagueMembersMock,
  listLeaguePayments: listLeaguePaymentsMock,
  listLeaguePlans: listLeaguePlansMock,
  listLeagueSquads: listLeagueSquadsMock,
  listSportLeagues: listSportLeaguesMock,
  refreshToken: refreshTokenMock,
  updateLeagueCupSettings: updateLeagueCupSettingsMock,
  updateLeagueDetails: updateLeagueDetailsMock,
  updateLeagueEventEmailSettings: updateLeagueEventEmailSettingsMock,
  updateLeaguePlan: updateLeaguePlanMock,
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
                  <Route element={<EditChampionshipSettingsPage />} path="championships/edit" />
                  <Route element={<EditEventEmailsPage />} path="event-emails/edit" />
                  <Route element={<LeaguePlanPage />} path="plan" />
                  <Route element={<LeaguePlanEditRedirect />} path="plan/edit" />
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

// Golf lists before basketball, the platform's order; the Champions Tour is no longer active.
const PGA = sportLeagueFixture({ id: 'sl-pga', name: 'PGA Tour' });
const LPGA = sportLeagueFixture({ id: 'sl-lpga', name: 'LPGA Tour' });
const CHAMPIONS = sportLeagueFixture({ id: 'sl-champions', name: 'Champions Tour', isActive: false });
const NBA = sportLeagueFixture({ id: 'sl-nba', name: 'NBA', sport: 'BASKETBALL', sportId: 'sport-basketball' });
const WNBA = sportLeagueFixture({ id: 'sl-wnba', name: 'WNBA', sport: 'BASKETBALL', sportId: 'sport-basketball' });
const SPORT_LEAGUES = [NBA, PGA, WNBA, CHAMPIONS, LPGA];

function primeMocks({
  isActive = true,
  isRootAdmin = false,
  leagueRole = 'COMMISSIONER',
  league = {},
}: {
  isActive?: boolean;
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
  league?: Parameters<typeof buildLeague>[0];
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ isActive, ...league }),
    { membership: buildLeagueMembership({ role: leagueRole }) },
  )));
  listSportLeaguesMock.mockResolvedValue(apiSuccess({ sportLeagues: SPORT_LEAGUES }));
  listLeaguePaymentsMock.mockResolvedValue(apiSuccess({ payments: [] }));
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
    activateLeagueMock, deleteLeagueMock, extendLeaguePlanRenewalMock, getCurrentUserMock, getLeagueByCodeMock,
    getLeaguePlanUsageMock, inactivateLeagueMock, listLeagueMembersMock, listLeaguePaymentsMock, listLeaguePlansMock,
    listLeagueSquadsMock, listSportLeaguesMock,
    refreshTokenMock, updateLeagueCupSettingsMock, updateLeagueDetailsMock, updateLeagueEventEmailSettingsMock,
    updateLeaguePlanMock,
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
    expect(screen.getByTestId('league-settings-edit')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('league-settings-championships-edit')).toHaveAttribute('aria-disabled', 'true');
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
  it('saves name, description and icon in one request and returns to League settings', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({
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
    expect(updateLeagueDetailsMock).toHaveBeenCalledTimes(1);
    expect(updateLeagueDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { name: 'Bigger Dawgs', description: 'Updated description', iconKey: 'GOLF_FLAG' },
    }));
    // The league selector reads the leagues list, which is updated from the save, not refetched.
    expect(queryClient.getQueryData(QueryKeys.leagues.list)).toMatchObject({
      leagues: [expect.objectContaining({ name: 'Bigger Dawgs', iconKey: 'GOLF_FLAG' })],
    });
  });

  it('sends the current icon unchanged when only the name changes', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ name: 'Bigger Dawgs' }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText('League name'), { target: { value: 'Bigger Dawgs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(updateLeagueDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: 'Bigger Dawgs', description: 'A test league', iconKey: 'TROPHY' },
    }));
  });

  it('sends no description when it is emptied, which the contract treats as clearing it', async () => {
    primeMocks();
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ description: null }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/edit');

    fireEvent.change(await screen.findByLabelText(/Description/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save league' }));

    await waitFor(() => expect(updateLeagueDetailsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: 'Big Dawgs', iconKey: 'TROPHY' },
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

describe('Championship settings', () => {
  it('shows the championship name and the points table on League settings, with an Edit to change them', async () => {
    primeMocks();

    renderCommissionerTools();

    const championships = within(await screen.findByTestId('league-settings-championships'));
    expect(championships.getByTestId('league-settings-cup-name')).toHaveTextContent('Big Dawgs Cup');
    expect(championships.getByTestId('league-settings-points-table')).toHaveTextContent('Standard');
    expect(championships.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/championships/edit');
  });

  it("lists a custom table's points in order on League settings", async () => {
    primeMocks({ league: { cupPointsScale: 'CUSTOM', cupCustomPoints: [10, 6, 3] } });

    renderCommissionerTools();

    expect(await screen.findByTestId('league-settings-points-table')).toHaveTextContent('Custom: 10, 6, 3');
  });

  it('saves a renamed championship on a custom table in one request, previewing what each place earns, and returns to League settings', async () => {
    primeMocks();
    updateLeagueCupSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({
      cupName: 'Dawg Bowl',
      cupPointsScale: 'CUSTOM',
      cupCustomPoints: [10, 6, 3],
    }))));
    const { queryClient } = renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.change(await screen.findByLabelText('Championship name'), { target: { value: 'Dawg Bowl' } });
    fireEvent.click(screen.getByTestId('edit-championships-scale-CUSTOM'));
    fireEvent.change(screen.getByLabelText('Custom points'), { target: { value: '10, 6 3' } });

    expect(screen.getByTestId('championship-points-preview-1st')).toHaveTextContent('10');
    expect(screen.getByTestId('championship-points-preview-3rd')).toHaveTextContent('3');
    expect(screen.getByTestId('championship-points-preview-4th')).toHaveTextContent('0');
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(buildLeague({
      cupName: 'Dawg Bowl',
      cupPointsScale: 'CUSTOM',
      cupCustomPoints: [10, 6, 3],
    }))));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByTestId('league-settings-points-table')).toHaveTextContent('Custom: 10, 6, 3');
    expect(updateLeagueCupSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateLeagueCupSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { cupName: 'Dawg Bowl', cupPointsScale: 'CUSTOM', cupCustomPoints: [10, 6, 3], hallOfLameVisible: true },
    }));
    // Open cups score on the table as it stands, so they are read again.
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: QueryKeys.cups.all }));
  });

  it('sends no custom points when a custom table is switched back to Top ten, and previews its points', async () => {
    primeMocks({ league: { cupPointsScale: 'CUSTOM', cupCustomPoints: [5, 2] } });
    updateLeagueCupSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ cupPointsScale: 'TOP_TEN' }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    expect(await screen.findByLabelText('Custom points')).toHaveValue('5, 2');
    fireEvent.click(screen.getByTestId('edit-championships-scale-TOP_TEN'));
    expect(screen.queryByLabelText('Custom points')).not.toBeInTheDocument();
    expect(screen.getByTestId('championship-points-preview-1st')).toHaveTextContent('25');
    expect(screen.getByTestId('championship-points-preview-10th')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(updateLeagueCupSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { cupName: 'Big Dawgs Cup', cupPointsScale: 'TOP_TEN', cupCustomPoints: [], hallOfLameVisible: true },
    })));
  });

  it('hides the Hall of Lame for the whole league when the commissioner unticks it, and League settings says so', async () => {
    primeMocks();
    updateLeagueCupSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ hallOfLameVisible: false }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    const hallOfLame = await screen.findByTestId('edit-championships-hall-of-lame');
    expect(hallOfLame).toBeChecked();
    fireEvent.click(hallOfLame);
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(buildLeague({ hallOfLameVisible: false }))));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(updateLeagueCupSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { cupName: 'Big Dawgs Cup', cupPointsScale: 'STANDARD', cupCustomPoints: [], hallOfLameVisible: false },
    })));
    expect(await screen.findByTestId('league-settings-hall-of-lame')).toHaveTextContent('Hidden');
  });

  it('blocks saving custom points that are not whole numbers and says why next to the field, sending nothing', async () => {
    primeMocks();

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    fireEvent.click(await screen.findByTestId('edit-championships-scale-CUSTOM'));
    fireEvent.change(screen.getByLabelText('Custom points'), { target: { value: '10, 2.5' } });
    expect(screen.getByTestId('championship-points-preview-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText("Each place's points must be a whole number from 0 to 1000.")).toBeInTheDocument();
    expect(updateLeagueCupSettingsMock).not.toHaveBeenCalled();
  });

  it('stays on the form with the reason when saving fails', async () => {
    primeMocks();
    updateLeagueCupSettingsMock.mockResolvedValue({
      error: { error: { code: 'CUP_CUSTOM_POINTS_INVALID', message: 'A custom points table needs points for at least 1st place' } },
    });

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A custom points table needs points for at least 1st place');
    expect(screen.getByTestId('edit-championships-page')).toBeInTheDocument();
  });

  it('warns that a new points table rescores open cups while the championship and crowned cups keep their points', async () => {
    primeMocks();

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    expect(await screen.findByTestId('championship-points-change-note')).toHaveTextContent(
      'A new table rescores open cups at once, every contest in them included. The championship and crowned cups keep the points their contests earned when they went final, so after a change an open cup and this year\'s championship can show different totals for the same contests.',
    );
  });

  it('says on League settings that the plan lacks championship settings, linking to the plan instead of Edit', async () => {
    primeMocks({ league: { planEntitlements: buildPlanEntitlements({ features: ['EMAIL_CONTEST_OPENED'] }) } });

    renderCommissionerTools();

    const championships = within(await screen.findByTestId('league-settings-championships'));
    expect(championships.getByText('Your league\'s plan doesn\'t include championship settings.')).toBeInTheDocument();
    expect(championships.getByRole('link', { name: 'Change plan' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/plan');
    expect(championships.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(championships.queryByTestId('league-settings-points-table')).not.toBeInTheDocument();
  });

  it('shows the locked note on Edit championships on a plan without championship settings', async () => {
    primeMocks({ league: { planEntitlements: buildPlanEntitlements({ features: ['EMAIL_CONTEST_OPENED'] }) } });

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    expect(await screen.findByTestId('plan-locked-CUP_SETTINGS')).toHaveTextContent('Championship settings');
    expect(screen.queryByTestId('edit-championships-page')).not.toBeInTheDocument();
  });

  it('offers no Hall of Lame switch without the record book, and saves the setting as it stands', async () => {
    primeMocks({ league: { hallOfLameVisible: false, planEntitlements: buildPlanEntitlements({ features: ['CUP_SETTINGS'] }) } });
    updateLeagueCupSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ hallOfLameVisible: false }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(screen.queryByTestId('edit-championships-hall-of-lame')).not.toBeInTheDocument();
    await waitFor(() => expect(updateLeagueCupSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { cupName: 'Big Dawgs Cup', cupPointsScale: 'STANDARD', cupCustomPoints: [], hallOfLameVisible: false },
    })));
  });

  it('sends a commissioner who opens Edit championships on an inactive league back to the read-only settings', async () => {
    primeMocks({ isActive: false });

    renderCommissionerTools('/league/BIGDAWGS/admin/championships/edit');

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-championships-page')).not.toBeInTheDocument();
  });
});

const FREE_PLAN = buildPlanEntitlements({
  plan: 'FREE',
  caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 },
  features: ['EMAIL_CONTEST_OPENED', 'EMAIL_CONTEST_RESULTS'],
  commissionerSelectable: true,
});

const PRO_PLAN = buildPlanEntitlements({
  plan: 'PRO',
  caps: { ENTRIES_PER_CONTEST: 50, SPORTS_LEAGUES_PER_YEAR: 3 },
  features: ['EMAIL_CONTEST_OPENED', 'EMAIL_CONTEST_RESULTS', 'CHAMPIONSHIP'],
  commissionerSelectable: true,
});

function primeUsage(overrides: { openContests?: Array<{ contestId: string; name: string; entryCount: number }> } = {}) {
  getLeaguePlanUsageMock.mockResolvedValue(apiSuccess({
    seasonYear: 2026,
    sportLeagueIds: [PGA.id, NBA.id],
    openContests: overrides.openContests ?? [
      { contestId: 'c-1', name: 'NBA Finals Picks', entryCount: 12 },
      { contestId: 'c-2', name: 'Masters Tiers Pool', entryCount: 34 },
    ],
  }));
}

function primePlanList() {
  listLeaguePlansMock.mockResolvedValue(apiSuccess({
    plans: [
      FREE_PLAN,
      PRO_PLAN,
      buildPlanEntitlements({ plan: 'PREMIUM', caps: { ENTRIES_PER_CONTEST: 100, SPORTS_LEAGUES_PER_YEAR: 10 }, commissionerSelectable: true }),
      buildPlanEntitlements(),
    ],
  }));
}

describe('League plan', () => {
  it('shows the league\'s plan and its limits on League settings, with a Change to pick another', async () => {
    primeMocks({ league: { planEntitlements: FREE_PLAN } });

    renderCommissionerTools();

    const plan = within(await screen.findByTestId('league-settings-plan'));
    expect(plan.getByTestId('league-settings-plan-name')).toHaveTextContent('Free');
    expect(plan.getByTestId('league-settings-plan-cap-ENTRIES_PER_CONTEST')).toHaveTextContent('20');
    expect(plan.getByTestId('league-settings-plan-cap-SPORTS_LEAGUES_PER_YEAR')).toHaveTextContent('1');
    expect(plan.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/plan');
  });

  it('shows a plan with no limit set as unlimited', async () => {
    primeMocks();

    renderCommissionerTools();

    expect(await screen.findByTestId('league-settings-plan-name')).toHaveTextContent('Platinum');
    expect(screen.getByTestId('league-settings-plan-cap-ENTRIES_PER_CONTEST')).toHaveTextContent('Unlimited');
  });

  it('shows on League settings when the league\'s Premium preview period ends, and offers a commissioner no way to extend it', async () => {
    primeMocks({ league: { planRenewsAt: '2027-04-24T12:00:00.000Z' } });

    renderCommissionerTools();

    expect(await screen.findByTestId('league-settings-plan-renews'))
      .toHaveTextContent(new Date('2027-04-24T12:00:00.000Z').toLocaleDateString());
    expect(screen.queryByTestId('league-settings-plan-extend')).not.toBeInTheDocument();
  });

  it('lets a root admin extend the league\'s Premium preview period by the chosen months, showing the new date', async () => {
    primeMocks({ isRootAdmin: true, leagueRole: 'MEMBER' });
    const extended = buildLeague({ planRenewsAt: '2027-10-24T12:00:00.000Z' });
    extendLeaguePlanRenewalMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(extended)));
    const { queryClient } = renderCommissionerTools();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.change(await screen.findByTestId('league-settings-plan-extend-months'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('league-settings-plan-extend-submit'));

    expect(await screen.findByTestId('league-settings-plan-extend-result'))
      .toHaveTextContent(`The Premium preview period now ends on ${new Date('2027-10-24T12:00:00.000Z').toLocaleDateString()}.`);
    expect(extendLeaguePlanRenewalMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' }, body: { months: 12 } }));
    expect(screen.getByTestId('league-settings-plan-renews')).toHaveTextContent(new Date('2027-10-24T12:00:00.000Z').toLocaleDateString());
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: QueryKeys.rootAdmin.manageLeagues }));
  });

  it('shows the reason when extending the gift fails, keeping the date', async () => {
    primeMocks({ isRootAdmin: true, league: { planRenewsAt: '2027-04-24T12:00:00.000Z' } });
    extendLeaguePlanRenewalMock.mockResolvedValue({ error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'League not found' } } });

    renderCommissionerTools();

    fireEvent.click(await screen.findByTestId('league-settings-plan-extend-submit'));

    expect(await screen.findByText('League not found')).toBeInTheDocument();
    expect(screen.getByTestId('league-settings-plan-renews')).toHaveTextContent(new Date('2027-04-24T12:00:00.000Z').toLocaleDateString());
  });

  it('shows a commissioner Platinum as coming soon with no way to move there, and says until when Premium is gifted for its preview period', async () => {
    primeMocks({ league: { planEntitlements: FREE_PLAN, planRenewsAt: '2027-04-24T12:00:00.000Z' } });
    primePlanList();
    primeUsage({ openContests: [] });

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    expect(await screen.findByTestId('league-plan-card-PLATINUM-coming-soon')).toHaveTextContent('Coming soon');
    expect(screen.queryByTestId('league-plan-card-PLATINUM-move')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-plan-card-PREMIUM-move')).toBeEnabled();
    expect(screen.getByTestId('league-plan-renews'))
      .toHaveTextContent(`Premium gifted for your preview period, until ${new Date('2027-04-24T12:00:00.000Z').toLocaleDateString()}.`);
  });

  it('lets a root admin move a league to Platinum, which commissioners see as coming soon', async () => {
    primeMocks({ isRootAdmin: true, leagueRole: 'MEMBER', league: { planEntitlements: FREE_PLAN } });
    primePlanList();
    primeUsage({ openContests: [] });
    updateLeaguePlanMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague())));

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    fireEvent.click(await screen.findByTestId('league-plan-card-PLATINUM-move'));
    fireEvent.click(await screen.findByTestId('league-plan-confirm-save'));

    await waitFor(() => expect(updateLeaguePlanMock).toHaveBeenCalledWith(expect.objectContaining({ body: { plan: 'PLATINUM' } })));
  });

  it('compares every plan side by side: its limits, what every plan includes, and which features it has', async () => {
    primeMocks();
    primePlanList();
    primeUsage({ openContests: [] });

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    const table = within(await screen.findByTestId('plan-comparison-table'));
    const [head, ...sections] = table.getAllByRole('rowgroup');
    expect(within(head).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['What the plan includes', 'Free', 'Pro', 'Premium', 'Platinum']);
    expect(sections.map((section) => within(section).getAllByRole('columnheader')[0]?.textContent)).toEqual(['Limits', 'In every plan', 'Emails', 'Championships', 'History']);
    const entries = within(table.getByTestId('plan-comparison-row-ENTRIES_PER_CONTEST'));
    expect(entries.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['20', '50', '100', 'Unlimited']);
    const championship = within(table.getByTestId('plan-comparison-row-CHAMPIONSHIP'));
    expect(championship.getAllByLabelText(/included/i).map((icon) => icon.getAttribute('aria-label')))
      .toEqual(['Not included', 'Included', 'Included', 'Included']);
  });

  it('shows what the league uses now: its plan, this year\'s sports leagues by name, and its fullest open contest against the plan\'s limits', async () => {
    primeMocks({ league: { planEntitlements: PRO_PLAN } });
    primePlanList();
    primeUsage();

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    const now = within(await screen.findByTestId('league-plan-now'));
    expect(now.getByTestId('league-plan-now-plan')).toHaveTextContent('Pro');
    expect(await now.findByTestId('league-plan-now-sport-leagues')).toHaveTextContent('2 of 3PGA Tour, NBA');
    expect(now.getByTestId('league-plan-now-entries')).toHaveTextContent('34 of 50 entriesMasters Tiers Pool');
    expect(screen.getByTestId('league-plan-card-PRO-current')).toHaveTextContent('Your plan');
    expect(screen.getByTestId('league-plan-card-PREMIUM-move')).toHaveTextContent('Move up to Premium');
    expect(screen.getByTestId('league-plan-card-FREE-move')).toHaveTextContent('Move to Free');
  });

  it('marks under a lower plan\'s limit what the league already uses past it', async () => {
    primeMocks({ league: { planEntitlements: PRO_PLAN } });
    primePlanList();
    primeUsage();

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    expect(await screen.findByTestId('plan-comparison-over-ENTRIES_PER_CONTEST-FREE')).toHaveTextContent('You use 34');
    expect(screen.getByTestId('plan-comparison-over-SPORTS_LEAGUES_PER_YEAR-FREE')).toHaveTextContent('You use 2');
    expect(screen.queryByTestId('plan-comparison-over-ENTRIES_PER_CONTEST-PRO')).not.toBeInTheDocument();
  });

  it('confirms a move down first, naming the three fullest contests over its entry limit and how many more, the sports leagues and the features it hides', async () => {
    primeMocks({ league: { planEntitlements: PRO_PLAN } });
    primePlanList();
    primeUsage({
      openContests: [
        { contestId: 'c-1', name: 'Masters Tiers Pool', entryCount: 34 },
        { contestId: 'c-2', name: 'Finals Picks', entryCount: 21 },
        { contestId: 'c-3', name: 'Open Draft', entryCount: 25 },
        { contestId: 'c-4', name: 'Derby Draw', entryCount: 22 },
        { contestId: 'c-5', name: 'Small Pool', entryCount: 8 },
      ],
    });
    renderCommissionerTools('/league/BIGDAWGS/admin/plan');
    await screen.findByTestId('league-plan-now-entries');

    fireEvent.click(await screen.findByTestId('league-plan-card-FREE-move'));

    const confirm = within(screen.getByTestId('league-plan-confirm'));
    expect(confirm.getByText('Move to Free?')).toBeInTheDocument();
    expect(confirm.getByTestId('league-plan-confirm-entries')).toHaveTextContent(
      'Masters Tiers Pool has 34 entries.Open Draft has 25 entries.Derby Draw has 22 entries.And 1 more.On Free each keeps them all, but takes no new entries past 20.',
    );
    expect(confirm.getByTestId('league-plan-confirm-sport-leagues')).toHaveTextContent('This year\'s contests use 2 sports leagues: PGA Tour, NBA. Free allows 1 a year');
    expect(within(confirm.getByTestId('league-plan-confirm-hidden')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['League championship']);
    expect(updateLeaguePlanMock).not.toHaveBeenCalled();
  });

  it('moves up with no warnings, since a higher plan stops and hides nothing', async () => {
    primeMocks({ league: { planEntitlements: PRO_PLAN } });
    primePlanList();
    primeUsage();
    renderCommissionerTools('/league/BIGDAWGS/admin/plan');
    await screen.findByTestId('league-plan-now-entries');

    fireEvent.click(await screen.findByTestId('league-plan-card-PREMIUM-move'));

    const confirm = within(screen.getByTestId('league-plan-confirm'));
    expect(confirm.getByText('Move to Premium?')).toBeInTheDocument();
    expect(confirm.queryByTestId('league-plan-confirm-entries')).not.toBeInTheDocument();
    expect(confirm.queryByTestId('league-plan-confirm-sport-leagues')).not.toBeInTheDocument();
    expect(confirm.queryByTestId('league-plan-confirm-hidden')).not.toBeInTheDocument();
  });

  it('moves the league to the confirmed plan in one request and shows it as Your plan', async () => {
    primeMocks();
    primePlanList();
    primeUsage();
    updateLeaguePlanMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ planEntitlements: FREE_PLAN }))));
    const { queryClient } = renderCommissionerTools('/league/BIGDAWGS/admin/plan');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByTestId('league-plan-card-FREE-move'));
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(buildLeague({ planEntitlements: FREE_PLAN }))));
    fireEvent.click(screen.getByTestId('league-plan-confirm-save'));

    expect(await screen.findByTestId('league-plan-card-FREE-current')).toHaveTextContent('Your plan');
    expect(screen.queryByTestId('league-plan-confirm')).not.toBeInTheDocument();
    expect(updateLeaguePlanMock).toHaveBeenCalledTimes(1);
    expect(updateLeaguePlanMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' }, body: { plan: 'FREE' } }));
    // The root admin's league list shows each league's plan.
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: QueryKeys.rootAdmin.manageLeagues }));
  });

  it('closes the confirm on Keep, changing nothing', async () => {
    primeMocks();
    primePlanList();
    primeUsage();
    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    fireEvent.click(await screen.findByTestId('league-plan-card-FREE-move'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep Platinum' }));

    expect(screen.queryByTestId('league-plan-confirm')).not.toBeInTheDocument();
    expect(updateLeaguePlanMock).not.toHaveBeenCalled();
  });

  it('lets a root admin who is not a commissioner change the plan', async () => {
    primeMocks({ isRootAdmin: true, leagueRole: 'MEMBER' });
    primePlanList();
    primeUsage();
    updateLeaguePlanMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ planEntitlements: FREE_PLAN }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    fireEvent.click(await screen.findByTestId('league-plan-card-FREE-move'));
    fireEvent.click(screen.getByTestId('league-plan-confirm-save'));

    await waitFor(() => expect(updateLeaguePlanMock).toHaveBeenCalledWith(expect.objectContaining({ body: { plan: 'FREE' } })));
  });

  it('keeps the confirm open with the reason when the change fails', async () => {
    primeMocks();
    primePlanList();
    primeUsage();
    updateLeaguePlanMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE', message: 'Inactive leagues are read-only outside lifecycle actions' } },
    });

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    fireEvent.click(await screen.findByTestId('league-plan-card-FREE-move'));
    fireEvent.click(screen.getByTestId('league-plan-confirm-save'));

    expect(await screen.findByTestId('league-plan-confirm-error')).toHaveTextContent('Inactive leagues are read-only outside lifecycle actions');
    expect(screen.getByTestId('league-plan-confirm')).toBeInTheDocument();
  });

  it('says the plans are unavailable, offering no move, when they cannot be loaded', async () => {
    primeMocks();
    primeUsage();
    listLeaguePlansMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    expect(await screen.findByText('Plans unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('league-plan-card-FREE-move')).not.toBeInTheDocument();
  });

  it('opens the Plan page from the old Choose a plan link', async () => {
    primeMocks();
    primePlanList();
    primeUsage();

    renderCommissionerTools('/league/BIGDAWGS/admin/plan/edit');

    expect(await screen.findByTestId('league-plan-page')).toBeInTheDocument();
  });

  it('sends a commissioner who opens the Plan page on an inactive league back to the read-only settings, where Change is unavailable', async () => {
    primeMocks({ isActive: false });

    renderCommissionerTools('/league/BIGDAWGS/admin/plan');

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(screen.queryByTestId('league-plan-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-settings-plan-edit')).toHaveAttribute('aria-disabled', 'true');
  });
});

// The leagues list is only touched by delete; it must drop the league.
describe('League payments', () => {
  it('lists the league\'s payments on League settings, newest first, each linking to its contest', async () => {
    primeMocks();
    listLeaguePaymentsMock.mockResolvedValue(apiSuccess({
      payments: [
        {
          id: '0f6e3c1a-1111-4b4b-9c9c-000000000002',
          paidAt: '2026-10-24T15:00:00.000Z',
          amountCents: 0,
          description: 'Masters Pool: 50 to 100 entries, free while payments are off',
          contestId: 'contest-1',
          payer: { id: 'user-1', name: 'Casey Commissioner' },
        },
        {
          id: '0f6e3c1a-1111-4b4b-9c9c-000000000001',
          paidAt: '2026-10-23T15:00:00.000Z',
          amountCents: 0,
          description: 'Old Pool: up to 50 entries, free while payments are off',
          contestId: null,
          payer: null,
        },
      ],
    }));

    renderCommissionerTools();

    const payments = within(await screen.findByTestId('league-payments'));
    const lines = await payments.findAllByTestId(/^league-payment-/);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Casey Commissioner');
    expect(lines[0]).toHaveTextContent('$0');
    expect(within(lines[0]).getByRole('link', { name: 'Masters Pool: 50 to 100 entries, free while payments are off' }))
      .toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
    // A deleted contest's line keeps its description, with nothing to link to.
    expect(within(lines[1]).queryByRole('link')).not.toBeInTheDocument();
    expect(listLeaguePaymentsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('says there are no payments yet when the league has none', async () => {
    primeMocks();

    renderCommissionerTools();

    expect(await screen.findByTestId('league-payments-empty')).toHaveTextContent('No payments yet.');
  });
});

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

describe('Event emails', () => {
  it('says on League settings that a new league hears about every sport league, with an Edit to choose', async () => {
    primeMocks();

    renderCommissionerTools();

    const eventEmails = within(await screen.findByTestId('league-settings-event-emails'));
    expect(await eventEmails.findByTestId('league-settings-event-emails-sport-leagues')).toHaveTextContent('Every sport league');
    expect(eventEmails.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/event-emails/edit');
  });

  it('counts only active sport leagues on League settings, so a muted inactive one leaves every sport league heard', async () => {
    primeMocks({ league: { mutedSportLeagueIds: [CHAMPIONS.id, NBA.id] } });

    renderCommissionerTools();

    expect(await screen.findByText('3 of 4 sport leagues')).toBeInTheDocument();
  });

  it('lists the active sport leagues ticked in groups by sport, golf before basketball, each by name', async () => {
    primeMocks({ league: { mutedSportLeagueIds: [WNBA.id] } });

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    const golf = within(await screen.findByTestId('edit-event-emails-sport-GOLF'));
    const basketball = within(screen.getByTestId('edit-event-emails-sport-BASKETBALL'));
    expect(screen.getByTestId('edit-event-emails-sport-GOLF').compareDocumentPosition(screen.getByTestId('edit-event-emails-sport-BASKETBALL')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByTestId('edit-event-emails-sport-GOLF')).toHaveTextContent(/^Golf\s*Golf\s*LPGA Tour\s*PGA Tour$/);
    expect(golf.getByTestId('edit-event-emails-sport-GOLF-all')).toBeChecked();
    expect(basketball.getByTestId(`edit-event-emails-league-${NBA.id}`)).toBeChecked();
    expect(basketball.getByTestId(`edit-event-emails-league-${WNBA.id}`)).not.toBeChecked();
    expect(basketball.getByTestId('edit-event-emails-sport-BASKETBALL-all')).not.toBeChecked();
    expect(screen.queryByText('Champions Tour')).not.toBeInTheDocument();
  });

  it('saves the sport leagues left unticked, a whole sport cleared at once, keeping a muted inactive one, and returns to League settings', async () => {
    primeMocks({ league: { mutedSportLeagueIds: [CHAMPIONS.id] } });
    const saved = buildLeague({ mutedSportLeagueIds: [CHAMPIONS.id, PGA.id, LPGA.id, NBA.id] });
    updateLeagueEventEmailSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(saved)));

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    fireEvent.click(await screen.findByTestId('edit-event-emails-sport-GOLF-all'));
    fireEvent.click(screen.getByTestId(`edit-event-emails-league-${NBA.id}`));
    expect(screen.getByTestId('edit-event-emails-sport-BASKETBALL-all')).not.toBeChecked();
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(saved)));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('1 of 4 sport leagues')).toBeInTheDocument();
    expect(updateLeagueEventEmailSettingsMock).toHaveBeenCalledTimes(1);
    const { body } = updateLeagueEventEmailSettingsMock.mock.calls[0]?.[0] as { body: { mutedSportLeagueIds: string[] } };
    expect(body.mutedSportLeagueIds).toHaveLength(4);
    expect(body.mutedSportLeagueIds).toEqual(expect.arrayContaining([CHAMPIONS.id, PGA.id, LPGA.id, NBA.id]));
    expect(updateLeagueEventEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('mutes every listed sport league with Clear all and hears them all again with Select all, sending only the inactive one', async () => {
    primeMocks({ league: { mutedSportLeagueIds: [CHAMPIONS.id, NBA.id] } });
    updateLeagueEventEmailSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague({ mutedSportLeagueIds: [CHAMPIONS.id] }))));

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    fireEvent.click(await screen.findByTestId('edit-event-emails-none'));
    for (const id of [PGA.id, LPGA.id, NBA.id, WNBA.id]) {
      expect(screen.getByTestId(`edit-event-emails-league-${id}`)).not.toBeChecked();
    }
    fireEvent.click(screen.getByTestId('edit-event-emails-all'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(updateLeagueEventEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { mutedSportLeagueIds: [CHAMPIONS.id], eventEmailDelivery: 'PER_EVENT' },
    })));
  });

  it('starts a league on an email for each event, saves a switch to the weekly digest, and shows it on League settings', async () => {
    primeMocks();
    const saved = buildLeague({ eventEmailDelivery: 'WEEKLY_DIGEST' });
    updateLeagueEventEmailSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(saved)));

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    expect(await screen.findByTestId('edit-event-emails-delivery-PER_EVENT')).toBeChecked();
    expect(screen.getByTestId('edit-event-emails-delivery-WEEKLY_DIGEST')).toHaveTextContent('One email early each Monday listing the next two weeks\' events');
    fireEvent.click(screen.getByTestId('edit-event-emails-delivery-WEEKLY_DIGEST'));
    expect(screen.getByTestId('edit-event-emails-delivery-WEEKLY_DIGEST')).toBeChecked();
    getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(saved)));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByTestId('league-settings-event-emails-delivery')).toHaveTextContent('Weekly digest');
    expect(updateLeagueEventEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { mutedSportLeagueIds: [], eventEmailDelivery: 'WEEKLY_DIGEST' },
    }));
  });

  it('offers no weekly digest on a plan without "Coming up soon", and saves an email for each event even if the digest was chosen before', async () => {
    primeMocks({ league: { eventEmailDelivery: 'WEEKLY_DIGEST', planEntitlements: buildPlanEntitlements({ features: ['EMAIL_EVENT_READY_FOR_CONTESTS'] }) } });
    updateLeagueEventEmailSettingsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeague())));

    const view = renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    await screen.findByTestId('edit-event-emails-page');
    expect(screen.queryByTestId('edit-event-emails-delivery-WEEKLY_DIGEST')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(updateLeagueEventEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { mutedSportLeagueIds: [], eventEmailDelivery: 'PER_EVENT' },
    })));
    view.unmount();

    renderCommissionerTools();
    await screen.findByTestId('league-settings-event-emails-sport-leagues');
    expect(screen.queryByTestId('league-settings-event-emails-delivery')).not.toBeInTheDocument();
  });

  it('stays on the form with the reason when saving fails', async () => {
    primeMocks();
    updateLeagueEventEmailSettingsMock.mockResolvedValue({
      error: { error: { code: 'SPORT_LEAGUE_NOT_FOUND', message: 'Not a sport league: sl-gone' } },
    });

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Not a sport league: sl-gone');
    expect(screen.getByTestId('edit-event-emails-page')).toBeInTheDocument();
  });

  it('shows an error instead of the form when the sport leagues cannot be loaded, offering nothing to save', async () => {
    primeMocks();
    listSportLeaguesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Sport leagues are down' } } });

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    expect(await screen.findByTestId('edit-event-emails-error')).toHaveTextContent('Sport leagues are down');
    expect(screen.queryByTestId('edit-event-emails-page')).not.toBeInTheDocument();
  });

  it('says on League settings that the plan lacks event emails, linking to the plan instead of Edit, and Edit shows the locked note', async () => {
    primeMocks({ league: { planEntitlements: buildPlanEntitlements({ features: ['EMAIL_CONTEST_OPENED'] }) } });

    const view = renderCommissionerTools();

    const eventEmails = within(await screen.findByTestId('league-settings-event-emails'));
    expect(eventEmails.getByText('Your league\'s plan doesn\'t include event emails.')).toBeInTheDocument();
    expect(eventEmails.getByRole('link', { name: 'Change plan' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/plan');
    expect(eventEmails.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    view.unmount();

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');
    expect(await screen.findByTestId('plan-locked-EMAIL_EVENT_COMING_UP')).toHaveTextContent('Event emails');
    expect(screen.queryByText('Coming up email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-event-emails-page')).not.toBeInTheDocument();
  });

  it('offers the choice on a plan with only "Ready for contests", promising only that email there and on League settings', async () => {
    primeMocks({ league: { planEntitlements: buildPlanEntitlements({ features: ['EMAIL_EVENT_READY_FOR_CONTESTS'] }) } });

    const view = renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    const page = await screen.findByTestId('edit-event-emails-page');
    expect(page).toHaveTextContent('Commissioners get an email once an event is ready for contests. Choose the sport leagues you want to hear about.');
    expect(page).not.toHaveTextContent('10 days');
    view.unmount();

    renderCommissionerTools();
    expect(await screen.findByTestId('league-settings-event-emails')).toHaveTextContent('Emails to commissioners when an event is ready for contests.');
  });

  it('promises only the "Coming up soon" email on a plan without "Ready for contests"', async () => {
    primeMocks({ league: { planEntitlements: buildPlanEntitlements({ features: ['EMAIL_EVENT_COMING_UP'] }) } });

    const view = renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    expect(await screen.findByTestId('edit-event-emails-page')).toHaveTextContent('Commissioners get an email about 10 days before an event. Choose the sport leagues you want to hear about.');
    view.unmount();

    renderCommissionerTools();
    expect(await screen.findByTestId('league-settings-event-emails')).toHaveTextContent('Emails to commissioners when an event is coming up.');
  });

  it('promises both emails on a plan with both', async () => {
    primeMocks();

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    expect(await screen.findByTestId('edit-event-emails-page')).toHaveTextContent('Commissioners get an email about 10 days before an event, and another once it\'s ready for contests.');
  });

  it('sends a commissioner who opens Edit event emails on an inactive league back to the read-only settings', async () => {
    primeMocks({ isActive: false });

    renderCommissionerTools('/league/BIGDAWGS/admin/event-emails/edit');

    expect(await screen.findByTestId('league-settings-page')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-event-emails-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-settings-event-emails-edit')).toHaveAttribute('aria-disabled', 'true');
  });
});
