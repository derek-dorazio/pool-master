import type { FastifyBaseLogger } from 'fastify';
import type { JobLock } from './job-lock';

/**
 * The nightly cleanup (#1175): once a day, each step deletes the rows its retention period no
 * longer keeps. Every server task runs this scheduler, and a run happens on one of them: the
 * task holding the cleanup's job lock (#1159).
 *
 * Steps belong to the module that owns their table, and the scheduler only sequences them. A
 * step that fails is logged and the others still run; whatever it left is deleted the next night.
 */
export interface NightlyCleanupStep {
  /** Names the step's count in the run's summary line. */
  readonly name: string;
  /** Deletes what the step's retention period no longer keeps as of `now`; resolves to how many rows. */
  purge(now: Date): Promise<number>;
}

/** Rows each delete takes at most, so no single statement holds its locks for long. */
export const CLEANUP_BATCH_SIZE = 1000;

/**
 * Runs `deleteBatch` until a batch comes back short of `batchSize`; resolves to the rows deleted.
 * Each batch is its own statement, so a large backlog is deleted in many short ones.
 */
export async function deleteInBatches(
  deleteBatch: (limit: number) => Promise<number>,
  batchSize: number = CLEANUP_BATCH_SIZE,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await deleteBatch(batchSize);
    total += deleted;
    if (deleted < batchSize) return total;
  }
}

const TICK_MS = 15 * 60_000;
/** 08:00 UTC: 3 or 4 AM US Eastern, after the 3 AM overnight emails have queued. */
const RUN_HOUR_UTC = 8;
const LOCK_KEY = 'nightly-cleanup';

export interface NightlyCleanupSchedulerOptions {
  steps: readonly NightlyCleanupStep[];
  /** Keeps each night's run to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class NightlyCleanupScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  /** The UTC date of the last run on this task, so a night's later ticks skip it. */
  private lastRunDay?: string;
  private readonly now: () => Date;

  constructor(private readonly options: NightlyCleanupSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref();
    this.options.logger?.info('Nightly cleanup scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Runs the cleanup when the run hour has come, it has not run on this task today, and this task
   * holds the lock. A task that starts after the run hour waits for the next night: the
   * retention periods are months long, so a missed night only delays a day's deletes.
   */
  async tick(): Promise<void> {
    const now = this.now();
    if (now.getUTCHours() !== RUN_HOUR_UTC) return;
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunDay === day || this.running) return;
    this.running = true;
    try {
      const ran = await this.options.jobLock.runExclusive(LOCK_KEY, () => this.run(now));
      if (ran) {
        this.lastRunDay = day;
      } else {
        this.options.logger?.debug('Skipped the nightly cleanup because another server task runs it');
      }
    } catch (error) {
      this.options.logger?.error({
        action: 'nightlyCleanup.failed',
        data: { error: error instanceof Error ? error.message : String(error) },
      }, 'Nightly cleanup failed');
    } finally {
      this.running = false;
    }
  }

  /** One run of every step, logging one summary line with each step's count. */
  async run(now: Date): Promise<void> {
    const deleted: Record<string, number> = {};
    const failed: string[] = [];
    for (const step of this.options.steps) {
      try {
        deleted[step.name] = await step.purge(now);
      } catch (error) {
        failed.push(step.name);
        this.options.logger?.error({
          action: 'nightlyCleanup.stepFailed',
          data: { step: step.name, error: error instanceof Error ? error.message : String(error) },
        }, 'A nightly cleanup step failed; the next night tries again');
      }
    }
    this.options.logger?.info({
      action: 'nightlyCleanup.completed',
      data: { deleted, failed },
    }, 'Nightly cleanup completed');
  }
}
