/**
 * "New member joined" (#903 B6): a league's commissioners hear when someone accepts an invitation.
 *
 * Someone joins by accepting a league invitation or by being added as a squad's co-owner. The first
 * three people to join a league on a day (US Eastern) are each told at once. A busy day's rest are
 * told together the next day, in one email listing everyone not told at once, so a league filling
 * up from a shared invite link doesn't flood its commissioners. The lifecycle scheduler's
 * "notifications due" step calls `queueDue` on every sweep; the next day's email goes once the
 * overnight hour (EMAIL_CONFIG.weeklyDigestHour, 3am Eastern by default) has come, once per league,
 * its outbox idempotency key being the day and the league and the person.
 *
 * Joins are the league's active MEMBER memberships by when they joined: a commissioner (the league's
 * creator) is not a join, and someone who left again the same day no longer counts toward the
 * three. The outbox records who was told at once, and the next day's email lists the rest.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeagueMembershipRepository, LeagueRepository, SquadMembershipRepository } from '@poolmaster/shared/db';
import { LeagueRole, type League, type LeagueMembership } from '@poolmaster/shared/domain';
import {
  emailRecipientOf,
  buildLeagueMembersAdminUrl,
  formatUserName,
  MemberJoinedTiming,
  type EmailService,
  type JoinedMember,
} from '../email';
import type { EmailConfig } from '@poolmaster/shared/dto';
import type { DueNotifications } from '../events/event-lifecycle-scheduler';
import { activeLeagueMembersByLeague, leagueMembersOf, type LeagueMemberDeps, type LeagueMemberWithRole } from './league-members';
import { easternDateOf, easternDayOf } from './overnight-day';

/** The first this many joins of a league's day are told at once; the rest wait for the next day. */
const AT_ONCE_PER_DAY = 3;
/** Far enough back to cover all of yesterday in US Eastern time. */
const LOOKBACK_MS = 72 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** What the routes that add someone to a league are given: the one instance the scheduler sweeps too. */
export interface MemberJoinedModuleOptions {
  memberJoined: Pick<MemberJoinedNotices, 'tellJoined'>;
}

export interface MemberJoinedNoticeDeps extends LeagueMemberDeps {
  memberships: Pick<LeagueMembershipRepository, 'findByLeagues' | 'findActiveJoinedSince' | 'countActiveByLeagues'>;
  leagues: Pick<LeagueRepository, 'findById' | 'findByIds'>;
  /** Each joiner's squad, by name. */
  squadMemberships: Pick<SquadMembershipRepository, 'findByLeagueUsersWithSquadName'>;
  email: Pick<EmailService, 'send' | 'leaguesRecordedAbout'>;
  /** The next day's email goes at the overnight hour every scheduled league email uses. */
  readConfig: () => Pick<EmailConfig, 'weeklyDigestHour'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** One email due to a league's commissioners: who joined, and when they are told. */
interface JoinNotice {
  league: League;
  timing: MemberJoinedTiming;
  joins: LeagueMembership[];
  about: string;
  /** What the sweep asks "already told?" about (#1169): the join for an at-once email, the day for the next day's. */
  noticeAbout: string;
}

/** The at-once email's outbox subject for one join: the membership and when it joined, as a rejoin is a new join. */
function atOnceAbout(membership: LeagueMembership): string {
  return `${membership.id}:${String(membership.joinedAt.getTime())}`;
}

/** The day before `date` (YYYY-MM-DD), as YYYY-MM-DD. */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** The memberships among `memberships` that count as joins on `date`, in the order they joined. */
function joinsOn(memberships: LeagueMembership[], date: string): LeagueMembership[] {
  return memberships
    .filter((membership) => membership.role === LeagueRole.MEMBER && easternDateOf(membership.joinedAt) === date)
    .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime() || left.id.localeCompare(right.id));
}

export class MemberJoinedNotices implements DueNotifications {
  constructor(private readonly deps: MemberJoinedNoticeDeps) {}

  /**
   * Tells the league's commissioners of `membership`'s join at once, if it is one of the day's
   * first three. The member has already joined, so a failure is logged rather than thrown.
   */
  async tellJoined(membership: LeagueMembership): Promise<void> {
    try {
      const league = await this.deps.leagues.findById(membership.leagueId);
      if (!league?.isActive) return;
      // The league's memberships say whether this join is one of the day's first three, and then
      // name the members the email goes to, so they are read once (#1355).
      const memberships = await this.deps.memberships.findByLeagues([league.id]);
      const today = joinsOn(memberships, easternDateOf(membership.joinedAt));
      const position = today.findIndex((join) => join.id === membership.id);
      if (position < 0 || position >= AT_ONCE_PER_DAY) return;
      const members = leagueMembersOf([league.id], memberships, await this.deps.users.findActiveByLeagues([league.id]));
      await this.sendEach(
        [{ league, timing: MemberJoinedTiming.AT_ONCE, joins: [membership], about: atOnceAbout(membership), noticeAbout: atOnceAbout(membership) }],
        (_notice, error) => this.failedAtOnce(membership, error),
        members,
      );
    } catch (error) {
      this.failedAtOnce(membership, error);
    }
  }

  private failedAtOnce(membership: LeagueMembership, error: unknown): void {
    this.deps.logger?.error({
      action: 'email.memberJoined.failed',
      data: { leagueId: membership.leagueId, membershipId: membership.id, error: error instanceof Error ? error.message : String(error) },
    }, 'Failed to queue the new member joined email');
  }

  /**
   * Yesterday's joins that weren't told at once, for each league that had them and hasn't been
   * told, once the overnight hour has come in US Eastern time. The outbox is the record of who was
   * told at once, so someone leaving later that day, or a join committing after a later one, never
   * drops or repeats anyone. Who was told, the day's email and each join's own, is one read for the
   * sweep (#1169), and a league whose joins were all told at once costs nothing more.
   */
  async queueDue(now: Date): Promise<void> {
    const today = easternDayOf(now, this.deps.readConfig().weeklyDigestHour);
    if (today === null) return;
    const yesterday = dayBefore(today);
    const byLeague = new Map<string, LeagueMembership[]>();
    for (const membership of await this.deps.memberships.findActiveJoinedSince(new Date(now.getTime() - LOOKBACK_MS))) {
      byLeague.set(membership.leagueId, [...(byLeague.get(membership.leagueId) ?? []), membership]);
    }
    const busy = [...byLeague]
      .map(([leagueId, memberships]) => ({ leagueId, joins: joinsOn(memberships, yesterday) }))
      .filter(({ joins }) => joins.length > 0);
    if (busy.length === 0) return;
    const told = await this.deps.email.leaguesRecordedAbout('LEAGUE_MEMBER_JOINED', [
      yesterday,
      ...busy.flatMap(({ joins }) => joins.map(atOnceAbout)),
    ]);
    const toldYesterday = told.get(yesterday);
    const due = busy
      .filter(({ leagueId }) => !toldYesterday?.has(leagueId))
      .map(({ leagueId, joins }) => ({ leagueId, untold: joins.filter((join) => !told.get(atOnceAbout(join))?.has(leagueId)) }))
      .filter(({ untold }) => untold.length > 0);
    if (due.length === 0) return;
    // Every due league is read once for the sweep, not once per league (#1255).
    const leagueById = new Map((await this.deps.leagues.findByIds(due.map(({ leagueId }) => leagueId))).map((league) => [league.id, league]));
    const notices = due.flatMap(({ leagueId, untold }): JoinNotice[] => {
      const league = leagueById.get(leagueId);
      return league?.isActive
        ? [{ league, timing: MemberJoinedTiming.NEXT_DAY, joins: untold, about: `${yesterday}:${leagueId}`, noticeAbout: yesterday }]
        : [];
    });
    if (notices.length === 0) return;
    const members = await activeLeagueMembersByLeague(this.deps, notices.map(({ league }) => league.id));
    await this.sendEach(notices, ({ league }, error) => {
      this.deps.logger?.error({
        action: 'email.memberJoined.nextDayFailed',
        data: { leagueId: league.id, day: yesterday, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue the next day\'s new member joined email');
    }, members);
  }

  /**
   * Each notice's email to its league's commissioners, given each league's members. Member counts
   * and joiners' squads are read once for all of them, not once per league or joiner (#1336); a
   * notice whose email fails goes to `failed`, and the rest still go.
   */
  private async sendEach(
    notices: readonly JoinNotice[],
    failed: (notice: JoinNotice, error: unknown) => void,
    membersByLeague: ReadonlyMap<string, LeagueMemberWithRole[]>,
  ): Promise<void> {
    const leagueIds = notices.map(({ league }) => league.id);
    const [counts, squads] = await Promise.all([
      this.deps.memberships.countActiveByLeagues([...new Set(leagueIds)]),
      this.deps.squadMemberships.findByLeagueUsersWithSquadName(notices.flatMap(({ league, joins }) =>
        joins.map((join) => ({ leagueId: league.id, userId: join.userId })))),
    ]);
    const squadNames = new Map(squads.map((squad) => [`${squad.leagueId}:${squad.userId}`, squad.squadName]));
    for (const notice of notices) {
      try {
        await this.send(notice, membersByLeague.get(notice.league.id) ?? [], counts.get(notice.league.id) ?? 0, squadNames);
      } catch (error) {
        failed(notice, error);
      }
    }
  }

  private async send(
    { league, timing, joins, about, noticeAbout }: JoinNotice,
    members: readonly LeagueMemberWithRole[],
    memberCount: number,
    squadNames: ReadonlyMap<string, string>,
  ): Promise<void> {
    const names = new Map(members.map(({ user }) => [user.id, formatUserName(user)]));
    const joined = joins.map((join): JoinedMember => ({
      name: names.get(join.userId) ?? '',
      squadName: squadNames.get(`${league.id}:${join.userId}`) ?? null,
    }));
    const membersUrl = buildLeagueMembersAdminUrl(this.deps.appBaseUrl, league.leagueCode);
    for (const { user } of members.filter(({ role }) => role === LeagueRole.COMMISSIONER)) {
      await this.deps.email.send('LEAGUE_MEMBER_JOINED', {
        to: emailRecipientOf(user),
        about,
        noticeAbout,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
        data: {
          userName: formatUserName(user),
          leagueName: league.name,
          timing,
          joined,
          memberCount,
          membersUrl,
        },
      });
    }
  }
}
