import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
    leagueCode: 'BIGDAWGS',
    leagueId: 'league-1',
    ownerName: 'Olive Owner',
    ownerRole: 'MEMBER',
    ownerUserId: 'user-2',
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

async function openOwnerMenu() {
  await userEvent.click(screen.getByTestId('team-home-owner-actions-team-1-user-2'));
}

async function openAction(action: 'promote' | 'demote' | 'remove') {
  await openOwnerMenu();
  await userEvent.click(screen.getByTestId(`team-home-owner-actions-${action}-team-1-user-2`));
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

  it('opens the owner\'s actions from a quiet "⋯" button named for the owner, not a gold one', () => {
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Actions for Olive Owner' });
    expect(trigger).toHaveAttribute('data-testid', 'team-home-owner-actions-team-1-user-2');
    expect(trigger).not.toHaveClass('bg-primary');
  });

  it('offers a plain owner only Remove owner, with no league role changes', async () => {
    renderMenu({ canManageLeagueRole: false });

    await openOwnerMenu();

    expect(screen.getByTestId('team-home-owner-actions-remove-team-1-user-2')).toBeInTheDocument();
    expect(screen.queryByTestId('team-home-owner-actions-promote-team-1-user-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-home-owner-actions-demote-team-1-user-2')).not.toBeInTheDocument();
  });


  it('offers demotion but not promotion for an owner who is already a commissioner', async () => {
    renderMenu({ ownerRole: 'COMMISSIONER' });

    await openOwnerMenu();

    expect(screen.getByTestId('team-home-owner-actions-demote-team-1-user-2')).toBeInTheDocument();
    expect(screen.queryByTestId('team-home-owner-actions-promote-team-1-user-2')).not.toBeInTheDocument();
  });

  it('shows the server\'s refusal in the promote dialog and lets the viewer try again', async () => {
    changeMemberRoleMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_PERMISSION_DENIED', message: 'Only a commissioner can change roles.' } },
    });
    renderMenu();

    await openAction('promote');
    fireEvent.click(await screen.findByTestId('team-home-owner-actions-confirm-promote-team-1-user-2'));

    expect(await screen.findByText('Only a commissioner can change roles.')).toBeInTheDocument();
    expect(screen.getByTestId('team-home-owner-actions-confirm-promote-team-1-user-2')).toBeEnabled();
  });

  it('shows the last-commissioner refusal in the demote dialog instead of closing it', async () => {
    changeMemberRoleMock.mockResolvedValue({
      error: {
        error: {
          code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
          message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
        },
      },
    });
    renderMenu({ ownerRole: 'COMMISSIONER' });

    await openAction('demote');
    fireEvent.click(await screen.findByTestId('team-home-owner-actions-confirm-demote-team-1-user-2'));

    expect(await screen.findByText(/Appoint another active commissioner/)).toBeInTheDocument();
    expect(changeMemberRoleMock).toHaveBeenCalledWith({
      path: { id: 'league-1', uid: 'user-2' },
      body: { role: 'MEMBER' },
    });
    expect(screen.getByTestId('team-home-owner-actions-dialog-team-1-user-2')).toBeInTheDocument();
  });

  it('refreshes the league context after a role change, so a commissioner who demotes themselves loses commissioner controls', async () => {
    changeMemberRoleMock.mockResolvedValue(membership('MEMBER'));
    const { invalidateSpy } = renderMenu({ ownerRole: 'COMMISSIONER' });

    await openAction('demote');
    fireEvent.click(await screen.findByTestId('team-home-owner-actions-confirm-demote-team-1-user-2'));

    await waitFor(() =>
      expect(screen.queryByTestId('team-home-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
    expect(invalidatedKeys(invalidateSpy)).toEqual(
      expect.arrayContaining([
        QueryKeys.leagues.detail('BIGDAWGS'),
        QueryKeys.leagues.list,
        QueryKeys.leagueTeams.byLeague('league-1'),
      ]),
    );
  });

  it('tells a plain owner who is the team\'s last one to use Leave league, and offers no removal', async () => {
    renderMenu({ activeOwnerCount: 1, canManageLeagueRole: false });

    await openAction('remove');

    expect(await screen.findByText(/use Leave league/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Team Home/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-home-owner-actions-confirm-remove-team-1-user-2')).not.toBeInTheDocument();
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

    await openAction('remove');
    fireEvent.click(await screen.findByTestId('team-home-owner-actions-confirm-remove-team-1-user-2'));

    await waitFor(() =>
      expect(screen.queryByTestId('team-home-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
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
      error: { error: { code: 'SQUAD_OWNER_REQUIRED', message: 'Only an active owner can do this' } },
    });
    renderMenu();

    await openAction('remove');
    fireEvent.click(await screen.findByTestId('team-home-owner-actions-confirm-remove-team-1-user-2'));
    expect(await screen.findByText('Only an active owner can do this')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Remove owner' }));
    await waitFor(() =>
      expect(screen.queryByTestId('team-home-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
    await openAction('remove');

    expect(await screen.findByTestId('team-home-owner-actions-confirm-remove-team-1-user-2')).toBeInTheDocument();
    expect(screen.queryByText('Only an active owner can do this')).not.toBeInTheDocument();
  });

  it('closes the owner menu on a click outside it, without opening a dialog', async () => {
    renderMenu();
    await openOwnerMenu();
    expect(screen.getByTestId('team-home-owner-actions-team-1-user-2-menu')).toBeVisible();

    await userEvent.click(document.body);

    expect(screen.queryByTestId('team-home-owner-actions-team-1-user-2-menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens each action as a titled dialog that names the owner in its description', async () => {
    renderMenu();

    await openAction('remove');

    const dialog = await screen.findByRole('dialog', { name: 'Remove owner' });
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining('will stop being an owner and will leave this league'));
  });

  it('confirms a removal with Cancel and a red Remove button, and Cancel closes without removing', async () => {
    renderMenu();

    await openAction('remove');

    const confirm = await screen.findByTestId('team-home-owner-actions-confirm-remove-team-1-user-2');
    expect(confirm).toHaveClass('text-destructive');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByTestId('team-home-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
    expect(removeSquadOwnerMock).not.toHaveBeenCalled();
  });

  it('confirms a promotion with Cancel and a primary Make commissioner button', async () => {
    renderMenu();

    await openAction('promote');

    expect(await screen.findByTestId('team-home-owner-actions-confirm-promote-team-1-user-2')).not.toHaveClass('text-destructive');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('gives a plain owner who is the last one only a Close button, since there is nothing to confirm', async () => {
    renderMenu({ activeOwnerCount: 1, canManageLeagueRole: false });

    await openAction('remove');

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByTestId('team-home-owner-actions-dialog-team-1-user-2')).not.toBeInTheDocument(),
    );
  });
});
