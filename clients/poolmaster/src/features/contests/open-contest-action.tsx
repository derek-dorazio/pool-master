import { useState } from 'react';
import { openContest } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Alert, Button, ConfirmDialog } from '@/features/shared/ui';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';

/**
 * "Open to league" (#117): the commissioner's one-way release of a draft contest. Members can
 * enter it from then on, and its settings can never change again, so it asks first.
 */
export function OpenContestAction({
  contestId,
  leagueId,
}: {
  contestId: string;
  leagueId: string;
}) {
  const logger = getLogger().child({ feature: 'open-contest-action' });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

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
      setIsConfirmOpen(false);
    },
    invalidates: [
      QueryKeys.contests.detail(contestId),
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.managedContests.all,
      QueryKeys.contestEntries.byContest(contestId),
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
      setIsConfirmOpen(false);
    }
  }

  return (
    <>
      <Button
        data-testid="contest-open-to-league"
        onClick={() => setIsConfirmOpen(true)}
      >
        Open to league
      </Button>
      <ConfirmDialog
        confirmLabel="Open to league"
        confirmTestId="contest-open-confirm"
        description="League members will be able to see this contest and enter it. Its name and settings can't change afterwards, and it can't be deleted or returned to a draft."
        isPending={openContestMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => void openContestMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setIsConfirmOpen(true);
            return;
          }
          closeDialog();
        }}
        open={isConfirmOpen}
        pendingLabel="Opening..."
        testId="contest-open-dialog"
        title="Open this contest to the league?"
      >
        {openContestMutation.isError ? (
          <Alert data-testid="contest-open-error" tone="danger">
            {extractErrorMessage(openContestMutation.error, {
              codeMessages: CONTEST_RELEASE_CODE_MESSAGES,
              fallback: 'We could not open that contest. Please try again.',
            })}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
