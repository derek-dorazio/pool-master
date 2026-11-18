/**
 * Activity (#1819): one read over every background job, for the root admin's Activity grid and
 * the same grid filtered to a sport league or an event. Nothing pages it: the grid holds
 * thousands of rows, and the filters narrow it. A queue-time window bounds every read: 24 hours
 * when it is not narrowed to a league or an event, and every job kept (30 days) when it is.
 *
 * A read is two queries however many jobs it answers (three with a league: its events' ids
 * first): the jobs, then the sync runs those jobs ran, so a sync row opens its run's detail.
 */

import type { BackgroundJobRepository, ProviderSyncRunRepository } from '@poolmaster/shared/db';
import {
  backgroundJobTypesOfKind,
  type BackgroundJob,
  type BackgroundJobKind,
  type BackgroundJobStatus,
} from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import { FINISHED_BACKGROUND_JOBS_KEPT_DAYS } from '../background-jobs/background-job-retention';

const HOUR_MS = 60 * 60_000;
/** The unnarrowed grid's window: the last day. */
export const ACTIVITY_DEFAULT_WINDOW_HOURS = 24;

/** A window that ends before it starts: it could only ever answer nothing, so it is refused. */
export class ActivityWindowError extends Error {
  readonly statusCode = 400;
  readonly code: ApiErrorCode = 'ACTIVITY_WINDOW_INVALID';

  constructor() {
    super('The Activity window\'s `from` is after its `to`.');
    this.name = 'ActivityWindowError';
  }
}

export interface ActivityFilters {
  kind?: BackgroundJobKind;
  status?: BackgroundJobStatus;
  sportLeagueId?: string;
  sportEventId?: string;
  from?: Date;
  to?: Date;
}

/** One job on the grid, with the ids of the sync runs it ran, oldest first. */
export interface ActivityJob {
  job: BackgroundJob;
  syncRunIds: string[];
}

export class ActivityService {
  constructor(private readonly deps: {
    jobs: Pick<BackgroundJobRepository, 'findActivity'>;
    syncRuns: Pick<ProviderSyncRunRepository, 'findByBackgroundJobIds'>;
    now?: () => Date;
  }) {}

  async list(filters: ActivityFilters): Promise<ActivityJob[]> {
    const createdTo = filters.to ?? this.deps.now?.() ?? new Date();
    const narrowed = filters.sportLeagueId !== undefined || filters.sportEventId !== undefined;
    const windowHours = narrowed ? FINISHED_BACKGROUND_JOBS_KEPT_DAYS * 24 : ACTIVITY_DEFAULT_WINDOW_HOURS;
    const createdFrom = filters.from ?? new Date(createdTo.getTime() - windowHours * HOUR_MS);
    if (createdFrom > createdTo) throw new ActivityWindowError();
    const jobs = await this.deps.jobs.findActivity({
      ...(filters.kind !== undefined && { types: backgroundJobTypesOfKind(filters.kind) }),
      status: filters.status,
      sportLeagueId: filters.sportLeagueId,
      sportEventId: filters.sportEventId,
      createdFrom,
      createdTo,
    });
    const runs = await this.deps.syncRuns.findByBackgroundJobIds(jobs.map((job) => job.id));
    const runIdsByJob = new Map<string, string[]>();
    for (const run of runs) {
      if (run.backgroundJobId === null) continue;
      const ids = runIdsByJob.get(run.backgroundJobId) ?? [];
      ids.push(run.id);
      runIdsByJob.set(run.backgroundJobId, ids);
    }
    return jobs.map((job) => ({ job, syncRunIds: runIdsByJob.get(job.id) ?? [] }));
  }
}
