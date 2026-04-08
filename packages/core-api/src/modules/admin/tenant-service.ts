/**
 * TenantService — business logic for admin tenant management operations.
 *
 * Provides tenant listing, detail views, suspension, credits, trial
 * extensions, and deletion. All write operations are audit-logged.
 *
 * Persisted via Prisma to the tenants table.
 */

import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantListQuery {
  search?: string;
  status?: 'active' | 'suspended' | 'trial';
  sortBy?: 'name' | 'created' | 'members' | 'lastActive';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  contestCount: number;
  leagueCount: number;
  status: 'active' | 'suspended' | 'trial';
  lastActiveAt?: Date;
  createdAt: Date;
}

export interface TenantDetailView {
  tenant: {
    id: string;
    name: string;
    slug: string;
    settings: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  };
  memberCount: number;
  leagueCount: number;
  contestCount: number;
  activeContestCount: number;
  status: 'active' | 'suspended' | 'trial';
  lastActiveAt?: Date;
  recentMembers: {
    id: string;
    email: string;
    displayName: string;
    createdAt: Date;
  }[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant not found: ${tenantId}`);
    this.name = 'TenantNotFoundError';
  }
}

export class TenantDeleteConfirmationError extends Error {
  constructor() {
    super('Confirmation does not match tenant name');
    this.name = 'TenantDeleteConfirmationError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a status string from the tenant's settings/plan.
 * The Tenant model does not have a dedicated status column, so we derive it
 * from the settings JSON (which may contain { suspended: true } or
 * { trialEndsAt: "..." }).
 */
function deriveTenantStatus(settings: Record<string, unknown>): 'active' | 'suspended' | 'trial' {
  if (settings.suspended === true) return 'suspended';
  if (settings.trialEndsAt && new Date(settings.trialEndsAt as string) > new Date()) {
    return 'trial';
  }
  return 'active';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TenantService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists tenants with search, filter, sort, and pagination.
   */
  async listTenants(
    query: TenantListQuery,
  ): Promise<{ items: TenantListItem[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    // Determine sort order
    const sortDir = query.sortDir ?? 'desc';
    let orderBy: Record<string, string> = { createdAt: sortDir };
    if (query.sortBy === 'name') orderBy = { name: sortDir };

    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          _count: {
            select: {
              users: true,
              leagues: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const items: TenantListItem[] = [];

    for (const row of rows) {
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const contestCount = await this.prisma.contest.count({
        where: { league: { tenantId: row.id } },
      });

      items.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        memberCount: row._count.users,
        contestCount,
        leagueCount: row._count.leagues,
        status: query.status ?? deriveTenantStatus(settings),
        lastActiveAt: (settings.lastActiveAt as string)
          ? new Date(settings.lastActiveAt as string)
          : undefined,
        createdAt: row.createdAt,
      });
    }

    // If filtering by status, filter post-query (status is derived, not a column)
    const filtered = query.status
      ? items.filter((t) => t.status === query.status)
      : items;

    return { items: filtered, total };
  }

  /**
   * Returns the full admin detail view for a single tenant.
   */
  async getTenantDetail(tenantId: string): Promise<TenantDetailView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            users: true,
            leagues: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;

    const [contestCount, activeContestCount, recentMembers] = await Promise.all([
      this.prisma.contest.count({
        where: { league: { tenantId } },
      }),
      this.prisma.contest.count({
        where: {
          league: { tenantId },
          status: { in: ['ACTIVE', 'OPEN', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        settings,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      memberCount: tenant._count.users,
      leagueCount: tenant._count.leagues,
      contestCount,
      activeContestCount,
      status: deriveTenantStatus(settings),
      lastActiveAt: (settings.lastActiveAt as string)
        ? new Date(settings.lastActiveAt as string)
        : undefined,
      recentMembers,
    };
  }

  /**
   * Suspends a tenant, disabling access for all members.
   */
  async suspendTenant(
    tenantId: string,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new TenantNotFoundError(tenantId);

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    settings.suspended = true;
    settings.suspendedAt = new Date().toISOString();
    settings.suspendReason = reason;

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as unknown as object },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.suspend',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Suspended tenant — reason: ${reason}`,
      afterState: { status: 'suspended' },
      reason,
    });
  }

  /**
   * Reactivates a previously suspended tenant.
   */
  async unsuspendTenant(
    tenantId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new TenantNotFoundError(tenantId);

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    delete settings.suspended;
    delete settings.suspendedAt;
    delete settings.suspendReason;

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as unknown as object },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.unsuspend',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: 'Unsuspended tenant',
      afterState: { status: 'active' },
    });
  }

  /**
   * Applies a monetary credit to a tenant's account.
   */
  async applyCredit(
    tenantId: string,
    amount: number,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new TenantNotFoundError(tenantId);

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const currentCredit = (settings.creditBalance as number) ?? 0;
    settings.creditBalance = currentCredit + amount;

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as unknown as object },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.apply_credit',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Applied credit of $${amount.toFixed(2)}`,
      afterState: { creditAmount: amount },
      reason,
    });
  }

  /**
   * Extends a tenant's trial period by the given number of days.
   */
  async extendTrial(
    tenantId: string,
    days: number,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new TenantNotFoundError(tenantId);

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const currentEnd = settings.trialEndsAt
      ? new Date(settings.trialEndsAt as string)
      : new Date();
    const newEnd = new Date(currentEnd.getTime() + days * 86_400_000);
    settings.trialEndsAt = newEnd.toISOString();

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as unknown as object },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.extend_trial',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Extended trial by ${days} days`,
      afterState: { trialExtensionDays: days },
      reason,
    });
  }

  /**
   * Permanently deletes a tenant and all associated data.
   * Requires the confirmation string to match the tenant name exactly.
   */
  async deleteTenant(
    tenantId: string,
    confirmation: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new TenantNotFoundError(tenantId);

    if (confirmation !== tenant.name) {
      throw new TenantDeleteConfirmationError();
    }

    // Cascade-delete in dependency order within a transaction
    await this.prisma.$transaction(async (tx) => {
      // Delete contest-related data
      const leagues = await tx.league.findMany({
        where: { tenantId },
        select: { id: true },
      });
      const leagueIds = leagues.map((l) => l.id);

      if (leagueIds.length > 0) {
        const contests = await tx.contest.findMany({
          where: { leagueId: { in: leagueIds } },
          select: { id: true },
        });
        const contestIds = contests.map((c) => c.id);

        if (contestIds.length > 0) {
          await tx.contestPick.deleteMany({ where: { contestId: { in: contestIds } } });
          await tx.contestEntry.deleteMany({ where: { contestId: { in: contestIds } } });
          await tx.contest.deleteMany({ where: { id: { in: contestIds } } });
        }

        await tx.leagueMembership.deleteMany({ where: { leagueId: { in: leagueIds } } });
        await tx.league.deleteMany({ where: { id: { in: leagueIds } } });
      }

      // Delete users
      await tx.user.deleteMany({ where: { tenantId } });

      // Delete impersonation sessions
      await tx.impersonationSession.deleteMany({ where: { tenantId } });

      // Delete the tenant itself
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.delete',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Deleted tenant "${tenant.name}"`,
      beforeState: { tenantName: tenant.name },
    });
  }
}
