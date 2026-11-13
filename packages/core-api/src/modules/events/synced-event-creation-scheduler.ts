/**
 * SyncedEventCreationScheduler — once a day, a synced sport league's provider events become its
 * events without an admin pressing Import (ADR 0011, #1725).
 *
 * A sport league is synced when a root admin has named the provider that creates its events
 * (`SportLeague.eventSyncProviderId`). For each active synced league, the sweep runs the admin's
 * own year import for this calendar year and the next: the provider's events whose tour is the
 * league's match keyword (`EventScoreSourceService.listTourEventsForYear`), created and linked for
 * scores by `SportEventService.importProviderEventYear`. It is the one creation path, so series,
 * rounds and default tiers are seeded the same way, and a re-run skips what is already there.
 *
 * Every created event is born DRAFT, as any event is. Release is a separate step that this sweep
 * does not take; for now an admin releases (Derek, 2026-11-13), an interim step, with automatic
 * release the aim once sync is stable (`rules/architecture-rules.md` §4 *A live provider sync is
 * the source of its league's events*).
 *
 * One league failing (its provider unreachable, its keyword matching nothing) is logged and the
 * sweep goes on to the next. Every server task runs this scheduler, and the sweep runs on the one
 * holding its job lock (#1159).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportLeagueRepository } from '@poolmaster/shared/db';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';
import { errorMessage } from '../../core/error-message';
import type { EventScoreSourceService } from './event-score-source-service';
import type { SportEventService } from './service';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The first sweep comes a little after a task starts, so a deploy picks up new events the same day. */
const FIRST_SWEEP_AFTER_MS = 10 * 60 * 1000;
const SWEEP_LOCK_KEY = 'synced-event-creation';
/** This calendar year and the next: a season that starts in the autumn lists next year's events early. */
const YEARS_AHEAD = [0, 1] as const;

export interface SyncedEventCreationSchedulerOptions {
  sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  scoreSource: Pick<EventScoreSourceService, 'listTourEventsForYear'>;
  sportEvents: Pick<SportEventService, 'importProviderEventYear'>;
  /** Keeps the sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** What one league's import did in one year, for the sweep's summary line. */
interface LeagueYearImport {
  sportLeagueId: string;
  eventYear: number;
  createdCount: number;
  skippedCount: number;
}

export class SyncedEventCreationScheduler {
  private readonly lockedSweep: LockedSweep;
  private readonly now: () => Date;

  constructor(private readonly options: SyncedEventCreationSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.lockedSweep = new LockedSweep({
      lockKey: SWEEP_LOCK_KEY,
      jobLock: options.jobLock,
      intervalMs: SWEEP_INTERVAL_MS,
      firstRunAfterMs: FIRST_SWEEP_AFTER_MS,
      label: 'synced event creation sweep',
      logger: options.logger,
    }, () => this.sweep());
  }

  start(): void {
    this.lockedSweep.start();
    this.options.logger?.info('Synced event creation scheduler started');
  }

  stop(): void {
    this.lockedSweep.stop();
  }

  /** One sweep, when this task holds the lock and no sweep is still running here. Exposed so tests need not wait on the timer. */
  runSweep(): Promise<void> {
    return this.lockedSweep.run();
  }

  private async sweep(): Promise<void> {
    const thisYear = this.now().getUTCFullYear();
    const leagues = await this.options.sportLeagues.findEventSynced();
    const imports: LeagueYearImport[] = [];
    let failedCount = 0;
    for (const league of leagues) {
      const providerId = league.eventSyncProviderId;
      if (providerId === null) continue;
      for (const offset of YEARS_AHEAD) {
        const eventYear = thisYear + offset;
        try {
          const providerEvents = await this.options.scoreSource.listTourEventsForYear(providerId, league.id, eventYear);
          const result = await this.options.sportEvents.importProviderEventYear({ sportLeagueId: league.id, eventYear, providerId, providerEvents });
          imports.push({ sportLeagueId: league.id, eventYear, createdCount: result.created.length, skippedCount: result.skipped.length });
        } catch (error) {
          failedCount += 1;
          this.options.logger?.error({
            sportLeagueId: league.id,
            sportLeague: league.name,
            providerId,
            eventYear,
            error: errorMessage(error),
          }, 'Synced event creation failed for a sport league');
        }
      }
    }
    this.options.logger?.info({
      leagueCount: leagues.length,
      createdCount: imports.reduce((sum, item) => sum + item.createdCount, 0),
      failedCount,
      imports: imports.filter((item) => item.createdCount > 0),
    }, 'Synced event creation sweep finished');
  }
}
