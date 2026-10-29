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
import type { LeagueMembershipRepository, LeagueRepository, SquadMembershipRepository, SquadRepository } from '@poolmaster/shared/db';
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
import { activeLeagueMembersWithRoles, type LeagueMemberDeps } from './league-members';
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
  memberships: Pick<LeagueMembershipRepository, 'findByLeague' | 'findActiveJoinedSince' | 'countActiveByLeagues'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  /** Each joiner's squad, by name. */
  squadMemberships: Pick<SquadMembershipRepository, 'findByLeagueAndUser'>;
  squads: Pick<SquadRepository, 'findById'>;
  email: Pick<EmailService, 'send' | 'leaguesRecorded'>;
  /** The next day's email goes at the overnight hour every scheduled league email uses. */
  readConfig: () => Pick<EmailConfig, 'weeklyDigestHour'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
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
      const today = joinsOn(await this.deps.memberships.findByLeague(league.id), easternDateOf(membership.joinedAt));
      const position = today.findIndex((join) => join.id === membership.id);
      if (position < 0 || position >= AT_ONCE_PER_DAY) return;
      await this.send(league, MemberJoinedTiming.AT_ONCE, [membership], atOnceAbout(membership));
    } catch (error) {
      this.deps.logger?.error({
        action: 'email.memberJoined.failed',
        data: { leagueId: membership.leagueId, membershipId: membership.id, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue the new member joined email');
    }
  }

  /**
   * Yesterday's joins that weren't told at once, for each league that had them and hasn't been
   * told, once the overnight hour has come in US Eastern time. The outbox is the record of who was
   * told at once, so someone leaving later that day, or a join committing after a later one, never
   * drops or repeats anyone.
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
    const told = await this.deps.email.leaguesRecorded('LEAGUE_MEMBER_JOINED', yesterday);
    for (const { leagueId, joins } of busy) {
      if (told.has(leagueId)) continue;
      try {
        const untold: LeagueMembership[] = [];
        for (const join of joins) {
          if (!(await this.deps.email.leaguesRecorded('LEAGUE_MEMBER_JOINED', atOnceAbout(join))).has(leagueId)) untold.push(join);
        }
        if (untold.length === 0) continue;
        // poolmaster-allow-query-in-loop: #1255
        const league = await this.deps.leagues.findById(leagueId);
        if (!league?.isActive) continue;
        await this.send(league, MemberJoinedTiming.NEXT_DAY, untold, `${yesterday}:${leagueId}`);
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.memberJoined.nextDayFailed',
          data: { leagueId, day: yesterday, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue the next day\'s new member joined email');
      }
    }
  }

  private async send(league: League, timing: MemberJoinedTiming, joins: LeagueMembership[], about: string): Promise<void> {
    const [members, counts] = await Promise.all([
      activeLeagueMembersWithRoles(this.deps, league.id),
      this.deps.memberships.countActiveByLeagues([league.id]),
    ]);
    const names = new Map(members.map(({ user }) => [user.id, formatUserName(user)]));
    const joined = await Promise.all(joins.map(async (join): Promise<JoinedMember> => ({
      name: names.get(join.userId) ?? '',
      squadName: await this.squadNameOf(league.id, join.userId),
    })));
    const membersUrl = buildLeagueMembersAdminUrl(this.deps.appBaseUrl, league.leagueCode);
    for (const { user } of members.filter(({ role }) => role === LeagueRole.COMMISSIONER)) {
      await this.deps.email.send('LEAGUE_MEMBER_JOINED', {
        to: emailRecipientOf(user),
        about,
        league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
        data: {
          userName: formatUserName(user),
          leagueName: league.name,
          timing,
          joined,
          memberCount: counts.get(league.id) ?? 0,
          membersUrl,
        },
      });
    }
  }

  private async squadNameOf(leagueId: string, userId: string): Promise<string | null> {
    const squadMembership = await this.deps.squadMemberships.findByLeagueAndUser(leagueId, userId);
    return squadMembership ? (await this.deps.squads.findById(squadMembership.squadId))?.name ?? null : null;
  }
}
