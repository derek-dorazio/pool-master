import type { SquadDto } from '@/lib/api';
import { Alert, ConfirmDialog, LifecycleActionSet } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { type ActiveTeamDialog, TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import type { MyTeamLifecycle } from './use-my-team-lifecycle';

export function MyTeamLifecycleActions({
  lifecycle,
  isInactiveLeague,
  isInactiveTeam,
  isBusy,
  canInactivateSelectedTeam,
  canDeleteSelectedTeam,
  setActiveDialog,
}: {
  lifecycle: MyTeamLifecycle;
  isInactiveLeague: boolean;
  isInactiveTeam: boolean;
  isBusy: boolean;
  canInactivateSelectedTeam: boolean;
  canDeleteSelectedTeam: boolean;
  setActiveDialog: (dialog: ActiveTeamDialog) => void;
}) {
  return (
    <LifecycleActionSet
      actions={[
        {
          key: 'inactivate',
          label: 'Inactivate team',
          pending: lifecycle.inactivateTeamMutation.isPending,
          pendingLabel: 'Inactivating...',
          disabled: isInactiveLeague || isBusy || !canInactivateSelectedTeam,
          onSelect: () => setActiveDialog('inactivate'),
          testId: 'my-team-inactivate',
          tone: 'danger',
          visibleForStatuses: ['Active'],
        },
        {
          key: 'delete',
          label: 'Delete team',
          pending: lifecycle.deleteTeamMutation.isPending,
          pendingLabel: 'Deleting...',
          disabled: !canDeleteSelectedTeam || isInactiveLeague || isBusy,
          onSelect: () => setActiveDialog('delete'),
          testId: 'my-team-delete',
          tone: 'danger',
          visibleForStatuses: ['Inactive'],
        },
      ]}
      currentStatus={isInactiveTeam ? 'Inactive' : 'Active'}
      statusTone={isInactiveTeam ? 'inactive' : 'active'}
      title="Team lifecycle"
    />
  );
}

/** The inactivate and delete outcomes. Shown in both the actions tile and the owners panel. */
export function MyTeamLifecycleNotices({ lifecycle }: { lifecycle: MyTeamLifecycle }) {
  const { teamInactivationNotice, teamDeletionNotice, inactivateTeamMutation, deleteTeamMutation } = lifecycle;

  return (
    <>
      {teamInactivationNotice ? (
        <Alert tone="success">{teamInactivationNotice}</Alert>
      ) : null}
      {teamDeletionNotice ? (
        <Alert tone="success">{teamDeletionNotice}</Alert>
      ) : null}
      {inactivateTeamMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(inactivateTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
      ) : null}
      {deleteTeamMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(deleteTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
      ) : null}
    </>
  );
}

export function MyTeamLifecycleDialogs({
  lifecycle,
  selectedTeam,
  activeDialog,
  setActiveDialog,
}: {
  lifecycle: MyTeamLifecycle;
  selectedTeam: SquadDto | null;
  activeDialog: ActiveTeamDialog;
  setActiveDialog: (dialog: ActiveTeamDialog) => void;
}) {
  const { inactivateTeamMutation, deleteTeamMutation } = lifecycle;

  return (
    <>
      <ConfirmDialog
        confirmLabel="Inactivate team"
        confirmTestId="my-team-confirm-inactivate"
        description={
          selectedTeam
            ? `${selectedTeam.name} will become inactive and its active owners will be removed from this league. Their accounts stay active, and inviting them back restores this team.`
            : 'This team will become inactive.'
        }
        isPending={inactivateTeamMutation.isPending}
        onCancel={() => {
          if (!inactivateTeamMutation.isPending) {
            inactivateTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        onConfirm={() => void inactivateTeamMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setActiveDialog('inactivate');
            return;
          }

          if (!inactivateTeamMutation.isPending) {
            inactivateTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'inactivate'}
        pendingLabel="Inactivating..."
        testId="my-team-inactivate-dialog"
        title="Inactivate team"
        tone="danger"
      />

      <ConfirmDialog
        confirmLabel="Delete team"
        confirmTestId="my-team-confirm-delete"
        description={
          selectedTeam
            ? `${selectedTeam.name} will be permanently deleted. This is only available after the team is inactive.`
            : 'This inactive team will be permanently deleted.'
        }
        isPending={deleteTeamMutation.isPending}
        onCancel={() => {
          if (!deleteTeamMutation.isPending) {
            deleteTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        onConfirm={() => void deleteTeamMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setActiveDialog('delete');
            return;
          }

          if (!deleteTeamMutation.isPending) {
            deleteTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'delete'}
        pendingLabel="Deleting..."
        testId="my-team-delete-dialog"
        title="Delete team"
        tone="danger"
      />
    </>
  );
}
