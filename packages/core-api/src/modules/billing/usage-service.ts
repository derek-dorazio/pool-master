/**
 * UsageService — tracks resource usage per tenant using Prisma TenantUsage table.
 *
 * All methods are gated by the billing_enabled feature flag.
 * When billing is OFF, usage is reported as 0 with unlimited limits.
 */

import type { PrismaClient } from '@prisma/client';
import { isBillingEnabled } from './billing-feature-gate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsageResource = 'LEAGUES' | 'MEMBERS' | 'CONTESTS';

export interface UsageRecord {
  tenantId: string;
  resource: UsageResource;
  currentCount: number;
  countedAt: Date;
}

export interface UsageTrackResult {
  resource: UsageResource;
  previousCount: number;
  newCount: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UsageService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Increments or decrements usage count for a resource.
   * When billing is OFF, returns a no-op result.
   */
  async trackUsage(
    tenantId: string,
    resource: UsageResource,
    delta: number,
  ): Promise<UsageTrackResult> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return { resource, previousCount: 0, newCount: 0 };
    }

    const existing = await this.prisma.tenantUsage.findUnique({
      where: { tenantId_resource: { tenantId, resource } },
    });

    const previousCount = existing?.currentCount ?? 0;
    const newCount = Math.max(0, previousCount + delta);

    await this.prisma.tenantUsage.upsert({
      where: { tenantId_resource: { tenantId, resource } },
      create: {
        tenantId,
        resource,
        currentCount: newCount,
        countedAt: new Date(),
      },
      update: {
        currentCount: newCount,
        countedAt: new Date(),
      },
    });

    return { resource, previousCount, newCount };
  }

  /**
   * Returns the current usage count for a resource.
   * When billing is OFF, returns 0.
   */
  async getUsage(
    tenantId: string,
    resource: UsageResource,
  ): Promise<number> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return 0;
    }

    const record = await this.prisma.tenantUsage.findUnique({
      where: { tenantId_resource: { tenantId, resource } },
    });

    return record?.currentCount ?? 0;
  }

  /**
   * Recounts usage from actual data by querying real tables.
   * When billing is OFF, returns zeroed counts.
   */
  async refreshAllUsage(
    tenantId: string,
  ): Promise<Map<UsageResource, number>> {
    const billingOn = await isBillingEnabled(tenantId);
    const results = new Map<UsageResource, number>();
    if (!billingOn) {
      results.set('LEAGUES', 0);
      results.set('MEMBERS', 0);
      results.set('CONTESTS', 0);
      return results;
    }

    // Count real data from the database
    const [leagueCount, memberCount, contestCount] = await Promise.all([
      this.prisma.league.count({ where: { tenantId } }),
      this.prisma.leagueMembership.count({
        where: { league: { tenantId } },
      }),
      this.prisma.contest.count({
        where: { league: { tenantId } },
      }),
    ]);

    const counts: Record<UsageResource, number> = {
      LEAGUES: leagueCount,
      MEMBERS: memberCount,
      CONTESTS: contestCount,
    };

    for (const [resource, count] of Object.entries(counts) as [UsageResource, number][]) {
      await this.prisma.tenantUsage.upsert({
        where: { tenantId_resource: { tenantId, resource } },
        create: {
          tenantId,
          resource,
          currentCount: count,
          countedAt: new Date(),
        },
        update: {
          currentCount: count,
          countedAt: new Date(),
        },
      });
      results.set(resource, count);
    }

    return results;
  }
}
