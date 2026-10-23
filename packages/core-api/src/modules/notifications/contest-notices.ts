/**
 * The emails a contest's own milestones send (#845): "New contest open" (catalog row D1) when the
 * commissioner opens it, "Contest is live, good luck" (E1) when it goes live at its cutoff, and
 * "Final results" (F1, with F3 for its winners) when it settles. All three go to every active
 * member of the contest's league, and to no other league. A contest that ends with no scores
 * (F2) tells only its commissioners and the members with an entry.
 *
 * Each email is queued once per person: its outbox idempotency key is the contest (and for E1
 * the event) and the person, so a retried call finds it recorded and skips.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestEntryRepository, ContestRepository, LeagueRepository, SquadMembershipRepository } from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
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
import type { ContestService } from '../contests/service';
import {
  ContestResultsKind,
  buildContestUrl,
  buildLeaderboardUrl,
  formatUserName,
  type ContestEmailEvent,
  type ContestResultsOutcome,
  type EmailService,
  type StandingsLine,
} from '../email';
import { describeEventFormat, summarizeContest, type ContestSummaryDeps } from './contest-summary';
import { activeLeagueMembers, activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';
import { leaderCount } from './live-standings';

export interface ContestNoticeDeps extends ContestSummaryDeps, LeagueMemberDeps {
  contests: Pick<ContestRepository, 'findById'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  entries: Pick<ContestEntryRepository, 'findByContest'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  /** A settled contest's frozen places, for its final results. */
  finalStandings: Pick<ContestService, 'finalStandingsOf'>;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** The contest-opened seam ContestManagementService calls. */
export interface ContestOpenedNotice {
  contestOpened(contestId: string): Promise<void>;
}

/** The contest-started seam EventLifecycleService calls. */
export interface ContestStartedNotice {
  contestStarted(contest: Contest, sportEvent: SportEvent): Promise<void>;
}

function toEmailEvent(sportEvent: SportEvent): ContestEmailEvent {
  return { name: sportEvent.name, startsAt: sportEvent.startDate, venue: sportEvent.venue };
}

/** The contest-settled seam ContestSettlementService calls. */
export interface ContestSettledNotice {
  contestSettled(contest: Contest): Promise<void>;
}

export class ContestNotices implements ContestOpenedNotice, ContestStartedNotice, ContestSettledNotice {
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
      to: { email: user.email, userId: user.id, timeZone: user.timezone },
      about: contest.id,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
      refs: { contestId: contest.id },
      data: {
        userName: formatUserName(user),
        leagueName: league.name,
        contestName: contest.name,
        events: summary.sportEvents.map(toEmailEvent),
        rules: summary.rules,
        entriesPerMember: summary.entriesPerMember,
        closesAt: summary.closesAt,
        contestUrl,
      },
    }));
  }

  /**
   * E1: wishes every active member good luck as the contest goes live for `sportEvent`, with the
   * event, the rules and how many entries are in. No entry list: the leaderboard has it.
   */
  async contestStarted(contest: Contest, sportEvent: SportEvent): Promise<void> {
    const [league, summary, entries] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      summarizeContest(this.deps, contest),
      this.deps.entries.findByContest(contest.id),
    ]);
    if (!league || !summary) {
      this.skipped('email.contestStarted.skipped', contest, 'Skipped the contest is live email because its league, rules or events are gone');
      return;
    }
    const submitted = entries.filter((entry) => contestEntryEventStatus(entry, sportEvent.id) === ContestEntryStatus.SUBMITTED);
    const entrants = new Set((await this.deps.squadMemberships.findBySquads([...new Set(submitted.map((entry) => entry.squadId))]))
      .map((owner) => owner.userId));
    const eventFormat = await describeEventFormat(this.deps, sportEvent);
    const leaderboardUrl = buildLeaderboardUrl(this.deps.appBaseUrl, league.leagueCode, contest.id);
    await this.sendEach('CONTEST_STARTED_SUMMARY', contest, league, await activeLeagueMembers(this.deps, league.id), (user) => this.deps.email.send('CONTEST_STARTED_SUMMARY', {
      to: { email: user.email, userId: user.id, timeZone: user.timezone },
      about: `${contest.id}:${sportEvent.id}`,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
      refs: { contestId: contest.id },
      data: {
        userName: formatUserName(user),
        leagueName: league.name,
        contestName: contest.name,
        event: toEmailEvent(sportEvent),
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
      to: { email: user.email, userId: user.id, timeZone: user.timezone },
      about: contest.id,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
      refs: { contestId: contest.id },
      data: { userName: formatUserName(user), leagueName: league.name, contestName: contest.name, outcome, leaderboardUrl, contestUrl },
    });

    if (final.entries.length === 0) {
      const [sportEvents, entries] = await Promise.all([
        this.deps.sportEvents.findByIds(contest.sportEventIds),
        this.deps.entries.findByContest(contest.id),
      ]);
      const entrants = new Set((await this.deps.squadMemberships.findBySquads([...new Set(entries.map((entry) => entry.squadId))]))
        .map((owner) => owner.userId));
      const outcome: ContestResultsOutcome = {
        kind: ContestResultsKind.NO_SCORES,
        allEventsCancelled: sportEvents.length > 0 && sportEvents.every((sportEvent) => sportEvent.status === SportEventStatus.CANCELLED),
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
