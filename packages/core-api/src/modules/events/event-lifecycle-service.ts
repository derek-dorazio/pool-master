/**
 * EventLifecycleService — the one place a SportEvent's status changes and its
 * downstream side effects (contest activation, contest settlement) fire.
 * Extracted from IngestionPersistence per plans/124 §3.3 so an
 * admin-triggered transition (a later slice) and a provider-triggered one
 * produce byte-identical downstream behavior — there is exactly one code
 * path for "what happens when a sport event's status changes."
 *
 * Every transition is driven by an admin or the lifecycle scheduler; a provider never
 * moves an event's status (ADR-0009). An undeclared jump in
 * SPORT_EVENT_STATUS_TRANSITIONS throws EventLifecycleError
 * (422 SPORT_EVENT_INVALID_TRANSITION). DRAFT → SCHEDULED is the release (#431): only
 * `SportEventService.releaseEvent`, after its readiness checks, may take it, so any other
 * caller is refused with 409 SPORT_EVENT_RELEASE_REQUIRED.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigurationRepository,
  ContestRepository,
  SportEventMatchRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import type { Contest, SportEvent, SportEventMatch } from '@poolmaster/shared/domain';
import {
  ContestStatus,
  SelectionType,
  SportEventStatus,
  isDeclaredSportEventTransition,
} from '@poolmaster/shared/domain';
import { ContestCutoffKind, contestCutoff, cutoffTiming, type EventTiming } from '../contests/entry-window';
import { hasSportEventStarted } from './operational-timing';
import type { ContestStartedNotice } from '../notifications/contest-notices';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

export interface FinishedSportEventSettlement {
  settleFinishedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
  ): Promise<unknown>;
  /** Settles the squares contests on one game once it has a result or is cancelled (#711). */
  settleFinishedGame(
    sportEventId: string,
    sportEventMatchId: string,
    input?: { completedAt?: Date },
  ): Promise<unknown>;
}

/** The contests a released edition joins: those made from a template covering its series (#714). */
export interface ReleasedEditionContests {
  addReleasedEditionToTemplateContests(
    sportEvent: Pick<SportEvent, 'id' | 'eventSeriesId' | 'eventYear'>,
  ): Promise<unknown>;
}

/** Who drove the transition: an admin by hand, or the lifecycle scheduler. */
export type SportEventStatusTransitionActor =
  | { type: 'ROOT_ADMIN' }
  | { type: 'SYSTEM' };

export interface SportEventStatusTransitionInput {
  sportEventId: string;
  toStatus: SportEventStatus;
  actor: SportEventStatusTransitionActor;
  /** Set only by the release action, which has checked the event is ready (#431). */
  release?: boolean;
}

export interface SportEventStatusTransitionResult {
  sportEvent: SportEvent;
  fromStatus: SportEventStatus;
  toStatus: SportEventStatus;
}

export class EventLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = 'SPORT_EVENT_INVALID_TRANSITION',
    readonly statusCode: number = 422,
  ) {
    super(message);
    this.name = 'EventLifecycleError';
  }
}

/**
 * The contest side of an event transition (#247): which contests start. Before #247 this was a
 * raw PrismaClient; contests are slice 3's cluster and now have ports. Who is told is the
 * notifications module's ContestStartedNotice (#845).
 */
export interface EventLifecycleContestDeps {
  contests: ContestRepository;
  /** A second-chance bracket's rules and games: it goes live at its starting round, not the event's start (#721). */
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
}

/** A contest starts from OPEN; any other status is left where it is. */
const STARTABLE: readonly ContestStatus[] = [ContestStatus.OPEN];

export class EventLifecycleService {
  constructor(
    private readonly contestDeps: EventLifecycleContestDeps,
    private readonly sportEvents: SportEventRepository,
    private readonly logger?: FastifyBaseLogger,
    private readonly contestStarted?: ContestStartedNotice,
    private readonly contestSettlement?: FinishedSportEventSettlement,
    private readonly releasedEditionContests?: ReleasedEditionContests,
  ) {}

  async applySportEventStatusTransition(
    input: SportEventStatusTransitionInput,
  ): Promise<SportEventStatusTransitionResult> {
    const before = await this.sportEvents.findById(input.sportEventId);
    if (!before) {
      throw new EventLifecycleError(`Sport event ${input.sportEventId} not found`, 'SPORT_EVENT_NOT_FOUND', 404);
    }
    const fromStatus = before.status;
    if (fromStatus !== input.toStatus && !isDeclaredSportEventTransition(fromStatus, input.toStatus)) {
      throw new EventLifecycleError(
        `Sport event ${input.sportEventId} cannot transition from ${fromStatus} to ${input.toStatus}`,
      );
    }
    const isRelease = fromStatus === SportEventStatus.DRAFT && input.toStatus === SportEventStatus.SCHEDULED;
    if (isRelease && !input.release) {
      this.logger?.warn(
        { sportEventId: input.sportEventId, actor: input.actor.type },
        'Refused to move a draft sport event to SCHEDULED outside the release action',
      );
      throw new EventLifecycleError(
        `Sport event ${input.sportEventId} is a draft; release it for contests instead.`,
        'SPORT_EVENT_RELEASE_REQUIRED',
        409,
      );
    }

    const updated = await this.sportEvents.update(input.sportEventId, {
      status: input.toStatus,
      ...(input.toStatus === SportEventStatus.COMPLETED && !before.endDate
        ? { endDate: new Date() }
        : {}),
    });

    // A released edition joins the contests made to cover its series, a majors pool's major (#714).
    // It runs after the release is written, outside a transaction: a contest whose rules refuse the
    // edition is logged and skipped inside, but any other failure answers the release as failed
    // with the event already released, and its commissioner can still add the edition by hand.
    if (input.release && input.toStatus === SportEventStatus.SCHEDULED) {
      await this.releasedEditionContests?.addReleasedEditionToTemplateContests(updated);
    }
    if (input.toStatus === SportEventStatus.IN_PROGRESS) {
      await this.activateContestsPastCutoff(updated);
    }
    // A cancelled event settles its contests too (#743): it counts for nothing, so it must not
    // hold a contest open.
    if (input.toStatus === SportEventStatus.COMPLETED || input.toStatus === SportEventStatus.CANCELLED) {
      await this.settleContestsForFinishedEvent(updated);
    }

    return {
      sportEvent: updated,
      fromStatus,
      toStatus: input.toStatus,
    };
  }

  /**
   * A game's result is in, or it was cancelled (#711): the squares contests played on it settle
   * now, while its event may still have weeks to run.
   */
  async settleContestsForFinishedGame(sportEvent: SportEvent, sportEventMatchId: string, now: Date = new Date()): Promise<void> {
    await this.contestSettlement?.settleFinishedGame(sportEvent.id, sportEventMatchId, { completedAt: now });
  }

  private async settleContestsForFinishedEvent(
    sportEvent: SportEvent,
  ): Promise<void> {
    if (!this.contestSettlement) {
      return;
    }

    // A cancelled event has no end date of its own, and its start may still be ahead, so its
    // contests settle at the cancellation.
    const cancelledAt = sportEvent.status === SportEventStatus.CANCELLED ? new Date() : undefined;
    await this.contestSettlement.settleFinishedSportEvent(sportEvent.id, {
      completedAt: sportEvent.endDate ?? cancelledAt ?? sportEvent.startDate,
    });
  }

  /**
   * The event's OPEN contests go live at their cutoff (#721): every contest when the event starts,
   * a second-chance bracket at its starting round's first game, and a squares contest at its
   * game's kickoff (#711), each of which comes while the event is under way, so the lifecycle scheduler asks again on each sweep of an event in progress.
   */
  async activateContestsPastCutoff(
    sportEvent: SportEvent,
    now: Date = new Date(),
  ): Promise<void> {
    const candidates = await this.contestDeps.contests.findBySportEvent(sportEvent.id, { statuses: STARTABLE });
    let games: SportEventMatch[] | undefined;

    for (const contest of candidates) {
      const cutoff = contest.selectionType === SelectionType.BRACKET || contest.selectionType === SelectionType.SQUARES
        ? contestCutoff((await this.contestDeps.configurations.findByContest(contest.id))?.configJson, contest.squaresGameMatchId)
        : { kind: ContestCutoffKind.EVENT_START } as const;
      const window: EventTiming = cutoff.kind === ContestCutoffKind.EVENT_START
        ? sportEvent
        : cutoffTiming(cutoff, sportEvent, games ??= await this.contestDeps.matches.findBySportEvent(sportEvent.id));
      if (!hasSportEventStarted(window, now)) {
        continue;
      }
      const started = await this.contestDeps.contests.transitionStatus(contest.id, {
        from: STARTABLE,
        to: ContestStatus.ACTIVE,
        startsAt: window.startDate,
      });

      if (!started) {
        this.logger?.debug({
          contestId: contest.id,
          sportEventId: sportEvent.id,
          providerId: sportEvent.providerId,
          eventExternalId: sportEvent.externalId,
        }, 'Skipped contest started email because contest was already active');
        continue;
      }

      this.logger?.info({
        contestId: contest.id,
        sportEventId: sportEvent.id,
        providerId: sportEvent.providerId,
        eventExternalId: sportEvent.externalId,
        cutoff: cutoff.kind,
      }, 'Activated contest from in-progress sport event');
      await this.tellContestStarted(contest, sportEvent);
    }
  }

  /** E1, "Contest is live": queued for the league, never failing the transition. */
  private async tellContestStarted(contest: Contest, sportEvent: SportEvent): Promise<void> {
    try {
      await this.contestStarted?.contestStarted(contest, sportEvent);
    } catch (err) {
      this.logger?.error({
        contestId: contest.id,
        leagueId: contest.leagueId,
        error: err instanceof Error ? err.message : String(err),
      }, 'Failed to queue contest started emails');
    }
  }
}
