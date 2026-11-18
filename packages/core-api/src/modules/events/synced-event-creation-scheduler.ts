/**
 * SyncedEventCreationScheduler — every six hours, the schedule trigger of each synced sport
 * league's events sync (ADR 0011, #1725; one sync framework, #1819). The sweep only queues: one
 * SYNC_LEAGUE_EVENTS job per active synced league (`LeagueEventsSync.queueScheduled`), and the
 * job runner does the provider calls in the background, recording each as an EVENTS sync run.
 * An admin's Sync now queues the same job, so a league is created and kept current one way.
 *
 * A sport league is synced when a root admin has named the provider that creates its events
 * (`SportLeague.eventSyncProviderId`). Every created event is born DRAFT, as any event is; status
 * is never set here, the lifecycle scheduler moves it on the event's dates.
 *
 * Every server task runs this scheduler, and the sweep runs on the one holding its job lock
 * (#1159). A league whose job still waits is not queued twice: its dedupe key holds one.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';
import type { LeagueEventsSync } from './league-events-sync';

/** Often enough that a rescheduled game or round moves the same day; each pass queues one job per league. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** The first sweep comes a little after a task starts, so a deploy picks up new events the same day. */
const FIRST_SWEEP_AFTER_MS = 10 * 60 * 1000;
const SWEEP_LOCK_KEY = 'synced-event-creation';

export interface SyncedEventCreationSchedulerOptions {
  leagueEventsSync: Pick<LeagueEventsSync, 'queueScheduled'>;
  /** Keeps the sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
}

export class SyncedEventCreationScheduler {
  private readonly lockedSweep: LockedSweep;

  constructor(private readonly options: SyncedEventCreationSchedulerOptions) {
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
    const queuedCount = await this.options.leagueEventsSync.queueScheduled();
    this.options.logger?.info({ action: 'events.leagueSync.scheduled', data: { queuedCount } }, 'Queued each synced sport league\'s events sync');
  }
}
