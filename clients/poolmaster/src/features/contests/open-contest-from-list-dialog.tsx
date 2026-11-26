import { useQuery } from '@tanstack/react-query';
import type { ContestDto } from '@/lib/api';
import { CheckList, ErrorState, LoadingState, refetchFailed } from '@/features/shared/ui';
import { firstContestEvent } from './contest-events';
import { getContestReadinessChecks } from './contest-readiness';
import { OpenContestDialog } from './open-contest-action';
import { sportEventQueryOptions } from './use-contest-schedule';

/**
 * "Open to league" from a contest's "⋯" in the contests list (#1648): the same question as the
 * contest's own page, with the page's readiness checks under it, and Open held until they pass.
 * The list carries only each event's name and start, so the dialog reads the contest's first
 * event once it opens. Nothing is read while it is closed. The server's own checks still have the last word.
 */
export function OpenContestFromListDialog({
  contest,
  onOpenChange,
  open,
}: {
  contest: ContestDto;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const eventQuery = useQuery(sportEventQueryOptions(open ? firstContestEvent(contest)?.sportEventId ?? '' : ''));

  const { isLoading, isError } = eventQuery;
  const checks = eventQuery.data && !isLoading && !isError
    ? getContestReadinessChecks(eventQuery.data, new Date())
    : null;

  return (
    <OpenContestDialog
      contestId={contest.id}
      contestName={contest.name}
      // While the checks load, or until every one passes, there is nothing to open yet. If they
      // can't be read, the commissioner may still try: the server says why it refuses.
      isConfirmDisabled={isLoading || (checks !== null && !checks.every((check) => check.isMet))}
      leagueId={contest.leagueId}
      onOpenChange={onOpenChange}
      open={open}
    >
      {isLoading ? (
        <LoadingState body="Checking the contest is ready..." size="plain" testId="contest-open-readiness-loading" />
      ) : isError ? (
        <ErrorState
          body="We couldn't check whether this contest is ready."
          onRetry={refetchFailed(eventQuery)}
          size="plain"
          testId="contest-open-readiness-error"
        />
      ) : checks ? (
        <CheckList
          items={checks.map((check) => ({
            id: check.id,
            isMet: check.isMet,
            label: check.label,
            testId: `contest-open-readiness-${check.id}`,
          }))}
          testId="contest-open-readiness-checks"
        />
      ) : null}
    </OpenContestDialog>
  );
}
