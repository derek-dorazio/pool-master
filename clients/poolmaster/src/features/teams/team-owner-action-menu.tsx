import { useState } from 'react';
import { changeMemberRole, removeSquadOwner } from '@/lib/api';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuTriggerSlot,
  ConfirmDialog,
  LinkButton,
  ReadOnlyDetailModal,
  showToast,
  Text,
} from '@/features/shared/ui';
import { buildLeagueAdminTeamPath } from '@/features/leagues/league-routing';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import type { TeamMember } from './my-team-shared';

type OwnerRole = TeamMember['leagueRole'];
type ActiveAction = 'promote' | 'demote' | 'remove' | null;

export function TeamOwnerActionMenu({
  activeOwnerCount,
  canManageLeagueRole,
  leagueCode,
  leagueId,
  ownerName,
  ownerRole,
  ownerUserId,
  teamId,
}: {
  activeOwnerCount: number;
  canManageLeagueRole: boolean;
  leagueCode: string;
  leagueId: string;
  ownerName: string;
  ownerRole: OwnerRole;
  ownerUserId: string;
  teamId: string;
}) {
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);

  const canPromote = canManageLeagueRole && ownerRole === 'MEMBER';
  const canDemote = canManageLeagueRole && ownerRole === 'COMMISSIONER';
  const removeRequiresInactivation = activeOwnerCount <= 1;
  const testPrefix = 'team-home-owner-actions';

  // The league context carries the viewer's own role and the league's member count, and both
  // change here: a commissioner may demote themselves, and removing an owner ends their membership.
  const ownerViewKeys = [
    QueryKeys.leagues.detail(leagueCode),
    QueryKeys.leagues.list,
    QueryKeys.leagues.members(leagueId),
    QueryKeys.leagueTeams.byLeague(leagueId),
    QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
  ] as const;

  const changeRoleMutation = useInvalidatingMutation({
    mutationFn: async (nextRole: 'COMMISSIONER' | 'MEMBER') => {
      const response = await changeMemberRole({
        path: { id: leagueId, uid: ownerUserId },
        body: { role: nextRole },
      });

      if (!response.data?.membership) {
        throwApiError(response.error, 'League member role response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: (_membership, nextRole) => {
      setActiveAction(null);
      showToast({
        title: nextRole === 'COMMISSIONER' ? `${ownerName} is now a commissioner` : `${ownerName} is now a member`,
        tone: 'success',
      });
    },
    invalidates: ownerViewKeys,
  });

  const removeOwnerMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await removeSquadOwner({
        path: { id: leagueId, squadId: teamId, userId: ownerUserId },
      });

      if (!response.data?.membership) {
        throwApiError(response.error, 'Remove owner response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: () => {
      setActiveAction(null);
      showToast({ title: `${ownerName} removed`, tone: 'success' });
    },
    invalidates: ownerViewKeys,
  });

  const roleError = changeRoleMutation.error
    ? extractErrorMessage(changeRoleMutation.error, { fallback: 'We could not update that league role.' })
    : null;
  const removeError = removeOwnerMutation.error
    ? extractErrorMessage(removeOwnerMutation.error, { fallback: 'We could not remove that owner right now.' })
    : null;
  const actionIsPending = changeRoleMutation.isPending || removeOwnerMutation.isPending;
  const dialogTitle =
    activeAction === 'promote'
      ? 'Promote to commissioner'
      : activeAction === 'demote'
        ? 'Demote to member'
        : 'Remove owner';
  const dialogTestId = `${testPrefix}-dialog-${teamId}-${ownerUserId}`;
  const closeDialog = () => {
    // A failure belongs to that attempt; the next opening starts clean.
    setActiveAction(null);
    changeRoleMutation.reset();
    removeOwnerMutation.reset();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTriggerSlot>
          <Button
            className="rounded-2xl px-4 py-2"
            data-testid={`${testPrefix}-trigger-${teamId}-${ownerUserId}`}
            type="button"
            variant="secondary"
          >
            Owner actions
          </Button>
        </DropdownMenuTriggerSlot>
        <DropdownMenuContent align="end" testId={`${testPrefix}-menu-${teamId}-${ownerUserId}`} width="md">
          {canPromote ? (
            <DropdownMenuItem
              data-testid={`${testPrefix}-promote-${teamId}-${ownerUserId}`}
              onSelect={() => setActiveAction('promote')}
            >
              <DropdownMenuItemText name="Promote to commissioner" />
            </DropdownMenuItem>
          ) : null}
          {canDemote ? (
            <DropdownMenuItem
              data-testid={`${testPrefix}-demote-${teamId}-${ownerUserId}`}
              onSelect={() => setActiveAction('demote')}
            >
              <DropdownMenuItemText name="Demote to member" />
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            data-testid={`${testPrefix}-remove-${teamId}-${ownerUserId}`}
            onSelect={() => setActiveAction('remove')}
          >
            <DropdownMenuItemText name="Remove owner" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {activeAction === 'remove' && removeRequiresInactivation ? (
        <ReadOnlyDetailModal
          detailContent={canManageLeagueRole ? (
            <>
              <Text as="p">
                {ownerName} is the only active owner, so removing them means inactivating. Use Inactivate in the Danger zone on the Manage page.
              </Text>
              <LinkButton
                className="mt-3"
                onClick={closeDialog}
                size="sm"
                to={buildLeagueAdminTeamPath(leagueCode, teamId)}
                variant="secondary"
              >
                Open the Manage page
              </LinkButton>
            </>
          ) : (
            <Text as="p">
              {ownerName} is the only active owner, so they can&apos;t be removed. To step away from this league, use Leave league.
            </Text>
          )}
          onCancel={closeDialog}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          open
          size="sm"
          testId={dialogTestId}
          title="Remove owner"
        />
      ) : (
        <ConfirmDialog
          confirmLabel={activeAction === 'promote' ? 'Promote' : activeAction === 'demote' ? 'Demote' : 'Remove'}
          confirmTestId={activeAction ? `${testPrefix}-confirm-${activeAction}-${teamId}-${ownerUserId}` : undefined}
          description={
            activeAction === 'promote'
              ? `${ownerName} will gain commissioner authority for this league.`
              : activeAction === 'demote'
                ? `${ownerName} will lose commissioner authority and return to member status in this league.`
                // #218: removal also ends their league membership, because a member with no
                // squad is invisible on every surface that lists people in the league.
                : `${ownerName} will stop being an owner and will leave this league. Their contest history stays, and rejoining restores it.`
          }
          error={activeAction === 'remove' ? removeError : roleError}
          isPending={actionIsPending}
          onCancel={closeDialog}
          onConfirm={() => {
            const run = activeAction === 'promote'
              ? changeRoleMutation.mutateAsync('COMMISSIONER')
              : activeAction === 'demote'
                ? changeRoleMutation.mutateAsync('MEMBER')
                : removeOwnerMutation.mutateAsync();
            void run.catch(() => undefined);
          }}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          open={activeAction !== null}
          pendingLabel={activeAction === 'promote' ? 'Promoting...' : activeAction === 'demote' ? 'Demoting...' : 'Removing...'}
          testId={dialogTestId}
          title={dialogTitle}
          tone={activeAction === 'remove' ? 'danger' : 'default'}
        />
      )}
    </>
  );
}
