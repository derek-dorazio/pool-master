/**
 * SquaresAutoDrawScheduler — draws a squares board's numbers five minutes before its game kicks
 * off when nobody has drawn them yet (#1760). A board that fills draws at the claim that fills it
 * (`SquaresService.claim`), and the commissioner may still draw early by hand; this sweep catches
 * every board that reaches kickoff undrawn.
 *
 * Each sweep reads the boards whose game kicks off within the lead time, or is under way, as the
 * game stands now, so a moved kickoff needs no rescheduling: the next sweep reads the new time.
 * Each board is drawn through `SquaresService.drawWhenDue`, the same path and the same receipts as
 * a manual draw, and a draw that lost the race to the commissioner's draws nothing. One board
 * failing is logged and the sweep goes on to the next. Every server task runs this scheduler, and
 * the sweep runs on the one holding its job lock (#1159).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestSquaresRepository } from '@poolmaster/shared/db';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';
import { errorMessage } from '../../core/error-message';
import { SQUARES_AUTO_DRAW_LEAD_MS, type SquaresAutoDrawOutcome, type SquaresService } from './squares-service';

/** Every minute, so a board draws within a minute of its moment, five minutes before kickoff. */
const SWEEP_INTERVAL_MS = 60 * 1000;
/** Off the minute the other sweeps start on, so they don't all reach the database together. */
const FIRST_SWEEP_AFTER_MS = 37 * 1000;
const SWEEP_LOCK_KEY = 'squares-auto-draw';

export interface SquaresAutoDrawSchedulerOptions {
  squares: Pick<ContestSquaresRepository, 'findDueForAutoDraw'>;
  service: Pick<SquaresService, 'drawWhenDue'>;
  /** Keeps the sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class SquaresAutoDrawScheduler {
  private readonly lockedSweep: LockedSweep;
  private readonly now: () => Date;

  constructor(private readonly options: SquaresAutoDrawSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.lockedSweep = new LockedSweep({
      lockKey: SWEEP_LOCK_KEY,
      jobLock: options.jobLock,
      intervalMs: SWEEP_INTERVAL_MS,
      firstRunAfterMs: FIRST_SWEEP_AFTER_MS,
      label: 'squares automatic draw sweep',
      logger: options.logger,
    }, () => this.sweep());
  }

  start(): void {
    this.lockedSweep.start();
    this.options.logger?.info('Squares automatic draw scheduler started');
  }

  stop(): void {
    this.lockedSweep.stop();
  }

  /** One sweep, when this task holds the lock and no sweep is still running here. Exposed so tests need not wait on the timer. */
  runSweep(): Promise<void> {
    return this.lockedSweep.run();
  }

  private async sweep(): Promise<void> {
    const contestIds = await this.options.squares.findDueForAutoDraw(new Date(this.now().getTime() + SQUARES_AUTO_DRAW_LEAD_MS));
    if (contestIds.length === 0) return;
    const outcomes: Record<SquaresAutoDrawOutcome | 'failed', number> = { drawn: 0, alreadyDrawn: 0, notDue: 0, closed: 0, failed: 0 };
    // Each due board is its own locked draw and receipts; a sweep finds the few boards kicking off this minute.
    for (const contestId of contestIds) {
      try {
        outcomes[await this.options.service.drawWhenDue(contestId)] += 1;
      } catch (error) {
        outcomes.failed += 1;
        this.options.logger?.error({
          action: 'squares.autoDraw.failed',
          data: { contestId, error: errorMessage(error) },
        }, 'The automatic squares draw failed for a contest');
      }
    }
    this.options.logger?.info({ action: 'squares.autoDraw.swept', data: { contestCount: contestIds.length, ...outcomes } }, 'Squares automatic draw sweep finished');
  }
}
