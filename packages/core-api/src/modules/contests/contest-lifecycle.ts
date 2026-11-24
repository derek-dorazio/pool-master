/**
 * ContestLifecycle (#1949): the one code path a contest's status changes by, as
 * `EventLifecycleService` is for a sport event's (`rules/architecture-rules.md` §4 *Service
 * Topology*). Its event going live or reopening a contest, settlement completing it and its
 * commissioner opening it all move it here, each as a guarded write. The move is described as a
 * `CONTEST_STATUS_CHANGED` domain event, and what follows it (the league's emails) is collected
 * from `DOMAIN_EVENT_HANDLERS` and written in the move's transaction: a contest another caller
 * moved first queues nothing, and one that moves always has its jobs. Every move has at least
 * one: its boards' rebuild, since a contest's status shows on them (#1973).
 */

import type { ContestRepository, ContestStatusTransition } from '@poolmaster/shared/db';
import { DomainEventType, type ContestStatusChanged, type DomainEvents } from '../domain-events';

/** A contest's move: the guarded write's statuses and timestamps, and the sport event that caused it, if one did. */
export type ContestStatusChange = Omit<ContestStatusTransition, 'jobs'> & Pick<ContestStatusChanged, 'sportEventId'>;

export class ContestLifecycle {
  constructor(
    private readonly contests: Pick<ContestRepository, 'transitionStatus' | 'transitionStatuses'>,
    private readonly domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>,
  ) {}

  /** Moves one contest, if it is still in one of `change.from`; answers whether this call moved it. */
  async transition(contestId: string, change: ContestStatusChange): Promise<boolean> {
    const followUps = await this.domainEvents.collect(statusChanged(contestId, change));
    const moved = await this.contests.transitionStatus(contestId, {
      ...transitionOf(change),
      jobs: () => followUps.jobs,
    });
    if (moved) followUps.queued();
    return moved;
  }

  /**
   * Moves every one of `contestIds` still in one of `change.from`, in one guarded write (#1199);
   * answers the ids this call moved. The follow-ups are collected for every contest asked about,
   * and only the moved ones' are written.
   */
  async transitionAll(contestIds: readonly string[], change: ContestStatusChange): Promise<string[]> {
    if (contestIds.length === 0) return [];
    const followUps = await this.domainEvents.collectEach(contestIds.map((contestId) => statusChanged(contestId, change)), (event) => event.contest.id);
    const moved = await this.contests.transitionStatuses(contestIds, {
      ...transitionOf(change),
      jobs: (movedIds: readonly string[]) => followUps.jobsFor(movedIds),
    });
    if (moved.length > 0) followUps.queued();
    return moved;
  }
}

function statusChanged(contestId: string, change: ContestStatusChange): ContestStatusChanged {
  return {
    type: DomainEventType.CONTEST_STATUS_CHANGED,
    contest: { id: contestId },
    from: change.from,
    to: change.to,
    ...(change.sportEventId !== undefined && { sportEventId: change.sportEventId }),
    ...(change.startsAt !== undefined && { startsAt: change.startsAt }),
  };
}

function transitionOf({ sportEventId: _cause, ...transition }: ContestStatusChange): Omit<ContestStatusTransition, 'jobs'> {
  return transition;
}
