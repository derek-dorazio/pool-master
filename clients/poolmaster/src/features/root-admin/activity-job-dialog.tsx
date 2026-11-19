import { Button, DateDisplay, ReadOnlyDetailModal, StatusBadge } from '@/features/shared/ui';
import type { ActivityJobDto } from '@/lib/api';
import {
  JOB_ERROR_TYPE_LABELS,
  JOB_KIND_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_TONES,
  JOB_TYPE_LABELS,
  jobTitle,
  startedByText,
} from './activity-labels';
import { formatJsonPayload } from './root-admin-sync-utils';

/** Where a job's facts list a value it has not got yet. */
const NONE = '—';

/** When its latest try finished, and how long it took. */
function finished(job: ActivityJobDto) {
  if (job.completedAt === null) return NONE;
  return (
    <span>
      <DateDisplay value={job.completedAt} />
      {job.durationSeconds === null ? null : ` · ${String(job.durationSeconds)} s`}
    </span>
  );
}

/**
 * One job's dialog on Activity (#1887), opened by ⤢ on its row; view only. Its facts, then for
 * a failure its error and message, and for a sync each run it ran, which opens that run's detail
 * in its place, so no dialog stacks on another.
 */
export function ActivityJobDialog({
  job,
  onClose,
  onOpenSyncRun,
}: {
  job: ActivityJobDto;
  onClose: () => void;
  onOpenSyncRun: (syncRunId: string) => void;
}) {
  const testId = 'activity-job-dialog';
  const scope = [job.sportLeague?.name, job.sportEvent?.name].filter(Boolean).join(' · ');
  return (
    <ReadOnlyDetailModal
      copyText={formatJsonPayload(job)}
      detailContent={job.syncRunIds.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid={`${testId}-sync-runs`}>
          {job.syncRunIds.map((syncRunId, index) => (
            <Button
              data-testid={`${testId}-sync-run-${syncRunId}`}
              key={syncRunId}
              onClick={() => onOpenSyncRun(syncRunId)}
              size="sm"
              type="button"
              variant="secondary"
            >
              {job.syncRunIds.length === 1 ? 'Open sync run' : `Open sync run ${String(index + 1)}`}
            </Button>
          ))}
        </div>
      ) : undefined}
      details={[
        { id: 'what', label: 'Kind · What', value: `${JOB_KIND_LABELS[job.kind]} · ${JOB_TYPE_LABELS[job.type]}` },
        { id: 'scope', label: 'Sport league · Event', value: scope === '' ? NONE : scope },
        { id: 'status', label: 'Status', value: <StatusBadge tone={JOB_STATUS_TONES[job.status]}>{JOB_STATUS_LABELS[job.status]}</StatusBadge> },
        { id: 'started-by', label: 'Started by', value: startedByText(job) },
        { id: 'queued', label: 'Queued', value: <DateDisplay value={job.createdAt} /> },
        { id: 'started', label: 'Started', value: job.startedAt === null ? NONE : <DateDisplay value={job.startedAt} /> },
        { id: 'finished', label: 'Finished', value: finished(job) },
        { id: 'tries', label: 'Tries', value: job.attempts },
        { id: 'changed', label: 'Changed', value: job.changedCount === null ? NONE : job.changedCount === 0 ? 'Nothing' : job.changedCount },
        ...(job.errorType === null ? [] : [{ id: 'error', label: 'Error', value: JOB_ERROR_TYPE_LABELS[job.errorType] }]),
        ...(job.lastError === null ? [] : [{ id: 'message', label: 'Message', value: <span className="break-words">{job.lastError}</span> }]),
      ]}
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId={testId}
      title={jobTitle(job)}
    />
  );
}
