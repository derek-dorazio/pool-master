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

  it('reloads the list after a failed resend, since the server may already have replaced the invite code', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED', message: 'Invitation email delivery failed.' } },
      status: 502,
    });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-invitation-resend-email-1'));

    await screen.findByTestId('league-invitation-resend-error');
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
  });

  it('shows the reason and reloads the list when a cancel is refused because the invite was already settled', async () => {
    listLeagueInvitationsMock
      .mockResolvedValueOnce({ data: { invitations: [emailInvite()] } })
      .mockResolvedValue({ data: { invitations: [] } });
    revokeInviteLinkMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INVITATION_NOT_CANCELLABLE', message: 'Only an outstanding invitation can be cancelled.' } },
      status: 409,
    });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-invitation-cancel-email-1'));

    expect(await screen.findByTestId('league-invitation-cancel-error')).toBeInTheDocument();
    expect(await screen.findByTestId('league-invitations-empty')).toBeInTheDocument();
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

  it('copies an email invite\'s link from its pending row, so the commissioner can share it by hand when no email goes out', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invite link for friend@example.com' }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/email-code`));
    expect(await screen.findByTestId('league-invitation-copied-email-1')).toHaveTextContent('Link copied');
  });

  it('copies the new link after a resend replaces the invite code, not the one that stopped working', async () => {
    listLeagueInvitationsMock
      .mockResolvedValueOnce({ data: { invitations: [emailInvite()] } })
      .mockResolvedValue({ data: { invitations: [emailInvite({ inviteCode: 'new-code' })] } });
    resendLeagueInvitationMock.mockResolvedValue({ data: { invitation: emailInvite({ inviteCode: 'new-code' }) } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-invitation-resend-email-1'));
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link for friend@example.com' }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/new-code`));
  });

  it('shows an invite\'s link for manual copy when the clipboard refuses the write', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked')) } });

    renderInvitations();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invite link for friend@example.com' }));

    expect(await screen.findByTestId('league-invitation-link-email-1')).toHaveTextContent(
      `${window.location.origin}/invite/email-code`,
    );
  });

  it('offers a copyable link on a join-link row too', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [joinLink()] } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invite link for Join link' }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/link-code`));
  });

  it('disables inviting and resending while the league is inactive', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });

    renderInvitations({ isInactiveLeague: true });

    expect(await screen.findByTestId('league-invitation-resend-email-1')).toBeDisabled();
    expect(screen.getByTestId('league-open-invite-members')).toBeDisabled();
    expect(screen.getByTestId('league-invitation-cancel-email-1')).toBeEnabled();
  });
});

describe('Inviting members from Teams and Owners', () => {
  afterEach(() => {
    generateInviteLinkMock.mockReset();
    listLeagueInvitationsMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
  });

  async function openInviteMembers() {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    renderInvitations();
    fireEvent.click(await screen.findByTestId('league-open-invite-members'));
    await screen.findByRole('dialog', { name: 'Invite Members' });
  }

  async function sendInviteTo(email: string) {
    await openInviteMembers();
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite by email' }), { target: { value: email } });
    fireEvent.click(screen.getByTestId('league-send-invite'));
  }

  it('confirms who an email invitation was sent to', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({ data: { sent: [emailInvite()], skippedMembers: [], skippedDuplicates: [] } });

    await sendInviteTo('friend@example.com');

    expect(await screen.findByText('Invitation sent to friend@example.com.')).toBeInTheDocument();
  });

  it('tells the commissioner an email already belongs to a member instead of implying it was sent', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({ data: { sent: [], skippedMembers: ['member@example.com'], skippedDuplicates: [] } });

    await sendInviteTo('member@example.com');

    expect(await screen.findByText('member@example.com is already a member of this league.')).toBeInTheDocument();
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument();
  });

  it('tells the commissioner an email already has a pending invitation instead of implying it was sent again', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({ data: { sent: [], skippedMembers: [], skippedDuplicates: ['pending@example.com'] } });

    await sendInviteTo('pending@example.com');

    expect(await screen.findByText('pending@example.com already has a pending invitation.')).toBeInTheDocument();
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument();
  });

  it('shows the server reason when an invitation cannot be sent and keeps the typed email', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({
      error: { code: 'LEAGUE_INACTIVE', message: 'This league is inactive and cannot send invitations.' },
    });

    await sendInviteTo('friend@example.com');

    expect(await screen.findByText('This league is inactive and cannot send invitations.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Invite by email' })).toHaveValue('friend@example.com');
  });

  it('shows the server reason when a join URL cannot be created and leaves the field empty', async () => {
    generateInviteLinkMock.mockResolvedValue({
      error: { code: 'LEAGUE_INACTIVE', message: 'This league is inactive and cannot create invite links.' },
    });

    await openInviteMembers();
    fireEvent.click(screen.getByTestId('league-create-join-url'));

    expect(await screen.findByText('This league is inactive and cannot create invite links.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Join URL' })).toHaveValue('');
  });

  it('keeps a created join URL visible for manual copy when the clipboard refuses the write', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard blocked'));
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    generateInviteLinkMock.mockResolvedValue({ data: { invitation: buildGeneratedInviteLink({ inviteCode: 'invite-xyz' }) } });

    await openInviteMembers();
    fireEvent.click(screen.getByTestId('league-create-join-url'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Join URL' })).toHaveValue(
      'http://localhost:3000/invite/invite-xyz',
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy join URL' }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: 'Join URL' })).toHaveValue('http://localhost:3000/invite/invite-xyz');
  });
});
