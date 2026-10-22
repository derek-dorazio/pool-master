/**
 * The emails a contest's own milestones send (#845): "New contest open" (catalog row D1) when the
 * commissioner opens it, and "Contest is live, good luck" (E1) when it goes live at its cutoff.
 * Both go to every active member of the contest's league, and to no other league.
 *
 * Each email is queued once per person: its outbox idempotency key is the contest (and for E1
 * the event) and the person, so a retried call finds it recorded and skips.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestEntryRepository, ContestRepository, LeagueRepository, SquadMembershipRepository } from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  contestEntryEventStatus,
  type Contest,
  type EmailTemplateKey,
  type League,
  type SportEvent,
  type User,
} from '@poolmaster/shared/domain';
import { buildContestUrl, buildLeaderboardUrl, formatUserName, type ContestEmailEvent, type EmailService } from '../email';
import { describeEventFormat, summarizeContest, type ContestSummaryDeps } from './contest-summary';
import { activeLeagueMembers, type LeagueMemberDeps } from './league-members';

export interface ContestNoticeDeps extends ContestSummaryDeps, LeagueMemberDeps {
  contests: Pick<ContestRepository, 'findById'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  entries: Pick<ContestEntryRepository, 'findByContest'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
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

export class ContestNotices implements ContestOpenedNotice, ContestStartedNotice {
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
