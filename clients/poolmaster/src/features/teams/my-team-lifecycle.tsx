import type { SquadDto } from '@/lib/api';
import { Alert, ConfirmDialog } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { type ActiveTeamDialog, TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import type { MyTeamLifecycle } from './use-my-team-lifecycle';

/** The inactivate and delete outcomes. */
export function MyTeamLifecycleNotices({ lifecycle }: { lifecycle: MyTeamLifecycle }) {
  const { teamInactivationNotice, inactivateTeamMutation, deleteTeamMutation } = lifecycle;

  return (
    <>
      {teamInactivationNotice ? (
        <Alert tone="success">{teamInactivationNotice}</Alert>
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
        confirmLabel="Inactivate"
        confirmTestId="my-team-confirm-inactivate"
        description={
          selectedTeam
            ? `${selectedTeam.name} will become inactive and its active owners will be removed from this league. Their accounts stay active, and inviting them back restores it.`
            : 'Its active owners will be removed from this league.'
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
        title={selectedTeam ? `Inactivate ${selectedTeam.name}` : 'Inactivate'}
        tone="danger"
      />

      <ConfirmDialog
        confirmLabel="Delete"
        confirmTestId="my-team-confirm-delete"
        description={
          selectedTeam
            ? `${selectedTeam.name} will be permanently deleted. This is only available once it is inactive.`
            : 'This will be permanently deleted.'
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
        title={selectedTeam ? `Delete ${selectedTeam.name}` : 'Delete'}
        tone="danger"
      />
    </>
  );
}
