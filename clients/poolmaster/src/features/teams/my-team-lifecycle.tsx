import type { SquadDto } from '@/lib/api';
import { Notice, ConfirmDialog } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { type ActiveTeamDialog, TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import type { MyTeamLifecycle } from './use-my-team-lifecycle';

/** Why an inactivate or delete failed. Success closes the dialog and shows a toast. */
export function MyTeamLifecycleNotices({ lifecycle }: { lifecycle: MyTeamLifecycle }) {
  const { inactivateTeamMutation, deleteTeamMutation } = lifecycle;

  return (
    <>
      {inactivateTeamMutation.isError ? (
        <Notice tone="danger">{extractErrorMessage(inactivateTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Notice>
      ) : null}
      {deleteTeamMutation.isError ? (
        <Notice tone="danger">{extractErrorMessage(deleteTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Notice>
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
  /** The team the page shows; the dialogs open only once it has loaded. */
  selectedTeam: SquadDto;
  activeDialog: ActiveTeamDialog;
  setActiveDialog: (dialog: ActiveTeamDialog) => void;
}) {
  const { inactivateTeamMutation, deleteTeamMutation } = lifecycle;
  // Each dialog is opened by its page button, so the one change it reports is a close (Escape),
  // which Cancel shares. ConfirmDialog offers neither while its write is still running.
  const closeInactivate = () => {
    inactivateTeamMutation.reset();
    setActiveDialog(null);
  };
  const closeDelete = () => {
    deleteTeamMutation.reset();
    setActiveDialog(null);
  };

  return (
    <>
      <ConfirmDialog
        confirmLabel="Inactivate"
        confirmTestId="my-team-confirm-inactivate"
        description={`${selectedTeam.name} will become inactive and its active owners will be removed from this league. Their accounts stay active, and inviting them back restores it.`}
        isPending={inactivateTeamMutation.isPending}
        onCancel={closeInactivate}
        onConfirm={() => void inactivateTeamMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={closeInactivate}
        open={activeDialog === 'inactivate'}
        pendingLabel="Inactivating..."
        testId="my-team-inactivate-dialog"
        title={`Inactivate ${selectedTeam.name}`}
        tone="danger"
      />

      <ConfirmDialog
        confirmLabel="Delete"
        confirmTestId="my-team-confirm-delete"
        description={`${selectedTeam.name} will be permanently deleted. This is only available once it is inactive.`}
        isPending={deleteTeamMutation.isPending}
        onCancel={closeDelete}
        onConfirm={() => void deleteTeamMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={closeDelete}
        open={activeDialog === 'delete'}
        pendingLabel="Deleting..."
        testId="my-team-delete-dialog"
        title={`Delete ${selectedTeam.name}`}
        tone="danger"
      />
    </>
  );
}
