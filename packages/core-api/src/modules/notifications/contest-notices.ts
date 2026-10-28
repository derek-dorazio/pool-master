/**
 * The emails a contest's own milestones send (#845): "New contest open" (catalog row D1) when the
 * commissioner opens it, "Contest is live, good luck" (E1) when it goes live at its cutoff, and
 * "Final results" (F1, with F3 for its winners) when it settles. All three go to every active
 * member of the contest's league, and to no other league. A contest that ends with no scores
 * (F2) tells only its commissioners and the members with an entry, and so does an event on it
 * being postponed, moved or cancelled (C6, C7).
 *
 * Each email is queued once per person: its outbox idempotency key is the contest (and for E1
 * the event) and the person, so a retried call finds it recorded and skips.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestEntryRepository, ContestRepository, LeagueRepository, SquadMembershipRepository } from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  ContestStatus,
  LeagueRole,
  PARTICIPANT_SCORING_DEFINITIONS,
  SportEventStatus,
  contestEntryEventStatus,
  type Contest,
  type EmailTemplateKey,
  type League,
  type SportEvent,
  type User,
} from '@poolmaster/shared/domain';
import { areEventPicksOpen } from '../contests/entry-window';
import type { ContestService } from '../contests/service';
import {
  emailRecipientOf,
  ContestEventChangeKind,
  ContestResultsKind,
  buildContestUrl,
  buildEmailContestFormat,
  buildEmailEventHeader,
  buildLeaderboardUrl,
  formatUserName,
  type ContestEmailEvent,
  type ContestEventChange,
  type ContestResultsOutcome,
  type EmailService,
  type StandingsLine,
} from '../email';
import { describeEventFormat, shareSummaryReads, summarizeContest, type ContestSummaryDeps } from './contest-summary';
import { activeLeagueMembers, activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';
import { leaderCount } from './live-standings';

export interface ContestNoticeDeps extends ContestSummaryDeps, LeagueMemberDeps {
  contests: Pick<ContestRepository, 'findById' | 'findBySportEvent'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  entries: Pick<ContestEntryRepository, 'findByContest'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  /** A settled contest's frozen places, for its final results. */
  finalStandings: Pick<ContestService, 'finalStandingsOf'>;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
  /** The clock that says whether an event's picks are still open; the real one by default. */
  now?: () => Date;
}

/** The contest-opened seam ContestManagementService calls. */
export interface ContestOpenedNotice {
  contestOpened(contestId: string): Promise<void>;
}

/** The contest-started seam EventLifecycleService calls, once for all of an event's contests that just went live. */
export interface ContestStartedNotice {
  contestsStarted(contests: readonly Contest[], sportEvent: SportEvent): Promise<void>;
}

function toEmailEvent(sportEvent: SportEvent): ContestEmailEvent {
  return { name: sportEvent.name, startsAt: sportEvent.startDate };
}

/** The contest-settled seam ContestSettlementService calls. */
export interface ContestSettledNotice {
  contestSettled(contest: Contest): Promise<void>;
}

/** What happened to an event, as EventLifecycleService and SportEventService report it. */
export type SportEventChange =
  | { kind: typeof ContestEventChangeKind.POSTPONED }
  | { kind: typeof ContestEventChangeKind.RESCHEDULED; previousStart: Date }
  | { kind: typeof ContestEventChangeKind.CANCELLED };

/** The event-changed seam EventLifecycleService calls. */
export interface SportEventChangedNotice {
  sportEventChanged(sportEvent: SportEvent, change: SportEventChange): Promise<void>;
}

/** Only an open or live contest hears about its events: a finished one is done, and a draft one's commissioners aren't told. */
const TOLD_OF_EVENT_CHANGES = [ContestStatus.OPEN, ContestStatus.ACTIVE];

export class ContestNotices implements ContestOpenedNotice, ContestStartedNotice, ContestSettledNotice, SportEventChangedNotice {
  constructor(private readonly deps: ContestNoticeDeps) {}

  /** D1: tells every active member the contest is open, with its rules and when picks close. */
  async contestOpened(contestId: string): Promise<void> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) return;
    const [league, summary] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      summarizeContest(this.deps, contest),
    ]);
    if (!league || !summary) {
      this.skipped('email.contestOpened.skipped', contest, 'Skipped the new contest email because its league, rules or events are gone');
      return;
    }
    const contestUrl = buildContestUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    await this.sendEach('CONTEST_OPENED', contest, league, await activeLeagueMembers(this.deps, league.id), (user) => this.deps.email.send('CONTEST_OPENED', {
      to: emailRecipientOf(user),
      about: contest.id,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
      refs: { contestId: contest.id },
      data: {
        userName: formatUserName(user),
        leagueName: league.name,
        contestName: contest.name,
        event: buildEmailEventHeader(this.deps.appBaseUrl, summary.firstEvent, summary.sportLeagueName),
        events: summary.sportEvents.map(toEmailEvent),
        format: buildEmailContestFormat(this.deps.appBaseUrl, contest.selectionType),
        rules: summary.rules,
        entriesPerMember: summary.entriesPerMember,
        closesAt: summary.closesAt,
        contestUrl,
      },
    }));
  }

  /**
   * E1 for each contest that just went live for `sportEvent`. The event's matches, sport league
   * and tiers are read once for all of them (#1199), and one contest failing to queue doesn't
   * stop the rest.
   */
  async contestsStarted(contests: readonly Contest[], sportEvent: SportEvent): Promise<void> {
    const shared = shareSummaryReads(this.deps, [sportEvent]);
    for (const contest of contests) {
      try {
        await this.contestStarted(contest, sportEvent, shared);
      } catch (err) {
        this.deps.logger?.error({
          action: 'email.contestStarted.failed',
          data: { contestId: contest.id, leagueId: contest.leagueId, error: err instanceof Error ? err.message : String(err) },
        }, 'Failed to queue contest started emails');
      }
    }
  }

  /**
   * E1: wishes every active member good luck as the contest goes live for `sportEvent`, with the
   * event, the rules and how many entries are in. No entry list: the leaderboard has it.
   */
  private async contestStarted(contest: Contest, sportEvent: SportEvent, shared: ContestSummaryDeps): Promise<void> {
    const [league, summary, entries] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      summarizeContest(shared, contest),
      this.deps.entries.findByContest(contest.id),
    ]);
    if (!league || !summary) {
      this.skipped('email.contestStarted.skipped', contest, 'Skipped the contest is live email because its league, rules or events are gone');
      return;
    }
    const submitted = entries.filter((entry) => contestEntryEventStatus(entry, sportEvent.id) === ContestEntryStatus.SUBMITTED);
    const entrants = new Set((await this.deps.squadMemberships.findBySquads([...new Set(submitted.map((entry) => entry.squadId))]))
      .map((owner) => owner.userId));
    const eventFormat = await describeEventFormat(shared, sportEvent);
    const leaderboardUrl = buildLeaderboardUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    await this.sendEach('CONTEST_STARTED_SUMMARY', contest, league, await activeLeagueMembers(this.deps, league.id), (user) => this.deps.email.send('CONTEST_STARTED_SUMMARY', {
      to: emailRecipientOf(user),
      about: `${contest.id}:${sportEvent.id}`,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
      refs: { contestId: contest.id },
      data: {
        userName: formatUserName(user),
        leagueName: league.name,
        contestName: contest.name,
        // A season contest's events are all in one sport league, the first event's.
        event: buildEmailEventHeader(this.deps.appBaseUrl, sportEvent, summary.sportLeagueName),
        format: buildEmailContestFormat(this.deps.appBaseUrl, contest.selectionType),
        ...(eventFormat !== null && { eventFormat }),
        rules: summary.rules,
        entryCount: submitted.length,
        hasEntry: entrants.has(user.id),
        leaderboardUrl,
      },
    }));
  }

  /**
   * F1, with F3 folded in: tells every active member who won, the final top 10 and where their
   * own entries finished, and congratulates the owners of the winning entries. F2 instead, to the
   * commissioners and the members with an entry, when the contest ended with no scores.
   */
  async contestSettled(contest: Contest): Promise<void> {
    const [league, final, members] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      this.deps.finalStandings.finalStandingsOf(contest),
      activeLeagueMembersWithRoles(this.deps, contest.leagueId),
    ]);
    if (!league) {
      this.skipped('email.contestSettled.skipped', contest, 'Skipped the final results email because its league is gone');
      return;
    }
    const leaderboardUrl = buildLeaderboardUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    const contestUrl = buildContestUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    const send = (user: User, outcome: ContestResultsOutcome) => this.deps.email.send('CONTEST_RESULTS', {
      to: emailRecipientOf(user),
      about: contest.id,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
      refs: { contestId: contest.id },
      data: { userName: formatUserName(user), leagueName: league.name, contestName: contest.name, outcome, leaderboardUrl, contestUrl },
    });

    if (final.entries.length === 0) {
      const [sportEvents, entrants] = await Promise.all([
        this.deps.sportEvents.findByIds(contest.sportEventIds),
        this.entrantsOf(contest),
      ]);
      const allCancelled = sportEvents.length > 0 && sportEvents.every((sportEvent) => sportEvent.status === SportEventStatus.CANCELLED);
      const outcome: ContestResultsOutcome = {
        kind: ContestResultsKind.NO_SCORES,
        cancelledEvents: allCancelled ? sportEvents.map((sportEvent) => sportEvent.name) : [],
      };
      const recipients = members
        .filter(({ user, role }) => role === LeagueRole.COMMISSIONER || entrants.has(user.id))
        .map(({ user }) => user);
      await this.sendEach('CONTEST_RESULTS', contest, league, recipients, (user) => send(user, outcome));
      return;
    }

    const format = final.scoringDefinitionId === null ? String : PARTICIPANT_SCORING_DEFINITIONS[final.scoringDefinitionId].format;
    const squadsByOwner = new Map<string, Set<string>>();
    for (const owner of await this.deps.squadMemberships.findBySquads([...new Set(final.entries.map((entry) => entry.squadId))])) {
      squadsByOwner.set(owner.userId, (squadsByOwner.get(owner.userId) ?? new Set<string>()).add(owner.squadId));
    }
    const leaders = leaderCount(final.entries);
    const winners = final.entries.filter((entry) => entry.position === 1);
    await this.sendEach('CONTEST_RESULTS', contest, league, members.map(({ user }) => user), (user) => {
      const squadIds = squadsByOwner.get(user.id) ?? new Set<string>();
      const lines = final.entries.map((entry): StandingsLine => ({
        place: entry.displayPosition,
        entryName: entry.entryName,
        squadName: entry.squadName,
        score: entry.score === null ? null : format(entry.score),
        movement: null,
        isYours: squadIds.has(entry.squadId),
      }));
      return send(user, {
        kind: ContestResultsKind.SCORED,
        winners: winners.map((entry) => ({ entryName: entry.entryName, squadName: entry.squadName })),
        top: lines.slice(0, leaders),
        yours: lines.slice(leaders).filter((line) => line.isYours),
        entryCount: lines.length,
        yourWins: winners
          .filter((entry) => squadIds.has(entry.squadId))
          .map((entry) => ({ entryName: entry.entryName, squadName: entry.squadName })),
      });
    });
  }

  /**
   * C6 and C7: tells each league with an open or live contest on the event, its commissioners and
   * the members with a submitted entry, one email per contest; a draft contest's commissioners
   * are not told. A postponed or moved event keeps an open contest's picks open until it starts;
   * a cancelled one counts for nothing. A cancellation that leaves a contest no event to play (its
   * only one, or the last not already cancelled) ends it, and its no-scores result (F2) says so
   * instead, which a member hears even with Contest updates turned off.
   */
  async sportEventChanged(sportEvent: SportEvent, change: SportEventChange): Promise<void> {
    const onEvent = await this.deps.contests.findBySportEvent(sportEvent.id, { statuses: TOLD_OF_EVENT_CHANGES });
    const contests = change.kind === ContestEventChangeKind.CANCELLED
      ? await this.stillToPlay(onEvent, sportEvent.id)
      : onEvent;
    // The about names the change and the start it leaves, and a move both starts, so a second
    // postponement or a move back to an earlier new date is told again.
    const about = change.kind === ContestEventChangeKind.RESCHEDULED
      ? `${sportEvent.id}:moved-${change.previousStart.toISOString()}-to-${sportEvent.startDate.toISOString()}`
      : `${sportEvent.id}:${change.kind.toLowerCase()}-${sportEvent.startDate.toISOString()}`;
    const now = this.deps.now?.() ?? new Date();
    if (contests.length === 0) return;
    const sportLeagueName = (await this.deps.sportLeagues.findById(sportEvent.sportLeagueId))?.name ?? '';
    const event = buildEmailEventHeader(this.deps.appBaseUrl, sportEvent, sportLeagueName);
    await Promise.all(contests.map(async (contest) => {
      const [league, members, entrants] = await Promise.all([
        // poolmaster-allow-query-in-loop: #1255
        this.deps.leagues.findById(contest.leagueId),
        activeLeagueMembersWithRoles(this.deps, contest.leagueId),
        this.entrantsOf(contest),
      ]);
      if (!league) {
        this.skipped('email.sportEventChanged.skipped', contest, 'Skipped the event changed email because its league is gone');
        return;
      }
      const picksOpen = areEventPicksOpen(contest, sportEvent, now);
      const contestChange: ContestEventChange = change.kind === ContestEventChangeKind.CANCELLED
        ? { kind: change.kind }
        : change.kind === ContestEventChangeKind.RESCHEDULED
          ? { kind: change.kind, previousStart: change.previousStart, newStart: sportEvent.startDate, picksOpen }
          : { kind: change.kind, picksOpen };
      const contestUrl = buildContestUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
      const recipients = members
        .filter(({ user, role }) => role === LeagueRole.COMMISSIONER || entrants.has(user.id))
        .map(({ user }) => user);
      await this.sendEach('CONTEST_EVENT_CHANGED', contest, league, recipients, (user) => this.deps.email.send('CONTEST_EVENT_CHANGED', {
        to: emailRecipientOf(user),
        about: `${contest.id}:${about}`,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
        refs: { contestId: contest.id },
        data: { userName: formatUserName(user), leagueName: league.name, contestName: contest.name, event, change: contestChange, contestUrl },
      }));
    }));
  }

  /** The contests with an event besides `sportEventId` that isn't cancelled, so they go on. */
  private async stillToPlay(contests: Contest[], sportEventId: string): Promise<Contest[]> {
    const others = [...new Set(contests.flatMap((contest) => contest.sportEventIds))].filter((id) => id !== sportEventId);
    const playable = new Set((await this.deps.sportEvents.findByIds(others))
      .filter((other) => other.status !== SportEventStatus.CANCELLED)
      .map((other) => other.id));
    return contests.filter((contest) => contest.sportEventIds.some((id) => playable.has(id)));
  }

  /** The people owning an entry submitted for any of the contest's events, as E1 counts entrants. */
  private async entrantsOf(contest: Contest): Promise<Set<string>> {
    const submitted = (await this.deps.entries.findByContest(contest.id)).filter((entry) => contest.sportEventIds
      .some((sportEventId) => contestEntryEventStatus(entry, sportEventId) === ContestEntryStatus.SUBMITTED));
    return new Set((await this.deps.squadMemberships.findBySquads([...new Set(submitted.map((entry) => entry.squadId))]))
      .map((owner) => owner.userId));
  }

  /**
   * Queues one email per recipient, all at once rather than one after another, so a large league
   * doesn't hold the request that opened the contest. A failure for one person is logged and the
   * rest still go: the contest has already moved, and the email must not undo it.
   */
  private async sendEach(
    templateKey: EmailTemplateKey,
    contest: Contest,
    league: League,
    recipients: User[],
    send: (user: User) => Promise<unknown>,
  ): Promise<void> {
    await Promise.all(recipients.map(async (user) => {
      try {
        await send(user);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.contestNotice.failed',
          data: { templateKey, contestId: contest.id, leagueId: league.id, userId: user.id, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue a contest email');
      }
    }));
  }

  private skipped(action: string, contest: Contest, message: string): void {
    this.deps.logger?.warn({ action, data: { contestId: contest.id, leagueId: contest.leagueId } }, message);
  }
}
