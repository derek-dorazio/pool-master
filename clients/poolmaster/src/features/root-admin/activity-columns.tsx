import { createColumnHelper } from '@tanstack/react-table';
import {
  BackgroundJobKindOrder,
  BackgroundJobStatusOrder,
  BackgroundJobTypeOrder,
  JobErrorTypeOrder,
  JobTriggerOrder,
  type BackgroundJobKind,
  type BackgroundJobType,
  type JobErrorType,
  type JobTrigger,
} from '@poolmaster/shared/domain';
import { StatusBadge } from '@/features/shared/ui';
import { ActivityStartedBy } from './activity-started-by';
import type { ActivityJobDto } from '@/lib/api';
import {
  JOB_ERROR_TYPE_LABELS,
  JOB_KIND_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_TONES,
  JOB_TRIGGER_LABELS,
  JOB_TYPE_LABELS,
} from './activity-labels';
import { ACTIVITY_STARTED_COLUMN } from './use-activity';

const columnHelper = createColumnHelper<ActivityJobDto>();

/**
 * The Activity grid's columns (#1879, #1887), each explained behind its (i). Sport league shows
 * only on the unscoped grid and Event only off an event's own tab, since there every row shares it.
 */
export function activityColumns({ showSportLeague, showEvent }: { showSportLeague: boolean; showEvent: boolean }) {
  return [
    columnHelper.accessor('createdAt', {
      id: ACTIVITY_STARTED_COLUMN,
      header: 'Started',
      meta: {
        info: 'When the job was queued, in your time zone. Widen this filter to see older jobs; finished jobs are kept 30 days.',
        type: { kind: 'datetime', direction: 'past', initial: { kind: 'relative', toward: 'past', amount: 1, unit: 'd' } },
      },
    }),
    columnHelper.accessor('kind', {
      header: 'Kind',
      meta: {
        info: 'What the job is about: a provider sync, emails to a league, settling contests, an event\'s release, or something else.',
        type: { kind: 'enum', order: BackgroundJobKindOrder, label: (kind) => JOB_KIND_LABELS[kind as BackgroundJobKind] },
      },
      cell: ({ getValue }) => JOB_KIND_LABELS[getValue()],
    }),
    columnHelper.accessor('type', {
      id: 'what',
      header: 'What',
      meta: {
        info: 'What the job does.',
        type: { kind: 'enum', order: BackgroundJobTypeOrder, label: (type) => JOB_TYPE_LABELS[type as BackgroundJobType] },
      },
      cell: ({ getValue }) => JOB_TYPE_LABELS[getValue()],
    }),
    ...(showSportLeague
      ? [columnHelper.accessor((job) => job.sportLeague?.name ?? null, {
          id: 'sportLeague',
          header: 'Sport league',
          meta: { info: 'The sport league the job is about: its own, or its event\'s.', type: { kind: 'enum' } },
        })]
      : []),
    ...(showEvent
      ? [columnHelper.accessor((job) => job.sportEvent?.name ?? null, {
          id: 'event',
          header: 'Event',
          meta: { info: 'The event the job is about; blank for a job on a whole sport league or on no event.', type: { kind: 'text' } },
        })]
      : []),
    columnHelper.accessor('trigger', {
      id: 'startedBy',
      header: 'Started by',
      meta: {
        info: 'What started the job: its schedule, a provider webhook, a root admin, a league commissioner, or the system. Hover Admin or Commissioner for their name.',
        type: { kind: 'enum', order: JobTriggerOrder, label: (trigger) => JOB_TRIGGER_LABELS[trigger as JobTrigger] },
      },
      cell: ({ row }) => <ActivityStartedBy job={row.original} />,
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      meta: {
        info: 'Queued waits for its run time, Running is under way, Done finished, Failed will not run again.',
        type: { kind: 'enum', order: BackgroundJobStatusOrder, label: (status) => JOB_STATUS_LABELS[status as ActivityJobDto['status']] },
      },
      cell: ({ getValue }) => <StatusBadge tone={JOB_STATUS_TONES[getValue()]}>{JOB_STATUS_LABELS[getValue()]}</StatusBadge>,
    }),
    columnHelper.accessor('changedCount', {
      header: 'Changed',
      meta: { info: 'How many rows a finished job created or changed: events, field participants, contests settled, boards rebuilt, emails queued.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('errorType', {
      header: 'Error',
      meta: {
        info: 'Why the job did not do its work, on a failed try or a held release. The message is in the job\'s dialog.',
        type: { kind: 'enum', order: JobErrorTypeOrder, label: (errorType) => JOB_ERROR_TYPE_LABELS[errorType as JobErrorType] },
      },
      cell: ({ getValue }) => {
        const errorType = getValue();
        return errorType === null ? null : JOB_ERROR_TYPE_LABELS[errorType];
      },
    }),
    columnHelper.accessor('attempts', {
      id: 'tries',
      header: 'Tries',
      meta: { info: 'How many times the job has run, counting one under way. A failed try is retried a few times before the job fails.', type: { kind: 'number' } },
    }),
    columnHelper.accessor('durationSeconds', {
      header: 'Duration (s)',
      meta: { info: 'How long its latest try took, in seconds; blank until it finishes.', type: { kind: 'number' } },
    }),
  ];
}
