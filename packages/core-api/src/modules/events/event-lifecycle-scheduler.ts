/**
 * EventLifecycleScheduler — a second, automatic caller of the exact same
 * `EventLifecycleService.applySportEventStatusTransition` the admin workflow
 * rail calls (plans/124 §3.6) — not a parallel status-writing mechanism.
 *
 * Runs on its own fixed 5-minute interval, platform-wide and not
 * admin-configurable (confirmed §9) — deliberately not folded into
 * `IngestionScheduler`, since no provider is involved. Covers every event,
 * linked to a provider or not: a provider never sets an event's status (ADR-0009).
 * Skips any event with `autoLifecycleEnabled = false` — the admin's manual
 * override for a rain delay, a dispute, or any other reason the recorded
 * schedule no longer reflects reality.
 *
 * A DRAFT event is never touched: only an admin's release moves it (#431). This
 * scheduler's job is the two status writes below, and, while an event is in progress, starting
 * the contests whose cutoff comes after the event's start (a second-chance bracket, #721).
 *
 * Each sweep ends with the "notifications due" step (#845): the emails that fire on the clock
 * rather than on an action, such as entry reminders, are queued once their time has come. The
 * outbox's idempotency key keeps a second sweep, or a second server task, from sending one twice.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRepository, SportEventRoundRepository } from '@poolmaster/shared/db';
import { SportEventStatus, type SportEvent, type SportEventRound } from '@poolmaster/shared/domain';
import type { EventLifecycleService } from './event-lifecycle-service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** The emails that come due on the clock (#845): each sweep asks them to queue what is due. */
export interface DueNotifications {
  queueDue(now: Date): Promise<void>;
}

export interface EventLifecycleSchedulerOptions {
  sportEvents: Pick<SportEventRepository, 'findAutoLifecycleCandidates'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvents'>;
  eventLifecycleService: Pick<EventLifecycleService, 'applySportEventStatusTransition' | 'activateContestsPastCutoff'>;
  /** The "notifications due" step; omitted, a sweep only moves events and contests. */
  notificationsDue?: DueNotifications;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

export class EventLifecycleScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private readonly sportEvents: EventLifecycleSchedulerOptions['sportEvents'];
  private readonly rounds: EventLifecycleSchedulerOptions['rounds'];
  private readonly eventLifecycleService: EventLifecycleSchedulerOptions['eventLifecycleService'];
  private readonly notificationsDue?: DueNotifications;
  private readonly logger?: FastifyBaseLogger;
  private readonly now: () => Date;

  constructor(options: EventLifecycleSchedulerOptions) {
    this.sportEvents = options.sportEvents;
    this.rounds = options.rounds;
    this.eventLifecycleService = options.eventLifecycleService;
    this.notificationsDue = options.notificationsDue;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runSweep();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
    this.logger?.info('Event lifecycle scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One sweep pass. Exposed directly so tests and manual triggers don't need to wait on the timer. */
  async runSweep(): Promise<void> {
    const now = this.now();
    const candidates = await this.sportEvents.findAutoLifecycleCandidates();
    const roundsByEvent = await this.rounds.findBySportEvents(candidates.map((candidate) => candidate.id));

    for (const candidate of candidates) {
      try {
        await this.applyDueTransition(candidate, countedRounds(candidate, roundsByEvent.get(candidate.id) ?? []), now);
      } catch (error) {
        this.logger?.error({
          sportEventId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        }, 'Event lifecycle scheduler failed to apply a due transition');
      }
    }

    // After the transitions, so a contest that just went live is not reminded about.
    try {
      await this.notificationsDue?.queueDue(now);
    } catch (error) {
      this.logger?.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'Event lifecycle scheduler failed to queue the notifications due');
    }
  }

  private async applyDueTransition(candidate: SportEvent, roundSchedule: SportEventRound[], now: Date): Promise<void> {
    if (candidate.status === SportEventStatus.SCHEDULED) {
      const dueAt = minDate(roundSchedule.map((round) => round.scheduledDate)) ?? candidate.startDate;
      if (now >= dueAt) {
        await this.eventLifecycleService.applySportEventStatusTransition({
          sportEventId: candidate.id,
          toStatus: SportEventStatus.IN_PROGRESS,
          actor: { type: 'SYSTEM' },
        });
      }
      return;
    }

    if (candidate.status === SportEventStatus.IN_PROGRESS) {
      // A second-chance bracket goes live at its starting round's first game, mid-event (#721).
      await this.eventLifecycleService.activateContestsPastCutoff(candidate, now);
      const roundEnds = roundSchedule
        .map((round) => round.scheduledEndAt)
        .filter((date): date is Date => date !== null);
      const dueAt = maxDate(roundEnds) ?? candidate.endDate;
      if (dueAt && now >= dueAt) {
        await this.eventLifecycleService.applySportEventStatusTransition({
          sportEventId: candidate.id,
          toStatus: SportEventStatus.COMPLETED,
          actor: { type: 'SYSTEM' },
        });
      }
    }
  }
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
