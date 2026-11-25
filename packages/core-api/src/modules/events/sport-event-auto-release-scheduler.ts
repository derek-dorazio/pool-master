/**
 * SportEventAutoReleaseScheduler — releases a synced DRAFT event for contests on its own once
 * every ready check passes, within its sport league's window before the start (#1823).
 *
 * Each hourly sweep reads, in one query, the DRAFT events of synced leagues with automatic release
 * on that start within the longest window any league may set, keeps those inside their own
 * league's window and linked to that league's provider, and queues one RELEASE_SPORT_EVENT job per
 * event in one insert. Each job's dedupe key keeps one waiting job per event, so a sweep that
 * finds an event whose job has not run yet queues nothing more. The job judges the event again
 * when it runs and logs every check with its value, released or held; a held event is tried again
 * by the next sweep. Every server task runs this scheduler, and the sweep runs on the one holding
 * its job lock (#1159).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRepository } from '@poolmaster/shared/db';
import { autoReleaseHorizon, isWithinAutoReleaseWindow } from '@poolmaster/shared/domain';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { releaseSportEventJob } from './release-sport-event-job';

/** Hourly: a window is days long, and each try of a held event is logged. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Off the minute the other sweeps start on, so they don't all reach the database together. */
const FIRST_SWEEP_AFTER_MS = 53 * 1000;
const SWEEP_LOCK_KEY = 'sport-event-auto-release';

export interface SportEventAutoReleaseSchedulerOptions {
  sportEvents: Pick<SportEventRepository, 'findAutoReleaseCandidates'>;
  jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll'>;
  /** Keeps the sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class SportEventAutoReleaseScheduler {
  private readonly lockedSweep: LockedSweep;
  private readonly now: () => Date;

  constructor(private readonly options: SportEventAutoReleaseSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.lockedSweep = new LockedSweep({
      lockKey: SWEEP_LOCK_KEY,
      jobLock: options.jobLock,
      intervalMs: SWEEP_INTERVAL_MS,
      firstRunAfterMs: FIRST_SWEEP_AFTER_MS,
      label: 'sport event automatic release sweep',
      logger: options.logger,
    }, () => this.sweep());
  }

  start(): void {
    this.lockedSweep.start();
    this.options.logger?.info('Sport event automatic release scheduler started');
  }

  stop(): void {
    this.lockedSweep.stop();
  }

  /** One sweep, when this task holds the lock and no sweep is still running here. Exposed so tests need not wait on the timer. */
  runSweep(): Promise<void> {
    return this.lockedSweep.run();
  }

  private async sweep(): Promise<void> {
    const now = this.now();
    const candidates = await this.options.sportEvents.findAutoReleaseCandidates(now, autoReleaseHorizon(now));
    const due = candidates.filter((candidate) => isWithinAutoReleaseWindow(candidate.startDate, candidate.autoReleaseDaysBeforeStart, now));
    if (due.length > 0) {
      // poolmaster-allow-direct-job: the automatic release sweep's timer starts each release
      await this.options.jobs.enqueueAll(due.map((candidate) => releaseSportEventJob(this.options.jobs, candidate.id)));
    }
    this.options.logger?.info(
      { action: 'events.autoRelease.swept', data: { candidateCount: candidates.length, queuedCount: due.length } },
      'Sport event automatic release sweep finished',
    );
  }
}
