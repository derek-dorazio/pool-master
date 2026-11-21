import {
  BackgroundJobKind,
  BackgroundJobStatus,
  BackgroundJobType,
  JobErrorType,
  JobTrigger,
} from '@poolmaster/shared/domain';
import type { StatusBadgeProps } from '@/features/shared/ui';
import type { ActivityJobDto } from '@/lib/api';

/**
 * The words Activity shows for each job code (#1879, #1887). The API answers stable codes; every
 * label lives here, never derived from an enum's name, so renaming one is a copy change only.
 */

/** What a job is about, the Kind column. */
export const JOB_KIND_LABELS: Record<BackgroundJobKind, string> = {
  [BackgroundJobKind.SYNC]: 'Sync',
  [BackgroundJobKind.EMAIL]: 'Email',
  [BackgroundJobKind.SETTLEMENT]: 'Settlement',
  [BackgroundJobKind.RELEASE]: 'Release',
  [BackgroundJobKind.OTHER]: 'Other',
};

/** What the job does, the What column. */
export const JOB_TYPE_LABELS: Record<BackgroundJobType, string> = {
  [BackgroundJobType.MANUAL_EVENT_SYNC]: 'Event feeds',
  [BackgroundJobType.PROVIDER_EVENT_SYNC]: 'Live scores',
  [BackgroundJobType.SYNC_LEAGUE_EVENTS]: 'Event list',
  [BackgroundJobType.CONTEST_STARTED_EMAILS]: 'Contest is live',
  [BackgroundJobType.CONTEST_SETTLED_EMAILS]: 'Results',
  [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS]: 'Event changed',
  [BackgroundJobType.CONTEST_REOPENED_EMAILS]: 'Event postponed, picks open again',
  [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS]: 'Settle contests',
  [BackgroundJobType.SETTLE_GAME_CONTESTS]: 'Settle game contests',
  [BackgroundJobType.REBUILD_LEADERBOARDS]: 'Rebuild leaderboards',
  [BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST]: 'Add to contest',
  [BackgroundJobType.RELEASE_SPORT_EVENT]: 'Release check',
  [BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS]: 'Games, tiers and prices',
};

export const JOB_STATUS_LABELS: Record<BackgroundJobStatus, string> = {
  [BackgroundJobStatus.QUEUED]: 'Queued',
  [BackgroundJobStatus.RUNNING]: 'Running',
  [BackgroundJobStatus.SUCCEEDED]: 'Done',
  [BackgroundJobStatus.FAILED]: 'Failed',
};

export const JOB_STATUS_TONES: Record<BackgroundJobStatus, StatusBadgeProps['tone']> = {
  [BackgroundJobStatus.QUEUED]: 'neutral',
  [BackgroundJobStatus.RUNNING]: 'info',
  [BackgroundJobStatus.SUCCEEDED]: 'success',
  [BackgroundJobStatus.FAILED]: 'failed',
};

/** What started the job, the Started by column. Admin and Commissioner are separate (Derek, 11-18). */
export const JOB_TRIGGER_LABELS: Record<JobTrigger, string> = {
  [JobTrigger.SCHEDULE]: 'Schedule',
  [JobTrigger.WEBHOOK]: 'Webhook',
  [JobTrigger.ADMIN]: 'Admin',
  [JobTrigger.COMMISSIONER]: 'Commissioner',
  [JobTrigger.SYSTEM]: 'System',
};

/** Why a job did not do its work, the Error column. */
export const JOB_ERROR_TYPE_LABELS: Record<JobErrorType, string> = {
  [JobErrorType.RATE_LIMITED]: 'Rate limited',
  [JobErrorType.TIMEOUT]: 'Timeout',
  [JobErrorType.PROVIDER_ERROR]: 'Provider error',
  [JobErrorType.BAD_DATA]: 'Bad data',
  [JobErrorType.CHECK_FAILED]: 'Check failed',
  [JobErrorType.OTHER]: 'Other',
};

/** Who started it, in words: the trigger, and for an admin or a commissioner their name. */
export function startedByText(job: Pick<ActivityJobDto, 'trigger' | 'startedBy'>): string {
  const trigger = JOB_TRIGGER_LABELS[job.trigger];
  return job.startedBy ? `${trigger} (${job.startedBy.displayName})` : trigger;
}

/** The job's title in its dialog: what it does, and how it stands, such as "Live scores · Failed". */
export function jobTitle(job: Pick<ActivityJobDto, 'type' | 'status'>): string {
  return `${JOB_TYPE_LABELS[job.type]} · ${JOB_STATUS_LABELS[job.status]}`;
}
