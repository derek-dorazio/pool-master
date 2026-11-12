import { useState } from 'react';
import { changeMemberRole, removeSquadOwner } from '@/lib/api';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuTriggerSlot,
  InlineError,
  LinkButton,
  Modal,
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
    onSuccess: () => {
      setActiveAction(null);
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
    },
    invalidates: ownerViewKeys,
  });

  const roleError = changeRoleMutation.error
    ? extractErrorMessage(changeRoleMutation.error, { fallback: 'We could not update that league role.' })
    : null;
  const removeError = removeOwnerMutation.error
    ? extractErrorMessage(removeOwnerMutation.error, { fallback: 'We could not remove that owner right now.' })
    : null;
  const dialogTitle =
    activeAction === 'promote'
      ? 'Promote to commissioner'
      : activeAction === 'demote'
        ? 'Demote to member'
        : 'Remove owner';
  const dialogTestId = `${testPrefix}-dialog-${teamId}-${ownerUserId}`;
  const dialogDescription =
    activeAction === 'promote'
      ? `${ownerName} will gain commissioner authority for this league.`
      : activeAction === 'demote'
        ? `${ownerName} will lose commissioner authority and return to member status in this league.`
        : `${ownerName} will stop being an owner and will leave this league.`;

  function closeDialog() {
    setActiveAction(null);
    changeRoleMutation.reset();
    removeOwnerMutation.reset();
  }

  const sharedDialogProps = {
    closeLabel: `Close ${dialogTitle}`,
    description: dialogDescription,
    onOpenChange: (open: boolean) => {
      if (!open) closeDialog();
    },
    open: activeAction !== null,
    testId: dialogTestId,
    title: dialogTitle,
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTriggerSlot>
          <Button
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

      {activeAction === 'promote' || activeAction === 'demote' ? (
        <ConfirmDialog
          {...sharedDialogProps}
          confirmLabel={activeAction === 'promote' ? 'Promote' : 'Demote'}
          confirmTestId={`${testPrefix}-confirm-${activeAction}-${teamId}-${ownerUserId}`}
          isPending={changeRoleMutation.isPending}
          onCancel={closeDialog}
          onConfirm={() =>
            void changeRoleMutation.mutateAsync(activeAction === 'promote' ? 'COMMISSIONER' : 'MEMBER').catch(() => undefined)}
          pendingLabel={activeAction === 'promote' ? 'Promoting...' : 'Demoting...'}
        >
          <div className="space-y-4">
            <Text as="p" variant="meta">
              {activeAction === 'promote'
                ? 'This change is league-scoped and does not alter the user\'s account-level permissions.'
                : 'A league must keep at least one active commissioner.'}
            </Text>
            {roleError ? <InlineError>{roleError}</InlineError> : null}
          </div>
        </ConfirmDialog>
      ) : null}

      {activeAction === 'remove' && !removeRequiresInactivation ? (
        <ConfirmDialog
          {...sharedDialogProps}
          confirmLabel="Remove as co-owner and from the league"
          confirmTestId={`${testPrefix}-confirm-remove-${teamId}-${ownerUserId}`}
          isPending={removeOwnerMutation.isPending}
          onCancel={closeDialog}
          onConfirm={() => void removeOwnerMutation.mutateAsync().catch(() => undefined)}
          pendingLabel="Removing..."
          tone="danger"
        >
          <div className="space-y-4">
            {/*
              * #218 — this copy said "removes the owner relationship only", which stopped
              * being true: removal now also ends their league membership, because a member
              * with no squad is invisible on every surface that lists people in the league.
              */}
            <Text as="p" variant="meta">
              This removes them as an owner and from the league. Contest history stays intact,
              and a commissioner can invite them back — rejoining restores everything they had.
            </Text>
            {removeError ? <InlineError>{removeError}</InlineError> : null}
          </div>
        </ConfirmDialog>
      ) : null}

      {/*
        * A team's only owner can't be removed here, so this dialog has nothing to confirm: a
        * commissioner is sent to the Manage page to inactivate the team, and an owner is told to
        * leave the league instead.
        */}
      {activeAction === 'remove' && removeRequiresInactivation ? (
        <Modal
          {...sharedDialogProps}
          footer={canManageLeagueRole ? (
            <>
              <Button onClick={closeDialog} type="button" variant="secondary">Cancel</Button>
              <LinkButton onClick={closeDialog} to={buildLeagueAdminTeamPath(leagueCode, teamId)}>
                Open the Manage page
              </LinkButton>
            </>
          ) : (
            <Button onClick={closeDialog} type="button" variant="secondary">Close</Button>
          )}
          onClose={closeDialog}
          size="sm"
        >
          <Text as="p" variant="meta">
            {canManageLeagueRole
              ? `${ownerName} is the only active owner, so removing them means inactivating. Use Inactivate in the Danger zone on the Manage page.`
              : `${ownerName} is the only active owner, so they can't be removed. To step away from this league, use Leave league.`}
          </Text>
        </Modal>
      ) : null}
    </>
  );
}
