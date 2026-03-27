/**
 * EntitlementService — single source of truth for "can this tenant do X?"
 *
 * Resolution order:
 *   1. Admin override (deferred — always falls through)
 *   2. Feature flag (deferred — always falls through)
 *   3. Plan tier entitlements from PlanTier table
 *   4. For usage-limited entitlements, count usage vs limit
 *
 * At launch the Free tier has unlimited everything, so all checks pass.
 * The service is structured to support paid tiers when they are enabled.
 */

import type { PrismaClient } from '@prisma/client';
import {
  PlanEntitlementsSchema,
  type EntitlementKey,
  type EntitlementResult,
  type PlanEntitlements,
  type UsageResource,
  type UsageResult,
} from '@poolmaster/shared/domain';

// ---------------------------------------------------------------------------
// In-memory cache for plan tier entitlements
// ---------------------------------------------------------------------------

interface CachedTier {
  slug: string;
  name: string;
  entitlements: PlanEntitlements;
  loadedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Entitlement key → PlanEntitlements field mapping
// ---------------------------------------------------------------------------

const USAGE_KEYS: Record<string, { field: keyof PlanEntitlements; resource: UsageResource }> = {
  'league.create': { field: 'max_leagues', resource: 'LEAGUES' },
  'league.member.add': { field: 'max_members_per_league', resource: 'MEMBERS' },
  'contest.create': { field: 'max_contests_per_season', resource: 'CONTESTS' },
};

const BOOLEAN_KEYS: Record<string, keyof PlanEntitlements> = {
  'leaderboard.realtime': 'real_time_leaderboard',
  'scoring.custom': 'custom_scoring',
  'branding.custom': 'branding',
  'prizes.intermediate': 'intermediate_prizes',
  'api.access': 'api_access',
};

const LIST_KEYS: Record<string, keyof PlanEntitlements> = {
  'sport.access': 'allowed_sports',
  'draft.type': 'allowed_draft_types',
  'draft.mode': 'allowed_draft_modes',
};

const TIER_KEYS: Record<string, keyof PlanEntitlements> = {
  'analytics.access': 'analytics_tier',
  'history.access': 'history_seasons',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EntitlementService {
  private tierCache: Map<string, CachedTier> = new Map();

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check a single entitlement for a tenant.
   */
  async check(
    tenantId: string,
    key: EntitlementKey,
    context?: Record<string, unknown>,
  ): Promise<EntitlementResult> {
    // Step 1: Admin override (deferred — always falls through)

    // Step 2: Feature flag (deferred — always falls through)

    // Step 3: Load plan tier entitlements
    const entitlements = await this.loadEntitlements(tenantId);
    if (!entitlements) {
      return { entitled: true }; // fail-open if tier not found
    }

    // Step 4: Evaluate the entitlement
    return this.evaluate(key, entitlements, context);
  }

  /**
   * Check multiple entitlements at once (for UI feature gating).
   */
  async checkMultiple(
    tenantId: string,
    keys: EntitlementKey[],
  ): Promise<Map<EntitlementKey, EntitlementResult>> {
    const entitlements = await this.loadEntitlements(tenantId);
    const results = new Map<EntitlementKey, EntitlementResult>();

    for (const key of keys) {
      if (!entitlements) {
        results.set(key, { entitled: true });
      } else {
        results.set(key, this.evaluate(key, entitlements));
      }
    }

    return results;
  }

  /**
   * Get usage for a resource (mock for now — returns 0 usage).
   */
  async getUsage(tenantId: string, resource: UsageResource): Promise<UsageResult> {
    const entitlements = await this.loadEntitlements(tenantId);

    const limitField: Record<UsageResource, keyof PlanEntitlements> = {
      LEAGUES: 'max_leagues',
      MEMBERS: 'max_members_per_league',
      CONTESTS: 'max_contests_per_season',
    };

    const limit = entitlements
      ? (entitlements[limitField[resource]] as number)
      : -1;

    // TODO: Replace with real usage counting when usage tracking is implemented (07-007)
    const current = 0;

    const percentage = limit === -1 ? 0 : limit === 0 ? 100 : Math.round((current / limit) * 100);

    return { resource, current, limit, percentage };
  }

  /**
   * Invalidate the tier cache (call after plan tier changes).
   */
  invalidateCache(): void {
    this.tierCache.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadEntitlements(tenantId: string): Promise<PlanEntitlements | null> {
    // Look up tenant's plan tier slug
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: true },
    });

    if (!tenant) {
      return null;
    }

    const slug = tenant.planTier;

    // Check cache
    const cached = this.tierCache.get(slug);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.entitlements;
    }

    // Load from database
    const tier = await this.prisma.planTier.findUnique({
      where: { slug },
    });

    if (!tier) {
      return null;
    }

    // Parse and validate entitlements
    const parsed = PlanEntitlementsSchema.safeParse(tier.entitlements);
    if (!parsed.success) {
      return null;
    }

    // Cache the result
    this.tierCache.set(slug, {
      slug,
      name: tier.name,
      entitlements: parsed.data,
      loadedAt: Date.now(),
    });

    return parsed.data;
  }

  private evaluate(
    key: EntitlementKey,
    entitlements: PlanEntitlements,
    context?: Record<string, unknown>,
  ): EntitlementResult {
    // Usage-limited entitlements (league.create, league.member.add, contest.create)
    if (key in USAGE_KEYS) {
      const { field } = USAGE_KEYS[key];
      const limit = entitlements[field] as number;

      // -1 means unlimited
      if (limit === -1) {
        return { entitled: true, limit: -1 };
      }

      // TODO: real usage counting (07-007). For now assume 0 usage.
      const currentUsage = 0;
      if (currentUsage >= limit) {
        return {
          entitled: false,
          reason: `Plan limit reached: ${currentUsage}/${limit}`,
          currentUsage,
          limit,
          upgradePlan: this.findNextTierSlug(key, entitlements),
        };
      }

      return { entitled: true, currentUsage, limit };
    }

    // Boolean entitlements
    if (key in BOOLEAN_KEYS) {
      const field = BOOLEAN_KEYS[key];
      const value = entitlements[field];

      // For branding, 'NONE' means not entitled
      if (field === 'branding') {
        const entitled = value !== 'NONE';
        return entitled
          ? { entitled: true }
          : { entitled: false, reason: 'Custom branding not available on current plan' };
      }

      return value
        ? { entitled: true }
        : { entitled: false, reason: `Feature not available on current plan` };
    }

    // List-based entitlements (sport.access, draft.type, draft.mode)
    if (key in LIST_KEYS) {
      const field = LIST_KEYS[key];
      const allowed = entitlements[field];

      // 'ALL' means everything is allowed
      if (allowed === 'ALL') {
        return { entitled: true };
      }

      // If context provides a specific value to check
      const requestedValue = context?.value as string | undefined;
      if (requestedValue && Array.isArray(allowed)) {
        const entitled = allowed.includes(requestedValue);
        return entitled
          ? { entitled: true }
          : { entitled: false, reason: `${requestedValue} not available on current plan` };
      }

      return { entitled: true };
    }

    // Tier-based entitlements
    if (key in TIER_KEYS) {
      const field = TIER_KEYS[key];
      const value = entitlements[field];

      if (key === 'analytics.access') {
        const entitled = value !== 'NONE';
        return entitled
          ? { entitled: true }
          : { entitled: false, reason: 'Analytics not available on current plan' };
      }

      if (key === 'history.access') {
        // -1 means unlimited
        if (value === -1) {
          return { entitled: true, limit: -1 };
        }
        return { entitled: true, limit: value as number };
      }
    }

    // Unknown key — fail open
    return { entitled: true };
  }

  /**
   * Suggests the next tier that would unlock the given entitlement.
   * Stub for now — returns undefined.
   */
  private findNextTierSlug(
    _key: EntitlementKey,
    _currentEntitlements: PlanEntitlements,
  ): string | undefined {
    // TODO: implement tier comparison logic when paid tiers are enabled
    return undefined;
  }
}
