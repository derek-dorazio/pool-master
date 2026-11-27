/**
 * EventLifecycleScheduler — a second, automatic caller of the exact same
 * `EventLifecycleService.applySportEventStatusTransition` the admin workflow
 * rail calls (plans/124 §3.6) — not a parallel status-writing mechanism.
 *
 * Runs on its own fixed 5-minute interval, platform-wide and not
 * admin-configurable (confirmed §9) — deliberately not folded into
 * the sync tick (`SyncTick`), since no provider is involved. Covers every event,
 * linked to a provider or not: a provider moves a synced event's dates, and this scheduler
 * moves its status on them (ADR 0011).
 * Skips any event with `autoLifecycleEnabled = false` — the admin's manual
 * override for a rain delay, a dispute, or any other reason the recorded
 * schedule no longer reflects reality.
 *
 * A DRAFT event is never touched: only an admin's release moves it (#431). This
 * scheduler's job is the two status writes below, and, while an event is in progress, starting
 * the contests whose cutoff comes after the event's start (a squares game, #711). A
 * POSTPONED event's status is left alone, but its contests follow its start (#1792): open while
 * it is ahead, wherever the start has moved to, and live once it has passed.
 *
 * The emails that fire on the clock rather than on an action, such as entry reminders and live
 * standings, sweep on timers of their own (`DueNotificationsScheduler`), so a slow one never
 * holds up an event's move or its contests going live.
 *
 * Every server task runs this scheduler, and the sweep runs on one of them (#1159): the task
 * holding the sweep's job lock. A sweep still running when the next is due is not overlapped.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { AutoLifecycleCandidate, SportEventRepository, SportEventRoundRepository } from '@poolmaster/shared/db';
import { SportEventStatus, type SportEvent, type SportEventRound } from '@poolmaster/shared/domain';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';
import type { EventLifecycleService } from './event-lifecycle-service';
import { errorMessage } from '../../core/error-message';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_LOCK_KEY = 'event-lifecycle-sweep';

export interface EventLifecycleSchedulerOptions {
  sportEvents: Pick<SportEventRepository, 'findAutoLifecycleCandidates'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvents'>;
  eventLifecycleService: Pick<EventLifecycleService, 'applySportEventStatusTransition' | 'activateContestsPastCutoff' | 'followPostponedStart'>;
  /** Keeps the sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class EventLifecycleScheduler {
  private readonly lockedSweep: LockedSweep;
  private readonly sportEvents: EventLifecycleSchedulerOptions['sportEvents'];
  private readonly rounds: EventLifecycleSchedulerOptions['rounds'];
  private readonly eventLifecycleService: EventLifecycleSchedulerOptions['eventLifecycleService'];
  private readonly logger?: FastifyBaseLogger;
  private readonly now: () => Date;

  constructor(options: EventLifecycleSchedulerOptions) {
    this.sportEvents = options.sportEvents;
    this.rounds = options.rounds;
    this.eventLifecycleService = options.eventLifecycleService;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.lockedSweep = new LockedSweep({
      lockKey: SWEEP_LOCK_KEY,
      jobLock: options.jobLock,
      intervalMs: SWEEP_INTERVAL_MS,
      label: 'event lifecycle sweep',
      logger: options.logger,
    }, () => this.sweep());
  }

  start(): void {
    this.lockedSweep.start();
    this.logger?.info('Event lifecycle scheduler started');
  }

  stop(): void {
    this.lockedSweep.stop();
  }

  /**
   * One sweep pass, when this task holds the sweep's lock and no sweep is still running here.
   * Exposed directly so tests and manual triggers don't need to wait on the timer. One read memo
   * per sweep (#1200), as a request has: the contests of one event share its sport league's read,
   * and a write in the sweep forgets what it touches.
   */
  runSweep(): Promise<void> {
    return this.lockedSweep.run();
  }

  private async sweep(): Promise<void> {
    const now = this.now();
    const candidates = await this.sportEvents.findAutoLifecycleCandidates();
    const roundsByEvent = await this.rounds.findBySportEvents(candidates.map((candidate) => candidate.id));
    const schedules = candidates.map((candidate) => ({ candidate, roundSchedule: countedRounds(candidate, roundsByEvent.get(candidate.id) ?? []) }));

    for (const { candidate, roundSchedule } of schedules) {
      try {
        await this.applyDueTransition(candidate, roundSchedule, now);
      } catch (error) {
        this.logger?.error({
          sportEventId: candidate.id,
          error: errorMessage(error),
        }, 'Event lifecycle scheduler failed to apply a due transition');
      }
    }
  }

  private async applyDueTransition(candidate: AutoLifecycleCandidate, roundSchedule: SportEventRound[], now: Date): Promise<void> {
    // Each status the candidate read answers has its case, and lint holds the switch whole.
    switch (candidate.status) {
      case SportEventStatus.POSTPONED:
        // Its contests take entries until its start, wherever that has moved to (#1792).
        await this.eventLifecycleService.followPostponedStart(candidate, now);
        return;
      case SportEventStatus.SCHEDULED: {
        const dueAt = minDate(roundSchedule.map((round) => round.scheduledDate)) ?? candidate.startDate;
        if (now < dueAt) return;
        await this.eventLifecycleService.applySportEventStatusTransition({
          sportEventId: candidate.id,
          toStatus: SportEventStatus.IN_PROGRESS,
          actor: { type: 'SYSTEM' },
          fromStatus: SportEventStatus.SCHEDULED,
        });
        return;
      }
      case SportEventStatus.IN_PROGRESS: {
        // A squares contest goes live at its game's kickoff, mid-event (#711).
        await this.eventLifecycleService.activateContestsPastCutoff(candidate, now);
        const dueAt = completionDueAt(candidate, roundSchedule);
        if (dueAt === undefined || now < dueAt) return;
        await this.eventLifecycleService.applySportEventStatusTransition({
          sportEventId: candidate.id,
          toStatus: SportEventStatus.COMPLETED,
          actor: { type: 'SYSTEM' },
          fromStatus: SportEventStatus.IN_PROGRESS,
        });
      }
    }
  }
}

/** When an event's schedule ends: its last round's end, or its own end date. */
function completionDueAt(event: SportEvent, roundSchedule: SportEventRound[]): Date | undefined {
  const roundEnds = roundSchedule
    .map((round) => round.scheduledEndAt)
    .filter((date): date is Date => date !== null);
  return maxDate(roundEnds) ?? event.endDate;
}

/**
 * The rounds the event plays: an admin who cuts the round count (weather) leaves the rows past
 * it stored, and those no longer decide when the event starts or ends.
 */
function countedRounds(event: SportEvent, rounds: SportEventRound[]): SportEventRound[] {
  const roundCount = event.rounds;
  return roundCount ? rounds.filter((round) => round.roundNumber <= roundCount) : rounds;
}

function minDate(dates: Date[]): Date | undefined {
  return dates.reduce<Date | undefined>((min, date) => (!min || date < min ? date : min), undefined);
}

function maxDate(dates: Date[]): Date | undefined {
  return dates.reduce<Date | undefined>((max, date) => (!max || date > max ? date : max), undefined);
}
