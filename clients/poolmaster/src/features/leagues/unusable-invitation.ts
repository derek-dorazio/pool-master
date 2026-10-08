import type { InvitationPreview } from './invitation-preview';

// League and team-owner previews share this generated status union.
type InvitationPreviewStatus = InvitationPreview['status'];

/**
 * Why an invitation preview cannot be accepted, or null when it can. League invites and
 * team-owner invites share the lifecycle, so both join pages read their copy from here instead
 * of offering a Join button the server will refuse. Keyed on every non-pending status, so a new
 * server status fails to compile here rather than silently showing Join.
 */
const UNUSABLE_INVITATION_MESSAGES: Record<Exclude<InvitationPreviewStatus, 'PENDING'>, string> = {
  EXPIRED: 'This invitation has expired. Ask the commissioner for a new one.',
  REVOKED: 'This invitation was withdrawn. Ask the commissioner for a new one.',
  ACCEPTED: 'This invitation has already been used.',
};

export function describeUnusableInvitation(status: InvitationPreviewStatus | undefined): string | null {
  if (!status || status === 'PENDING') {
    return null;
  }
  return UNUSABLE_INVITATION_MESSAGES[status];
}
