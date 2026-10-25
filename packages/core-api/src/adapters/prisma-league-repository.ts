/**
 * Prisma adapter for LeagueRepository port.
 */

import type { League as PrismaLeague, Prisma, PrismaClient } from '@prisma/client';
import type { LeaguePlanChange, LeagueRepository, LeagueSearchFilters } from '@poolmaster/shared/db';
import type { League, LeagueIconKey, LeaguePlan } from '@poolmaster/shared/domain';
import { LeagueMembershipStatus as MembershipStatus, LeaguePlanChangeReason } from '@poolmaster/shared/domain';

export class PrismaLeagueRepository implements LeagueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<League | null> {
    const row = await this.prisma.league.findFirst({
      where: { id },
    });
    return row ? mapToLeague(row) : null;
  }

  async findByCode(code: string): Promise<League | null> {
    const row = await this.prisma.league.findFirst({
      where: { leagueCode: code },
    });
    return row ? mapToLeague(row) : null;
  }

  async findAll(filters: LeagueSearchFilters = {}): Promise<League[]> {
    const search = filters.search?.trim();
    const where: Prisma.LeagueWhereInput = {
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(typeof filters.isActive === 'boolean' ? { isActive: filters.isActive } : {}),
    };
    const rows = await this.prisma.league.findMany({
      where,
      // updatedAt first so the admin management surface shows recently-touched leagues at
      // the top, which is the ordering it already relied on.
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(mapToLeague);
  }

  async findByUser(userId: string): Promise<League[]> {
    // One join, replacing the service-level findByUser's membership fetch plus a findById
    // per membership (#202). A join cannot produce the orphaned-membership case that
    // version had to log and skip, because it only returns leagues that exist.
    // ACTIVE only: a removed member keeps an INACTIVE row (so a re-invitation can restore it),
    // and that row must not keep the league in their list.
    const rows = await this.prisma.league.findMany({
      where: { memberships: { some: { userId, status: MembershipStatus.ACTIVE } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapToLeague);
  }

  async create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt' | 'cupPointsScale' | 'cupCustomPoints' | 'hallOfLameVisible' | 'plan' | 'planRenewsAt' | 'mutedSportLeagueIds' | 'eventEmailDelivery'>): Promise<League> {
    const row = await this.prisma.league.create({
      data: {
        leagueCode: league.leagueCode,
        name: league.name,
        description: league.description,
        isActive: league.isActive,
        iconKey: league.iconKey,
        cupName: league.cupName,
      },
    });
    return mapToLeague(row);
  }

  async changePlan(
    leagueId: string,
    change: { fromPlan: LeaguePlan; toPlan: LeaguePlan; changedById: string },
  ): Promise<League | null> {
    return this.prisma.$transaction(async (tx) => {
      // Only a league still on the from-plan moves, so the log never records a stale from-plan.
      const moved = await tx.league.updateMany({
        where: { id: leagueId, plan: change.fromPlan },
        data: { plan: change.toPlan },
      });
      if (moved.count === 0) {
        return null;
      }
      await tx.leaguePlanChange.create({
        data: { leagueId, fromPlan: change.fromPlan, toPlan: change.toPlan, changeReason: LeaguePlanChangeReason.CHOSEN, changedById: change.changedById },
      });
      return mapToLeague(await tx.league.findUniqueOrThrow({ where: { id: leagueId } }));
    });
  }

  async findLastPlanChange(leagueId: string): Promise<LeaguePlanChange | null> {
    const row = await this.prisma.leaguePlanChange.findFirst({ where: { leagueId }, orderBy: { changedAt: 'desc' } });
    return row ? { fromPlan: row.fromPlan, toPlan: row.toPlan, changeReason: row.changeReason, changedById: row.changedById, changedAt: row.changedAt } : null;
  }

  async extendPlanRenewal(
    leagueId: string,
    change: { renewsAt: Date; changedById: string; restorePlan?: { fromPlan: LeaguePlan; toPlan: LeaguePlan } },
  ): Promise<League | null> {
    // The league row is locked first, so a concurrent move waits rather than being logged with a
    // stale from-date. (The stored date has microseconds a JS Date lacks, so it can't be matched by value.)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "leagues" WHERE id = ${leagueId}::uuid FOR UPDATE`;
      const league = await tx.league.findUnique({ where: { id: leagueId } });
      if (!league) {
        return null;
      }
      if (league.planRenewsAt >= change.renewsAt) {
        return mapToLeague(league);
      }
      // The plan moves back only if the league is still where the end of its gift left it.
      const restored = change.restorePlan !== undefined && league.plan === change.restorePlan.fromPlan
        ? change.restorePlan.toPlan
        : null;
      const moved = await tx.league.update({
        where: { id: leagueId },
        data: { planRenewsAt: change.renewsAt, ...(restored === null ? {} : { plan: restored }) },
      });
      await tx.leaguePlanRenewalChange.create({
        data: { leagueId, fromRenewsAt: league.planRenewsAt, toRenewsAt: change.renewsAt, changedById: change.changedById },
      });
      if (restored !== null) {
        await tx.leaguePlanChange.create({
          data: { leagueId, fromPlan: league.plan, toPlan: restored, changeReason: LeaguePlanChangeReason.GIFT_RESTORED, changedById: change.changedById },
        });
      }
      return mapToLeague(moved);
    });
  }

  async extendRunningPlanRenewals(change: { renewsAt: Date; now: Date; changedById: string }): Promise<number> {
    // The running leagues' rows are locked first, in id order, so a concurrent move waits rather
    // than being logged with a stale from-date; the lock re-checks each row's date once it is free.
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "leagues"
        WHERE "plan_renews_at" > ${change.now} AND "plan_renews_at" < ${change.renewsAt}
        ORDER BY id
        FOR UPDATE`;
      if (locked.length === 0) {
        return 0;
      }
      const leagues = await tx.league.findMany({
        where: { id: { in: locked.map((league) => league.id) } },
        select: { id: true, planRenewsAt: true },
      });
      await tx.league.updateMany({
        where: { id: { in: leagues.map((league) => league.id) } },
        data: { planRenewsAt: change.renewsAt },
      });
      await tx.leaguePlanRenewalChange.createMany({
        data: leagues.map((league) => ({
          leagueId: league.id,
          fromRenewsAt: league.planRenewsAt,
          toRenewsAt: change.renewsAt,
          changedById: change.changedById,
        })),
      });
      return leagues.length;
    });
  }

  async findPlansEndingBetween(after: Date, through: Date): Promise<League[]> {
    const rows = await this.prisma.league.findMany({
      where: { isActive: true, plan: { not: 'FREE' }, planRenewsAt: { gt: after, lte: through } },
      orderBy: [{ planRenewsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(mapToLeague);
  }

  async moveEndedPlansToFree(now: Date): Promise<Array<{ leagueId: string; fromPlan: LeaguePlan }>> {
    // The ended leagues' rows are locked first, in id order, so a concurrent plan change or
    // extension waits; the lock re-checks each row, so one extended meanwhile is left alone.
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.$queryRaw<Array<{ id: string; plan: LeaguePlan }>>`
        SELECT id, plan FROM "leagues"
        WHERE "plan_renews_at" <= ${now} AND plan <> 'FREE'
        ORDER BY id
        FOR UPDATE`;
      if (ended.length === 0) {
        return [];
      }
      await tx.league.updateMany({ where: { id: { in: ended.map((league) => league.id) } }, data: { plan: 'FREE' } });
      await tx.leaguePlanChange.createMany({
        // Stamped with the sweep's own time, the one the leagues were picked by.
        data: ended.map((league) => ({ leagueId: league.id, fromPlan: league.plan, toPlan: 'FREE' as const, changeReason: LeaguePlanChangeReason.PREVIEW_ENDED, changedById: null, changedAt: now })),
      });
      return ended.map((league) => ({ leagueId: league.id, fromPlan: league.plan }));
    });
  }

  async update(id: string, updates: Partial<League>): Promise<League> {
    const row = await this.prisma.league.update({
      where: { id },
      data: {
        ...(updates.leagueCode !== undefined && { leagueCode: updates.leagueCode }),
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.iconKey !== undefined && { iconKey: updates.iconKey }),
        ...(updates.cupName !== undefined && { cupName: updates.cupName }),
        ...(updates.cupPointsScale !== undefined && { cupPointsScale: updates.cupPointsScale }),
        ...(updates.cupCustomPoints !== undefined && { cupCustomPoints: updates.cupCustomPoints }),
        ...(updates.hallOfLameVisible !== undefined && { hallOfLameVisible: updates.hallOfLameVisible }),
        ...(updates.mutedSportLeagueIds !== undefined && { mutedSportLeagueIds: updates.mutedSportLeagueIds }),
        ...(updates.eventEmailDelivery !== undefined && { eventEmailDelivery: updates.eventEmailDelivery }),
      },
    });
    return mapToLeague(row);
  }

}

function mapToLeague(row: PrismaLeague): League {
  return {
    id: row.id,
    leagueCode: row.leagueCode,
    name: row.name,
    description: row.description ?? undefined,
    isActive: row.isActive,
    iconKey: row.iconKey as LeagueIconKey,
    cupName: row.cupName,
    cupPointsScale: row.cupPointsScale,
    cupCustomPoints: row.cupCustomPoints,
    hallOfLameVisible: row.hallOfLameVisible,
    plan: row.plan,
    planRenewsAt: row.planRenewsAt,
    mutedSportLeagueIds: row.mutedSportLeagueIds,
    eventEmailDelivery: row.eventEmailDelivery,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
