import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Toaster } from '@/features/shared/ui';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
    emailStatus: 'QUEUED',
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
      <MemoryRouter>
        <LeagueInvitations isInactiveLeague={isInactiveLeague} leagueId="league-1" membersByUserId={membersByUserId} />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type RowActionName = 'copy' | 'resend' | 'cancel';

async function openRowActions(invitationId: string) {
  await userEvent.click(await screen.findByTestId(`league-invitation-actions-${invitationId}`));
  await screen.findByRole('menu');
}

/** The quick actions a row's "⋯" offers, by test id suffix, closing the menu again after. */
async function rowActionsOffered(invitationId: string): Promise<RowActionName[]> {
  await openRowActions(invitationId);
  const offered = (['copy', 'resend', 'cancel'] as const).filter((action) =>
    screen.queryByTestId(`league-invitation-actions-${invitationId}-${action}`));
  await userEvent.keyboard('{Escape}');
  return offered;
}

async function chooseRowAction(invitationId: string, action: RowActionName) {
  await openRowActions(invitationId);
  await userEvent.click(screen.getByTestId(`league-invitation-actions-${invitationId}-${action}`));
}

async function cancelInvite(invitationId: string) {
  await chooseRowAction(invitationId, 'cancel');
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel invite' }));
}

describe('Commissioner tools › Invites: waiting on an answer', () => {
  afterEach(() => {
    generateInviteLinkMock.mockReset();
    listLeagueInvitationsMock.mockReset();
    resendLeagueInvitationMock.mockReset();
    revokeInviteLinkMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
  });

  it('lists each pending invite with who sent it and a Pending badge, and offers Resend only on email invites while both get Copy and Cancel', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite(), joinLink()] } });

    renderInvitations();

    const email = await screen.findByTestId('league-invitation-email-1');
    expect(email).toHaveTextContent('friend@example.com');
    expect(email).toHaveTextContent('Derek Dorazio');
    expect(within(email).getByTestId('league-invitation-status-email-1')).toHaveTextContent('Pending');
    expect(within(email).getByRole('button', { name: 'Actions for friend@example.com' })).toBeInTheDocument();
    expect(await rowActionsOffered('email-1')).toEqual(['copy', 'resend', 'cancel']);

    const link = screen.getByTestId('league-invitation-link-1');
    expect(link).toHaveTextContent('Join link');
    expect(link).toHaveTextContent('2 joined');
    expect(link).toHaveTextContent('Never');
    expect(await rowActionsOffered('link-1')).toEqual(['copy', 'cancel']);
  });

  it('says where each email invite\'s email stands, warns when it could not be sent, and says nothing on a join link', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          emailInvite({ id: 'sent-1', email: 'sent@gmail.com', emailStatus: 'SENT' }),
          emailInvite({ id: 'queued-1', email: 'queued@gmail.com', emailStatus: 'QUEUED' }),
          emailInvite({ id: 'failed-1', email: 'failed@gmail.com', emailStatus: 'FAILED' }),
          emailInvite({ id: 'skipped-1', email: 'skipped@gmail.com', emailStatus: 'SKIPPED' }),
          joinLink(),
        ],
      },
    });

    renderInvitations();

    expect(await screen.findByTestId('league-invitation-email-status-sent-1')).toHaveTextContent('Email sent');
    expect(screen.getByTestId('league-invitation-email-status-queued-1')).toHaveTextContent('Sending email');
    expect(screen.getByTestId('league-invitation-email-status-failed-1')).toHaveTextContent('Email could not be sent');
    expect(screen.getByTestId('league-invitation-email-status-skipped-1')).toHaveTextContent('Email not sent. Copy the link to share it.');
    expect(screen.queryByTestId('league-invitation-email-status-link-1')).not.toBeInTheDocument();
  });

  it('says when an invite email was delivered, bounced or marked as spam, and shows a bounce as a problem', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          emailInvite({ id: 'delivered-1', email: 'delivered@gmail.com', emailStatus: 'DELIVERED' }),
          emailInvite({ id: 'bounced-1', email: 'bounced@gmail.com', emailStatus: 'BOUNCED' }),
          emailInvite({ id: 'spam-1', email: 'spam@gmail.com', emailStatus: 'COMPLAINED' }),
        ],
      },
    });

    renderInvitations();

    expect(await screen.findByTestId('league-invitation-email-status-delivered-1')).toHaveTextContent('Email delivered');
    expect(screen.getByTestId('league-invitation-email-status-delivered-1')).not.toHaveClass('text-destructive');
    expect(screen.getByTestId('league-invitation-email-status-bounced-1')).toHaveTextContent('Email bounced. Check the address');
    expect(screen.getByTestId('league-invitation-email-status-bounced-1')).toHaveClass('text-destructive');
    expect(screen.getByTestId('league-invitation-email-status-spam-1')).toHaveTextContent('Email marked as spam');
  });

  it('says an invite email to a suppressed address can\'t be sent, without saying why, rather than the generic not-sent line', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          emailInvite({ id: 'suppressed-1', email: 'gone@gmail.com', emailStatus: 'SKIPPED', emailSkipReason: 'SUPPRESSED' }),
        ],
      },
    });

    renderInvitations();

    const status = await screen.findByTestId('league-invitation-email-status-suppressed-1');
    expect(status).toHaveTextContent('We can\'t email this address. Copy the link to share it.');
    expect(status).toHaveClass('text-destructive');
  });

  it('keeps an email invite past its expiry out of Pending and lists it under Expired, still offering Resend', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: { invitations: [emailInvite({ expiresAt: '2026-01-01T00:00:00.000Z' }), joinLink()] },
    });

    renderInvitations();

    await screen.findByTestId('league-invitation-link-1');
    expect(screen.getByRole('radio', { name: 'Pending 1' })).toBeChecked();
    expect(screen.queryByTestId('league-invitation-email-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Expired 1' }));

    const email = await screen.findByTestId('league-invitation-email-1');
    expect(within(email).getByTestId('league-invitation-status-email-1')).toHaveTextContent('Expired');
    expect(await rowActionsOffered('email-1')).toContain('resend');
    expect(screen.queryByTestId('league-invitation-link-1')).not.toBeInTheDocument();
  });

  it('offers no Copy on an expired invite, since its link no longer works', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: { invitations: [emailInvite({ expiresAt: '2026-01-01T00:00:00.000Z' })] },
    });

    renderInvitations();
    fireEvent.click(await screen.findByRole('radio', { name: 'Expired 1' }));

    await screen.findByTestId('league-invitation-email-1');
    expect(await rowActionsOffered('email-1')).toEqual(['resend', 'cancel']);
  });

  it('says there are no pending invites when every invite has expired, rather than that nothing matches', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: { invitations: [emailInvite({ expiresAt: '2026-01-01T00:00:00.000Z' })] },
    });

    renderInvitations();

    expect(await screen.findByText('No pending invites.')).toBeInTheDocument();
  });

  it('says there are no expired invites to show when a search under Expired finds nothing, not that none have expired', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: { invitations: [emailInvite({ expiresAt: '2026-01-01T00:00:00.000Z' })] },
    });

    renderInvitations();
    fireEvent.click(await screen.findByRole('radio', { name: 'Expired 1' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find an email' }), { target: { value: 'nobody' } });

    expect(await screen.findByText('No expired invites.')).toBeInTheDocument();
    expect(screen.queryByText('No invites have expired.')).not.toBeInTheDocument();
  });

  it('finds an invite by its email and hides the rest', async () => {
    listLeagueInvitationsMock.mockResolvedValue({
      data: {
        invitations: [
          emailInvite(),
          emailInvite({ id: 'email-2', inviteCode: 'email-code-2', email: 'rival@example.com' }),
        ],
      },
    });

    renderInvitations();
    await screen.findByTestId('league-invitation-email-2');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find an email' }), { target: { value: 'rival' } });

    await waitFor(() => expect(screen.queryByTestId('league-invitation-email-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('league-invitation-email-2')).toBeInTheDocument();
  });

  it('pages the invites 25 at a time', async () => {
    const many = Array.from({ length: 30 }, (_, index) => emailInvite({
      id: `email-${String(index)}`,
      inviteCode: `code-${String(index)}`,
      email: `friend${String(index)}@example.com`,
    }));
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: many } });

    renderInvitations();

    await screen.findByTestId('league-invitations-table');
    expect(within(screen.getByTestId('league-invitations-table')).getAllByRole('row')).toHaveLength(26);
  });

  it('resends an email invite and reloads the list, telling the commissioner the old link stopped working', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockResolvedValue({ data: { invitation: emailInvite({ inviteCode: 'new-code' }) } });

    renderInvitations();
    await chooseRowAction('email-1', 'resend');

    await waitFor(() =>
      expect(resendLeagueInvitationMock).toHaveBeenCalledWith({ path: { id: 'league-1', invitationId: 'email-1' } }),
    );
    const toast = await screen.findByTestId('app-toast');
    expect(toast).toHaveTextContent('Invite resent to friend@example.com with a new link');
    expect(toast).toHaveTextContent('The old link no longer works.');
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
  });

  it('cancels an invite by its code once the commissioner confirms, says so, and drops it from the list', async () => {
    listLeagueInvitationsMock
      .mockResolvedValueOnce({ data: { invitations: [joinLink()] } })
      .mockResolvedValue({ data: { invitations: [] } });
    revokeInviteLinkMock.mockResolvedValue({ data: { success: true } });

    renderInvitations();
    await chooseRowAction('link-1', 'cancel');
    expect(await screen.findByRole('dialog', { name: 'Cancel this invite?' })).toHaveTextContent('The join link will stop working.');
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel invite' }));

    await waitFor(() =>
      expect(revokeInviteLinkMock).toHaveBeenCalledWith({ path: { id: 'league-1', code: 'link-code' } }),
    );
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Invite for Join link cancelled');
    expect(await screen.findByText('No invites are waiting on an answer.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the invite when the commissioner backs out of cancelling it', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });

    renderInvitations();
    await chooseRowAction('email-1', 'cancel');
    expect(await screen.findByRole('dialog', { name: 'Cancel this invite?' })).toHaveTextContent('The link sent to friend@example.com will stop working.');
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(revokeInviteLinkMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('league-invitation-email-1')).toBeInTheDocument();
  });

  it('shows the reason when a resend fails', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INVITATION_NOT_RESENDABLE', message: 'Only an outstanding email invitation can be resent.' } },
      status: 409,
    });

    renderInvitations();
    await chooseRowAction('email-1', 'resend');

    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Only an outstanding email invitation can be resent.');
  });

  it('reloads the list after a failed resend, since the server may already have replaced the invite code', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INVITATION_NOT_RESENDABLE', message: 'Only an outstanding email invitation can be resent.' } },
      status: 409,
    });

    renderInvitations();
    await chooseRowAction('email-1', 'resend');

    await screen.findByTestId('app-toast');
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
    await cancelInvite('email-1');

    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Only an outstanding invitation can be cancelled.');
    expect(await screen.findByText('No invites are waiting on an answer.')).toBeInTheDocument();
  });

  it('copies an email invite\'s link from its row, so the commissioner can share it by hand when no email goes out', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    await chooseRowAction('email-1', 'copy');

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/email-code`));
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Invite link copied');
  });

  it('copies the new link after a resend replaces the invite code, not the one that stopped working', async () => {
    listLeagueInvitationsMock
      .mockResolvedValueOnce({ data: { invitations: [emailInvite()] } })
      .mockResolvedValue({ data: { invitations: [emailInvite({ inviteCode: 'new-code' })] } });
    resendLeagueInvitationMock.mockResolvedValue({ data: { invitation: emailInvite({ inviteCode: 'new-code' }) } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    await chooseRowAction('email-1', 'resend');
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
    await chooseRowAction('email-1', 'copy');

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/new-code`));
  });

  it('offers no Copy or second Resend while a resend is replacing the invite code, so the dying link cannot be copied', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    resendLeagueInvitationMock.mockReturnValue(new Promise(() => undefined));

    renderInvitations();
    await chooseRowAction('email-1', 'resend');

    await waitFor(() => expect(resendLeagueInvitationMock).toHaveBeenCalledTimes(1));
    expect(await rowActionsOffered('email-1')).toEqual(['cancel']);
  });

  it('shows an invite\'s link for manual copy when the clipboard refuses the write', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked')) } });

    renderInvitations();
    await chooseRowAction('email-1', 'copy');

    expect(await screen.findByTestId('app-toast')).toHaveTextContent("Couldn't copy. The link is");
    expect(await screen.findByTestId('league-invitation-link-email-1')).toHaveTextContent(
      `${window.location.origin}/invite/email-code`,
    );
  });

  it('offers a copyable link on a join-link row too', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [joinLink()] } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    await chooseRowAction('link-1', 'copy');

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/link-code`));
  });

  it('says the waiting invites could not load, in red with Retry, and reads them again on Retry', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } }, status: 500 });

    renderInvitations();

    const error = await screen.findByTestId('league-invitations-error');
    expect(error).toHaveTextContent("We couldn't load pending invites right now.");
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('league-invitation-email-1')).toBeInTheDocument();
  });

  it('disables inviting and offers no resend while the league is inactive, and says why, but still allows copying and cancelling', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite()] } });

    renderInvitations({ isInactiveLeague: true });

    await screen.findByTestId('league-invitation-email-1');
    expect(screen.getByTestId('league-invite-email')).toBeDisabled();
    expect(screen.getByTestId('league-create-join-url')).toBeDisabled();
    expect(screen.getByTestId('league-invites-inactive')).toHaveTextContent('nobody new can be invited');
    expect(await rowActionsOffered('email-1')).toEqual(['copy', 'cancel']);
  });
});

describe('Commissioner tools › Invites: invite people', () => {
  afterEach(() => {
    generateInviteLinkMock.mockReset();
    listLeagueInvitationsMock.mockReset();
    sendLeagueInvitationsMock.mockReset();
  });

  async function sendInviteTo(email: string) {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    renderInvitations();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Invite by email' }), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
  }

  it('shows the invite form on the page itself, with no dialog to open first', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });

    renderInvitations();

    expect(await screen.findByRole('textbox', { name: 'Invite by email' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Join link' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends an email invite, clears the field and refreshes the list', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({ data: { sent: [emailInvite()], skippedMembers: [], skippedDuplicates: [] } });

    await sendInviteTo('friend@example.com');

    await waitFor(() =>
      expect(sendLeagueInvitationsMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { emails: ['friend@example.com'] },
      }),
    );
    // A sent invite confirms with a toast; nothing stays on the page.
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Invitation sent to friend@example.com');
    await waitFor(() => expect(listLeagueInvitationsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('textbox', { name: 'Invite by email' })).toHaveValue('');
  });

  it('tells the commissioner when the invite was made but no email went out, so they share its link instead', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({
      data: { sent: [emailInvite({ emailStatus: 'SKIPPED' })], skippedMembers: [], skippedDuplicates: [] },
    });

    await sendInviteTo('friend@example.com');

    expect(await screen.findByText(
      'Invitation made for friend@example.com, but no email was sent. Copy its link below to share it.',
    )).toBeInTheDocument();
  });

  it('tells the commissioner the address can\'t be emailed, without saying it bounced or complained, since that may have been another league\'s email', async () => {
    sendLeagueInvitationsMock.mockResolvedValue({
      data: {
        sent: [emailInvite({ emailStatus: 'SKIPPED', emailSkipReason: 'SUPPRESSED' })],
        skippedMembers: [],
        skippedDuplicates: [],
      },
    });

    await sendInviteTo('friend@example.com');

    expect(await screen.findByText(
      'Invitation made for friend@example.com, but we can\'t email that address. Copy its link below to share it.',
    )).toBeInTheDocument();
  });

  it('sends the invite when the commissioner presses Enter in the email field', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    sendLeagueInvitationsMock.mockResolvedValue({ data: { sent: [emailInvite()], skippedMembers: [], skippedDuplicates: [] } });

    renderInvitations();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Invite by email' }), 'friend@example.com{Enter}');

    await waitFor(() => expect(sendLeagueInvitationsMock).toHaveBeenCalledTimes(1));
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
      error: { error: { code: 'LEAGUE_INACTIVE', message: 'This league is inactive and cannot send invitations.' } },
    });

    await sendInviteTo('friend@example.com');

    expect(await screen.findByText('This league is inactive and cannot send invitations.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Invite by email' })).toHaveValue('friend@example.com');
  });

  it('shows the league\'s current join link from the list, with how many people have used it', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [emailInvite(), joinLink()] } });

    renderInvitations();

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Join link' })).toHaveValue(`${window.location.origin}/invite/link-code`),
    );
    expect(screen.getByText('Anyone with the link can join. 2 people have used it.')).toBeInTheDocument();
    expect(screen.getByTestId('league-create-join-url')).toHaveTextContent('New link');
  });

  it('creates a join link, shows it in the field and copies it', async () => {
    listLeagueInvitationsMock
      .mockResolvedValueOnce({ data: { invitations: [] } })
      .mockResolvedValue({ data: { invitations: [joinLink({ inviteCode: 'invite-abc', currentUses: 0 })] } });
    generateInviteLinkMock.mockResolvedValue({ data: { invitation: joinLink({ inviteCode: 'invite-abc', currentUses: 0 }) } });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderInvitations();
    expect(await screen.findByRole('button', { name: 'Copy join link' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create join link' }));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Join link' })).toHaveValue(`${window.location.origin}/invite/invite-abc`),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy join link' }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/invite/invite-abc`));
  });

  it('shows the server reason when a join link cannot be created and leaves the field empty', async () => {
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [] } });
    generateInviteLinkMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_INACTIVE', message: 'This league is inactive and cannot create invite links.' } },
    });

    renderInvitations();
    fireEvent.click(await screen.findByRole('button', { name: 'Create join link' }));

    expect(await screen.findByText('This league is inactive and cannot create invite links.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Join link' })).toHaveValue('');
  });

  it('says the copy failed and keeps the join link in its field for a manual copy when the clipboard refuses the write', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard blocked'));
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    listLeagueInvitationsMock.mockResolvedValue({ data: { invitations: [joinLink({ inviteCode: 'invite-xyz' })] } });

    renderInvitations();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Join link' })).toHaveValue(`${window.location.origin}/invite/invite-xyz`),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy join link' }));

    expect(await screen.findByTestId('league-copy-join-url-failed')).toHaveTextContent('Couldn\'t copy. Select the link and copy it by hand.');
    expect(screen.getByRole('textbox', { name: 'Join link' })).toHaveValue(`${window.location.origin}/invite/invite-xyz`);
  });
});
