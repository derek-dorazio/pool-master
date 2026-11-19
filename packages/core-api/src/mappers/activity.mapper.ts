/**
 * Activity mapper (#1819): one background job, with the sync runs it ran, as the grid shows it.
 */
import type { ActivityJobDto } from '@poolmaster/shared/dto';
import { BACKGROUND_JOB_KINDS, type BackgroundJob } from '@poolmaster/shared/domain';
import { formatUserName } from '../modules/email/email-content';

export function toActivityJobDto(job: BackgroundJob, syncRunIds: readonly string[]): ActivityJobDto {
  return {
    id: job.id,
    type: job.type,
    kind: BACKGROUND_JOB_KINDS[job.type],
    status: job.status,
    sportLeagueId: job.sportLeagueId ?? null,
    sportEventId: job.sportEventId ?? null,
    attempts: job.attempts,
    runAt: job.runAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    lastError: job.lastError ?? null,
    trigger: job.trigger,
    startedBy: job.startedBy ? { id: job.startedBy.id, displayName: formatUserName(job.startedBy) } : null,
    startedAt: job.startedAt?.toISOString() ?? null,
    durationSeconds: durationSeconds(job),
    changedCount: job.changedCount ?? null,
    errorType: job.errorType ?? null,
    result: job.result ?? null,
    syncRunIds: [...syncRunIds],
  };
}

/** Its latest try's length in whole seconds, once it has finished; null before. */
function durationSeconds(job: BackgroundJob): number | null {
  if (job.startedAt === undefined || job.completedAt === undefined) return null;
  return Math.max(0, Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000));
}
