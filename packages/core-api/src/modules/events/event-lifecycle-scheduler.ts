/**
 * EventLifecycleScheduler — a second, automatic caller of the exact same
 * `EventLifecycleService.applySportEventStatusTransition` the admin workflow
 * rail calls (plans/124 §3.6) — not a parallel status-writing mechanism.
 *
 * Runs on its own fixed 5-minute interval, platform-wide and not
 * admin-configurable (confirmed §9) — deliberately not folded into
 * `IngestionScheduler`, since no provider is involved. Covers every event,
 * linked to a provider or not: a provider moves a synced event's dates, and this scheduler
 * moves its status on them (ADR 0011).
 * Skips any event with `autoLifecycleEnabled = false` — the admin's manual
 * override for a rain delay, a dispute, or any other reason the recorded
 * schedule no longer reflects reality.
 *
 * An event holding a stat line a provider has not called final yet is not completed (#1660): a
 * Clutch Card's last game running past its scheduled end would otherwise settle contests on a
 * partial box score, and the live sync, which reads only in-progress events, would never bring
 * the final line. The sweep logs the hold and completes the event once the line is final; an
 * admin can still complete it by hand if a feed never sends final. A game suspended mid-play
 * leaves its lines in progress for good, so every sweep's line for a hold past `LONG_HOLD_MS` is
 * a warning rather than info, to stand out in the logs for an admin to finish the event.
 *
 * A DRAFT event is never touched: only an admin's release moves it (#431). This
 * scheduler's job is the two status writes below, and, while an event is in progress, starting
 * the contests whose cutoff comes after the event's start (a second-chance bracket, #721).
 *
 * The emails that fire on the clock rather than on an action, such as entry reminders and live
 * standings, sweep on timers of their own (`DueNotificationsScheduler`), so a slow one never
 * holds up an event's move or its contests going live.
 *
 * Every server task runs this scheduler, and the sweep runs on one of them (#1159): the task
 * holding the sweep's job lock. A sweep still running when the next is due is not overlapped.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventParticipantStatLineRepository, SportEventRepository, SportEventRoundRepository } from '@poolmaster/shared/db';
import { SportEventStatus, type SportEvent, type SportEventRound } from '@poolmaster/shared/domain';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';
import type { EventLifecycleService } from './event-lifecycle-service';
import { errorMessage } from '../../core/error-message';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** How long past its scheduled end an event's completion is held before the hold is a warning. */
export const LONG_HOLD_MS = 6 * 60 * 60 * 1000;
const SWEEP_LOCK_KEY = 'event-lifecycle-sweep';

export interface EventLifecycleSchedulerOptions {
  sportEvents: Pick<SportEventRepository, 'findAutoLifecycleCandidates'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvents'>;
  /** Which events hold a stat line still in progress, whose completion waits (#1660). */
  statLines: Pick<SportEventParticipantStatLineRepository, 'findSportEventsWithLiveLines'>;
  eventLifecycleService: Pick<EventLifecycleService, 'applySportEventStatusTransition' | 'activateContestsPastCutoff'>;
  /** Keeps the sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class EventLifecycleScheduler {
  private readonly lockedSweep: LockedSweep;
  private readonly sportEvents: EventLifecycleSchedulerOptions['sportEvents'];
  private readonly rounds: EventLifecycleSchedulerOptions['rounds'];
  private readonly statLines: EventLifecycleSchedulerOptions['statLines'];
  private readonly eventLifecycleService: EventLifecycleSchedulerOptions['eventLifecycleService'];
  private readonly logger?: FastifyBaseLogger;
  private readonly now: () => Date;

  constructor(options: EventLifecycleSchedulerOptions) {
    this.sportEvents = options.sportEvents;
    this.rounds = options.rounds;
    this.statLines = options.statLines;
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
    // One read, and only for the events due to complete this pass.
    const dueToComplete = schedules.filter(({ candidate, roundSchedule }) => isDueToComplete(candidate, roundSchedule, now)).map(({ candidate }) => candidate.id);
    const held = new Set(dueToComplete.length === 0 ? [] : await this.statLines.findSportEventsWithLiveLines(dueToComplete));

    for (const { candidate, roundSchedule } of schedules) {
      try {
        await this.applyDueTransition(candidate, roundSchedule, now, held.has(candidate.id));
      } catch (error) {
        this.logger?.error({
          sportEventId: candidate.id,
          error: errorMessage(error),
        }, 'Event lifecycle scheduler failed to apply a due transition');
      }
    }
  }

  private async applyDueTransition(candidate: SportEvent, roundSchedule: SportEventRound[], now: Date, liveLineHeld: boolean): Promise<void> {
    if (candidate.status === SportEventStatus.SCHEDULED) {
      const dueAt = minDate(roundSchedule.map((round) => round.scheduledDate)) ?? candidate.startDate;
      if (now >= dueAt) {
        await this.eventLifecycleService.applySportEventStatusTransition({
          sportEventId: candidate.id,
          toStatus: SportEventStatus.IN_PROGRESS,
          actor: { type: 'SYSTEM' },
          fromStatus: SportEventStatus.SCHEDULED,
        });
      }
      return;
    }

    if (candidate.status === SportEventStatus.IN_PROGRESS) {
      // A second-chance bracket goes live at its starting round's first game, mid-event (#721).
      await this.eventLifecycleService.activateContestsPastCutoff(candidate, now);
      const dueAt = completionDueAt(candidate, roundSchedule);
      if (dueAt === undefined || now < dueAt) return;
      if (liveLineHeld) {
        const heldMs = now.getTime() - dueAt.getTime();
        const entry = { action: 'eventLifecycle.completionHeld', data: { sportEventId: candidate.id, heldMs } };
        if (heldMs >= LONG_HOLD_MS) {
          this.logger?.warn(entry, 'Held an event\'s completion for hours: a game\'s stat lines are still in progress, so an admin may need to finish it');
        } else {
          this.logger?.info(entry, 'Held an event\'s completion: a game\'s stat lines are still in progress');
        }
        return;
      }
      await this.eventLifecycleService.applySportEventStatusTransition({
        sportEventId: candidate.id,
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'SYSTEM' },
        fromStatus: SportEventStatus.IN_PROGRESS,
      });
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

/** Whether an in-progress event's schedule has ended. */
function isDueToComplete(event: SportEvent, roundSchedule: SportEventRound[], now: Date): boolean {
  if (event.status !== SportEventStatus.IN_PROGRESS) return false;
  const dueAt = completionDueAt(event, roundSchedule);
  return dueAt !== undefined && now >= dueAt;
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
