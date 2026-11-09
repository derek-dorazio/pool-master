/**
 * A recurring sweep that runs on one server task (#1159): every task starts the timer, and each
 * tick runs the work only on the task holding the sweep's job lock. A tick that comes due while
 * the last one is still running here is skipped, not overlapped. Each run has a read memo of its
 * own (#1200), as a request has. A failure is logged, never thrown, so the timer carries on and
 * the next tick tries again.
 *
 * The event lifecycle sweep and each kind of clock-driven email run on one of these, each behind a
 * lock of its own (`rules/architecture-rules.md` §4, one recurring job per lock).
 */

import type { FastifyBaseLogger } from 'fastify';
import { errorMessage } from './error-message';
import type { JobLock } from './job-lock';
import { runWithReadMemo } from './request-read-memo';

export interface LockedSweepOptions {
  /** The job lock that keeps the sweep to one server task; it also names the sweep in the logs. */
  lockKey: string;
  jobLock: JobLock;
  /** How often the sweep runs once started. */
  intervalMs: number;
  /**
   * How long after `start` the first run comes, after which it runs every `intervalMs`. Defaults
   * to `intervalMs`. Sweeps started together use it to spread out, so they don't all hit the
   * database on the same tick.
   */
  firstRunAfterMs?: number;
  /** Names the sweep in its log lines, such as "event lifecycle sweep". */
  label: string;
  logger?: FastifyBaseLogger;
}

export class LockedSweep {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly options: LockedSweepOptions,
    private readonly work: () => Promise<void>,
  ) {}

  start(): void {
    if (this.timer) return;
    const { intervalMs, firstRunAfterMs } = this.options;
    this.timer = setTimeout(() => {
      this.timer = setInterval(() => {
        void this.run();
      }, intervalMs);
      this.timer.unref();
      void this.run();
    }, firstRunAfterMs ?? intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      // One call clears either: the first run's timeout or the interval after it.
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** One run, when this task holds the lock and its last run here has ended. */
  async run(): Promise<void> {
    const { lockKey, jobLock, label, logger } = this.options;
    if (this.running) {
      logger?.warn({ action: 'lockedSweep.overlap', data: { lockKey } }, `Skipped the ${label} because the previous one is still running`);
      return;
    }
    this.running = true;
    try {
      const ran = await jobLock.runExclusive(lockKey, () => runWithReadMemo(this.work));
      if (!ran) {
        logger?.debug({ action: 'lockedSweep.heldElsewhere', data: { lockKey } }, `Skipped the ${label} because another server task runs it`);
      }
    } catch (error) {
      logger?.error({
        action: 'lockedSweep.failed',
        data: { lockKey, error: errorMessage(error) },
      }, `The ${label} failed`);
    } finally {
      this.running = false;
    }
  }
}
