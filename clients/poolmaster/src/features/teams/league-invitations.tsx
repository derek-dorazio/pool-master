import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InvitationStatus, InviteType } from '@poolmaster/shared/domain';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import {
  generateInviteLink,
  listLeagueInvitations,
  resendLeagueInvitation,
  revokeInviteLink,
  sendLeagueInvitations,
  type LeagueInvitationDto,
  type LeagueMembershipDto,
  type SendLeagueInvitationsResponse,
} from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { buildInvitePath } from '@/features/leagues/league-routing';
import {
  ActionModal,
  Alert,
  Button,
  Chip,
  DateDisplay,
  FormField,
  Input,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

/**
 * League invitations, where the roster is (#221): "Invite members" and the invites still waiting
 * on an answer. Commissioner only, like the endpoints behind it.
 *
 * An invite is pending until it is accepted or cancelled. An email invite past its expiry is still
 * listed, marked Expired, so the commissioner can resend it; a resend issues a new link and the old
 * one stops working. A join link can only be cancelled.
 *
 * Every pending row can copy its own link (#476). With the invite email switched off, a resend
 * sends nothing, so copying the new link is how the commissioner gets it to the invitee.
 */
type LeagueInvitationsProps = {
  isInactiveLeague: boolean;
  leagueId: string;
  leagueName: string;
  membersByUserId: Map<string, LeagueMembershipDto>;
};

/**
 * What happened to the one email the commissioner sent. The server skips an address that already
 * belongs to the league or already has a pending invitation, and says so; without this the field
 * just cleared and read as "sent".
 */
function describeInviteResult(result: SendLeagueInvitationsResponse): string | null {
  const [sent] = result.sent;
  if (sent) {
    return `Invitation sent to ${sent.email}.`;
  }
  const [member] = result.skippedMembers;
  if (member) {
    return `${member} is already a member of this league.`;
  }
  const [duplicate] = result.skippedDuplicates;
  if (duplicate) {
    return `${duplicate} already has a pending invitation.`;
  }
  return null;
}

export function LeagueInvitations({
  isInactiveLeague,
  leagueId,
  leagueName,
  membersByUserId,
}: LeagueInvitationsProps) {
  const logger = getLogger().child({ feature: 'league-invitations' });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [rowCopy, setRowCopy] = useState<{ invitationId: string; state: 'copied' | 'failed' } | null>(null);
  const invitationsKey = QueryKeys.leagueInvitations.byLeague(leagueId);

  const invitationsQuery = useQuery({
    queryKey: invitationsKey,
    queryFn: async (): Promise<LeagueInvitationDto[]> => {
      const response = await listLeagueInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throwApiError(response.error, 'League invitation list response is missing data.');
      }
      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const inviteLinkMutation = useInvalidatingMutation({
    mutationFn: async (): Promise<string> => {
      const response = await generateInviteLink({ path: { id: leagueId }, body: {} });
      const inviteCode = response.data?.invitation?.inviteCode;
      if (!inviteCode) {
        throwApiError(response.error, 'Invite link generation did not return an invite code.');
      }
      return `${window.location.origin}${buildInvitePath(inviteCode)}`;
    },
    invalidates: [invitationsKey],
  });

  const sendInviteMutation = useInvalidatingMutation({
    mutationFn: async (email: string) => {
      const response = await sendLeagueInvitations({
        path: { id: leagueId },
        body: { emails: [email] },
      });
      if (!response.data) {
        throwApiError(response.error, 'Invitation send response is missing data.');
      }
      return response.data;
    },
    invalidates: [invitationsKey],
  });

  // A failed resend or cancel can still mean the list is stale: a resend replaces the code before
  // sending, and a refused cancel means the invite was settled elsewhere. Reload either way.
  const queryClient = useQueryClient();
  const reloadInvitations = () => queryClient.invalidateQueries({ queryKey: invitationsKey });

  const resendMutation = useInvalidatingMutation({
    mutationFn: async (invitationId: string) => {
      const response = await resendLeagueInvitation({ path: { id: leagueId, invitationId } });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Resend invitation response is missing data.');
      }
      return response.data.invitation;
    },
    onSuccess: (invitation) => {
      setRowCopy(null);
      logger.info(
        { action: 'leagueInvitations.resend.succeeded', data: { leagueId, invitationId: invitation.id } },
        'Resent a league invitation',
      );
    },
    onError: reloadInvitations,
    invalidates: [invitationsKey],
  });

  const cancelMutation = useInvalidatingMutation({
    mutationFn: async (inviteCode: string) => {
      const response = await revokeInviteLink({ path: { id: leagueId, code: inviteCode } });
      if (!response.data) {
        throwApiError(response.error, 'Cancel invitation response is missing data.');
      }
      return response.data;
    },
    onError: reloadInvitations,
    invalidates: [invitationsKey],
  });

  async function handleGenerateInviteLink() {
    if (isInactiveLeague) {
      return;
    }
    try {
      const nextLink = await inviteLinkMutation.mutateAsync();
      setInviteLink(nextLink);
      setInviteLinkCopied(false);
    } catch {
      // Error state is rendered from the mutation.
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkCopied(true);
    } catch {
      // Keep the link visible for manual copy when clipboard access is unavailable.
    }
  }

  async function handleCopyRowLink(invitationId: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setRowCopy({ invitationId, state: 'copied' });
    } catch {
      // Show the link on the row so it can be copied by hand.
      setRowCopy({ invitationId, state: 'failed' });
    }
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim();
    if (!email || isInactiveLeague) {
      return;
    }
    try {
      await sendInviteMutation.mutateAsync(email);
      setInviteEmail('');
    } catch {
      // Error state is rendered from the mutation; the typed email stays for a retry.
    }
  }

  const invitations = invitationsQuery.data ?? [];
  const isBusy = resendMutation.isPending || cancelMutation.isPending;

  function inviterName(userId: string) {
    const inviter = membersByUserId.get(userId);
    return inviter ? formatUserName(inviter.user.firstName, inviter.user.lastName) : 'A former commissioner';
  }

  return (
    <Tile data-testid="league-invitations">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Pending invites</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Invites stay here until they are accepted or cancelled. Once someone joins, their team
            appears in the list below.
          </p>
        </div>
        <Button
          data-testid="league-open-invite-members"
          disabled={isInactiveLeague}
          onClick={() => {
            sendInviteMutation.reset();
            setInviteOpen(true);
          }}
          type="button"
        >
          Invite members
        </Button>
      </div>

      <div className="mt-5 space-y-2">
        {invitationsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading invites...</p>
        ) : invitationsQuery.isError ? (
          <p className="text-sm text-destructive" data-testid="league-invitations-error">
            We couldn&apos;t load pending invites right now.
          </p>
        ) : invitations.length ? (
          invitations.map((invitation) => {
            const isEmail = invitation.inviteType === InviteType.EMAIL;
            const isExpired = invitation.status === InvitationStatus.EXPIRED
              || (invitation.expiresAt ? new Date(invitation.expiresAt).getTime() < Date.now() : false);
            const label = isEmail ? invitation.email : 'Join link';
            const link = `${window.location.origin}${buildInvitePath(invitation.inviteCode)}`;
            const copyState = rowCopy?.invitationId === invitation.id ? rowCopy.state : null;

            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-3"
                data-testid={`league-invitation-${invitation.id}`}
                key={invitation.id}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-medium text-foreground">
                      {label}
                    </span>
                    <Chip>{isExpired ? 'Expired' : 'Pending'}</Chip>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Invited by {inviterName(invitation.invitedBy)} · Sent{' '}
                    <DateDisplay className="text-muted-foreground" timeStyle={null} value={invitation.createdAt} />
                    {invitation.expiresAt ? (
                      <>
                        {' · '}{isExpired ? 'Expired' : 'Expires'}{' '}
                        <DateDisplay className="text-muted-foreground" timeStyle={null} value={invitation.expiresAt} />
                      </>
                    ) : null}
                    {!isEmail ? ` · ${invitation.currentUses} joined` : null}
                  </p>
                  {copyState === 'failed' ? (
                    <p
                      className="break-all font-mono text-xs text-foreground"
                      data-testid={`league-invitation-link-${invitation.id}`}
                    >
                      {link}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {copyState === 'copied' ? (
                    <span className="text-xs text-muted-foreground" data-testid={`league-invitation-copied-${invitation.id}`}>
                      Link copied
                    </span>
                  ) : null}
                  <Button
                    aria-label={`Copy invite link for ${label}`}
                    data-testid={`league-invitation-copy-${invitation.id}`}
                    disabled={resendMutation.isPending}
                    onClick={() => void handleCopyRowLink(invitation.id, link)}
                    size="icon"
                    title="Copy invite link"
                    type="button"
                    variant="icon"
                  >
                    {copyState === 'copied' ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
                  </Button>
                  {isEmail ? (
                    <Button
                      data-testid={`league-invitation-resend-${invitation.id}`}
                      disabled={isBusy || isInactiveLeague}
                      onClick={() => void resendMutation.mutateAsync(invitation.id).catch(() => undefined)}
                      type="button"
                      variant="subtle"
                    >
                      Resend Invite
                    </Button>
                  ) : null}
                  <Button
                    data-testid={`league-invitation-cancel-${invitation.id}`}
                    disabled={isBusy}
                    onClick={() => void cancelMutation.mutateAsync(invitation.inviteCode).catch(() => undefined)}
                    type="button"
                    variant="subtle"
                  >
                    Cancel Invite
                  </Button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="league-invitations-empty">
            No invites are waiting on an answer.
          </p>
        )}
        {resendMutation.isSuccess && !resendMutation.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="league-invitation-resent">
            Invite resent with a new link. The old link no longer works.
          </p>
        ) : null}
        {resendMutation.isError ? (
          <p className="text-sm text-destructive" data-testid="league-invitation-resend-error">
            {extractErrorMessage(resendMutation.error, {
              fallback: 'We could not resend that invite. Please try again.',
            })}
          </p>
        ) : null}
        {cancelMutation.isError ? (
          <p className="text-sm text-destructive" data-testid="league-invitation-cancel-error">
            {extractErrorMessage(cancelMutation.error, {
              fallback: 'We could not cancel that invite. Please try again.',
            })}
          </p>
        ) : null}
      </div>

      <ActionModal
        description={`Invite new members to join the ${leagueName} league.`}
        footer={(
          <Button onClick={() => setInviteOpen(false)} variant="secondary">
            Close
          </Button>
        )}
        onCancel={() => setInviteOpen(false)}
        onOpenChange={setInviteOpen}
        open={inviteOpen}
        testId="league-invitations-section"
        title="Invite Members"
      >
        <FormField label="Join URL">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              aria-label="Join URL"
              className="min-w-0 flex-1 font-mono"
              data-testid="league-join-url"
              disabled={isInactiveLeague}
              placeholder="Create a join URL"
              readOnly
              value={inviteLink}
            />
            <div className="flex gap-2">
              <Button
                data-testid="league-create-join-url"
                disabled={inviteLinkMutation.isPending || isInactiveLeague}
                onClick={() => void handleGenerateInviteLink()}
                variant="secondary"
              >
                {inviteLinkMutation.isPending ? 'Creating...' : inviteLink ? 'Refresh URL' : 'Create URL'}
              </Button>
              <Button
                aria-label="Copy join URL"
                data-testid="league-copy-join-url"
                disabled={!inviteLink || isInactiveLeague}
                onClick={() => void handleCopyInviteLink()}
                size="icon"
                title="Copy join URL"
                variant="icon"
              >
                {inviteLinkCopied ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
              </Button>
            </div>
          </div>
        </FormField>

        {inviteLinkMutation.isError ? (
          <Alert className="mt-3" tone="danger">
            {extractErrorMessage(inviteLinkMutation.error, { fallback: 'We could not create a join URL.' })}
          </Alert>
        ) : null}

        <FormField className="mt-5" label="Invite by email">
          <div className="flex gap-3">
            <Input
              aria-label="Invite by email"
              data-testid="league-invite-email"
              disabled={isInactiveLeague}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="member@example.com"
              type="email"
              value={inviteEmail}
            />
            <Button
              data-testid="league-send-invite"
              disabled={sendInviteMutation.isPending || !inviteEmail.trim() || isInactiveLeague}
              onClick={() => void handleSendInvite().catch(() => undefined)}
            >
              {sendInviteMutation.isPending ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </FormField>

        {sendInviteMutation.data && describeInviteResult(sendInviteMutation.data) ? (
          <Alert className="mt-3" tone="success">
            {describeInviteResult(sendInviteMutation.data)}
          </Alert>
        ) : null}

        {sendInviteMutation.isError ? (
          <Alert className="mt-3" tone="danger">
            {extractErrorMessage(sendInviteMutation.error, { fallback: 'We could not send that invitation.' })}
          </Alert>
        ) : null}
      </ActionModal>
    </Tile>
  );
}
