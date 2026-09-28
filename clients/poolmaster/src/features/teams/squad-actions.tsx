import { useState } from 'react';
import {
  createSquadOwnerInvitation,
  inactivateLeagueSquad,
  revokeSquadOwnerInvitation,
  type TeamOwnerInvitationDto,
} from '@/lib/api';
import { Button, Chip, FormField, Input } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

/**
 * The squad-level actions, on the squad list (#219).
 *
 * These existed only on Team Home, reachable for another team by appending `?teamId=` — a hop that
 * made the squad list a read-only directory even though it is the league's member roster.
 *
 * Permissions mirror the backend rather than restating it:
 *
 * - **Invite and revoke a co-owner** — `requireSquadManager`: an active owner of *this* squad, or a
 *   commissioner / root admin for any squad. Plainly the owner's business.
 * - **Inactivate the team** — commissioner or root admin only. Ending a team also ends its owners'
 *   league memberships (#218), so it is league administration, not team management.
 */
type SquadActionsProps = {
  canInactivate: boolean;
  canManageOwners: boolean;
  leagueId: string;
  pendingInvitations: TeamOwnerInvitationDto[];
  squadId: string;
  squadIsActive: boolean;
  squadName: string;
};

type ActiveAction = 'invite' | 'inactivate' | null;

export function SquadActions({
  canInactivate,
  canManageOwners,
  leagueId,
  pendingInvitations,
  squadId,
  squadIsActive,
  squadName,
}: SquadActionsProps) {
  const logger = getLogger().child({ feature: 'squad-actions' });
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [coOwnerEmail, setCoOwnerEmail] = useState('');

  const inviteMutation = useInvalidatingMutation({
    mutationFn: async (email: string) => {
      const response = await createSquadOwnerInvitation({
        path: { id: leagueId, squadId },
        body: { email },
      });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Owner invitation response is missing data.');
      }
      return response.data.invitation;
    },
    onSuccess: (invitation) => {
      setCoOwnerEmail('');
      setActiveAction(null);
      logger.info(
        {
          action: 'squadActions.inviteCoOwner.succeeded',
          data: { squadId, invitationStatus: invitation.status },
        },
        'Invited a co-owner from the squad list',
      );
    },
    invalidates: [
      QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
      QueryKeys.leagueTeams.byLeague(leagueId),
    ],
  });

  const revokeMutation = useInvalidatingMutation({
    mutationFn: async (invitationId: string) => {
      const response = await revokeSquadOwnerInvitation({
        path: { id: leagueId, invitationId },
      });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Revoke owner invitation response is missing data.');
      }
      return response.data.invitation;
    },
    invalidates: [QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId)],
  });

  const inactivateMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await inactivateLeagueSquad({ path: { id: leagueId, squadId } });
      if (!response.data?.squad) {
        throwApiError(response.error, 'Team inactivation response is missing data.');
      }
      return response.data.squad;
    },
    onSuccess: () => setActiveAction(null),
    invalidates: [
      QueryKeys.leagueTeams.byLeague(leagueId),
      QueryKeys.leagues.list,
      QueryKeys.leagues.members(leagueId),
    ],
  });

  const isBusy = inviteMutation.isPending || revokeMutation.isPending || inactivateMutation.isPending;
  const showInvite = canManageOwners && squadIsActive;
  const showInactivate = canInactivate && squadIsActive;

  if (!showInvite && !showInactivate && !pendingInvitations.length) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3" data-testid={`squad-actions-${squadId}`}>
      {pendingInvitations.length ? (
        <div className="space-y-2">
          {pendingInvitations.map((invitation) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-3"
              data-testid={`squad-actions-pending-${squadId}-${invitation.id}`}
              key={invitation.id}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-foreground">{invitation.email}</span>
                <Chip>Pending invite</Chip>
              </div>
              {canManageOwners ? (
                <Button
                  data-testid={`squad-actions-revoke-${squadId}-${invitation.id}`}
                  disabled={isBusy}
                  onClick={() => void revokeMutation.mutateAsync(invitation.id).catch(() => undefined)}
                  type="button"
                  variant="subtle"
                >
                  {revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
                </Button>
              ) : null}
            </div>
          ))}
          {revokeMutation.isError ? (
            <p className="text-sm text-destructive" data-testid={`squad-actions-revoke-error-${squadId}`}>
              {extractErrorMessage(revokeMutation.error, {
                fallback: 'We could not revoke that invitation. Please try again.',
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {showInvite ? (
          <Button
            data-testid={`squad-actions-open-invite-${squadId}`}
            disabled={isBusy}
            onClick={() => setActiveAction(activeAction === 'invite' ? null : 'invite')}
            type="button"
            variant="subtle"
          >
            Invite co-owner
          </Button>
        ) : null}
        {showInactivate ? (
          <Button
            data-testid={`squad-actions-open-inactivate-${squadId}`}
            disabled={isBusy}
            onClick={() => setActiveAction(activeAction === 'inactivate' ? null : 'inactivate')}
            type="button"
            variant="subtle"
          >
            Inactivate team
          </Button>
        ) : null}
      </div>

      {activeAction === 'invite' ? (
        <form
          className="space-y-3 rounded-2xl border border-border bg-card p-4"
          data-testid={`squad-actions-invite-form-${squadId}`}
          onSubmit={(event) => {
            event.preventDefault();
            void inviteMutation.mutateAsync(coOwnerEmail.trim()).catch(() => undefined);
          }}
        >
          <FormField label={`Invite a co-owner to ${squadName}`}>
            <Input
              data-testid={`squad-actions-invite-email-${squadId}`}
              onChange={(event) => setCoOwnerEmail(event.target.value)}
              placeholder="co-owner@example.com"
              type="email"
              value={coOwnerEmail}
            />
          </FormField>
          <p className="text-sm text-muted-foreground">
            If they already have a PoolMaster account they join this team straight away. If not,
            they&apos;ll get an invite and can create their account from it.
          </p>
          {inviteMutation.isError ? (
            <p className="text-sm text-destructive" data-testid={`squad-actions-invite-error-${squadId}`}>
              {extractErrorMessage(inviteMutation.error, {
                fallback: 'We could not send that invitation. Please try again.',
                codeMessages: {
                  SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT:
                    'That person is already in this league, and every member has their own team. Only somebody outside the league can join an existing team as a co-owner.',
                },
              })}
            </p>
          ) : null}
          <Button
            data-testid={`squad-actions-send-invite-${squadId}`}
            disabled={isBusy || !coOwnerEmail.trim()}
            type="submit"
          >
            {inviteMutation.isPending ? 'Sending...' : 'Send invite'}
          </Button>
        </form>
      ) : null}

      {activeAction === 'inactivate' ? (
        <div
          className="space-y-3 rounded-2xl border border-border bg-card p-4"
          data-testid={`squad-actions-inactivate-panel-${squadId}`}
        >
          <p className="text-sm text-muted-foreground">
            Inactivating {squadName} keeps its history and removes its owners from the league. Their
            accounts stay active, and inviting them back restores this team.
          </p>
          {inactivateMutation.isError ? (
            <p
              className="text-sm text-destructive"
              data-testid={`squad-actions-inactivate-error-${squadId}`}
            >
              {extractErrorMessage(inactivateMutation.error, {
                fallback: 'We could not inactivate that team. Please try again.',
              })}
            </p>
          ) : null}
          <Button
            data-testid={`squad-actions-confirm-inactivate-${squadId}`}
            disabled={isBusy}
            onClick={() => void inactivateMutation.mutateAsync().catch(() => undefined)}
            variant="danger"
            type="button"
          >
            {inactivateMutation.isPending ? 'Inactivating...' : `Inactivate ${squadName}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
