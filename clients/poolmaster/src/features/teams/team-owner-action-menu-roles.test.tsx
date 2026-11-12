import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/msw-api';
import { Toaster } from '@/features/shared/ui';
import { apiSuccess, buildLeagueMembership, buildLeagueSquadMember } from '@/features/leagues/test/fixtures';
import { TeamOwnerActionMenu } from './team-owner-action-menu';

type MenuProps = ComponentProps<typeof TeamOwnerActionMenu>;

function renderMenu(overrides: Partial<MenuProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: MenuProps = {
    activeOwnerCount: 2,
    canManageLeagueRole: true,
    leagueCode: 'BIGDAWGS',
    leagueId: 'league-1',
    ownerName: 'Jordan Rivers',
    ownerRole: 'MEMBER',
    ownerUserId: 'user-2',
    teamId: 'team-1',
    ...overrides,
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TeamOwnerActionMenu {...props} />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /^Actions for / }));
}

async function chooseAction(name: string) {
  await openMenu();
  await userEvent.click(screen.getByRole('menuitem', { name }));
  await screen.findByRole('dialog', { name });
}

describe('TeamOwnerActionMenu by viewer role', () => {
  it('offers promote and remove, but not demote, for an owner who is a league member', async () => {
    renderMenu({ ownerRole: 'MEMBER' });

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Make commissioner' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove owner' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove as commissioner' })).not.toBeInTheDocument();
  });

  it('offers demote, but not promote, for an owner who is a commissioner', async () => {
    renderMenu({ ownerRole: 'COMMISSIONER' });

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Remove as commissioner' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Make commissioner' })).not.toBeInTheDocument();
  });

  it('offers only removal when the viewer may remove owners but not change league roles', async () => {
    renderMenu({ canManageLeagueRole: false, ownerRole: 'MEMBER' });

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Remove owner' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Make commissioner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove as commissioner' })).not.toBeInTheDocument();
  });

  it('promotes the owner to commissioner in this league, closes the confirmation and confirms with a toast', async () => {
    mockApi.changeMemberRole.mockResolvedValue(apiSuccess({
      membership: buildLeagueMembership({ userId: 'user-2', role: 'COMMISSIONER' }),
    }));
    renderMenu({ ownerRole: 'MEMBER' });

    await chooseAction('Make commissioner');
    const dialog = within(screen.getByRole('dialog', { name: 'Make commissioner' }));
    expect(dialog.getByText('Jordan Rivers will help you run this league, with the same Commissioner tools you have.')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Make commissioner' }));

    await waitFor(() => expect(mockApi.changeMemberRole).toHaveBeenCalledWith({
      path: { id: 'league-1', uid: 'user-2' },
      body: { role: 'COMMISSIONER' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Jordan Rivers is now a commissioner');
  });

  it('keeps the demote confirmation open with the server reason when the last commissioner cannot step down', async () => {
    mockApi.changeMemberRole.mockResolvedValue({
      error: {
        error: {
          code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
          message: 'Appoint another active commissioner before removing or demoting the last commissioner.',
        },
      },
    });
    renderMenu({ ownerRole: 'COMMISSIONER' });

    await chooseAction('Remove as commissioner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove as commissioner' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Remove as commissioner' }));

    expect(await dialog.findByText(
      'Appoint another active commissioner before removing or demoting the last commissioner.',
    )).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Remove as commissioner' })).toBeEnabled();
  });

  it('clears a previous failure when the confirmation is closed and opened again', async () => {
    mockApi.changeMemberRole.mockResolvedValue({
      error: { error: { code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED', message: 'Cannot demote the last commissioner.' } },
    });
    renderMenu({ ownerRole: 'COMMISSIONER' });

    await chooseAction('Remove as commissioner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove as commissioner' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Remove as commissioner' }));
    await dialog.findByText('Cannot demote the last commissioner.');
    fireEvent.click(dialog.getByRole('button', { name: 'Close Remove as commissioner' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await chooseAction('Remove as commissioner');
    const reopened = within(screen.getByRole('dialog', { name: 'Remove as commissioner' }));
    expect(reopened.queryByText('Cannot demote the last commissioner.')).not.toBeInTheDocument();
  });

  it('removes an owner from a squad that has another owner, warning it also removes them from the league', async () => {
    mockApi.removeSquadOwner.mockResolvedValue(apiSuccess({
      membership: buildLeagueSquadMember({ userId: 'user-2' }),
    }));
    renderMenu({ activeOwnerCount: 2 });

    await chooseAction('Remove owner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove owner' }));
    expect(dialog.getByText(/will stop being an owner and will leave this league/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mockApi.removeSquadOwner).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('app-toast')).toHaveTextContent('Jordan Rivers removed');
  });

  it('shows the server reason and keeps the dialog open when removing an owner fails', async () => {
    mockApi.removeSquadOwner.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_REMOVE_FAILED', message: 'That owner could not be removed.' } },
    });
    renderMenu({ activeOwnerCount: 3 });

    await chooseAction('Remove owner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove owner' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));

    expect(await dialog.findByText('That owner could not be removed.')).toBeInTheDocument();
  });

  it('does not remove a squad\'s only owner directly, and sends a commissioner to the Manage page to inactivate it', async () => {
    renderMenu({ activeOwnerCount: 1, canManageLeagueRole: true });

    await chooseAction('Remove owner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove owner' }));

    expect(dialog.getByText(/Use Inactivate in the Danger zone on the Manage page/)).toBeInTheDocument();
    expect(dialog.queryByText(/Team Home/)).not.toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Open the Manage page' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/admin/teams/team-1',
    );
    expect(dialog.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(mockApi.removeSquadOwner).not.toHaveBeenCalled();
  });

});
