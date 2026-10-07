/**
 * DashboardService — aggregates data for the commissioner dashboard.
 *
 * Composes league, contest, member and invitation data
 * into a single dashboard response.
 */

import type {
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
  ) {}

  /** Builds the full commissioner dashboard for a league. */
  async getDashboard(leagueId: string): Promise<CommissionerDashboard | null> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      return null;
    }
    const [members, contests, invitations] = await Promise.all([
      this.membershipRepo.findByLeague(leagueId),
      this.contestRepo.findByLeague(leagueId),
      this.invitationRepo.findByLeague(leagueId),
    ]);
    const pendingInvites = invitations.filter((i) => i.status === InvitationStatus.PENDING).length;
    const recentMemberActivity = buildRecentActivity(members);
    const upcomingEvents = buildUpcomingEvents(contests);
    return {
      league,
      contests,
      memberCount: members.length,
      pendingInvites,
      recentMemberActivity,
      upcomingEvents,
    };
  }
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
