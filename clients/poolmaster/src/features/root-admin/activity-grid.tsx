import { useMemo, useState } from 'react';
import { DataGrid, ErrorState, LoadingState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { activityColumns } from './activity-columns';
import { ActivityJobDialog } from './activity-job-dialog';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import type { ActivityState } from './use-activity';

/** What the grid has open: one job's dialog, or a sync run that job ran. */
type Opened = { jobId: string } | { syncRunId: string } | null;

/**
 * The one Activity grid (#1887): every background job in its window, one row each, sorted and
 * filtered from its headers, opening on the past day. The root admin Activity page shows it
 * unscoped; a sport league's and an event's Activity tabs show it scoped to theirs, with the
 * columns every row shares left out. A row's ⤢ opens the job's dialog. No paging: widening the
 * Started filter reads further back.
 */
export function ActivityGrid({ activity }: { activity: ActivityState }) {
  const { scope, query, onFiltersChange } = activity;
  const [opened, setOpened] = useState<Opened>(null);
  const columns = useMemo(
    () => activityColumns({ showSportLeague: scope === null, showEvent: scope === null || !('sportEventId' in scope) }),
    [scope],
  );
  const jobs = query.data ?? [];
  const openJob = opened !== null && 'jobId' in opened ? jobs.find((job) => job.id === opened.jobId) : undefined;

  return (
    <div className="space-y-3" data-testid="activity-grid">
      {query.isError ? (
        <ErrorState
          body={extractErrorMessage(query.error, { fallback: 'We could not load Activity right now.' })}
          onRetry={() => void query.refetch()}
          size="inline"
          testId="activity-grid-error"
        />
      ) : null}
      {query.isPending && query.fetchStatus === 'fetching' ? <LoadingState body="Loading activity..." size="inline" /> : null}
      <DataGrid
        columns={columns}
        data={jobs}
        emptyMessage="No jobs match these filters."
        filterTestIdPrefix="activity-grid-filter"
        getRowId={(job) => job.id}
        onFiltersChange={onFiltersChange}
        openRowDialog={(job) => setOpened({ jobId: job.id })}
        rowTestId={(job) => `activity-job-${job.id}`}
        tableTestId="activity-grid-table"
        urlKey="activity"
      />
      {openJob ? (
        <ActivityJobDialog
          job={openJob}
          onClose={() => setOpened(null)}
          onOpenSyncRun={(syncRunId) => setOpened({ syncRunId })}
        />
      ) : null}
      {opened !== null && 'syncRunId' in opened ? (
        <SyncRunByIdDialog onClose={() => setOpened(null)} syncRunId={opened.syncRunId} />
      ) : null}
    </div>
  );
}
