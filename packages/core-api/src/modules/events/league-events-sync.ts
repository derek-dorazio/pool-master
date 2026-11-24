/**
 * A sport league's events sync (#1819), the EVENTS kind of the one sync framework: every trigger
 * (the schedule, an admin's Sync now) queues the same SYNC_LEAGUE_EVENTS job, and the job does the
 * work in the background, so no request waits on the provider.
 *
 * For each Season it reads (the league's current Season and every later one, or the one an admin
 * named, #2003), the events of the provider league the league's selected provider mapping names,
 * asked for by the provider's own id for that Season (`EventScoreSourceService.listSeasonEvents`,
 * #1997), become its events in that Season (`SportEventService.importProviderSeason`, the one
 * creation path: series, rounds and default tiers seeded alike, and a re-run skips what is there),
 * and the events already linked keep their provider's name, venue and dates
 * (`SportEventService.keepProviderEventsCurrent`, ADR 0011). Nothing works out a season from
 * today's date: when the league's last Season mapped to its provider has ended and no later one is
 * mapped, the job raises one SEASON_MISSING ERROR finding, since Seasons are added by migration.
 *
 * Each try records one EVENTS sync run: IN_PROGRESS with its progress while it runs, then
 * COMPLETED with the events it created, updated and skipped, or FAILED with why. A league the
 * provider's plan refuses, or one that is no longer synced, fails the job at once, since a retry
 * would fail alike; anything else (the provider unreachable) is tried again by the runner. A try
 * that stopped mid-run leaves its run IN_PROGRESS; the next try marks it FAILED as interrupted.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSyncRunRepository, SportLeagueRepository, SportLeagueSeasonRepository, SportRepository, SyncableSportLeagueSeason } from '@poolmaster/shared/db';
import {
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncKind,
  seasonsToSync,
  ProviderSyncRunStatus,
  JobTrigger,
  type BackgroundJob,
  type BackgroundJobOutcome,
  type ProviderSyncRun,
  type ProviderSyncRunOutcome,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { errorMessage } from '../../core/error-message';
import { SCHEDULE_START } from '../../core/job-start';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { PermanentBackgroundJobError, type BackgroundJobContext } from '../background-jobs/background-job-runner';
import { EventScoreSourceError, type EventScoreSourceService } from './event-score-source-service';
import { SportEventError } from './errors';
import { syncLeagueEventsJob, type SyncLeagueEventsJobPayload } from './league-events-sync-job';
import type { ProviderSyncFindingService } from '../ingestion/findings/provider-sync-finding-service';
import type { ProviderSeasonImport, SportEventService } from './service';

/**
 * The provider's refusals a retry cannot fix: the league is unknown, is not synced from the provider, or is
 * left out of the provider's plan. Anything else, such as the provider being unreachable, is
 * tried again.
 */
const PERMANENT_SOURCE_ERRORS = new Set(['PROVIDER_NOT_FOUND', 'SPORT_LEAGUE_NOT_FOUND', 'SPORT_LEAGUE_NOT_SYNCED', 'PROVIDER_LEAGUE_REFUSED']);

export interface LeagueEventsSyncOptions {
  sportLeagues: Pick<SportLeagueRepository, 'findById' | 'findEventSynced'>;
  seasons: Pick<SportLeagueSeasonRepository, 'findForSync'>;
  sports: Pick<SportRepository, 'findById'>;
  scoreSource: Pick<EventScoreSourceService, 'listSeasonEvents'>;
  sportEvents: Pick<SportEventService, 'importProviderSeason' | 'keepProviderEventsCurrent'>;
  findings: Pick<ProviderSyncFindingService, 'raise'>;
  syncRuns: Pick<ProviderSyncRunRepository, 'create' | 'update' | 'findByBackgroundJobIds'>;
  jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll' | 'enqueueRequestReturning'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** What one Season of a league's events sync did. */
interface SeasonSync {
  sportLeagueSeasonId: string;
  seasonName: string;
  created: ProviderSeasonImport['created'];
  skipped: ProviderSeasonImport['skipped'];
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
   * provider creates the league's events; 404 SPORT_LEAGUE_SEASON_NOT_FOUND for a Season that is not
   * the league's; 422 SPORT_LEAGUE_SEASON_NOT_MAPPED for one the provider has no id for.
   */
  async syncNow(input: { sportLeagueId: string; sportLeagueSeasonId?: string; requestedByUserId: string }): Promise<BackgroundJob> {
    const sportLeague = await this.options.sportLeagues.findById(input.sportLeagueId);
    if (!sportLeague) {
      throw new SportEventError(`Sport league ${input.sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    if (sportLeague.selectedProviderMapping === null) {
      throw new SportEventError(`No provider syncs ${sportLeague.name}'s events.`, 'SPORT_LEAGUE_NOT_SYNCED', 422);
    }
    if (input.sportLeagueSeasonId !== undefined) {
      const seasons = await this.options.seasons.findForSync(sportLeague.id, sportLeague.selectedProviderMapping.id);
      const season = seasons.find((each) => each.id === input.sportLeagueSeasonId);
      if (season === undefined) {
        throw new SportEventError(`Season ${input.sportLeagueSeasonId} is not one of ${sportLeague.name}'s.`, 'SPORT_LEAGUE_SEASON_NOT_FOUND', 404);
      }
      if (season.providerSeasonId === null) {
        throw new SportEventError(`${sportLeague.selectedProviderMapping.providerName} has no id for ${sportLeague.name}'s ${season.name} Season.`, 'SPORT_LEAGUE_SEASON_NOT_MAPPED', 422);
      }
    }
    // poolmaster-allow-direct-job: a root admin's Sync now starts the league's sync
    return this.options.jobs.enqueueRequestReturning(syncLeagueEventsJob(this.options.jobs, {
      sportLeagueId: sportLeague.id,
      ...(input.sportLeagueSeasonId !== undefined && { sportLeagueSeasonId: input.sportLeagueSeasonId }),
    }, { start: { trigger: JobTrigger.ADMIN, startedByUserId: input.requestedByUserId }, providerCode: sportLeague.selectedProviderMapping.providerCode }));
  }

  /** The schedule's pass: one job per active synced league, in one write; answers how many were queued. */
  async queueScheduled(): Promise<number> {
    const leagues = await this.options.sportLeagues.findEventSynced();
    // poolmaster-allow-direct-job: the sync schedule's timer starts each league's sync
    return this.options.jobs.enqueueAll(leagues.map((league) => syncLeagueEventsJob(this.options.jobs, {
      sportLeagueId: league.id,
    }, { start: SCHEDULE_START, ...(league.selectedProviderMapping !== null && { providerCode: league.selectedProviderMapping.providerCode }) })));
  }

  /** The SYNC_LEAGUE_EVENTS job. */
  async run(payload: SyncLeagueEventsJobPayload, context: Pick<BackgroundJobContext, 'jobId' | 'attempt' | 'renewLease' | 'trigger'>): Promise<BackgroundJobOutcome> {
    if (context.attempt > 1) await this.failInterruptedRuns(context.jobId);

    const sportLeague = await this.options.sportLeagues.findById(payload.sportLeagueId);
    if (!sportLeague) throw new PermanentBackgroundJobError(`Sport league ${payload.sportLeagueId} no longer exists`);
    const selected = sportLeague.selectedProviderMapping;
    if (selected === null) throw new PermanentBackgroundJobError(`No provider syncs ${sportLeague.name}'s events any more`);
    const sport = (await this.options.sports.findById(sportLeague.sportId))?.sport;
    if (sport === undefined) throw new PermanentBackgroundJobError(`Sport league ${sportLeague.name} belongs to no known sport`);
    const leagueSeasons = await this.options.seasons.findForSync(sportLeague.id, selected.id);
    const seasons = this.seasonsToRead(sportLeague, leagueSeasons, payload.sportLeagueSeasonId);
    await this.raiseSeasonMissing(sportLeague, selected.providerId, leagueSeasons);

    // A try whose job another task has claimed stops before it records a run of its own.
    if (!await context.renewLease()) throw new Error(`Another try took over ${sportLeague.name}'s events sync`);
    const startedAt = this.now();
    const providerId = selected.providerId;
    const run = await this.options.syncRuns.create({
      providerCode: selected.providerCode,
      sport,
      kind: ProviderSyncKind.EVENTS,
      trigger: context.trigger,
      sportLeagueId: sportLeague.id,
      sportEventId: null,
      backgroundJobId: context.jobId,
      status: ProviderSyncRunStatus.IN_PROGRESS,
      startedAt,
      completedAt: null,
      ...progressOutcome(sportLeague, [], seasons.length),
      createdAt: startedAt,
    });

    const synced: SeasonSync[] = [];
    try {
      for (const [index, season] of seasons.entries()) {
        // A Season's reads can wait on the provider's rate limit, so each later Season starts on a
        // fresh lease; a try whose job another task has claimed stops here.
        if (index > 0 && !await context.renewLease()) throw new Error(`Another try took over ${sportLeague.name}'s events sync`);
        synced.push(await this.syncSeason(sportLeague.id, providerId, season));
        // poolmaster-allow-query-in-loop: the run's progress after each Season
        await this.options.syncRuns.update(run.id, {
          status: ProviderSyncRunStatus.IN_PROGRESS,
          ...progressOutcome(sportLeague, synced, seasons.length),
        });
      }
    } catch (error) {
      await this.failRun(run, startedAt, synced, error);
      this.options.logger?.error({
        action: 'events.leagueSync.failed',
        data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, providerId, syncRunId: run.id, error: errorMessage(error) },
      }, 'A sport league\'s events sync failed');
      if (error instanceof EventScoreSourceError && PERMANENT_SOURCE_ERRORS.has(error.code)) {
        throw new PermanentBackgroundJobError(`${error.code}: ${error.message}`, { cause: error });
      }
      throw error;
    }

    const counts = countsOf(synced);
    const read = seasons.length === 0 ? 'no Season, since none is mapped to its provider from the current one on' : seasons.map((season) => season.name).join(' and ');
    await this.options.syncRuns.update(run.id, {
      status: ProviderSyncRunStatus.COMPLETED,
      startedAt,
      completedAt: this.now(),
      summary: `Synced ${sportLeague.name}'s events for ${read}: ${String(counts.created)} created, ${String(counts.updated)} updated, ${String(counts.skipped)} skipped.`,
      stats: counts,
      changedCount: counts.created + counts.updated,
      errorCount: 0,
      details: { seasons: synced.map(seasonDetails) },
    });
    this.options.logger?.info({
      action: 'events.leagueSync.completed',
      data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, providerId, syncRunId: run.id, trigger: context.trigger, seasons: seasons.map((season) => season.id), ...counts },
    }, 'A sport league\'s events sync finished');
    return {
      changedCount: counts.created + counts.updated,
      result: { syncRunId: run.id, sportLeagueSeasonIds: seasons.map((season) => season.id), ...counts },
    };
  }

  /**
   * The Seasons the job reads: the one it names, or the league's current Season and every later
   * one; only those the provider has an id for.
   */
  private seasonsToRead(
    sportLeague: SportLeague,
    seasons: readonly SyncableSportLeagueSeason[],
    sportLeagueSeasonId: string | undefined,
  ): Array<SyncableSportLeagueSeason & { providerSeasonId: string }> {
    const chosen = sportLeagueSeasonId === undefined
      ? seasonsToSync(seasons, sportLeague.currentSeasonId)
      : seasons.filter((season) => season.id === sportLeagueSeasonId);
    return chosen.filter((season): season is SyncableSportLeagueSeason & { providerSeasonId: string } => season.providerSeasonId !== null);
  }

  /**
   * One SEASON_MISSING ERROR per league and Provider when the last of its Seasons the provider has
   * an id for has ended: nothing of the next Season syncs until a migration adds it.
   */
  private async raiseSeasonMissing(sportLeague: SportLeague, providerId: string, seasons: readonly SyncableSportLeagueSeason[]): Promise<void> {
    const lastMapped = seasons.filter((season) => season.providerSeasonId !== null).at(-1);
    if (lastMapped !== undefined && lastMapped.endsAt >= this.now()) return;
    this.options.logger?.warn({
      action: 'events.leagueSync.seasonMissing',
      data: { sportLeagueId: sportLeague.id, sportLeague: sportLeague.name, providerId, lastMappedSeasonId: lastMapped?.id ?? null },
    }, 'A sport league has no Season left to sync from its provider');
    await this.options.findings.raise([{
      kind: ProviderSyncFindingKind.SEASON_MISSING,
      severity: ProviderSyncFindingSeverity.ERROR,
      sportLeagueId: sportLeague.id,
      sportEventId: null,
      providerId,
      providerValue: null,
      providerValueName: null,
    }]);
  }

  private async syncSeason(sportLeagueId: string, providerId: string, season: SyncableSportLeagueSeason & { providerSeasonId: string }): Promise<SeasonSync> {
    const providerEvents = await this.options.scoreSource.listSeasonEvents(providerId, sportLeagueId, season.providerSeasonId);
    const imported = await this.options.sportEvents.importProviderSeason({ sportLeagueId, sportLeagueSeasonId: season.id, providerId, providerEvents });
    const updated = await this.options.sportEvents.keepProviderEventsCurrent({ sportLeagueId, providerId, providerEvents });
    return { sportLeagueSeasonId: season.id, seasonName: season.name, created: imported.created, skipped: imported.skipped, updated };
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
        summary: 'Interrupted: an earlier try of this sync stopped before it finished.',
        stats: run.stats,
        changedCount: null,
        errorCount: 1,
      });
    }
  }

  private async failRun(
    run: ProviderSyncRun,
    startedAt: Date,
    seasons: readonly SeasonSync[],
    error: unknown,
  ): Promise<void> {
    const message = errorMessage(error);
    await this.options.syncRuns.update(run.id, {
      status: ProviderSyncRunStatus.FAILED,
      startedAt,
      completedAt: this.now(),
      summary: `Failed: ${message}`,
      stats: countsOf(seasons),
      changedCount: null,
      errorCount: 1,
      details: {
        seasons: seasons.map(seasonDetails),
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
}

/** What a sync changed; `alreadyStarted` counts the skipped provider events whose start had passed (#1821). */
function countsOf(seasons: readonly SeasonSync[]): { created: number; updated: number; skipped: number; alreadyStarted: number } {
  return {
    created: seasons.reduce((sum, season) => sum + season.created.length, 0),
    updated: seasons.reduce((sum, season) => sum + season.updated.length, 0),
    skipped: seasons.reduce((sum, season) => sum + season.skipped.length, 0),
    alreadyStarted: seasons.reduce((sum, season) => sum + season.skipped.filter((row) => row.reason === 'ALREADY_STARTED').length, 0),
  };
}

/** A running sync's outcome so far: how far it has got. */
function progressOutcome(sportLeague: SportLeague, seasons: readonly SeasonSync[], seasonCount: number): ProviderSyncRunOutcome {
  return {
    summary: `Syncing ${sportLeague.name}'s events: ${String(seasons.length)} of ${String(seasonCount)} Seasons done.`,
    stats: { ...countsOf(seasons), seasonsDone: seasons.length, seasonCount },
    changedCount: null,
    errorCount: 0,
  };
}

/** One Season's changes, each event linked by id, as the run's details keep them. */
function seasonDetails(season: SeasonSync): Record<string, unknown> {
  return {
    sportLeagueSeasonId: season.sportLeagueSeasonId,
    season: season.seasonName,
    created: season.created.map(({ event }) => ({ sportEventId: event.id, name: event.name })),
    updated: season.updated.map((change) => ({ sportEventId: change.sportEventId, externalId: change.externalId, changed: change.changed })),
    skipped: season.skipped,
  };
}
