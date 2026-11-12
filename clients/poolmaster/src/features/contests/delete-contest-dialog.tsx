import { deleteContest } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { ConfirmDialog, Notice } from '@/features/shared/ui';

/**
 * "Delete this contest?": removes a contest that was never opened to the league, for good, once
 * the commissioner confirms. The contest's own page and the "⋯" on its row in the contests list
 * both ask with it.
 */
export function DeleteContestDialog({
  contestId,
  contestName,
  leagueCode,
  leagueId,
  onDeleted,
  onOpenChange,
  open,
}: {
  contestId: string;
  contestName: string;
  leagueCode: string;
  leagueId: string;
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const logger = getLogger().child({ feature: 'delete-contest-dialog' });
  const deleteContestMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await deleteContest({ path: { contestId } });
      if (response.error) {
        throwApiError(response.error);
      }
    },
    onSuccess: () => {
      logger.info({ action: 'contest.delete.succeeded', data: { leagueCode, contestId } }, 'Deleted contest');
      onOpenChange(false);
      onDeleted();
    },
    invalidates: [QueryKeys.contests.list({ leagueId }), QueryKeys.managedContests.all],
    onError: (error) => {
      const payload = { action: 'contest.delete.failed', data: { leagueCode, contestId }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest delete was rejected');
      } else {
        logger.error(payload, 'Contest delete failed unexpectedly');
      }
    },
  });

  function closeDialog() {
    if (!deleteContestMutation.isPending) {
      deleteContestMutation.reset();
      onOpenChange(false);
    }
  }

  return (
    <ConfirmDialog
      confirmLabel="Delete contest"
      description={`${contestName} will be removed for good. Members never saw it.`}
      isPending={deleteContestMutation.isPending}
      onCancel={closeDialog}
      onConfirm={() => void deleteContestMutation.mutateAsync().catch(() => undefined)}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        closeDialog();
      }}
      open={open}
      pendingLabel="Deleting..."
      testId="contest-delete-dialog"
      title="Delete this contest?"
      tone="danger"
    >
      {deleteContestMutation.isError ? (
        <Notice data-testid="contest-delete-error" tone="danger">
          {extractErrorMessage(deleteContestMutation.error, {
            fallback: 'We could not delete that contest. Please try again.',
          })}
        </Notice>
      ) : null}
    </ConfirmDialog>
  );
}
