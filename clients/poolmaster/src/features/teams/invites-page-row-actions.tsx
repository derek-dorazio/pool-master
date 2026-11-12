import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { resendLeagueInvitation, revokeInviteLink } from '@/lib/api';
import {
  ConfirmDialog,
  copyToClipboard,
  RowActionsMenu,
  showToast,
  type RowAction,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { refreshAfterWrite, useInvalidatingMutation } from '@/lib/mutation-hooks';
import type { InviteRow } from './invites-page-helpers';

/**
 * The "⋯" on an invite's row: copy its link (not once it has expired, as it no longer works),
 * resend an email invite with a new link, or cancel the invite after asking. Each ends in a toast.
 */
export function InvitesPageRowActions({
  invitationsKey,
  isInactiveLeague,
  leagueId,
  row,
}: {
  invitationsKey: QueryKey;
  isInactiveLeague: boolean;
  leagueId: string;
  row: InviteRow;
}) {
  const logger = getLogger().child({ feature: 'league-invitations' });
  const { invitation, isEmail, isExpired, label, link } = row;
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const testPrefix = `league-invitation-actions-${invitation.id}`;

  // A failed resend or cancel can still mean the list is stale: a resend replaces the code before
  // sending, and a refused cancel means the invite was settled elsewhere. Reload either way.
  const queryClient = useQueryClient();
  const reloadInvitations = () => void refreshAfterWrite(queryClient, [invitationsKey]);

  const resendMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await resendLeagueInvitation({ path: { id: leagueId, invitationId: invitation.id } });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Resend invitation response is missing data.');
      }
      return response.data.invitation;
    },
    onSuccess: (resent) => {
      logger.info(
        { action: 'leagueInvitations.resend.succeeded', data: { leagueId, invitationId: resent.id } },
        'Resent a league invitation',
      );
      showToast({
        description: 'The old link no longer works.',
        title: `Invite resent to ${label} with a new link`,
        tone: 'success',
      });
    },
    onError: (error) => {
      reloadInvitations();
      showToast({
        title: extractErrorMessage(error, { fallback: 'We could not resend that invite. Please try again.' }),
        tone: 'danger',
      });
    },
    invalidates: [invitationsKey],
  });

  const cancelMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await revokeInviteLink({ path: { id: leagueId, code: invitation.inviteCode } });
      if (!response.data) {
        throwApiError(response.error, 'Cancel invitation response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      setIsCancelOpen(false);
      showToast({ title: `Invite for ${label} cancelled`, tone: 'success' });
    },
    // A refusal usually means the invite was settled elsewhere, so the reload drops its row (and
    // this dialog with it): the reason goes in a toast, which outlives the row.
    onError: (error) => {
      setIsCancelOpen(false);
      reloadInvitations();
      showToast({
        title: extractErrorMessage(error, { fallback: 'We could not cancel that invite. Please try again.' }),
        tone: 'danger',
      });
    },
    invalidates: [invitationsKey],
  });

  async function copyLink() {
    if (await copyToClipboard(link)) {
      showToast({ title: 'Invite link copied', tone: 'success' });
      return;
    }
    showToast({
      description: <span className="break-all font-mono" data-testid={`league-invitation-link-${invitation.id}`}>{link}</span>,
      title: "Couldn't copy. The link is",
      tone: 'danger',
    });
  }

  function closeCancelDialog() {
    if (!cancelMutation.isPending) {
      cancelMutation.reset();
      setIsCancelOpen(false);
    }
  }

  const actions: RowAction[] = [
    // While a resend replaces the code, the old link is dying, so there is nothing to copy yet.
    ...(isExpired || resendMutation.isPending ? [] : [{ label: 'Copy link', onSelect: () => void copyLink(), testId: `${testPrefix}-copy` }]),
    ...(isEmail && !isInactiveLeague && !resendMutation.isPending
      ? [{ label: 'Resend', onSelect: () => void resendMutation.mutateAsync().catch(() => undefined), testId: `${testPrefix}-resend` }]
      : []),
    { label: 'Cancel invite', onSelect: () => setIsCancelOpen(true), testId: `${testPrefix}-cancel`, tone: 'danger' },
  ];

  return (
    <>
      <RowActionsMenu actions={actions} label={`Actions for ${label}`} testId={testPrefix} />
      <ConfirmDialog
        cancelLabel="Keep it"
        confirmLabel="Cancel invite"
        description={isEmail
          ? `The link sent to ${label} will stop working.`
          : 'The join link will stop working. Anyone who already joined with it stays in the league.'}
        isPending={cancelMutation.isPending}
        onCancel={closeCancelDialog}
        onConfirm={() => void cancelMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setIsCancelOpen(true);
            return;
          }
          closeCancelDialog();
        }}
        open={isCancelOpen}
        pendingLabel="Cancelling..."
        testId={`${testPrefix}-cancel-dialog`}
        title="Cancel this invite?"
        tone="danger"
      />
    </>
  );
}
