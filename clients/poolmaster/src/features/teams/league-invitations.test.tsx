import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeagueInvitationDto, LeagueMembershipDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { buildGeneratedInviteLink, buildLeagueMembership } from '@/features/leagues/test/fixtures';
import { LeagueInvitations } from './league-invitations';

const {
  generateInviteLinkMock,
  listLeagueInvitationsMock,
  resendLeagueInvitationMock,
  revokeInviteLinkMock,
  sendLeagueInvitationsMock,
} = vi.hoisted(() => ({
  generateInviteLinkMock: vi.fn(),
  listLeagueInvitationsMock: vi.fn(),
  resendLeagueInvitationMock: vi.fn(),
  revokeInviteLinkMock: vi.fn(),
  sendLeagueInvitationsMock: vi.fn(),
}));

bindApiMocks({
  generateInviteLink: generateInviteLinkMock,
  listLeagueInvitations: listLeagueInvitationsMock,
  resendLeagueInvitation: resendLeagueInvitationMock,
  revokeInviteLink: revokeInviteLinkMock,
  sendLeagueInvitations: sendLeagueInvitationsMock,
});

const IN_A_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function emailInvite(overrides: Partial<LeagueInvitationDto> = {}): LeagueInvitationDto {
  return {
    ...buildGeneratedInviteLink(),
    id: 'email-1',
    inviteCode: 'email-code',
    inviteType: 'EMAIL',
    email: 'friend@example.com',
    expiresAt: IN_A_WEEK,
    ...overrides,
  };
}

function joinLink(overrides: Partial<LeagueInvitationDto> = {}): LeagueInvitationDto {
  return { ...buildGeneratedInviteLink(), id: 'link-1', inviteCode: 'link-code', maxUses: 0, currentUses: 2, ...overrides };
}

function renderInvitations({ isInactiveLeague = false } = {}) {
  const commissioner = buildLeagueMembership({ userId: 'user-1' });
  const membersByUserId = new Map<string, LeagueMembershipDto>([
    ['user-1', { ...commissioner, user: { ...commissioner.user, firstName: 'Derek', lastName: 'Dorazio' } }],
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LeagueInvitations
        isInactiveLeague={isInactiveLeague}
        joinPolicy="COMMISSIONER_ONLY"
        leagueId="league-1"
        leagueName="Big Dawgs"
        membersByUserId={membersByUserId}
      />
    </QueryClientProvider>,
  );
}

describe('LeagueInvitations', () => {
  afterEach(() => {
    generateInviteLinkMock.mockReset();
    listLeagueInvitationsMock.mockReset();
    resendLeagueInvitationMock.mockReset();
    revokeInviteLinkMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
  });

  it('lists each pending invite with who sent it, and offers Resend only on email invites while both get Cancel', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite(), joinLink()] } });

    renderInvitations();

    const email = await screen.findByTestId('league-invitation-email-1');
    expect(email).toHaveTextContent('friend@example.com');
    expect(email).toHaveTextContent('Pending');
    expect(email).toHaveTextContent('Invited by Derek Dorazio');
    expect(within(email).getByTestId('league-invitation-resend-email-1')).toHaveTextContent('Resend Invite');
    expect(within(email).getByTestId('league-invitation-cancel-email-1')).toHaveTextContent('Cancel Invite');

    const link = screen.getByTestId('league-invitation-link-1');
    expect(link).toHaveTextContent('Join link');
    expect(link).toHaveTextContent('2 joined');
    expect(within(link).queryByTestId('league-invitation-resend-link-1')).not.toBeInTheDocument();
    expect(within(link).getByTestId('league-invitation-cancel-link-1')).toBeInTheDocument();
  });

  it('marks an email invite past its expiry as Expired and still offers Resend', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: { invitations: [emailInvite({ expiresAt: '2026-01-01T00:00:00.000Z' })] },
    });

    renderInvitations();

    const email = await screen.findByTestId('league-invitation-email-1');
    expect(within(email).getAllByText('Expired').length).toBeGreaterThan(0);
    expect(within(email).getByTestId('league-invitation-resend-email-1')).toBeEnabled();
  });

  it('resends an email invite and reloads the list, telling the commissioner the old link stopped working', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockResolvedValue({ data: { invitation: emailInvite({ inviteCode: 'new-code' }) } });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-invitation-resend-email-1'));

    await waitFor(() =>
      expect(resendLeagueInvitationMock).toHaveBeenCalledWith({ path: { id: 'league-1', invitationId: 'email-1' } }),
    );
    expect(await screen.findByTestId('league-invitation-resent')).toHaveTextContent('The old link no longer works.');
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
  });

  it('cancels an invite by its code and drops it from the list', async () => {
    listLeagueInvitationsMock
      .mockResolvedValueOnce({ data: { invitations: [joinLink()] } })
      .mockResolvedValue({ data: { invitations: [] } });
    revokeInviteLinkMock.mockResolvedValue({ data: { success: true } });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-invitation-cancel-link-1'));

    await waitFor(() =>
      expect(revokeInviteLinkMock).toHaveBeenCalledWith({ path: { id: 'league-1', code: 'link-code' } }),
    );
    expect(await screen.findByTestId('league-invitations-empty')).toHaveTextContent('No invites are waiting on an answer.');
  });

  it('shows the reason when a resend fails', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED', message: 'Invitation email delivery failed.' } },
      status: 502,
    });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-invitation-resend-email-1'));

    expect(await screen.findByTestId('league-invitation-resend-error')).toBeInTheDocument();
  });

  it('creates a copyable join URL from the Invite members modal and refreshes the pending list', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    generateInviteLinkMock.mockResolvedValue({ data: { invitation: buildGeneratedInviteLink({ inviteCode: 'invite-abc' }) } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-open-invite-members'));
    await screen.findByTestId('league-invitations-section');
    fireEvent.click(screen.getByTestId('league-create-join-url'));

    await waitFor(() =>
      expect(screen.getByTestId('league-join-url')).toHaveValue(`${window.location.origin}/invite/invite-abc`),
    );
    fireEvent.click(screen.getByTestId('league-copy-join-url'));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/invite/invite-abc')));
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
  });

  it('sends an email invite from the modal and refreshes the pending list', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    sendLeagueInvitationsMock.mockResolvedValue({ data: { sent: [emailInvite()], skippedMembers: [], skippedDuplicates: [] } });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-open-invite-members'));
    fireEvent.change(await screen.findByTestId('league-invite-email'), { target: { value: 'friend@example.com' } });
    fireEvent.click(screen.getByTestId('league-send-invite'));

    await waitFor(() =>
      expect(sendLeagueInvitationsMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { emails: ['friend@example.com'] },
      }),
    );
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('league-invite-email')).toHaveValue('');
  });

  it('disables inviting and resending while the league is inactive', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });

    renderInvitations({ isInactiveLeague: true });

    expect(await screen.findByTestId('league-invitation-resend-email-1')).toBeDisabled();
    expect(screen.getByTestId('league-open-invite-members')).toBeDisabled();
    expect(screen.getByTestId('league-invitation-cancel-email-1')).toBeEnabled();
  });
});
