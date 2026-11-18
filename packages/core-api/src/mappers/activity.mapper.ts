/**
 * Activity mapper (#1819): one background job, with the sync runs it ran, as the grid shows it.
 */
import type { ActivityJobDto } from '@poolmaster/shared/dto';
import { BACKGROUND_JOB_KINDS, type BackgroundJob } from '@poolmaster/shared/domain';

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
    result: job.result ?? null,
    syncRunIds: [...syncRunIds],
  };
}
