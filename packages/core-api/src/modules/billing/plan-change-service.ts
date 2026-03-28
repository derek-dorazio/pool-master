/**
 * PlanChangeService — handles plan upgrade/downgrade previews,
 * usage limit checks, and graceful degradation for plan changes.
 */

import type { PrismaClient } from '@prisma/client';
import { PlanEntitlementsSchema, type PlanEntitlements } from '@poolmaster/shared/domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradePreview {
  currentPlan: string;
  newPlan: string;
  proratedAmountCents: number;
  newMonthlyAmountCents: number;
  effectiveImmediately: true;
}

export interface DowngradePreview {
  currentPlan: string;
  newPlan: string;
  featuresLost: string[];
  effectiveDate: Date;
  usageExceedances: UsageExceedance[];
}

export interface UsageExceedance {
  resource: string;
  currentUsage: number;
  newLimit: number;
  action: 'READ_ONLY_OLDEST' | 'NO_NEW_INVITES' | 'NO_NEW_CREATION';
}

export interface DegradationResult {
  tenantId: string;
  degradedResources: UsageExceedance[];
  appliedAt: Date;
}

// ---------------------------------------------------------------------------
// Plan pricing (mirrors plan tier table)
// ---------------------------------------------------------------------------

const PLAN_MONTHLY_PRICES: Record<string, number> = {
  free: 0,
  starter: 900,
  pro: 2900,
  league_plus: 7900,
};

const PLAN_DISPLAY_ORDER: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  league_plus: 3,
};

// ---------------------------------------------------------------------------
// Feature labels for downgrade comparison
// ---------------------------------------------------------------------------

const FEATURE_LABELS: Record<string, (e: PlanEntitlements) => string | null> = {
  real_time_leaderboard: (e) => e.real_time_leaderboard ? null : 'Real-time leaderboard',
  custom_scoring: (e) => e.custom_scoring ? null : 'Custom scoring templates',
  intermediate_prizes: (e) => e.intermediate_prizes ? null : 'Intermediate prizes',
  api_access: (e) => e.api_access ? null : 'API access',
  branding: (e) => e.branding === 'NONE' ? 'Custom branding' : null,
  analytics_tier: (e) => e.analytics_tier === 'NONE' ? 'Analytics' : null,
};

// ---------------------------------------------------------------------------
// Degradation action mapping
// ---------------------------------------------------------------------------

const RESOURCE_DEGRADATION_ACTION: Record<string, UsageExceedance['action']> = {
  LEAGUES: 'READ_ONLY_OLDEST',
  MEMBERS: 'NO_NEW_INVITES',
  CONTESTS: 'NO_NEW_CREATION',
};

// ---------------------------------------------------------------------------
// In-memory degradation store
// ---------------------------------------------------------------------------

const degradationStore: Map<string, DegradationResult> = new Map();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PlanChangeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Calculate proration preview for an upgrade.
   */
  async previewUpgrade(tenantId: string, newPlanSlug: string): Promise<UpgradePreview> {
    const currentSlug = await this.getTenantPlanSlug(tenantId);
    const currentPrice = PLAN_MONTHLY_PRICES[currentSlug] ?? 0;
    const newPrice = PLAN_MONTHLY_PRICES[newPlanSlug] ?? 0;
    const daysRemaining = this.computeDaysRemaining();
    const daysInMonth = 30;
    const proratedAmountCents = Math.max(
      0,
      Math.round(((newPrice - currentPrice) * daysRemaining) / daysInMonth),
    );
    return {
      currentPlan: currentSlug,
      newPlan: newPlanSlug,
      proratedAmountCents,
      newMonthlyAmountCents: newPrice,
      effectiveImmediately: true,
    };
  }

  /**
   * Preview what features are lost and what usage exceeds limits on downgrade.
   */
  async previewDowngrade(tenantId: string, newPlanSlug: string): Promise<DowngradePreview> {
    const currentSlug = await this.getTenantPlanSlug(tenantId);
    const newEntitlements = await this.loadPlanEntitlements(newPlanSlug);
    const currentEntitlements = await this.loadPlanEntitlements(currentSlug);
    const featuresLost = this.computeFeaturesLost(currentEntitlements, newEntitlements);
    const usageExceedances = await this.checkUsageExceedsLimits(tenantId, newPlanSlug);
    const effectiveDate = new Date();
    effectiveDate.setDate(effectiveDate.getDate() + 30);
    return {
      currentPlan: currentSlug,
      newPlan: newPlanSlug,
      featuresLost,
      effectiveDate,
      usageExceedances,
    };
  }

  /**
   * Check if current usage exceeds target plan limits.
   */
  async checkUsageExceedsLimits(
    tenantId: string,
    targetPlanSlug: string,
  ): Promise<UsageExceedance[]> {
    const entitlements = await this.loadPlanEntitlements(targetPlanSlug);
    if (!entitlements) {
      return [];
    }
    const usageCounts = await this.getMockUsageCounts(tenantId);
    const exceedances: UsageExceedance[] = [];
    const limits: Array<{ resource: string; field: keyof PlanEntitlements }> = [
      { resource: 'LEAGUES', field: 'max_leagues' },
      { resource: 'MEMBERS', field: 'max_members_per_league' },
      { resource: 'CONTESTS', field: 'max_contests_per_season' },
    ];
    for (const { resource, field } of limits) {
      const limit = entitlements[field] as number;
      const current = usageCounts[resource] ?? 0;
      if (limit !== -1 && current > limit) {
        exceedances.push({
          resource,
          currentUsage: current,
          newLimit: limit,
          action: RESOURCE_DEGRADATION_ACTION[resource] ?? 'NO_NEW_CREATION',
        });
      }
    }
    return exceedances;
  }

  /**
   * Apply graceful degradation when a downgrade causes usage to exceed limits.
   */
  async applyDegradation(
    tenantId: string,
    _fromPlan: string,
    toPlan: string,
  ): Promise<DegradationResult> {
    const exceedances = await this.checkUsageExceedsLimits(tenantId, toPlan);
    const result: DegradationResult = {
      tenantId,
      degradedResources: exceedances,
      appliedAt: new Date(),
    };
    degradationStore.set(tenantId, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getTenantPlanSlug(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: true },
    });
    return tenant?.planTier ?? 'free';
  }

  private async loadPlanEntitlements(slug: string): Promise<PlanEntitlements | null> {
    const tier = await this.prisma.planTier.findUnique({ where: { slug } });
    if (!tier) {
      return null;
    }
    const parsed = PlanEntitlementsSchema.safeParse(tier.entitlements);
    return parsed.success ? parsed.data : null;
  }

  private computeDaysRemaining(): number {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.max(1, endOfMonth.getDate() - now.getDate());
  }

  private computeFeaturesLost(
    current: PlanEntitlements | null,
    target: PlanEntitlements | null,
  ): string[] {
    if (!current || !target) {
      return [];
    }
    const lost: string[] = [];
    for (const [, checker] of Object.entries(FEATURE_LABELS)) {
      const currentlyHas = checker(current) === null;
      const label = checker(target);
      if (currentlyHas && label !== null) {
        lost.push(label);
      }
    }
    return lost;
  }

  /**
   * Mock usage counts for a tenant. Returns realistic defaults.
   */
  private async getMockUsageCounts(
    _tenantId: string,
  ): Promise<Record<string, number>> {
    return {
      LEAGUES: 4,
      MEMBERS: 25,
      CONTESTS: 8,
    };
  }
}
