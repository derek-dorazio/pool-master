import { EmailMessageStatus, EmailSkipReason, InvitationStatus } from '@poolmaster/shared/domain';
import type { LeagueInvitationDto, SendLeagueInvitationsResponse } from '@/lib/api';
import { buildInvitePath } from '@/features/leagues/league-routing';

export type InviteFilter = 'pending' | 'expired';

export function isInviteFilter(value: string): value is InviteFilter {
  return value === 'pending' || value === 'expired';
}

export type InviteRow = {
  invitation: LeagueInvitationDto;
  isEmail: boolean;
  isExpired: boolean;
  label: string;
  link: string;
  sentBy: string;
};

export function buildInviteUrl(inviteCode: string): string {
  return `${window.location.origin}${buildInvitePath(inviteCode)}`;
}

export function isExpiredInvitation(invitation: LeagueInvitationDto): boolean {
  return invitation.status === InvitationStatus.EXPIRED
    || (invitation.expiresAt ? new Date(invitation.expiresAt).getTime() < Date.now() : false);
}

/** What an invite by email came to: a toast when it was sent, a notice when there is more to do. */
export type InviteOutcome = { kind: 'sent'; message: string } | { kind: 'notice'; tone: 'info' | 'warning'; message: string };

/**
 * What happened to the one email the commissioner sent. The server skips an address that already
 * belongs to the league or already has a pending invitation, and says so; without this the field
 * just cleared and read as "sent".
 */
export function describeInviteResult(result: SendLeagueInvitationsResponse): InviteOutcome | null {
  const sent = result.sent.at(0);
  if (sent) {
    // No email went out, so the commissioner has to share the link themselves: that stays on the page.
    if (sent.emailSkipReason === EmailSkipReason.SUPPRESSED) {
      return { kind: 'notice', tone: 'warning', message: `Invitation made for ${sent.email}, but we can't email that address. Copy its link below to share it.` };
    }
    return sent.emailStatus === EmailMessageStatus.SKIPPED
      ? { kind: 'notice', tone: 'warning', message: `Invitation made for ${sent.email}, but no email was sent. Copy its link below to share it.` }
      : { kind: 'sent', message: `Invitation sent to ${sent.email}` };
  }
  const [member] = result.skippedMembers;
  if (member) {
    return { kind: 'notice', tone: 'info', message: `${member} is already a member of this league.` };
  }
  const [duplicate] = result.skippedDuplicates;
  if (duplicate) {
    return { kind: 'notice', tone: 'info', message: `${duplicate} already has a pending invitation.` };
  }
  return null;
}

/** What an email invite's row says about its latest email. */
const EMAIL_STATUS_LABELS: Record<EmailMessageStatus, string> = {
  [EmailMessageStatus.QUEUED]: 'Sending email',
  [EmailMessageStatus.SENDING]: 'Sending email',
  [EmailMessageStatus.SENT]: 'Email sent',
  [EmailMessageStatus.DELIVERED]: 'Email delivered',
  [EmailMessageStatus.BOUNCED]: 'Email bounced. Check the address, or copy the link to share it.',
  [EmailMessageStatus.COMPLAINED]: 'Email marked as spam. Copy the link to share it.',
  [EmailMessageStatus.FAILED]: 'Email could not be sent. Resend it, or copy the link to share it.',
  [EmailMessageStatus.SKIPPED]: 'Email not sent. Copy the link to share it.',
};

/**
 * Not sent because the address is on the suppression list. That list is platform-wide, so the
 * line never says why: the bounce or complaint may have come from another league's email.
 */
const SUPPRESSED_LABEL = 'We can\'t email this address. Copy the link to share it.';

const EMAIL_PROBLEM_STATUSES: ReadonlySet<EmailMessageStatus> = new Set([
  EmailMessageStatus.FAILED,
  EmailMessageStatus.BOUNCED,
  EmailMessageStatus.COMPLAINED,
]);

export function emailStatusLabel(invitation: LeagueInvitationDto, status: EmailMessageStatus): string {
  return invitation.emailSkipReason === EmailSkipReason.SUPPRESSED ? SUPPRESSED_LABEL : EMAIL_STATUS_LABELS[status];
}

export function isEmailProblem(invitation: LeagueInvitationDto, status: EmailMessageStatus): boolean {
  return EMAIL_PROBLEM_STATUSES.has(status) || invitation.emailSkipReason === EmailSkipReason.SUPPRESSED;
}

export function joinedCount(count: number): string {
  return count === 1 ? '1 person has used it' : `${String(count)} people have used it`;
}
