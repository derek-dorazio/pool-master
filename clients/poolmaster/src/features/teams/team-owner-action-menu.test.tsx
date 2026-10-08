import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { TeamOwnerActionMenu } from './team-owner-action-menu';

const changeMemberRoleMock = vi.fn();
const removeSquadOwnerMock = vi.fn();

bindApiMocks({
  changeMemberRole: changeMemberRoleMock,
  removeSquadOwner: removeSquadOwnerMock,
});

type MenuProps = Parameters<typeof TeamOwnerActionMenu>[0];

function renderMenu(overrides: Partial<MenuProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const props: MenuProps = {
    activeOwnerCount: 2,
    canManageLeagueRole: true,
    canRemoveOwner: true,
    leagueCode: 'BIGDAWGS',
    leagueId: 'league-1',
    ownerName: 'Olive Owner',
    ownerRole: 'MEMBER',
    ownerUserId: 'user-2',
    surface: 'teams',
    teamId: 'team-1',
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TeamOwnerActionMenu {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, invalidateSpy };
}

function openAction(action: 'promote' | 'demote' | 'remove') {
  fireEvent.click(screen.getByTestId('teams-owner-actions-trigger-team-1-user-2'));
  fireEvent.click(screen.getByTestId(`teams-owner-actions-${action}-team-1-user-2`));
}

function membership(role: 'COMMISSIONER' | 'MEMBER') {
  return {
    data: {
      membership: {
        id: 'league-member-2',
        leagueId: 'league-1',
        userId: 'user-2',
        role,
        status: 'ACTIVE',
        joinedAt: '2026-04-16T00:00:00.000Z',
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    },
  };
}

function invalidatedKeys(spy: ReturnType<typeof renderMenu>['invalidateSpy']) {
  return spy.mock.calls.map(([filters]) => (filters as { queryKey?: unknown } | undefined)?.queryKey);
}

describe('TeamOwnerActionMenu', () => {
  beforeEach(() => {
    changeMemberRoleMock.mockReset();
    removeSquadOwnerMock.mockReset();
  });

  it('renders nothing when the viewer may neither change the owner\'s role nor remove them', () => {
    const { container } = renderMenu({ canManageLeagueRole: false, canRemoveOwner: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('offers demotion but not promotion for an owner who is already a commissioner', () => {
    renderMenu({ ownerRole: 'COMMISSIONER' });

    fireEvent.click(screen.getByTestId('teams-owner-actions-trigger-team-1-user-2'));

    expect(screen.getByTestId('teams-owner-actions-demote-team-1-user-2')).toBeInTheDocument();
    expect(screen.queryByTestId('teams-owner-actions-promote-team-1-user-2')).not.toBeInTheDocument();
  });

  it('shows the server\'s refusal in the promote dialog and lets the viewer try again', async () => {
    changeMemberRoleMock.mockResolvedValue({
      error: { code: 'LEAGUE_PERMISSION_DENIED', message: 'Only a commissioner can change roles.' },
    });
    renderMenu();

    openAction('promote');
    fireEvent.click(await screen.findByTestId('teams-owner-actions-confirm-promote-team-1-user-2'));

    expect(await screen.findByText('Only a commissioner can change roles.')).toBeInTheDocument();
    expect(screen.getByTestId('teams-owner-actions-confirm-promote-team-1-user-2')).toBeEnabled();
  });

  it('shows the last-commissioner refusal in the demote dialog instead of closing it', async () => {
    changeMemberRoleMock.mockResolvedValue({
      error: {
        code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
        message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
      },
    });
    renderMenu({ ownerRole: 'COMMISSIONER' });

    openAction('demote');
    fireEvent.click(await screen.findByTestId('teams-owner-actions-confirm-demote-team-1-user-2'));

    expect(await screen.findByText(/Appoint another active commissioner/)).toBeInTheDocument();
    expect(changeMemberRoleMock).toHaveBeenCalledWith({
      path: { id: 'league-1', uid: 'user-2' },
      body: { role: 'MEMBER' },
    });
    expect(screen.getByTestId('teams-owner-actions-dialog-team-1-user-2')).toBeInTheDocument();
  });

  it('refreshes the league context after a role change, so a commissioner who demotes themselves loses commissioner controls', async () => {
    changeMemberRoleMock.mockResolvedValue(membership('MEMBER'));
    const { invalidateSpy } = renderMenu({ ownerRole: 'COMMISSIONER' });

    openAction('demote');
    fireEvent.click(await screen.findByTestId('teams-owner-actions-confirm-demote-team-1-user-2'));

    await waitFor(() =>
      expect(screen.queryByTestId('teams-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
    expect(invalidatedKeys(invalidateSpy)).toEqual(
      expect.arrayContaining([
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.list,
        QueryKeys.leagueTeams.byLeague('league-1'),
      ]),
    );
  });

  it('points to Team Home instead of offering removal when the owner is the team\'s last one', async () => {
    renderMenu({ activeOwnerCount: 1 });

    openAction('remove');

    expect(await screen.findByRole('link', { name: 'Open Team Home' })).toBeInTheDocument();
    expect(screen.queryByTestId('teams-owner-actions-confirm-remove-team-1-user-2')).not.toBeInTheDocument();
  });

  it('removes a co-owner, closes the dialog and refreshes the roster and the league\'s member count', async () => {
    removeSquadOwnerMock.mockResolvedValue({
      data: {
        membership: {
          id: 'squad-member-2',
          squadId: 'team-1',
          leagueId: 'league-1',
          status: 'INACTIVE',
          joinedAt: '2026-04-16T00:00:00.000Z',
          createdAt: '2026-04-16T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
          user: {
            id: 'user-2',
            email: 'olive@example.com',
            username: 'olive',
            firstName: 'Olive',
            lastName: 'Owner',
            isActive: true,
            isRootAdmin: false,
            createdAt: '2026-04-16T00:00:00.000Z',
          },
        },
      },
    });
    const { invalidateSpy } = renderMenu();

    openAction('remove');
    fireEvent.click(await screen.findByTestId('teams-owner-actions-confirm-remove-team-1-user-2'));

    await waitFor(() =>
      expect(screen.queryByTestId('teams-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
    expect(removeSquadOwnerMock).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
    });
    expect(invalidatedKeys(invalidateSpy)).toEqual(
      expect.arrayContaining([
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.members('league-1'),
        QueryKeys.leagueTeams.byLeague('league-1'),
      ]),
    );
  });

  it('shows the server\'s refusal to remove an owner, and clears it when the dialog is closed', async () => {
    removeSquadOwnerMock.mockResolvedValue({
      error: { code: 'SQUAD_OWNER_REQUIRED', message: 'You must be an active team owner to perform this action' },
    });
    renderMenu();

    openAction('remove');
    fireEvent.click(await screen.findByTestId('teams-owner-actions-confirm-remove-team-1-user-2'));
    expect(await screen.findByText('You must be an active team owner to perform this action')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Remove owner' }));
    await waitFor(() =>
      expect(screen.queryByTestId('teams-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
    openAction('remove');

    expect(await screen.findByTestId('teams-owner-actions-confirm-remove-team-1-user-2')).toBeInTheDocument();
    expect(screen.queryByText('You must be an active team owner to perform this action')).not.toBeInTheDocument();
  });
});
