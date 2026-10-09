import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/msw-api';
import { apiSuccess, buildLeagueMembership, buildLeagueSquadMember } from '@/features/leagues/test/fixtures';
import { TeamOwnerActionMenu } from './team-owner-action-menu';

type MenuProps = ComponentProps<typeof TeamOwnerActionMenu>;

function renderMenu(overrides: Partial<MenuProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: MenuProps = {
    activeOwnerCount: 2,
    canManageLeagueRole: true,
    canRemoveOwner: true,
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Owner actions' }));
}

async function chooseAction(name: string) {
  openMenu();
  fireEvent.click(screen.getByRole('button', { name }));
  await screen.findByRole('dialog', { name });
}

describe('TeamOwnerActionMenu by viewer role', () => {
  it('renders nothing when the viewer can neither change the owner\'s role nor remove them', () => {
    renderMenu({ canManageLeagueRole: false, canRemoveOwner: false });

    expect(screen.queryByRole('button', { name: 'Owner actions' })).not.toBeInTheDocument();
  });

  it('offers promote and remove, but not demote, for an owner who is a league member', () => {
    renderMenu({ ownerRole: 'MEMBER' });

    openMenu();

    expect(screen.getByRole('button', { name: 'Promote to commissioner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Demote to member' })).not.toBeInTheDocument();
  });

  it('offers demote, but not promote, for an owner who is a commissioner', () => {
    renderMenu({ ownerRole: 'COMMISSIONER' });

    openMenu();

    expect(screen.getByRole('button', { name: 'Demote to member' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote to commissioner' })).not.toBeInTheDocument();
  });

  it('offers only removal when the viewer may remove owners but not change league roles', () => {
    renderMenu({ canManageLeagueRole: false, ownerRole: 'MEMBER' });

    openMenu();

    expect(screen.getByRole('button', { name: 'Remove owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote to commissioner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Demote to member' })).not.toBeInTheDocument();
  });

  it('promotes the owner to commissioner in this league and closes the confirmation', async () => {
    mockApi.changeMemberRole.mockResolvedValue(apiSuccess({
      membership: buildLeagueMembership({ userId: 'user-2', role: 'COMMISSIONER' }),
    }));
    renderMenu({ ownerRole: 'MEMBER' });

    await chooseAction('Promote to commissioner');
    const dialog = within(screen.getByRole('dialog', { name: 'Promote to commissioner' }));
    expect(dialog.getByText('Jordan Rivers will gain commissioner authority for this league.')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Promote' }));

    await waitFor(() => expect(mockApi.changeMemberRole).toHaveBeenCalledWith({
      path: { id: 'league-1', uid: 'user-2' },
      body: { role: 'COMMISSIONER' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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

    await chooseAction('Demote to member');
    const dialog = within(screen.getByRole('dialog', { name: 'Demote to member' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Demote' }));

    expect(await dialog.findByText(
      'Appoint another active commissioner before removing or demoting the last commissioner.',
    )).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Demote' })).toBeEnabled();
  });

  it('clears a previous failure when the confirmation is closed and opened again', async () => {
    mockApi.changeMemberRole.mockResolvedValue({
      error: { error: { code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED', message: 'Cannot demote the last commissioner.' } },
    });
    renderMenu({ ownerRole: 'COMMISSIONER' });

    await chooseAction('Demote to member');
    const dialog = within(screen.getByRole('dialog', { name: 'Demote to member' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Demote' }));
    await dialog.findByText('Cannot demote the last commissioner.');
    fireEvent.click(dialog.getByRole('button', { name: 'Close Demote to member' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await chooseAction('Demote to member');
    const reopened = within(screen.getByRole('dialog', { name: 'Demote to member' }));
    expect(reopened.queryByText('Cannot demote the last commissioner.')).not.toBeInTheDocument();
  });

  it('removes an owner from a team that has another owner, warning it also removes them from the league', async () => {
    mockApi.removeSquadOwner.mockResolvedValue(apiSuccess({
      membership: buildLeagueSquadMember({ userId: 'user-2' }),
    }));
    renderMenu({ activeOwnerCount: 2 });

    await chooseAction('Remove owner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove owner' }));
    expect(dialog.getByText(/removes them from the team and from the league/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove from team and league' }));

    await waitFor(() => expect(mockApi.removeSquadOwner).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server reason and keeps the dialog open when removing an owner fails', async () => {
    mockApi.removeSquadOwner.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_REMOVE_FAILED', message: 'That owner could not be removed.' } },
    });
    renderMenu({ activeOwnerCount: 3 });

    await chooseAction('Remove owner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove owner' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Remove from team and league' }));

    expect(await dialog.findByText('That owner could not be removed.')).toBeInTheDocument();
  });

  it('does not remove a team\'s only owner directly, and points to Team Home to inactivate the team instead', async () => {
    renderMenu({ activeOwnerCount: 1 });

    await chooseAction('Remove owner');
    const dialog = within(screen.getByRole('dialog', { name: 'Remove owner' }));

    expect(dialog.getByText(/only has one active owner left/)).toBeInTheDocument();
    expect(dialog.getByRole('link', { name: 'Open Team Home' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/teams/team-1',
    );
    expect(dialog.queryByRole('button', { name: 'Remove from team and league' })).not.toBeInTheDocument();
    expect(mockApi.removeSquadOwner).not.toHaveBeenCalled();
  });
});
