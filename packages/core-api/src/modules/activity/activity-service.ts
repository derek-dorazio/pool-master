/**
 * Activity (#1819): one read over every background job, for the root admin's Activity grid and
 * the same grid filtered to a sport league or an event. Nothing pages it: the grid holds
 * thousands of rows, and the filters narrow it. A queue-time window bounds every read: 24 hours
 * when it is not narrowed to a league or an event, and every job kept (30 days) when it is.
 *
 * A read is four queries however many jobs it answers (five with a league: its events' ids
 * first): the jobs; then the sync runs those jobs ran, so a sync row opens its run's detail,
 * beside the events the jobs are about; then the sport leagues, the jobs' own and their events'.
 */

import type {
  BackgroundJobRepository,
  ProviderSyncRunRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
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

/** A sport league or event a job is about, as the grid names it. */
export interface ActivityScopeName {
  id: string;
  name: string;
}

/**
 * One job on the grid, with the ids of the sync runs it ran, oldest first, and the sport league
 * and event it is about: for a job on an event, the league is the event's.
 */
export interface ActivityJob {
  job: BackgroundJob;
  syncRunIds: string[];
  sportLeague: ActivityScopeName | null;
  sportEvent: ActivityScopeName | null;
}

export class ActivityService {
  constructor(private readonly deps: {
    jobs: Pick<BackgroundJobRepository, 'findActivity'>;
    syncRuns: Pick<ProviderSyncRunRepository, 'findByBackgroundJobIds'>;
    sportEvents: Pick<SportEventRepository, 'findByIds'>;
    sportLeagues: Pick<SportLeagueRepository, 'findByIds'>;
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
    return this.present(jobs);
  }

  /**
   * Jobs as the grid shows them: each with its sync runs and the names of the sport league and
   * event it is about, in a fixed three reads however many jobs there are. Also how a route that
   * queues a job answers it, so it reads the same as its Activity row.
   */
  async present(jobs: readonly BackgroundJob[]): Promise<ActivityJob[]> {
    const eventIds = unique(jobs.map((job) => job.sportEventId));
    const [runs, events] = await Promise.all([
      this.deps.syncRuns.findByBackgroundJobIds(jobs.map((job) => job.id)),
      eventIds.length === 0 ? [] : this.deps.sportEvents.findByIds(eventIds),
    ]);
    const eventsById = new Map(events.map((event) => [event.id, event]));
    const leagueIds = unique([...jobs.map((job) => job.sportLeagueId), ...events.map((event) => event.sportLeagueId)]);
    const leagues = leagueIds.length === 0 ? [] : await this.deps.sportLeagues.findByIds(leagueIds);
    const leaguesById = new Map(leagues.map((league) => [league.id, league]));

    const runIdsByJob = new Map<string, string[]>();
    for (const run of runs) {
      if (run.backgroundJobId === null) continue;
      const ids = runIdsByJob.get(run.backgroundJobId) ?? [];
      ids.push(run.id);
      runIdsByJob.set(run.backgroundJobId, ids);
    }
    return jobs.map((job) => {
      const event = job.sportEventId === undefined ? undefined : eventsById.get(job.sportEventId);
      const leagueId = job.sportLeagueId ?? event?.sportLeagueId;
      const league = leagueId === undefined ? undefined : leaguesById.get(leagueId);
      return {
        job,
        syncRunIds: runIdsByJob.get(job.id) ?? [],
        sportLeague: league ? { id: league.id, name: league.name } : null,
        sportEvent: event ? { id: event.id, name: event.name } : null,
      };
    });
  }
}

/** The ids given, each once, leaving out the missing ones. */
function unique(ids: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => id !== undefined))];
}
