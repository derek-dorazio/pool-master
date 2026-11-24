/**
 * A sport league's events sync (#1819), the EVENTS kind of the one sync framework: every trigger
 * (the schedule, an admin's Sync now) queues the same SYNC_LEAGUE_EVENTS job, and the job does the
 * work in the background, so no request waits on the provider.
 *
 * For each year the job names, the events of the provider league the league's selected provider
 * mapping names (`EventScoreSourceService.listTourEventsForYear`, #1997) become its events
 * (`SportEventService.importProviderEventYear`, the one creation path: series, rounds and default
 * tiers seeded alike, and a re-run skips what is there), and the events already linked keep their
 * provider's name, venue and dates (`SportEventService.keepProviderEventsCurrent`, ADR 0011).
 *
 * Each try records one EVENTS sync run: IN_PROGRESS with its progress while it runs, then
 * COMPLETED with the events it created, updated and skipped, or FAILED with why. A league the
 * provider's plan refuses, or one that is no longer synced, fails the job at once, since a retry
 * would fail alike; anything else (the provider unreachable) is tried again by the runner. A try
 * that stopped mid-run leaves its run IN_PROGRESS; the next try marks it FAILED as interrupted.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSyncRunRepository, SportLeagueRepository, SportRepository } from '@poolmaster/shared/db';
import {
  ProviderSyncKind,
  ProviderSyncRunStatus,
  JobTrigger,
  isClutchCardLeague,
  type BackgroundJob,
  type BackgroundJobOutcome,
  type ProviderSyncRun,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { errorMessage } from '../../core/error-message';
import { SCHEDULE_START } from '../../core/job-start';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { PermanentBackgroundJobError, type BackgroundJobContext } from '../background-jobs/background-job-runner';
import { EventScoreSourceError, type EventScoreSourceService } from './event-score-source-service';
import { SportEventError } from './errors';
import { syncLeagueEventsJob, type SyncLeagueEventsJobPayload } from './league-events-sync-job';
import type { ProviderEventYearImport, SportEventService } from './service';

/** The run's payload `runType`, beside the feed runs' MANUAL, SCHEDULED and WEBHOOK event syncs. */
export const LEAGUE_EVENTS_SYNC_RUN_TYPE = 'LEAGUE_EVENTS_SYNC';

/**
 * The scheduled sync's years: this calendar year and the next, since a season that starts in the
 * autumn lists next year's events early. An admin's Sync now without a year syncs the same two.
 */
const YEARS_AHEAD = [0, 1] as const;

/**
 * The provider's refusals a retry cannot fix: the league is unknown, is not synced from the provider, or is
 * left out of the provider's plan. Anything else, such as the provider being unreachable, is
 * tried again.
 */
const PERMANENT_SOURCE_ERRORS = new Set(['PROVIDER_NOT_FOUND', 'SPORT_LEAGUE_NOT_FOUND', 'SPORT_LEAGUE_NOT_SYNCED', 'PROVIDER_LEAGUE_REFUSED']);

export interface LeagueEventsSyncOptions {
  sportLeagues: Pick<SportLeagueRepository, 'findById' | 'findEventSynced'>;
  sports: Pick<SportRepository, 'findById'>;
  scoreSource: Pick<EventScoreSourceService, 'listTourEventsForYear'>;
  sportEvents: Pick<SportEventService, 'importProviderEventYear' | 'keepProviderEventsCurrent'>;
  syncRuns: Pick<ProviderSyncRunRepository, 'create' | 'update' | 'findByBackgroundJobIds'>;
  jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll' | 'enqueueRequestReturning'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** How long after the season leagues' jobs a Clutch Card league's scheduled job is due. */
export const CLUTCH_CARD_SYNC_DELAY_MS = 10 * 60_000;

/** What one year of a league's events sync did. */
interface YearSync {
  eventYear: number;
  created: ProviderEventYearImport['created'];
  skipped: ProviderEventYearImport['skipped'];
  updated: Awaited<ReturnType<SportEventService['keepProviderEventsCurrent']>>;
}

export class LeagueEventsSync {
  private readonly now: () => Date;

  constructor(private readonly options: LeagueEventsSyncOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * An admin's Sync now on a league's events (#1819): queues its job and answers it, or the job
   * already waiting for the league. 404 SPORT_LEAGUE_NOT_FOUND; 422 SPORT_LEAGUE_NOT_SYNCED when no
   * provider creates the league's events.
   */
  async syncNow(input: { sportLeagueId: string; eventYear?: number; requestedByUserId: string }): Promise<BackgroundJob> {
    const sportLeague = await this.options.sportLeagues.findById(input.sportLeagueId);
    if (!sportLeague) {
      throw new SportEventError(`Sport league ${input.sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    if (sportLeague.selectedProviderMapping === null) {
      throw new SportEventError(`No provider syncs ${sportLeague.name}'s events.`, 'SPORT_LEAGUE_NOT_SYNCED', 422);
    }
    // poolmaster-allow-direct-job: a root admin's Sync now starts the league's sync
    return this.options.jobs.enqueueRequestReturning(syncLeagueEventsJob(this.options.jobs, {
      sportLeagueId: sportLeague.id,
      eventYears: input.eventYear === undefined ? this.scheduledYears() : [input.eventYear],
    }, { start: { trigger: JobTrigger.ADMIN, startedByUserId: input.requestedByUserId } }));
  }

  /** The schedule's pass: one job per active synced league, in one write; answers how many were queued. */
  async queueScheduled(): Promise<number> {
    const leagues = await this.options.sportLeagues.findEventSynced();
    const eventYears = this.scheduledYears();
    // A Clutch Card event names its season event (#1820), so each Clutch Card league's job is due
    // after the season leagues' jobs: a new season event is on the site before its rounds import.
    // One that still misses its season event is skipped as NO_PARENT_EVENT and made by a later sync.
    const clutchCardRunAt = new Date(this.now().getTime() + CLUTCH_CARD_SYNC_DELAY_MS);
    // poolmaster-allow-direct-job: the sync schedule's timer starts each league's sync
    return this.options.jobs.enqueueAll(leagues.map((league) => syncLeagueEventsJob(this.options.jobs, {
      sportLeagueId: league.id,
      eventYears,
    }, { start: SCHEDULE_START, ...(isClutchCardLeague(league) && { runAt: clutchCardRunAt }) })));
  }

  /** The SYNC_LEAGUE_EVENTS job. */
  async run(payload: SyncLeagueEventsJobPayload, context: Pick<BackgroundJobContext, 'jobId' | 'attempt' | 'renewLease' | 'trigger'>): Promise<BackgroundJobOutcome> {
    if (context.attempt > 1) await this.failInterruptedRuns(context.jobId);

    const sportLeague = await this.options.sportLeagues.findById(payload.sportLeagueId);
    if (!sportLeague) throw new PermanentBackgroundJobError(`Sport league ${payload.sportLeagueId} no longer exists`);
    const providerId = sportLeague.selectedProviderMapping?.providerId ?? null;
    if (providerId === null) throw new PermanentBackgroundJobError(`No provider syncs ${sportLeague.name}'s events any more`);
    const sport = (await this.options.sports.findById(sportLeague.sportId))?.sport;
    if (sport === undefined) throw new PermanentBackgroundJobError(`Sport league ${sportLeague.name} belongs to no known sport`);

    // A try whose job another task has claimed stops before it records a run of its own.
    if (!await context.renewLease()) throw new Error(`Another try took over ${sportLeague.name}'s events sync`);
    const startedAt = this.now();
    const basePayload = { runType: LEAGUE_EVENTS_SYNC_RUN_TYPE, eventYears: payload.eventYears };
    const run = await this.options.syncRuns.create({
      providerId,
      sport,
      eventId: null,
      kind: ProviderSyncKind.EVENTS,
      trigger: context.trigger,
      sportLeagueId: sportLeague.id,
      sportEventId: null,
      backgroundJobId: context.jobId,
      status: ProviderSyncRunStatus.IN_PROGRESS,
      startedAt,
      completedAt: null,
      payload: { ...basePayload, ...progressPayload(sportLeague, [], payload.eventYears.length) },
      createdAt: startedAt,
    });

    const years: YearSync[] = [];
    try {
      for (const [index, eventYear] of payload.eventYears.entries()) {
        // A year's reads can wait on the provider's rate limit, so each later year starts on a
        // fresh lease; a try whose job another task has claimed stops here.
        if (index > 0 && !await context.renewLease()) throw new Error(`Another try took over ${sportLeague.name}'s events sync`);
        years.push(await this.syncYear(sportLeague.id, providerId, eventYear));
        // poolmaster-allow-query-in-loop: the run's progress after each year
        await this.options.syncRuns.update(run.id, {
          status: ProviderSyncRunStatus.IN_PROGRESS,
          payload: { ...basePayload, ...progressPayload(sportLeague, years, payload.eventYears.length) },
        });
      }
    } catch (error) {
      await this.failRun(run, startedAt, basePayload, years, error);
      this.options.logger?.error({
        action: 'events.leagueSync.failed',
        data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, providerId, syncRunId: run.id, error: errorMessage(error) },
      }, 'A sport league\'s events sync failed');
      if (error instanceof EventScoreSourceError && PERMANENT_SOURCE_ERRORS.has(error.code)) {
        throw new PermanentBackgroundJobError(`${error.code}: ${error.message}`, { cause: error });
      }
      throw error;
    }

    const counts = countsOf(years);
    await this.options.syncRuns.update(run.id, {
      status: ProviderSyncRunStatus.COMPLETED,
      startedAt,
      completedAt: this.now(),
      payload: {
        ...basePayload,
        detail: `Synced ${sportLeague.name}'s events for ${payload.eventYears.join(' and ')}: ${String(counts.created)} created, ${String(counts.updated)} updated.`,
        outcome: { severity: 'SUCCESS', summary: `${String(counts.created)} created, ${String(counts.updated)} updated, ${String(counts.skipped)} skipped.`, warnings: [], errors: 0 },
        stats: counts,
      },
      details: { years: years.map(yearDetails) },
    });
    this.options.logger?.info({
      action: 'events.leagueSync.completed',
      data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, providerId, syncRunId: run.id, trigger: context.trigger, ...counts },
    }, 'A sport league\'s events sync finished');
    return {
      changedCount: counts.created + counts.updated,
      result: { syncRunId: run.id, eventYears: payload.eventYears, ...counts },
    };
  }

  private async syncYear(sportLeagueId: string, providerId: string, eventYear: number): Promise<YearSync> {
    const providerEvents = await this.options.scoreSource.listTourEventsForYear(providerId, sportLeagueId, eventYear);
    const imported = await this.options.sportEvents.importProviderEventYear({ sportLeagueId, eventYear, providerId, providerEvents });
    const updated = await this.options.sportEvents.keepProviderEventsCurrent({ sportLeagueId, providerId, providerEvents });
    return { eventYear, created: imported.created, skipped: imported.skipped, updated };
  }

  /** An earlier try of this job that stopped mid-run left its run IN_PROGRESS: it is FAILED as interrupted. */
  private async failInterruptedRuns(jobId: string): Promise<void> {
    const interrupted = (await this.options.syncRuns.findByBackgroundJobIds([jobId]))
      .filter((run) => run.status === ProviderSyncRunStatus.IN_PROGRESS);
    for (const run of interrupted) {
      // poolmaster-allow-query-in-loop: at most one interrupted run per earlier try, four tries at most
      await this.options.syncRuns.update(run.id, {
        status: ProviderSyncRunStatus.FAILED,
        completedAt: this.now(),
        payload: {
          ...run.payload,
          detail: 'Interrupted: an earlier try of this sync stopped before it finished.',
          outcome: { severity: 'ERROR', summary: 'Interrupted before it finished.', warnings: [], errors: 1 },
        },
      });
    }
  }

  private async failRun(
    run: ProviderSyncRun,
    startedAt: Date,
    basePayload: Record<string, unknown>,
    years: readonly YearSync[],
    error: unknown,
  ): Promise<void> {
    const message = errorMessage(error);
    await this.options.syncRuns.update(run.id, {
      status: ProviderSyncRunStatus.FAILED,
      startedAt,
      completedAt: this.now(),
      payload: {
        ...basePayload,
        detail: `Failed: ${message}`,
        outcome: { severity: 'ERROR', summary: `Failed: ${message}`, warnings: [], errors: 1 },
        stats: countsOf(years),
      },
      details: {
        years: years.map(yearDetails),
        failurePayload: {
          error: {
            ...(error instanceof Error && { name: error.name }),
            message,
            ...(error instanceof EventScoreSourceError && { code: error.code }),
          },
        },
      },
    });
  }

  private scheduledYears(): number[] {
    const thisYear = this.now().getUTCFullYear();
    return YEARS_AHEAD.map((offset) => thisYear + offset);
  }
}

/** What a sync changed; `alreadyStarted` counts the skipped provider events whose start had passed (#1821). */
function countsOf(years: readonly YearSync[]): { created: number; updated: number; skipped: number; alreadyStarted: number } {
  return {
    created: years.reduce((sum, year) => sum + year.created.length, 0),
    updated: years.reduce((sum, year) => sum + year.updated.length, 0),
    skipped: years.reduce((sum, year) => sum + year.skipped.length, 0),
    alreadyStarted: years.reduce((sum, year) => sum + year.skipped.filter((row) => row.reason === 'ALREADY_STARTED').length, 0),
  };
}

/** A running sync's payload: how far it has got. */
function progressPayload(sportLeague: SportLeague, years: readonly YearSync[], yearCount: number): Record<string, unknown> {
  const counts = countsOf(years);
  const summary = `Syncing ${sportLeague.name}'s events: ${String(years.length)} of ${String(yearCount)} years done.`;
  return {
    detail: summary,
    outcome: { severity: 'SUCCESS', summary, warnings: [], errors: 0 },
    stats: counts,
    progress: { yearsDone: years.length, yearCount },
  };
}

/** One year's changes, each event linked by id, as the run's details keep them. */
function yearDetails(year: YearSync): Record<string, unknown> {
  return {
    eventYear: year.eventYear,
    created: year.created.map(({ event }) => ({ sportEventId: event.id, name: event.name })),
    updated: year.updated.map((change) => ({ sportEventId: change.sportEventId, externalId: change.externalId, changed: change.changed })),
    skipped: year.skipped,
  };
}
