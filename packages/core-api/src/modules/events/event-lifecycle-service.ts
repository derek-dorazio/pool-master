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
import type { BackgroundJobRequest, Contest, SportEvent, SportEventMatch } from '@poolmaster/shared/domain';
import {
  ContestStatus,
  SelectionType,
  SportEventStatus,
  isDeclaredSportEventTransition,
} from '@poolmaster/shared/domain';
import { ContestCutoffKind, contestCutoff, cutoffTiming, type EventTiming } from '../contests/entry-window';
import { hasSportEventStarted } from './operational-timing';
import { ContestEventChangeKind } from '../email';
import type { SportEventChange, SportEventChangedNotice } from '../notifications/contest-notices';
import { contestStartedEmailsJob } from '../notifications/contest-email-job-requests';
import { settleSportEventContestsJob, type SettleSportEventContestsJobPayload } from '../contests/settle-sport-event-job-requests';
import { settleGameContestsJob, type SettleGameContestsJobPayload } from '../contests/settle-game-job-requests';
import type { BackgroundJobQueue } from '../background-jobs';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

export interface FinishedSportEventSettlement {
  settleFinishedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date; sportEvent?: SportEvent },
  ): Promise<unknown>;
  /** Settles the squares contests on one game once it has a result or is cancelled (#711). */
  settleFinishedGame(
    sportEventId: string,
    sportEventMatchId: string,
    input?: { completedAt?: Date },
  ): Promise<unknown>;
}

/** The job a decided game's write carries, and what to call once that write has committed. */
export interface FinishedGameSettlement {
  jobs: readonly BackgroundJobRequest[];
  queued(): void;
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
  /**
   * The status the caller saw the event in. Set, the change applies only from it: the lifecycle
   * scheduler that saw an event in progress does not complete it a second time after an admin or
   * another server task already has (#1159).
   */
  fromStatus?: SportEventStatus;
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
 * raw PrismaClient; contests are slice 3's cluster and now have ports. Each contest that goes
 * live queues its "Contest is live" email job in the same write (#845, #1387).
 */
export interface EventLifecycleContestDeps {
  contests: ContestRepository;
  /** A second-chance bracket's rules and games: it goes live at its starting round, not the event's start (#721). */
  configurations: Pick<ContestConfigurationRepository, 'findByContests'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
}

/** A contest starts from OPEN; any other status is left where it is. */
const STARTABLE: readonly ContestStatus[] = [ContestStatus.OPEN];

export class EventLifecycleService {
  constructor(
    private readonly contestDeps: EventLifecycleContestDeps,
    private readonly sportEvents: SportEventRepository,
    private readonly logger?: FastifyBaseLogger,
    /**
     * Where each contest that goes live queues its "Contest is live" email job (#1387), and a
     * finished event queues the job that settles its contests (#1448); without it, neither runs.
     */
    private readonly jobs?: Pick<BackgroundJobQueue, 'request' | 'queued'>,
    private readonly contestSettlement?: FinishedSportEventSettlement,
    private readonly releasedEditionContests?: ReleasedEditionContests,
    private readonly sportEventChanged?: SportEventChangedNotice,
  ) {}

  async applySportEventStatusTransition(
    input: SportEventStatusTransitionInput,
  ): Promise<SportEventStatusTransitionResult> {
    const before = await this.sportEvents.findById(input.sportEventId);
    if (!before) {
      throw new EventLifecycleError(`Sport event ${input.sportEventId} not found`, 'SPORT_EVENT_NOT_FOUND', 404);
    }
    const fromStatus = before.status;
    if (input.fromStatus !== undefined && input.fromStatus !== fromStatus) {
      this.logger?.info(
        { sportEventId: input.sportEventId, expectedStatus: input.fromStatus, status: fromStatus, toStatus: input.toStatus },
        'Skipped a sport event status change because the event had already moved on',
      );
      return { sportEvent: before, fromStatus, toStatus: input.toStatus };
    }
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

    // An event that completes or is cancelled settles its contests in a background job written
    // with the status (#1448): an event can hold hundreds of contests, too many for the request.
    // A cancelled event counts for nothing, so it must not hold a contest open either (#743).
    const finishing = input.toStatus === SportEventStatus.COMPLETED || input.toStatus === SportEventStatus.CANCELLED;
    const now = new Date();
    const endDate = input.toStatus === SportEventStatus.COMPLETED && !before.endDate ? now : undefined;
    // A cancelled event has no end date of its own, and its start may still be ahead, so its
    // contests settle at the cancellation.
    const settleAt = endDate ?? before.endDate ?? (input.toStatus === SportEventStatus.CANCELLED ? now : before.startDate);
    const settleJob = finishing && this.jobs && this.contestSettlement
      ? settleSportEventContestsJob(this.jobs, input.sportEventId, settleAt)
      : undefined;

    // Written only while the event is still where it was read (#1159): of two callers making the
    // change at once, one writes it and runs the side effects below, and the other stops here.
    const updated = await this.sportEvents.transitionStatus(input.sportEventId, {
      from: fromStatus,
      to: input.toStatus,
      ...(endDate && { endDate }),
      ...(settleJob && { jobs: [settleJob] }),
    });
    if (!updated) {
      const current = (await this.sportEvents.findById(input.sportEventId)) ?? before;
      this.logger?.info(
        { sportEventId: input.sportEventId, fromStatus, status: current.status, toStatus: input.toStatus, actor: input.actor.type },
        'Skipped a sport event status change because another caller changed the status first',
      );
      // A caller that named the status it saw expects to lose such a race; an admin who did not
      // is told the change did not land, unless the event ended where they asked anyway.
      if (input.fromStatus === undefined && current.status !== input.toStatus) {
        throw new EventLifecycleError(
          `Sport event ${input.sportEventId} moved from ${fromStatus} to ${current.status} while this change to ${input.toStatus} was made`,
          'SPORT_EVENT_INVALID_TRANSITION',
          409,
        );
      }
      return { sportEvent: current, fromStatus, toStatus: input.toStatus };
    }

    // A released edition joins the contests made to cover its series, a majors pool's major (#714),
    // by one job per contest (#1318). The jobs are written after the release, outside its
    // transaction: a failure to write them answers the release as failed with the event already
    // released, and its commissioners can still add the edition by hand.
    if (input.release && input.toStatus === SportEventStatus.SCHEDULED) {
      await this.releasedEditionContests?.addReleasedEditionToTemplateContests(updated);
    }
    if (input.toStatus === SportEventStatus.IN_PROGRESS) {
      await this.activateContestsPastCutoff(updated);
    }
    if (input.toStatus === SportEventStatus.POSTPONED && fromStatus !== SportEventStatus.POSTPONED) {
      await this.tellSportEventChanged(updated, { kind: ContestEventChangeKind.POSTPONED });
    }
    // The cancellation email (C7) is sent by the settlement job, before it finishes the contests
    // it is about.
    if (settleJob) this.jobs?.queued();

    return {
      sportEvent: updated,
      fromStatus,
      toStatus: input.toStatus,
    };
  }

  /** C6: a released event's start moved, as an admin's edit reports it. */
  async sportEventRescheduled(sportEvent: SportEvent, previousStart: Date): Promise<void> {
    await this.tellSportEventChanged(sportEvent, { kind: ContestEventChangeKind.RESCHEDULED, previousStart });
  }

  /** C6: queued for the leagues on the event, never failing the admin's change. */
  private async tellSportEventChanged(sportEvent: SportEvent, change: SportEventChange): Promise<void> {
    try {
      await this.sportEventChanged?.sportEventChanged(sportEvent, change);
    } catch (err) {
      this.logger?.error({
        sportEventId: sportEvent.id,
        change: change.kind,
        error: err instanceof Error ? err.message : String(err),
      }, 'Failed to queue event changed emails');
    }
  }

  /**
   * A game's result is in, a quarter score it waited for came after it, or it was cancelled
   * (#711): the squares contests played on it settle now, while its event may still have weeks to
   * run. They settle in a job the caller writes with the game, so a request never loops over an
   * event's contests. Without a job queue and settlement, nothing settles.
   */
  finishedGameSettlement(sportEventId: string, sportEventMatchId: string, now: Date = new Date()): FinishedGameSettlement {
    if (!this.jobs || !this.contestSettlement) return { jobs: [], queued: () => undefined };
    const { jobs } = this;
    return {
      jobs: [settleGameContestsJob(jobs, sportEventId, sportEventMatchId, now)],
      queued: () => jobs.queued(),
    };
  }

  /**
   * The SETTLE_GAME_CONTESTS job: settles the squares contests on one game as the game stands
   * when the job runs. A contest already COMPLETED is not settled again, so a retry after a
   * failure part way settles only the rest.
   */
  async settleFinishedGameContests(payload: SettleGameContestsJobPayload): Promise<void> {
    if (!this.contestSettlement) {
      throw new Error('Contest settlement is required to settle a finished game\'s contests');
    }
    await this.contestSettlement.settleFinishedGame(payload.sportEventId, payload.sportEventMatchId, {
      completedAt: new Date(payload.completedAt),
    });
  }

  /**
   * The SETTLE_SPORT_EVENT_CONTESTS job (#1448): settles the contests of an event that completed
   * or was cancelled, after telling a cancelled event's leagues (C7), which it must do while their
   * contests are still open. It reads the event again: one moved back out of COMPLETED or
   * CANCELLED before the job ran settles nothing, and its next finish queues a job of its own.
   *
   * Settlement is idempotent, so a retry after a failure part way finishes the rest: a contest
   * already COMPLETED is not settled again, one whose standings for this event are frozen keeps
   * them, and C7's idempotency key sends it to each member once.
   */
  async settleFinishedEventContests(payload: SettleSportEventContestsJobPayload): Promise<void> {
    if (!this.contestSettlement) {
      throw new Error('Contest settlement is required to settle a finished event\'s contests');
    }
    const sportEvent = await this.sportEvents.findById(payload.sportEventId);
    if (sportEvent?.status !== SportEventStatus.COMPLETED && sportEvent?.status !== SportEventStatus.CANCELLED) {
      this.logger?.warn(
        { action: 'events.settleContests.skipped', data: { sportEventId: payload.sportEventId, status: sportEvent?.status ?? null } },
        'Skipped settling an event\'s contests because the event is gone or no longer finished',
      );
      return;
    }
    // Nothing has settled yet, so a failure to queue C7 fails the job and its retry tells them:
    // swallowed here, the contests would complete and nothing would ever tell them.
    if (sportEvent.status === SportEventStatus.CANCELLED) {
      await this.sportEventChanged?.sportEventChanged(sportEvent, { kind: ContestEventChangeKind.CANCELLED });
    }
    await this.contestSettlement.settleFinishedSportEvent(sportEvent.id, {
      completedAt: new Date(payload.completedAt),
      sportEvent,
    });
  }

  /**
   * The event's OPEN contests go live at their cutoff (#721): every contest when the event starts,
   * a second-chance bracket at its starting round's first game, and a squares contest at its
   * game's kickoff (#711), each of which comes while the event is under way, so the lifecycle scheduler asks again on each sweep of an event in progress.
   * `knownGames`, the event's games as a caller just wrote them, saves reading them.
   */
  async activateContestsPastCutoff(
    sportEvent: SportEvent,
    now: Date = new Date(),
    knownGames?: readonly SportEventMatch[],
  ): Promise<void> {
    const candidates = await this.contestDeps.contests.findBySportEvent(sportEvent.id, { statuses: STARTABLE });
    let games: readonly SportEventMatch[] | undefined = knownGames;
    // A bracket's or squares contest's cutoff is in its configuration: all of them read at once (#1183).
    const cutoffConfigured = candidates.filter((contest) => contest.selectionType === SelectionType.BRACKET || contest.selectionType === SelectionType.SQUARES);
    const configJsonByContest = new Map(
      (cutoffConfigured.length === 0 ? [] : await this.contestDeps.configurations.findByContests(cutoffConfigured.map((contest) => contest.id)))
        .map((configuration) => [configuration.contestId, configuration.configJson]),
    );

    // Each contest past its cutoff, by the moment it went live: one guarded write per moment
    // (#1199), since an NFL Sunday can start hundreds of contests on one event.
    const dueByStart = new Map<number, Array<{ contest: Contest; cutoff: ContestCutoffKind }>>();
    for (const contest of candidates) {
      const cutoff = contest.selectionType === SelectionType.BRACKET || contest.selectionType === SelectionType.SQUARES
        ? contestCutoff(configJsonByContest.get(contest.id), contest.squaresGameMatchId)
        : { kind: ContestCutoffKind.EVENT_START } as const;
      const window: EventTiming = cutoff.kind === ContestCutoffKind.EVENT_START
        ? sportEvent
        : cutoffTiming(cutoff, sportEvent, games ??= await this.contestDeps.matches.findBySportEvent(sportEvent.id));
      if (!hasSportEventStarted(window, now)) {
        continue;
      }
      const startsAt = window.startDate.getTime();
      dueByStart.set(startsAt, [...(dueByStart.get(startsAt) ?? []), { contest, cutoff: cutoff.kind }]);
    }

    const { jobs } = this;
    let started = 0;
    try {
      for (const [startsAt, due] of dueByStart) {
        // poolmaster-allow-query-in-loop: one write per cutoff moment (the event's start, a bracket round's, a squares game's kickoff), not per contest
        const activated = new Set(await this.contestDeps.contests.transitionStatuses(due.map(({ contest }) => contest.id), {
          from: STARTABLE,
          to: ContestStatus.ACTIVE,
          startsAt: new Date(startsAt),
          // E1, "Contest is live": one job per contest that went live, written with its move.
          ...(jobs && { jobs: (contestIds) => contestIds.map((contestId) => contestStartedEmailsJob(jobs, contestId, sportEvent.id)) }),
        }));
        for (const { contest, cutoff } of due) {
          const logged = {
            contestId: contest.id,
            sportEventId: sportEvent.id,
            providerId: sportEvent.providerId,
            eventExternalId: sportEvent.externalId,
          };
          if (!activated.has(contest.id)) {
            this.logger?.debug(logged, 'Skipped contest started email because contest was already active');
            continue;
          }
          this.logger?.info({ ...logged, cutoff }, 'Activated contest from in-progress sport event');
          started++;
        }
      }
    } finally {
      // The jobs of the contests already live have committed with them, even when a later write fails.
      if (started > 0) jobs?.queued();
    }
  }
}
