import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import { LeagueSettingsPage } from '@/features/leagues/league-settings-page';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
  listLeagueSquadsData,
  updateLeagueSquadData,
} from '@/features/leagues/test/fixtures';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { AdminEditTeamPage } from './admin-edit-team-page';
import { InvitesPage } from './invites-page';
import { ManageTeamPage } from './manage-team-page';
import { ManageTeamsPage } from './manage-teams-page';

const deleteLeagueSquadMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const inactivateLeagueSquadMock = vi.fn();
const listLeagueInvitationsMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const listSquadOwnerInvitationsMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

bindApiMocks({
  deleteLeagueSquad: deleteLeagueSquadMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  inactivateLeagueSquad: inactivateLeagueSquadMock,
  listLeagueInvitations: listLeagueInvitationsMock,
  listLeagueMembers: listLeagueMembersMock,
  listLeagueSquads: listLeagueSquadsMock,
  listSquadOwnerInvitations: listSquadOwnerInvitationsMock,
  refreshToken: refreshTokenMock,
  updateLeagueSquad: updateLeagueSquadMock,
});

function renderAdmin(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<MemberRouteGuard />}>
              <Route element={<CommissionerRouteGuard />} path="/league/:leagueCode/admin">
                <Route element={<CommissionerToolsLayout />}>
                  <Route element={<LeagueSettingsPage />} index />
                  <Route element={<ManageTeamsPage />} path="teams" />
                  <Route element={<ManageTeamPage />} path="teams/:teamId" />
                  <Route element={<AdminEditTeamPage />} path="teams/:teamId/edit" />
                  <Route element={<InvitesPage />} path="invites" />
                </Route>
              </Route>
            </Route>
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const commissionerTeam = buildLeagueSquad();
const memberTeam = buildLeagueSquad({
  id: 'team-2',
  name: 'Second Team',
  members: [buildLeagueSquadMember({
    id: 'team-membership-2',
    squadId: 'team-2',
    userId: 'user-2',
    user: buildCurrentUser({ id: 'user-2', firstName: 'Morgan', lastName: 'Member' }),
  })],
});
const inactiveTeam = buildLeagueSquad({ id: 'team-3', name: 'Retired Rockets', isActive: false, members: [] });

function primeMocks({
  isRootAdmin = false,
  leagueRole = 'COMMISSIONER',
  isLeagueActive = true,
}: { isRootAdmin?: boolean; leagueRole?: 'COMMISSIONER' | 'MEMBER'; isLeagueActive?: boolean } = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ isActive: isLeagueActive }),
    { membership: buildLeagueMembership({ role: leagueRole }) },
  )));
  listLeagueMembersMock.mockResolvedValue(apiSuccess({
    members: [
      buildLeagueMembership({ id: 'm-1', userId: 'user-1', role: 'COMMISSIONER' }),
      buildLeagueMembership({ id: 'm-2', userId: 'user-2', role: 'MEMBER' }),
    ],
  }));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([commissionerTeam, memberTeam, inactiveTeam])));
  listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({ invitations: [] }));
  listLeagueInvitationsMock.mockResolvedValue(apiSuccess({ invitations: [] }));
}

afterEach(() => {
  for (const mock of [
    deleteLeagueSquadMock, getCurrentUserMock, getLeagueByCodeMock, inactivateLeagueSquadMock,
    listLeagueInvitationsMock, listLeagueMembersMock, listLeagueSquadsMock, listSquadOwnerInvitationsMock,
    refreshTokenMock, updateLeagueSquadMock,
  ]) {
    mock.mockReset();
  }
});

describe('Commissioner tools › Teams', () => {
  it('sends a member who opens the team admin list to League Home', async () => {
    primeMocks({ leagueRole: 'MEMBER' });

    renderAdmin('/league/BIGDAWGS/admin/teams');

    expect(await screen.findByTestId('league-home-destination')).toBeInTheDocument();
  });

  it('lists every team with a Manage link, marks the commissioner\'s team, and highlights Teams in the menu', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams');

    const first = within(await screen.findByTestId('admin-team-team-1'));
    expect(first.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/teams/team-1');
    expect(await first.findByText('Commissioner')).toBeInTheDocument();
    expect(within(screen.getByTestId('admin-team-team-2')).queryByText('Commissioner')).not.toBeInTheDocument();
    expect(screen.getByTestId('commissioner-tools-menu-teams')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('admin-teams-invite')).toHaveAttribute('href', '/league/BIGDAWGS/admin/invites');
  });

  it('narrows the list to teams with a commissioner, or to inactive teams', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams');
    await within(await screen.findByTestId('admin-team-team-1')).findByText('Commissioner');

    fireEvent.click(screen.getByRole('radio', { name: 'With a commissioner' }));
    expect(screen.getByTestId('admin-team-team-1')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-team-team-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-team-team-3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Inactive' }));
    expect(screen.getByTestId('admin-team-team-3')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-team-team-1')).not.toBeInTheDocument();
  });

  it('finds a team by its owner\'s name', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams');

    fireEvent.change(await screen.findByTestId('admin-teams-search'), { target: { value: 'Morgan' } });

    expect(await screen.findByTestId('admin-team-team-2')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-team-team-1')).not.toBeInTheDocument();
  });

  it('links the Commissioners row of League settings to the team admin list', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin');

    const commissioners = within(await screen.findByTestId('league-settings-commissioners'));
    expect(commissioners.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/teams');
  });
});

describe('Commissioner tools › Manage team', () => {
  it('shows the team\'s settings, an Edit link and its owners', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams/team-2');

    expect(await screen.findByTestId('manage-team-identity')).toHaveTextContent('Second Team');
    expect(screen.getByTestId('manage-team-identity')).toHaveTextContent('1 owner · Active');
    expect(screen.getByTestId('manage-team-edit')).toHaveAttribute('href', '/league/BIGDAWGS/admin/teams/team-2/edit');
    expect(screen.getByTestId('manage-team-edit')).toHaveAttribute('aria-disabled', 'false');
    expect(within(screen.getByTestId('manage-team-owners')).getByText('Morgan Member')).toBeInTheDocument();
    expect(screen.getByTestId('commissioner-tools-menu-teams')).toHaveAttribute('aria-current', 'page');
  });

  it('warns that pending owner invitations could not be loaded rather than showing none', async () => {
    primeMocks();
    listSquadOwnerInvitationsMock.mockRejectedValue(new Error('Invitations unavailable'));

    renderAdmin('/league/BIGDAWGS/admin/teams/team-2');

    expect(await screen.findByTestId('manage-team-invitations-error'))
      .toHaveTextContent('Owner invitations are temporarily unavailable');
    expect(within(screen.getByTestId('manage-team-owners')).getByText('Morgan Member')).toBeInTheDocument();
  });

  it('inactivates the team only after the commissioner confirms', async () => {
    primeMocks();
    inactivateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData({ ...memberTeam, isActive: false })));

    renderAdmin('/league/BIGDAWGS/admin/teams/team-2');

    fireEvent.click(await screen.findByTestId('manage-team-inactivate'));
    expect(inactivateLeagueSquadMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('my-team-confirm-inactivate'));

    await waitFor(() => expect(inactivateLeagueSquadMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'league-1', squadId: 'team-2' } }),
    ));
  });

  it('keeps an inactive team read-only and leaves deleting it to a root admin', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams/team-3');

    expect(await screen.findByTestId('manage-team-inactive')).toBeInTheDocument();
    expect(screen.getByTestId('manage-team-edit')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('manage-team-inactivate')).not.toBeInTheDocument();
    expect(screen.getByTestId('manage-team-delete')).toBeDisabled();
    expect(screen.getByTestId('manage-team-danger-zone')).toHaveTextContent('Only a root admin can delete a team.');
  });

  it('lets a root admin delete an inactive team and returns them to the team list', async () => {
    primeMocks({ isRootAdmin: true });
    deleteLeagueSquadMock.mockResolvedValue(apiSuccess({ success: true }));

    renderAdmin('/league/BIGDAWGS/admin/teams/team-3');

    fireEvent.click(await screen.findByTestId('manage-team-delete'));
    fireEvent.click(await screen.findByTestId('my-team-confirm-delete'));

    await waitFor(() => expect(deleteLeagueSquadMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'league-1', squadId: 'team-3' } }),
    ));
    expect(await screen.findByTestId('admin-teams-page')).toBeInTheDocument();
  });

  it('says the team is not in this league when it does not exist', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams/missing-team');

    const notFound = await screen.findByTestId('manage-team-not-found');
    expect(notFound).toHaveTextContent("This team isn't in this league");
    expect(within(notFound).getByRole('link', { name: 'All teams' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/teams');
  });
});

describe('Commissioner tools › Edit team', () => {
  it('saves the name and icon in one request and returns to the team', async () => {
    primeMocks();
    updateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData({ ...memberTeam, name: 'Renamed' })));

    renderAdmin('/league/BIGDAWGS/admin/teams/team-2/edit');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('edit-team-save'));

    expect(await screen.findByTestId('manage-team-page')).toBeInTheDocument();
    expect(updateLeagueSquadMock).toHaveBeenCalledTimes(1);
    expect(updateLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-2' },
      body: { name: 'Renamed', iconKey: TeamIconKey.HELMET_BOLT_MIDNIGHT },
    }));
  });

  it('refuses to save a blank team name', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams/team-2/edit');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('edit-team-save'));

    expect(await screen.findByText('Team name is required')).toBeInTheDocument();
    expect(updateLeagueSquadMock).not.toHaveBeenCalled();
  });

  it('sends an inactive team\'s edit link back to the team, which says why', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/teams/team-3/edit');

    expect(await screen.findByTestId('manage-team-inactive')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-team-page')).not.toBeInTheDocument();
  });

  it('sends the edit link back to the team while the league is inactive', async () => {
    primeMocks({ isLeagueActive: false });

    renderAdmin('/league/BIGDAWGS/admin/teams/team-2/edit');

    expect(await screen.findByTestId('manage-team-league-inactive')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-team-page')).not.toBeInTheDocument();
  });
});

describe('Commissioner tools › Invites', () => {
  it('shows the league invitations under the Invites menu item', async () => {
    primeMocks();

    renderAdmin('/league/BIGDAWGS/admin/invites');

    expect(await screen.findByTestId('admin-invites-page')).toBeInTheDocument();
    expect(await screen.findByTestId('league-invitations')).toBeInTheDocument();
    expect(screen.getByTestId('commissioner-tools-menu-invites')).toHaveAttribute('aria-current', 'page');
  });
});
