/**
 * EventLifecycleService — the one place a SportEvent's status changes and its
 * downstream side effects (contest activation, contest settlement) fire.
 * Extracted from IngestionPersistence per plans/124 §3.3 so an
 * admin-triggered transition (a later slice) and a provider-triggered one
 * produce byte-identical downstream behavior — there is exactly one code
 * path for "what happens when a sport event's status changes."
 *
 * Every transition is driven by an admin or the lifecycle scheduler; a provider moves a
 * synced event's dates, never its status (ADR 0011). An undeclared jump in
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
import type { BackgroundJobOutcome, Contest, SportEvent, SportEventMatch } from '@poolmaster/shared/domain';
import {
  ContestStatus,
  SelectionType,
  SportEventStatus,
  isDeclaredSportEventTransition,
  hasSportEventStarted,
  isSportEventStatusFinished,
} from '@poolmaster/shared/domain';
import { ContestCutoffKind, contestCutoff, cutoffTiming, hasGameMovedOn, type EventTiming } from '../contests/entry-window';
import { ContestLifecycle } from '../contests/contest-lifecycle';
import type { SettleSportEventContestsJobPayload } from '../contests/settle-sport-event-job-requests';
import type { SettleGameContestsJobPayload } from '../contests/settle-game-job-requests';
import type { JobsForWrite } from '../background-jobs';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import { DomainEventType, type DomainEvents } from '../domain-events';
import type { EventContestsJobPayload } from './event-contests-job-requests';

export interface FinishedSportEventSettlement {
  settleFinishedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date; sportEvent?: SportEvent },
  ): Promise<{ contestsSettled: number }>;
  /**
   * Settles the squares contests on one game once it has a result or is cancelled (#711); answers
   * how many it completed.
   */
  settleFinishedGame(
    sportEventId: string,
    sportEventMatchId: string,
    input?: { completedAt?: Date },
  ): Promise<number>;
}

/**
 * What a finished event's settle jobs need (#1946): both required, so a lifecycle built without
 * them fails to compile instead of settling nothing or telling nobody of a cancellation.
 */
export interface EventSettlementDeps {
  contestSettlement: FinishedSportEventSettlement;
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
 * raw PrismaClient; contests are slice 3's cluster and now have ports. Each contest moves through
 * `ContestLifecycle`, whose handlers write its "Contest is live" or reopen email with the move
 * (#1387, #1949).
 */
export interface EventLifecycleContestDeps {
  contests: ContestRepository;
  /** A second-chance bracket's rules and games: it goes live at its starting round, not the event's start (#721). */
  configurations: Pick<ContestConfigurationRepository, 'findByContests'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
}

/** A contest starts from OPEN; any other status is left where it is. */
const STARTABLE: readonly ContestStatus[] = [ContestStatus.OPEN];
/** A live contest is the only kind a postponement takes back to OPEN (#1792). */
const REOPENABLE: readonly ContestStatus[] = [ContestStatus.ACTIVE];

/** The live contests a postponed event takes back to OPEN, by the start (epoch ms) each reopens to. */
type ReopenPlan = ReadonlyMap<number, readonly string[]>;

/** The contests a reopen plan moves (#1910). */
function reopeningIdsOf(plan: ReopenPlan): Set<string> {
  return new Set([...plan.values()].flat());
}

export class EventLifecycleService {
  /** The one writer of a contest's status (#1949), over this service's contests and handler map. */
  private readonly contestLifecycle: ContestLifecycle;

  constructor(
    private readonly contestDeps: EventLifecycleContestDeps,
    private readonly sportEvents: SportEventRepository,
    /** What follows a status change or a moved start: the jobs each writes with its change (#1946). */
    private readonly domainEvents: Pick<DomainEvents, 'collect' | 'collectEach'>,
    private readonly settlement: EventSettlementDeps,
    private readonly logger?: FastifyBaseLogger,
  ) {
    this.contestLifecycle = new ContestLifecycle(contestDeps.contests, domainEvents);
  }

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

    const now = new Date();
    const endDate = input.toStatus === SportEventStatus.COMPLETED && !before.endDate ? now : undefined;
    // A postponement reopens the live contests on it whose start is still ahead (#1792), in the
    // job written with the status (#1952). They are planned here too, so the event changed email
    // leaves them to the reopen's own email (#1910). A planned contest the job's guarded write then
    // misses is still told: either another caller reopened it first, and its write queued the same
    // reopen email, or the contest left ACTIVE, and the C6 a live contest would get no longer
    // applies. The job plans again as it runs, and a job that fails is retried, with the lifecycle
    // sweep behind it. One case gets neither email: if the new start passes before the job runs
    // (its latency or a retry), a planned contest stays live, since the event has started by then.
    const postponing = input.toStatus === SportEventStatus.POSTPONED && fromStatus !== SportEventStatus.POSTPONED;
    const reopenPlan = postponing ? await this.contestsToReopen({ ...before, status: SportEventStatus.POSTPONED }, now) : undefined;
    // What follows the change (settlement, a release into template contests, the postponed
    // notices, the boards' rebuild) is written with the status (#1946), so a change that fails or
    // loses a race queues nothing and one that lands always has its jobs.
    const followUps = await this.domainEvents.collect({
      type: DomainEventType.SPORT_EVENT_STATUS_CHANGED,
      sportEvent: { id: before.id, startDate: before.startDate, eventSeriesId: before.eventSeriesId, eventYear: before.eventYear },
      from: fromStatus,
      to: input.toStatus,
      // A cancelled event has no end date of its own, and its start may still be ahead, so its
      // contests settle at the cancellation.
      settleAt: endDate ?? before.endDate ?? (input.toStatus === SportEventStatus.CANCELLED ? now : before.startDate),
      reopeningContestIds: reopenPlan ? reopeningIdsOf(reopenPlan) : new Set(),
    });
    const { jobs } = followUps;

    // Written only while the event is still where it was read (#1159): of two callers making the
    // change at once, one writes it and runs the side effects below, and the other stops here.
    const updated = await this.sportEvents.transitionStatus(input.sportEventId, {
      from: fromStatus,
      to: input.toStatus,
      ...(endDate && { endDate }),
      ...(isRelease && { releasedAt: now }),
      ...(jobs.length > 0 && { jobs }),
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

    // The contests going live at the start, and a postponed event's contests following its start,
    // are jobs written with the status (#1952), as are a cancellation's emails (C7).
    followUps.queued();

    return {
      sportEvent: updated,
      fromStatus,
      toStatus: input.toStatus,
    };
  }

  /**
   * The follow-ups of an admin's edit that moves a released event's start from `previousStart`
   * to `sportEvent.startDate` (#1464), for the edit to write with the new start, and the wake to
   * call once it has committed. On a postponed event, a live contest the new start reopens is
   * told by its reopen's email instead (#1910), sent when the next lifecycle sweep reopens it.
   */
  async sportEventRescheduledJobs(sportEvent: Pick<SportEvent, 'id' | 'startDate' | 'status'>, previousStart: Date): Promise<JobsForWrite> {
    const reopeningContestIds = sportEvent.status === SportEventStatus.POSTPONED
      ? reopeningIdsOf(await this.contestsToReopen(sportEvent, new Date()))
      : new Set<string>();
    return this.domainEvents.collect({
      type: DomainEventType.SPORT_EVENT_RESCHEDULED,
      sportEvent: { id: sportEvent.id, startDate: sportEvent.startDate, status: sportEvent.status },
      previousStart,
      reopeningContestIds,
    });
  }

  /**
   * The SETTLE_GAME_CONTESTS job: settles the squares contests on one game as the game stands
   * when the job runs. A contest already COMPLETED is not settled again, so a retry after a
   * failure part way settles only the rest.
   */
  async settleFinishedGameContests(payload: SettleGameContestsJobPayload): Promise<BackgroundJobOutcome> {
    const completed = await this.settlement.contestSettlement.settleFinishedGame(payload.sportEventId, payload.sportEventMatchId, {
      completedAt: new Date(payload.completedAt),
    });
    return { changedCount: completed };
  }

  /**
   * The SETTLE_SPORT_EVENT_CONTESTS job (#1448): settles the contests of an event that completed
   * or was cancelled. A cancelled event's leagues were told (C7) by the jobs its cancellation
   * wrote, while their contests were still open. It reads the event again: one moved back out of COMPLETED or
   * CANCELLED before the job ran settles nothing, and its next finish queues a job of its own.
   *
   * A completed event's contests still open past their cutoff go live first, so each is told it
   * went live (E1) before it is told it finished.
   *
   * Settlement is idempotent, so a retry after a failure part way finishes the rest: a contest
   * already COMPLETED is not settled again, and one whose standings for this event are frozen keeps
   * them. Reports the contests it settled (#1861).
   */
  async settleFinishedEventContests(payload: SettleSportEventContestsJobPayload): Promise<BackgroundJobOutcome> {
    const sportEvent = await this.sportEvents.findById(payload.sportEventId);
    if (!sportEvent || !isSportEventStatusFinished(sportEvent.status)) {
      this.logger?.warn(
        { action: 'events.settleContests.skipped', data: { sportEventId: payload.sportEventId, status: sportEvent?.status ?? null } },
        'Skipped settling an event\'s contests because the event is gone or no longer finished',
      );
      return { changedCount: 0 };
    }
    const completedAt = new Date(payload.completedAt);
    // A completed event's open contests go live first (#1952), as the sweep does: an event that
    // completed before its ACTIVATE_EVENT_CONTESTS job ran, or while that job waited to retry, would
    // otherwise settle them straight from OPEN and nobody would be told the contest went live.
    // The guarded moves keep it idempotent with that job.
    if (sportEvent.status === SportEventStatus.COMPLETED) {
      await this.activateContestsPastCutoff(sportEvent, completedAt);
    }
    const summary = await this.settlement.contestSettlement.settleFinishedSportEvent(sportEvent.id, {
      completedAt,
      sportEvent,
    });
    return { changedCount: summary.contestsSettled };
  }

  /**
   * A postponed event's contests follow its start (#1792): while the start is ahead, a contest that
   * went live on it takes entries and pick changes again, back to OPEN; once the start has passed,
   * its contests go live as at any start. The lifecycle scheduler asks on each sweep of a postponed
   * event, so a start moved later reopens them and the new start closes them.
   */
  async followPostponedStart(sportEvent: SportEvent, now: Date = new Date()): Promise<number> {
    if (hasSportEventStarted(sportEvent, now)) {
      return this.activateContestsPastCutoff(sportEvent, now);
    }
    // A reopened contest goes live again through the same activation, which queues its "Contest is
    // live" job a second time; the outbox's idempotency key (contest, event and member) sends nothing new.
    return this.reopenContestsBeforeStart(await this.contestsToReopen(sportEvent, now), sportEvent);
  }

  /**
   * The ACTIVATE_EVENT_CONTESTS job (#1952): an event that started takes its contests live at
   * their cutoffs. It reads the event again: one gone, or moved back before its start (postponed,
   * scheduled again, cancelled), starts nothing here; a postponed one's own job and the lifecycle
   * sweep follow it. One already completed did start, so its contests still go live first, as they
   * would have inline. A retry finds the contests already live and moves none.
   */
  async activateEventContests(payload: EventContestsJobPayload): Promise<BackgroundJobOutcome> {
    const sportEvent = await this.sportEvents.findById(payload.sportEventId);
    if (!sportEvent || (sportEvent.status !== SportEventStatus.IN_PROGRESS && sportEvent.status !== SportEventStatus.COMPLETED)) {
      this.logger?.info(
        { action: 'events.activateContests.skipped', data: { sportEventId: payload.sportEventId, status: sportEvent?.status ?? null } },
        'Skipped taking an event\'s contests live because the event is gone or no longer under way',
      );
      return { changedCount: 0 };
    }
    return { changedCount: await this.activateContestsPastCutoff(sportEvent) };
  }

  /**
   * The FOLLOW_POSTPONED_EVENT_CONTESTS job (#1952): a postponed event's contests follow its start
   * as it stands when the job runs (`followPostponedStart`). An event gone or no longer postponed
   * moves nothing; its own change queued what follows it. A retry finds the contests already moved.
   */
  async followPostponedEventContests(payload: EventContestsJobPayload): Promise<BackgroundJobOutcome> {
    const sportEvent = await this.sportEvents.findById(payload.sportEventId);
    if (!sportEvent || sportEvent.status !== SportEventStatus.POSTPONED) {
      this.logger?.info(
        { action: 'events.postponedContests.skipped', data: { sportEventId: payload.sportEventId, status: sportEvent?.status ?? null } },
        'Skipped following a postponed event\'s start because the event is gone or no longer postponed',
      );
      return { changedCount: 0 };
    }
    return { changedCount: await this.followPostponedStart(sportEvent) };
  }

  /**
   * The live contests on a postponed event that has not started which go back to OPEN (#1792),
   * by the start each reopens to: those that close at the event's start and none of whose events
   * has started. A season contest whose earlier week was played stays live, and its postponed week
   * takes pick changes as any later week does. A bracket that starts at a later round and a squares
   * contest close at a game, and a contest with a random draw has dealt its picks, so those stay
   * live too. A game already under way, or with a period score, means play began before the
   * postponement, so nothing reopens. One decision for the reopen and for the event changed email
   * that leaves those contests to the reopen's email (#1910).
   */
  private async contestsToReopen(sportEvent: Pick<SportEvent, 'id' | 'startDate' | 'status'>, now: Date): Promise<ReopenPlan> {
    const dueByStart = new Map<number, string[]>();
    if (hasSportEventStarted(sportEvent, now)) return dueByStart;
    const live = (await this.contestDeps.contests.findBySportEvent(sportEvent.id, { statuses: REOPENABLE }))
      .filter((contest) => contest.drawnAt === undefined && contest.selectionType !== SelectionType.SQUARES);
    if (live.length === 0) return dueByStart;
    if ((await this.contestDeps.matches.findBySportEvent(sportEvent.id)).some(hasGameMovedOn)) return dueByStart;

    const brackets = live.filter((contest) => contest.selectionType === SelectionType.BRACKET);
    const configJsonByContest = new Map(
      (brackets.length === 0 ? [] : await this.contestDeps.configurations.findByContests(brackets.map((contest) => contest.id)))
        .map((configuration) => [configuration.contestId, configuration.configJson]),
    );
    const atEventStart = live.filter((contest) => contest.selectionType !== SelectionType.BRACKET
      || contestCutoff(configJsonByContest.get(contest.id)).kind === ContestCutoffKind.EVENT_START);
    const otherEventIds = [...new Set(atEventStart.flatMap((contest) => contest.sportEventIds))].filter((id) => id !== sportEvent.id);
    const startById = new Map<string, Date>([[sportEvent.id, sportEvent.startDate]]);
    const started = new Set<string>();
    for (const other of otherEventIds.length === 0 ? [] : await this.sportEvents.findByIds(otherEventIds)) {
      startById.set(other.id, other.startDate);
      if (hasSportEventStarted(other, now)) started.add(other.id);
    }

    // A reopened contest starts at its first event's start again, now ahead, which is what its
    // pages count down to and close entries at.
    for (const contest of atEventStart) {
      if (contest.sportEventIds.some((id) => started.has(id))) continue;
      const startsAt = Math.min(...contest.sportEventIds.map((id) => startById.get(id)?.getTime() ?? sportEvent.startDate.getTime()));
      dueByStart.set(startsAt, [...(dueByStart.get(startsAt) ?? []), contest.id]);
    }
    return dueByStart;
  }

  /**
   * Back to OPEN, the live contests on a postponed event that has not started (#1792), as
   * `contestsToReopen` decided. The contest's start moves to its first event's start, so its pages
   * count down to the new start and close entries at it: one guarded write per start, as when
   * contests go live.
   */
  private async reopenContestsBeforeStart(dueByStart: ReopenPlan, sportEvent: SportEvent): Promise<number> {
    let reopenedCount = 0;
    for (const [startsAt, contestIds] of dueByStart) {
      // One guarded write per start moment of the reopened contests, not per contest.
      const reopened = await this.contestLifecycle.transitionAll(contestIds, {
        from: REOPENABLE,
        to: ContestStatus.OPEN,
        startsAt: new Date(startsAt),
        // Its handler tells the league "Event postponed, picks are open again" (#1808, #1910).
        sportEventId: sportEvent.id,
      });
      for (const contestId of reopened) {
        this.logger?.info(
          { action: 'events.postponed.contestReopened', data: { contestId, sportEventId: sportEvent.id, startsAt: new Date(startsAt).toISOString() } },
          'Reopened a live contest for entries because its postponed event has not started',
        );
      }
      reopenedCount += reopened.length;
    }
    return reopenedCount;
  }

  /**
   * The event's OPEN contests go live at their cutoff (#721): every contest when the event starts,
   * a second-chance bracket at its starting round's first game, and a squares contest at its
   * game's kickoff (#711), each of which comes while the event is under way, so the lifecycle scheduler asks again on each sweep of an event in progress.
   * `knownGames`, the event's games as a caller just wrote them, saves reading them. Answers how
   * many contests went live.
   */
  async activateContestsPastCutoff(
    sportEvent: SportEvent,
    now: Date = new Date(),
    knownGames?: readonly SportEventMatch[],
  ): Promise<number> {
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

    let activatedCount = 0;
    for (const [startsAt, due] of dueByStart) {
      // One guarded write per cutoff moment (the event's start, a bracket round's, a squares game's kickoff), not per contest.
      const activated = new Set(await this.contestLifecycle.transitionAll(due.map(({ contest }) => contest.id), {
        from: STARTABLE,
        to: ContestStatus.ACTIVE,
        startsAt: new Date(startsAt),
        // Its handler tells the league E1, "Contest is live".
        sportEventId: sportEvent.id,
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
        activatedCount++;
      }
    }
    return activatedCount;
  }
}
