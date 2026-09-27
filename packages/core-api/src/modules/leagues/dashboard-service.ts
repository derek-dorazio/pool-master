/**
 * DashboardService — aggregates data for the commissioner dashboard.
 *
 * Composes league, contest, member, invitation, and action item data
 * into a single dashboard response.
 */

import type {
  ActionItemRepository,
  ContestRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import type {
  CommissionerDashboard,
  Contest,
  MemberActivityEvent,
  UpcomingEvent,
} from '@poolmaster/shared/domain';
import { InvitationStatus } from '@poolmaster/shared/domain';

export class DashboardService {
  constructor(
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly contestRepo: ContestRepository,
    private readonly invitationRepo: LeagueInvitationRepository,
    private readonly actionItemRepo: ActionItemRepository,
  ) {}

  /** Builds the full commissioner dashboard for a league. */
  async getDashboard(leagueId: string): Promise<CommissionerDashboard | null> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      return null;
    }
    const [members, contests, invitations, actionItems] = await Promise.all([
      this.membershipRepo.findByLeague(leagueId),
      this.contestRepo.findByLeague(leagueId),
      this.invitationRepo.findByLeague(leagueId),
      this.actionItemRepo.findUnresolved(leagueId),
    ]);
    const pendingInvites = invitations.filter((i) => i.status === InvitationStatus.PENDING).length;
    const recentMemberActivity = buildRecentActivity(members);
    const upcomingEvents = buildUpcomingEvents(contests);
    return {
      league,
      actionItems,
      contests,
      memberCount: members.length,
      pendingInvites,
      recentMemberActivity,
      upcomingEvents,
    };
  }

  /** Creates a new action item for a league. */
  /*
   * #202 — `createActionItem` and `resolveActionItem` are gone.
   *
   * Nothing in the codebase ever created a `CommissionerActionItem` outside a unit test, so the
   * resolve route could never have anything to resolve, and the create half had no caller
   * either. `getDashboard` still reads unresolved action items, which means that field is
   * permanently empty until action items are actually designed — recorded on the dashboard
   * follow-up rather than papered over here.
   */
}

/** Builds recent member activity from membership join dates. */
function buildRecentActivity(
  members: { userId: string; joinedAt: Date }[],
): MemberActivityEvent[] {
  return [...members]
    .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
    .slice(0, 10)
    .map((m) => ({
      userId: m.userId,
      firstName: undefined,
      lastName: undefined,
      action: 'joined the league',
      timestamp: m.joinedAt,
    }));
}

/** Extracts upcoming events from contests with future dates. */
function buildUpcomingEvents(contests: Contest[]): UpcomingEvent[] {
  const now = new Date();
  const events: UpcomingEvent[] = [];
  for (const contest of contests) {
    if (contest.startsAt && contest.startsAt > now) {
      events.push({
        contestId: contest.id,
        title: `${contest.name} starts`,
        date: contest.startsAt,
        eventType: 'CONTEST_START',
      });
    }
    if (contest.lockAt && contest.lockAt > now) {
      events.push({
        contestId: contest.id,
        title: `${contest.name} locks`,
        date: contest.lockAt,
        eventType: 'LOCK_TIME',
      });
    }
    if (contest.endsAt && contest.endsAt > now) {
      events.push({
        contestId: contest.id,
        title: `${contest.name} ends`,
        date: contest.endsAt,
        eventType: 'CONTEST_END',
      });
    }
  }
  return events.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 20);
}
