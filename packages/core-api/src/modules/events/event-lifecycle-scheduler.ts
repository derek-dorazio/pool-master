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
 * scheduler's job is exactly the two status writes below, nothing else.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRepository, SportEventRoundRepository } from '@poolmaster/shared/db';
import { SportEventStatus, type SportEvent, type SportEventRound } from '@poolmaster/shared/domain';
import type { EventLifecycleService } from './event-lifecycle-service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export class EventLifecycleScheduler {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly sportEvents: Pick<SportEventRepository, 'findAutoLifecycleCandidates'>,
    private readonly rounds: Pick<SportEventRoundRepository, 'findBySportEvents'>,
    private readonly eventLifecycleService: Pick<EventLifecycleService, 'applySportEventStatusTransition'>,
    private readonly logger?: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runSweep();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
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
        await this.applyDueTransition(candidate, roundsByEvent.get(candidate.id) ?? [], now);
      } catch (error) {
        this.logger?.error({
          sportEventId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        }, 'Event lifecycle scheduler failed to apply a due transition');
      }
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

function minDate(dates: Date[]): Date | undefined {
  return dates.reduce<Date | undefined>((min, date) => (!min || date < min ? date : min), undefined);
}

function maxDate(dates: Date[]): Date | undefined {
  return dates.reduce<Date | undefined>((max, date) => (!max || date > max ? date : max), undefined);
}
