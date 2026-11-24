import { enumLabel } from '@poolmaster/shared/display-strings';
import { BackgroundJobStatus } from '@poolmaster/shared/domain';
import type { StatusBadgeProps } from '@/features/shared/ui';
import type { ActivityJobDto } from '@/lib/api';

/**
 * Activity's job codes (#1879, #1887) in words. The words themselves are the codes' display
 * strings (`enumLabel`, rules/ux-rules.md §16 *Display Strings*); this file holds the tones and
 * the lines built from them.
 */

export const JOB_STATUS_TONES: Record<BackgroundJobStatus, StatusBadgeProps['tone']> = {
  [BackgroundJobStatus.QUEUED]: 'neutral',
  [BackgroundJobStatus.RUNNING]: 'info',
  [BackgroundJobStatus.SUCCEEDED]: 'success',
  [BackgroundJobStatus.FAILED]: 'failed',
};

/** Who started it, in words: the trigger, and for an admin or a commissioner their name. */
export function startedByText(job: Pick<ActivityJobDto, 'trigger' | 'startedBy'>): string {
  const trigger = enumLabel('JobTrigger', job.trigger);
  return job.startedBy ? `${trigger} (${job.startedBy.displayName})` : trigger;
}

/** The job's title in its dialog: what it does, and how it stands, such as "Live scores · Failed". */
export function jobTitle(job: Pick<ActivityJobDto, 'type' | 'status'>): string {
  return `${enumLabel('BackgroundJobType', job.type)} · ${enumLabel('BackgroundJobStatus', job.status)}`;
}
