import type { InvitationPreview } from './invitation-preview';

// League and team-owner previews share this generated status union.
type InvitationPreviewStatus = InvitationPreview['status'];

/** Why an invitation can't be used, as a status page's title and one line. */
export type UnusableInvitation = {
  body: string;
  kind: 'expired' | 'notFound';
  title: string;
};

/**
 * Why an invitation preview cannot be accepted, or null when it can. League invites and
 * team-owner invites share the lifecycle, so both join pages read their dead-link page from here
 * instead of offering a Join button the server will refuse. Keyed on every non-pending status, so
 * a new server status fails to compile here rather than silently showing Join.
 */
const UNUSABLE_INVITATIONS: Record<Exclude<InvitationPreviewStatus, 'PENDING'>, UnusableInvitation> = {
  EXPIRED: { kind: 'expired', title: 'This invitation has expired', body: 'Ask the commissioner for a new one.' },
  REVOKED: { kind: 'expired', title: 'This invitation was withdrawn', body: 'Ask the commissioner for a new one.' },
  ACCEPTED: { kind: 'expired', title: 'This invitation was already used', body: 'Sign in to reach the league.' },
};

/** An invite code the server doesn't know: mistyped, or cut short when it was copied. */
export const UNKNOWN_INVITATION: UnusableInvitation = {
  kind: 'notFound',
  title: "This invitation link doesn't work",
  body: 'Check the link, or ask the commissioner for a new one.',
};

export function describeUnusableInvitation(status: InvitationPreviewStatus | undefined): UnusableInvitation | null {
  if (!status || status === 'PENDING') {
    return null;
  }
  return UNUSABLE_INVITATIONS[status];
}
