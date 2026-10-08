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
  ContestEntryRepository,
  ContestRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SportEventRepository,
  SquadMembershipRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type { Contest, League, SportEvent, User } from '@poolmaster/shared/domain';
import {
  ContestStatus,
  LeagueRole,
  LeagueMembershipStatus,
  SportEventStatus,
  isDeclaredSportEventTransition,
} from '@poolmaster/shared/domain';
import {
  renderSystemEmailTemplate,
  type ContestStartedEntrySummary,
  type MailDeliveryProvider,
} from '../email';

export interface CompletedSportEventSettlement {
  settleCompletedSportEvent(
    sportEventId: string,
    input?: { completedAt?: Date },
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
    readonly code: string = 'SPORT_EVENT_INVALID_TRANSITION',
    readonly statusCode: number = 422,
  ) {
    super(message);
    this.name = 'EventLifecycleError';
  }
}

/**
 * The contest side of an event transition (#247): which contests start, and who is told. Before
 * #247 this was a raw PrismaClient; contests are slice 3's cluster and now have ports.
 */
export interface EventLifecycleContestDeps {
  contests: ContestRepository;
  entries: ContestEntryRepository;
  leagues: LeagueRepository;
  memberships: LeagueMembershipRepository;
  squadMemberships: SquadMembershipRepository;
  users: UserRepository;
}

/** A contest being started, with everything its summary email reads. */
interface ContestStartedSummary {
  contest: Contest;
  league: League;
  entries: Array<{ name: string; squadName: string }>;
  recipients: User[];
}

/** A contest starts from OPEN or LOCKED; any other status is left where it is. */
const STARTABLE: readonly ContestStatus[] = [ContestStatus.OPEN, ContestStatus.LOCKED];

export class EventLifecycleService {
  constructor(
    private readonly contestDeps: EventLifecycleContestDeps,
    private readonly sportEvents: SportEventRepository,
    private readonly logger?: FastifyBaseLogger,
    private readonly mailDelivery?: MailDeliveryProvider,
    private readonly appBaseUrl = 'http://localhost:5173',
    private readonly golfContestSettlement?: CompletedSportEventSettlement,
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

    if (input.toStatus === SportEventStatus.IN_PROGRESS) {
      await this.activateContestsForStartedEvent(updated);
    }
    if (input.toStatus === SportEventStatus.COMPLETED) {
      await this.settleContestsForCompletedEvent(updated);
    }

    return {
      sportEvent: updated,
      fromStatus,
      toStatus: input.toStatus,
    };
  }

  private async settleContestsForCompletedEvent(
    sportEvent: SportEvent,
  ): Promise<void> {
    if (!this.golfContestSettlement) {
      return;
    }

    await this.golfContestSettlement.settleCompletedSportEvent(sportEvent.id, {
      completedAt: sportEvent.endDate ?? sportEvent.startDate,
    });
  }

  private async activateContestsForStartedEvent(
    sportEvent: SportEvent,
  ): Promise<void> {
    const candidates = await this.contestDeps.contests.findBySportEvent(sportEvent.id, { statuses: STARTABLE });

    for (const contest of candidates) {
      const started = await this.contestDeps.contests.transitionStatus(contest.id, {
        from: STARTABLE,
        to: ContestStatus.ACTIVE,
        startsAt: sportEvent.startDate,
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
      }, 'Activated contest from in-progress sport event');
      await this.deliverContestStartedSummaryEmails(contest, sportEvent);
    }
  }

  /**
   * The contest's league, its submitted entries (entry number, then name) and the people told:
   * the league's active commissioners, then each entry's active squad members, active users
   * only, each once. Null when the league is gone.
   */
  private async loadContestStartedSummary(contest: Contest): Promise<ContestStartedSummary | null> {
    const { entries, leagues, memberships, squadMemberships, users } = this.contestDeps;
    const [league, leagueMemberships, contestEntries] = await Promise.all([
      leagues.findById(contest.leagueId),
      memberships.findByLeague(contest.leagueId),
      entries.findByContestWithSquad(contest.id, { submittedOnly: true }),
    ]);
    if (!league) {
      return null;
    }
    const orderedEntries = [...contestEntries].sort((a, b) =>
      a.entryNumber - b.entryNumber || a.name.localeCompare(b.name));

    const commissionerIds = leagueMemberships
      .filter((membership) => membership.status === LeagueMembershipStatus.ACTIVE && membership.role === LeagueRole.COMMISSIONER)
      .map((membership) => membership.userId);
    const squadMemberIds = (await Promise.all(
      orderedEntries.map((entry) => squadMemberships.findBySquad(entry.squadId)),
    )).flat().map((membership) => membership.userId);
    const recipientIds = [...new Set([...commissionerIds, ...squadMemberIds])];
    const recipients = (await Promise.all(recipientIds.map((id) => users.findById(id))))
      .filter((user): user is User => user !== null && user.isActive);

    return {
      contest,
      league,
      entries: orderedEntries.map((entry) => ({ name: entry.name, squadName: entry.squadName })),
      recipients,
    };
  }

  private async deliverContestStartedSummaryEmails(
    contest: Contest,
    sportEvent: SportEvent,
  ): Promise<void> {
    if (!this.mailDelivery) {
      this.logger?.debug({
        contestId: contest.id,
        leagueId: contest.leagueId,
      }, 'Skipped contest started summary email because mail delivery is unavailable');
      return;
    }

    const summary = await this.loadContestStartedSummary(contest);
    if (!summary) {
      this.logger?.warn({
        contestId: contest.id,
        leagueId: contest.leagueId,
      }, 'Skipped contest started summary email because the league was not found');
      return;
    }
    const entries: ContestStartedEntrySummary[] = summary.entries.map((entry) => ({
      entryName: entry.name,
      teamName: entry.squadName,
    }));
    // The contest belongs to this event, so its name and start are the event's own.
    const contestUrl = buildContestUrl(
      this.appBaseUrl,
      summary.league.leagueCode,
      contest.id,
    );

    for (const user of summary.recipients) {
      const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
        userName: formatUserName(user),
        leagueName: summary.league.name,
        contestName: contest.name,
        eventName: sportEvent.name,
        contestUrl,
        startedAt: sportEvent.startDate,
        entryCount: entries.length,
        entries,
      });

      try {
        await this.mailDelivery.send({
          to: user.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
          metadata: {
            templateKey: message.templateKey,
            leagueId: contest.leagueId,
            contestId: contest.id,
          },
        });
        this.logger?.info({
          contestId: contest.id,
          leagueId: contest.leagueId,
          userId: user.id,
          templateKey: message.templateKey,
        }, 'Delivered contest started summary email');
      } catch (err) {
        this.logger?.error({
          contestId: contest.id,
          leagueId: contest.leagueId,
          userId: user.id,
          templateKey: message.templateKey,
          error: err instanceof Error ? err.message : String(err),
        }, 'Failed to deliver contest started summary email');
      }
    }
  }
}

function formatUserName(user: User): string {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user.username || user.email;
}

function buildContestUrl(
  appBaseUrl: string,
  leagueCode: string,
  contestId: string,
): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}/contests/${encodeURIComponent(contestId)}`;
}
