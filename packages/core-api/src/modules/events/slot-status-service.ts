/**
 * Status bubbling (#2013, plan §6 step 5): the handlers of the two refresh jobs. A Match's status
 * is written by its result writer with its Games; each move raises MATCH_STATUS_CHANGED, whose
 * job recomputes the event's Season slots here. A slot that moves raises
 * SEASON_SLOT_STATUS_CHANGED, whose job recomputes the event's status from its slots and moves it
 * through `EventLifecycleService`, the one writer of an event's status.
 *
 * Every write is guarded by the status it was read in, so two jobs on one event cannot both move
 * it. A COMPLETED slot is final: nothing here moves it again.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SlotStatusRepository, SportEventRepository } from '@poolmaster/shared/db';
import {
  isDeclaredSportEventTransition,
  seasonSlotStatusOf,
  sportEventStatusOfSlots,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import type { DomainEvents } from '../domain-events';
import { DomainEventType } from '../domain-events/domain-event';
import type { EventLifecycleService } from './event-lifecycle-service';

export interface SlotStatusServiceDeps {
  slots: SlotStatusRepository;
  sportEvents: Pick<SportEventRepository, 'findById'>;
  eventLifecycle: Pick<EventLifecycleService, 'applySportEventStatusTransition'>;
  domainEvents: Pick<DomainEvents, 'collect'>;
  logger?: FastifyBaseLogger;
}

/** What one refresh moved, for the job's record. */
export interface StatusRefreshResult {
  changedCount: number;
}

export class SlotStatusService {
  constructor(private readonly deps: SlotStatusServiceDeps) {}

  /** Recomputes each Season slot of the event from its Matches, and writes each one that moved. */
  async refreshSlots(sportEventId: string): Promise<StatusRefreshResult> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event) return { changedCount: 0 };
    const slots = await this.deps.slots.findBySportEvent(sportEventId);
    let changedCount = 0;
    for (const slot of slots) {
      const to = seasonSlotStatusOf(event.scoringFamily, { current: slot.status, matchStatuses: slot.matchStatuses, feedFinal: slot.feedFinal });
      if (to === slot.status) continue;
      const followUps = await this.deps.domainEvents.collect({
        type: DomainEventType.SEASON_SLOT_STATUS_CHANGED,
        sportEventId,
        seasonSlotId: slot.seasonSlotId,
        from: slot.status,
        to,
      });
      // poolmaster-allow-query-in-loop: one event's slots, each a guarded write of its own
      const moved = await this.deps.slots.transitionStatus(slot.seasonSlotId, { from: slot.status, to }, followUps.jobs);
      if (!moved) {
        this.deps.logger?.info({ sportEventId, seasonSlotId: slot.seasonSlotId, from: slot.status, to }, 'Skipped a slot status change because the slot had already moved on');
        continue;
      }
      followUps.queued();
      changedCount += 1;
      this.deps.logger?.info({ sportEventId, seasonSlotId: slot.seasonSlotId, from: slot.status, to }, 'Moved a Season slot status');
    }
    return { changedCount };
  }

  /**
   * Moves the event to the status its slots give it. A draft stays a draft (only release moves
   * it), and an event whose automatic lifecycle is switched off keeps the status its admin set.
   * An event its slots finish before it started passes through IN_PROGRESS, as its declared
   * transitions require. A move the transitions do not declare (back to SCHEDULED once started)
   * is not made.
   */
  async refreshEvent(sportEventId: string): Promise<StatusRefreshResult> {
    const event = await this.deps.sportEvents.findById(sportEventId);
    if (!event || event.status === SportEventStatus.DRAFT || !event.autoLifecycleEnabled) return { changedCount: 0 };
    const slots = await this.deps.slots.findBySportEvent(sportEventId);
    const target = sportEventStatusOfSlots(slots.map((slot) => slot.status));
    if (target === null || target === event.status) return { changedCount: 0 };
    const steps = isDeclaredSportEventTransition(event.status, target)
      ? [target]
      : target === SportEventStatus.COMPLETED && isDeclaredSportEventTransition(event.status, SportEventStatus.IN_PROGRESS)
        ? [SportEventStatus.IN_PROGRESS, SportEventStatus.COMPLETED]
        : [];
    if (steps.length === 0) {
      this.deps.logger?.info({ sportEventId, status: event.status, target }, 'Left an event where it is: its slots give it a status it cannot move to');
      return { changedCount: 0 };
    }
    let fromStatus: SportEventStatus = event.status;
    for (const toStatus of steps) {
      const moved = await this.deps.eventLifecycle.applySportEventStatusTransition({ sportEventId, toStatus, fromStatus, actor: { type: 'SYSTEM' } });
      if (moved.sportEvent.status !== toStatus) return { changedCount: 0 };
      fromStatus = toStatus;
    }
    return { changedCount: 1 };
  }
}
