import { useState, type ReactNode } from 'react';
import { openContest } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Button, ConfirmDialog, showToast } from '@/features/shared/ui';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';
import { entryWriteKeys } from './use-contest-entries';

/**
 * "Open to league" (#117): the commissioner's one-way release of a draft contest. Members can
 * enter it from then on, and its settings can never change again, so it asks first.
 */
export function OpenContestAction({
  contestId,
  contestName,
  leagueId,
}: {
  contestId: string;
  contestName: string;
  leagueId: string;
}) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <>
      <Button
        data-testid="contest-open-to-league"
        onClick={() => setIsConfirmOpen(true)}
      >
        Open to league
      </Button>
      <OpenContestDialog
        contestId={contestId}
        contestName={contestName}
        leagueId={leagueId}
        onOpenChange={setIsConfirmOpen}
        open={isConfirmOpen}
      />
    </>
  );
}

/**
 * The question "Open to league" asks, and the release once the commissioner confirms, wherever
 * they start it: the contest's own page or the "⋯" on its row in the contests list. A release
 * ends in a toast; a refusal shows inside the dialog, which stays open. Started from the list, it
 * shows the contest's readiness checks as `children` and holds Open until they pass.
 */
export function OpenContestDialog({
  children,
  contestId,
  contestName,
  isConfirmDisabled = false,
  leagueId,
  onOpenChange,
  open,
}: {
  /** Drawn under the question: the readiness checks when the dialog starts from the list. */
  children?: ReactNode;
  contestId: string;
  contestName: string;
  isConfirmDisabled?: boolean;
  leagueId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const logger = getLogger().child({ feature: 'open-contest-action' });

  const openContestMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await openContest({ path: { id: leagueId, contestId } });
      if (!response.data?.contest) {
        throwApiError(response.error, 'Open contest response is missing data.');
      }
      return response.data.contest;
    },
    onMutate: () => {
      logger.debug(
        { action: 'contest.open.started', data: { leagueId, contestId } },
        'Opening contest to the league',
      );
    },
    onSuccess: () => {
      logger.info(
        { action: 'contest.open.succeeded', data: { leagueId, contestId } },
        'Opened contest to the league',
      );
      onOpenChange(false);
      showToast({ title: `${contestName} is open to the league`, tone: 'success' });
    },
    invalidates: [
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.managedContests.all,
      ...entryWriteKeys(contestId),
    ],
    onError: (error) => {
      const payload = { action: 'contest.open.failed', data: { leagueId, contestId }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'Opening the contest was rejected');
      } else {
        logger.error(payload, 'Opening the contest failed unexpectedly');
      }
    },
  });

  function closeDialog() {
    if (!openContestMutation.isPending) {
      openContestMutation.reset();
      onOpenChange(false);
    }
  }

  return (
    <ConfirmDialog
      confirmLabel="Open to league"
      confirmTestId="contest-open-confirm"
      error={openContestMutation.isError
        ? extractErrorMessage(openContestMutation.error, {
          codeMessages: CONTEST_RELEASE_CODE_MESSAGES,
          fallback: 'We could not open that contest. Please try again.',
        })
        : null}
      description="League members will be able to see this contest and enter it. Its name and settings can't change afterwards, and it can't be deleted or returned to a draft."
      isConfirmDisabled={isConfirmDisabled}
      isPending={openContestMutation.isPending}
      onCancel={closeDialog}
      onConfirm={() => void openContestMutation.mutateAsync().catch(() => undefined)}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        closeDialog();
      }}
      open={open}
      pendingLabel="Opening..."
      testId="contest-open-dialog"
      title="Open this contest to the league?"
    >
      {children}
    </ConfirmDialog>
  );
}
