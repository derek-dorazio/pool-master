import { useState } from 'react';
import { runContestDraw } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Alert, Button, ConfirmDialog } from '@/features/shared/ui';
import { pluralize } from './contest-rules';
import { CONTEST_DRAW_CODE_MESSAGES } from './use-contest-draw';

/**
 * "Run draw": the commissioner's one-way deal of a random-draw contest. It deals every entry its
 * golfers, enters them all and closes entries, and there is no undo, so it asks first.
 */
export function RunDrawAction({
  contestId,
  entryCount,
  leagueId,
  picksPerEntry,
}: {
  contestId: string;
  entryCount: number;
  leagueId: string;
  picksPerEntry: number;
}) {
  const logger = getLogger().child({ feature: 'run-draw-action' });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const runDrawMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await runContestDraw({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Run draw response is missing data.');
      }
      return response.data;
    },
    onMutate: () => {
      logger.debug({ action: 'contest.draw.started', data: { leagueId, contestId } }, 'Running the contest draw');
    },
    onSuccess: () => {
      logger.info({ action: 'contest.draw.succeeded', data: { leagueId, contestId } }, 'Ran the contest draw');
      setIsConfirmOpen(false);
    },
    // The draw submits every entry with its dealt golfers, closes entries and reveals the picks,
    // so every entry's room, the entry list and the standings all change.
    invalidates: [
      QueryKeys.selectionStates.byContest(contestId),
      QueryKeys.contestEntries.byContest(contestId),
      QueryKeys.contests.detail(contestId),
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.managedContests.all,
    ],
    onError: (error) => {
      const payload = { action: 'contest.draw.failed', data: { leagueId, contestId }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'The contest draw was rejected');
      } else {
        logger.error(payload, 'The contest draw failed unexpectedly');
      }
    },
  });

  function closeDialog() {
    if (!runDrawMutation.isPending) {
      runDrawMutation.reset();
      setIsConfirmOpen(false);
    }
  }

  return (
    <>
      <Button data-testid="contest-run-draw" onClick={() => setIsConfirmOpen(true)}>
        Run draw
      </Button>
      <ConfirmDialog
        confirmLabel="Run draw"
        confirmTestId="contest-run-draw-confirm"
        description={`The draw deals each of the ${pluralize(entryCount, 'entry', 'entries')} ${pluralize(picksPerEntry, 'golfer')} at random and enters them. It’s final: it can’t be undone or run again. Entries close, so no one can enter, leave or rename an entry afterwards, and everyone in the league sees who drew whom.`}
        isPending={runDrawMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => void runDrawMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setIsConfirmOpen(true);
            return;
          }
          closeDialog();
        }}
        open={isConfirmOpen}
        pendingLabel="Drawing..."
        testId="contest-run-draw-dialog"
        title="Run the draw?"
      >
        {runDrawMutation.isError ? (
          <Alert data-testid="contest-run-draw-error" tone="danger">
            {extractErrorMessage(runDrawMutation.error, {
              codeMessages: CONTEST_DRAW_CODE_MESSAGES,
              fallback: 'We could not run the draw. Please try again.',
            })}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
