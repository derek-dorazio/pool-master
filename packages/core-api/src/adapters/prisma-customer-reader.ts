/**
 * Prisma adapter for the root admin's Customers page (#1882): every league's facts in four
 * queries and every user's in two, however many leagues, users and memberships there are.
 */
import type { PrismaClient } from '@prisma/client';
import type { CustomerLeagueFacts, CustomerReader } from '@poolmaster/shared/db';
import { ACTIVE_LEAGUE_CONTEST_STATUSES, LeagueMembershipStatus, LeagueRole, type CustomerUser, type CustomerUserLeague } from '@poolmaster/shared/domain';

export class PrismaCustomerReader implements CustomerReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readLeagueFacts(): Promise<CustomerLeagueFacts> {
    const [leagues, commissioners, memberGroups, contestGroups] = await Promise.all([
      this.prisma.league.findMany({
        select: { id: true, leagueCode: true, name: true, isActive: true, plan: true, planRenewsAt: true, createdAt: true },
        orderBy: [{ name: 'asc' }, { leagueCode: 'asc' }],
      }),
      this.prisma.leagueMembership.findMany({
        where: { role: LeagueRole.COMMISSIONER, status: LeagueMembershipStatus.ACTIVE },
        select: { leagueId: true, userId: true, joinedAt: true, user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.leagueMembership.groupBy({
        by: ['leagueId'],
        where: { status: LeagueMembershipStatus.ACTIVE },
        _count: { _all: true },
      }),
      this.prisma.contest.groupBy({
        by: ['leagueId'],
        where: { status: { in: [...ACTIVE_LEAGUE_CONTEST_STATUSES] } },
        _count: { _all: true },
      }),
    ]);
    return {
      leagues,
      commissioners: commissioners.map(({ user, ...commissioner }) => ({ ...commissioner, firstName: user.firstName, lastName: user.lastName })),
      memberCounts: new Map(memberGroups.map((group) => [group.leagueId, group._count._all])),
      activeContestCounts: new Map(contestGroups.map((group) => [group.leagueId, group._count._all])),
    };
  }

  async readUsers(): Promise<CustomerUser[]> {
    const [users, memberships] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true, email: true, username: true, firstName: true, lastName: true,
          isRootAdmin: true, isActive: true, createdAt: true, lastSignInAt: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
      }),
      this.prisma.leagueMembership.findMany({
        where: { status: LeagueMembershipStatus.ACTIVE },
        select: { userId: true, league: { select: { id: true, leagueCode: true, name: true } } },
        orderBy: { league: { name: 'asc' } },
      }),
    ]);
    const leaguesByUser = new Map<string, CustomerUserLeague[]>();
    for (const { userId, league } of memberships) {
      const leagues = leaguesByUser.get(userId);
      if (leagues) leagues.push(league);
      else leaguesByUser.set(userId, [league]);
    }
    return users.map(({ createdAt, ...user }) => ({ ...user, joinedAt: createdAt, leagues: leaguesByUser.get(user.id) ?? [] }));
  }
}
