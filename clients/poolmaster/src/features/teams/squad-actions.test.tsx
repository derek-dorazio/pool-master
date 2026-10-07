import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import type { TeamOwnerInvitationDto } from '@/lib/api';
import { mockApi } from '@/test/msw-api';
import { SquadActions } from './squad-actions';

type SquadActionsProps = ComponentProps<typeof SquadActions>;

const pendingInvite: TeamOwnerInvitationDto = {
  id: 'owner-invite-1',
  leagueId: 'league-1',
  squadId: 'team-1',
  email: 'pending@example.com',
  status: 'PENDING',
  replacementForUserId: null,
  invitedBy: 'user-1',
  inviteCode: 'owner-code-1',
  expiresAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  team: { id: 'team-1', name: 'Derek Squad', iconKey: 'CAPTAIN_SMILE_FIELD' },
};

function renderSquadActions(overrides: Partial<SquadActionsProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: SquadActionsProps = {
    canInactivate: true,
    canManageOwners: true,
    leagueId: 'league-1',
    pendingInvitations: [],
    squadId: 'team-1',
    squadIsActive: true,
    squadName: 'Derek Squad',
    ...overrides,
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <SquadActions {...props} />
    </QueryClientProvider>,
  );
}

function openInviteForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Invite co-owner' }));
  return screen.getByRole('textbox', { name: 'Invite a co-owner to Derek Squad' });
}

describe('SquadActions', () => {
  it('renders nothing for a viewer with no squad actions when the squad has no pending invites', () => {
    renderSquadActions({ canInactivate: false, canManageOwners: false });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending invite')).not.toBeInTheDocument();
  });

  it('shows pending owner invites to a viewer who cannot manage owners, without a revoke control', () => {
    renderSquadActions({ canInactivate: false, canManageOwners: false, pendingInvitations: [pendingInvite] });

    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('lets an owner invite a co-owner but not inactivate the team', () => {
    renderSquadActions({ canInactivate: false, canManageOwners: true });

    expect(screen.getByRole('button', { name: 'Invite co-owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inactivate team' })).not.toBeInTheDocument();
  });

  it('offers no invite or inactivation for an inactive team, but still lists and revokes its pending invites', () => {
    renderSquadActions({ squadIsActive: false, pendingInvitations: [pendingInvite] });

    expect(screen.queryByRole('button', { name: 'Invite co-owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inactivate team' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
  });

  it('sends a co-owner invite to the trimmed email and closes the form', async () => {
    mockApi.createSquadOwnerInvitation.mockResolvedValue({
      data: { invitation: { ...pendingInvite, email: 'friend@example.com' } },
    });
    renderSquadActions();

    const emailField = openInviteForm();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled();
    fireEvent.change(emailField, { target: { value: '  friend@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(mockApi.createSquadOwnerInvitation).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1' },
      body: { email: 'friend@example.com' },
    }));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('explains that a league member cannot become a co-owner when the invite hits that conflict', async () => {
    mockApi.createSquadOwnerInvitation.mockResolvedValue({
      error: { code: 'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT', message: 'conflict' },
    });
    renderSquadActions();

    fireEvent.change(openInviteForm(), { target: { value: 'member@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByText(/That person is already in this league/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Invite a co-owner to Derek Squad' })).toHaveValue('member@example.com');
  });

  it('revokes a pending owner invite, and shows the reason when revoking fails', async () => {
    mockApi.revokeSquadOwnerInvitation.mockResolvedValue({
      error: { code: 'SQUAD_OWNER_INVITATION_NOT_PENDING', message: 'That invite was already accepted.' },
    });
    renderSquadActions({ pendingInvitations: [pendingInvite] });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(mockApi.revokeSquadOwnerInvitation).toHaveBeenCalledWith({
      path: { id: 'league-1', invitationId: 'owner-invite-1' },
    }));
    expect(await screen.findByText('That invite was already accepted.')).toBeInTheDocument();
  });

  it('inactivates the team after the commissioner confirms, warning that its owners leave the league', async () => {
    mockApi.inactivateLeagueSquad.mockResolvedValue({
      data: { squad: { id: 'team-1', name: 'Derek Squad', isActive: false } },
    });
    renderSquadActions();

    fireEvent.click(screen.getByRole('button', { name: 'Inactivate team' }));
    expect(screen.getByText(/removes its owners from the league/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inactivate Derek Squad' }));

    await waitFor(() => expect(mockApi.inactivateLeagueSquad).toHaveBeenCalledWith({
      path: { id: 'league-1', squadId: 'team-1' },
    }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Inactivate Derek Squad' })).not.toBeInTheDocument());
  });

  it('shows the reason and keeps the confirmation open when inactivating the team fails', async () => {
    mockApi.inactivateLeagueSquad.mockResolvedValue({
      error: { code: 'SQUAD_INACTIVATE_FAILED', message: 'The team could not be inactivated.' },
    });
    renderSquadActions();

    fireEvent.click(screen.getByRole('button', { name: 'Inactivate team' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inactivate Derek Squad' }));

    expect(await screen.findByText('The team could not be inactivated.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inactivate Derek Squad' })).toBeEnabled();
  });
});
