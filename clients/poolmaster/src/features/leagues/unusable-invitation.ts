/**
 * Why an invitation preview cannot be accepted, or null when it can. League invites and
 * team-owner invites share the lifecycle, so both join pages read their copy from here instead
 * of offering a Join button the server will refuse.
 */
const UNUSABLE_INVITATION_MESSAGES: Partial<Record<string, string>> = {
  EXPIRED: 'This invitation has expired. Ask the commissioner for a new one.',
  REVOKED: 'This invitation was withdrawn. Ask the commissioner for a new one.',
  ACCEPTED: 'This invitation has already been used.',
};

export function describeUnusableInvitation(status: string | undefined): string | null {
  return status ? UNUSABLE_INVITATION_MESSAGES[status] ?? null : null;
}
