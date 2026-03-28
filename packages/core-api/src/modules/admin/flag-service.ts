/**
 * FlagService — feature flag CRUD with in-memory Map storage.
 *
 * Provides flag lifecycle management, tenant-specific overrides, and
 * flag resolution with the precedence chain:
 *   tenant override -> global enabled -> rollout percentage
 *
 * Uses mock data — will be replaced with real database integration.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlagType = 'BOOLEAN' | 'PERCENTAGE' | 'TENANT_LIST';

export interface TenantOverride {
  tenantId: string;
  tenantName: string;
  enabled: boolean;
  reason: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  flagType: FlagType;
  enabledGlobally: boolean;
  rolloutPercentage?: number;
  tenantOverrides: TenantOverride[];
  owner: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface CreateFlagInput {
  key: string;
  name: string;
  description: string;
  flagType: FlagType;
  enabledGlobally: boolean;
  rolloutPercentage?: number;
  owner: string;
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  enabledGlobally?: boolean;
  rolloutPercentage?: number;
  owner?: string;
}

export interface FlagResolution {
  flagKey: string;
  tenantId: string;
  enabled: boolean;
  source: 'TENANT_OVERRIDE' | 'GLOBAL' | 'ROLLOUT_PERCENTAGE';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FlagNotFoundError extends Error {
  constructor(flagKey: string) {
    super(`Feature flag not found: ${flagKey}`);
    this.name = 'FlagNotFoundError';
  }
}

export class FlagAlreadyExistsError extends Error {
  constructor(flagKey: string) {
    super(`Feature flag already exists: ${flagKey}`);
    this.name = 'FlagAlreadyExistsError';
  }
}

// ---------------------------------------------------------------------------
// Hash helper (deterministic rollout)
// ---------------------------------------------------------------------------

function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const now = new Date();

function daysAgo(d: number): Date {
  return new Date(now.getTime() - d * 86_400_000);
}

function seedFlags(): Map<string, FeatureFlag> {
  const flags = new Map<string, FeatureFlag>();

  const seeds: FeatureFlag[] = [
    {
      id: 'flag-001',
      key: 'live_draft_v2',
      name: 'Live Draft V2',
      description: 'Enables the redesigned live draft experience with real-time pick animations and improved timer UX.',
      flagType: 'PERCENTAGE',
      enabledGlobally: true,
      rolloutPercentage: 50,
      tenantOverrides: [
        { tenantId: 'tenant-001', tenantName: 'Tiger\'s Co', enabled: true, reason: 'Beta tester' },
        { tenantId: 'tenant-003', tenantName: 'Acme Corp', enabled: true, reason: 'Requested early access' },
      ],
      owner: 'draft-team',
      createdAt: daysAgo(30),
      updatedAt: daysAgo(2),
      updatedBy: 'admin-001',
    },
    {
      id: 'flag-002',
      key: 'budget_pick_golf',
      name: 'Budget Pick — Golf',
      description: 'Enables budget-based pick selection for golf contests with salary cap mechanics.',
      flagType: 'BOOLEAN',
      enabledGlobally: false,
      tenantOverrides: [
        { tenantId: 'tenant-001', tenantName: 'Tiger\'s Co', enabled: true, reason: 'Golf feature testing' },
      ],
      owner: 'contest-team',
      createdAt: daysAgo(14),
      updatedAt: daysAgo(5),
      updatedBy: 'admin-002',
    },
    {
      id: 'flag-003',
      key: 'salary_cap_nfl',
      name: 'Salary Cap — NFL',
      description: 'Enables salary cap draft mode for NFL contests.',
      flagType: 'BOOLEAN',
      enabledGlobally: true,
      tenantOverrides: [],
      owner: 'contest-team',
      createdAt: daysAgo(60),
      updatedAt: daysAgo(10),
      updatedBy: 'admin-001',
    },
    {
      id: 'flag-004',
      key: 'dark_mode',
      name: 'Dark Mode',
      description: 'Enables dark mode theme across web and mobile clients.',
      flagType: 'PERCENTAGE',
      enabledGlobally: true,
      rolloutPercentage: 25,
      tenantOverrides: [],
      owner: 'design-team',
      createdAt: daysAgo(45),
      updatedAt: daysAgo(3),
      updatedBy: 'admin-003',
    },
    {
      id: 'flag-005',
      key: 'new_scoring_ui',
      name: 'New Scoring UI',
      description: 'Redesigned scoring display with live animations, expanded stat breakdowns, and timeline view.',
      flagType: 'TENANT_LIST',
      enabledGlobally: false,
      tenantOverrides: [
        { tenantId: 'tenant-001', tenantName: 'Tiger\'s Co', enabled: true, reason: 'UI beta tester' },
        { tenantId: 'tenant-002', tenantName: 'Golf Crew', enabled: true, reason: 'Requested early access' },
      ],
      owner: 'scoring-team',
      createdAt: daysAgo(20),
      updatedAt: daysAgo(1),
      updatedBy: 'admin-001',
    },
    {
      id: 'flag-007',
      key: 'billing_enabled',
      name: 'Billing & Subscriptions',
      description: 'Gates all billing features including Stripe integration, usage enforcement, and subscription management. When OFF, all entitlement checks pass (free tier, unlimited) and no Stripe calls are made.',
      flagType: 'BOOLEAN',
      enabledGlobally: false,
      tenantOverrides: [],
      owner: 'billing-team',
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      updatedBy: 'admin-001',
    },
    {
      id: 'flag-006',
      key: 'bracket_ncaa',
      name: 'NCAA Bracket Contest',
      description: 'Enables NCAA tournament bracket-style contest type.',
      flagType: 'BOOLEAN',
      enabledGlobally: true,
      tenantOverrides: [
        { tenantId: 'tenant-004', tenantName: 'Test Org', enabled: false, reason: 'Not ready for free tier' },
      ],
      owner: 'contest-team',
      createdAt: daysAgo(90),
      updatedAt: daysAgo(7),
      updatedBy: 'admin-002',
    },
  ];

  for (const flag of seeds) {
    flags.set(flag.key, flag);
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class FlagService {
  private flags: Map<string, FeatureFlag> = seedFlags();
  private nextId = 8;

  /**
   * Returns all feature flags.
   */
  async listFlags(): Promise<FeatureFlag[]> {
    return Array.from(this.flags.values());
  }

  /**
   * Creates a new feature flag.
   */
  async createFlag(
    input: CreateFlagInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<FeatureFlag> {
    if (this.flags.has(input.key)) {
      throw new FlagAlreadyExistsError(input.key);
    }

    const flag: FeatureFlag = {
      id: `flag-${String(this.nextId++).padStart(3, '0')}`,
      key: input.key,
      name: input.name,
      description: input.description,
      flagType: input.flagType,
      enabledGlobally: input.enabledGlobally,
      rolloutPercentage: input.rolloutPercentage,
      tenantOverrides: [],
      owner: input.owner,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: adminUserId,
    };

    this.flags.set(flag.key, flag);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'flags.create',
      resourceType: 'FEATURE_FLAG',
      resourceId: flag.key,
      description: `Created feature flag "${flag.name}" (${flag.key})`,
      afterState: flag as unknown as Record<string, unknown>,
    });

    return flag;
  }

  /**
   * Returns detail for a single feature flag.
   */
  async getFlagDetail(flagKey: string): Promise<FeatureFlag> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new FlagNotFoundError(flagKey);
    }
    return flag;
  }

  /**
   * Updates a feature flag.
   */
  async updateFlag(
    flagKey: string,
    updates: UpdateFlagInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<FeatureFlag> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new FlagNotFoundError(flagKey);
    }

    const beforeState = { ...flag };

    if (updates.name !== undefined) flag.name = updates.name;
    if (updates.description !== undefined) flag.description = updates.description;
    if (updates.enabledGlobally !== undefined) flag.enabledGlobally = updates.enabledGlobally;
    if (updates.rolloutPercentage !== undefined) flag.rolloutPercentage = updates.rolloutPercentage;
    if (updates.owner !== undefined) flag.owner = updates.owner;
    flag.updatedAt = new Date();
    flag.updatedBy = adminUserId;

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'flags.update',
      resourceType: 'FEATURE_FLAG',
      resourceId: flagKey,
      description: `Updated feature flag "${flag.name}" (${flagKey})`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: flag as unknown as Record<string, unknown>,
    });

    return flag;
  }

  /**
   * Deletes a feature flag.
   */
  async deleteFlag(
    flagKey: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new FlagNotFoundError(flagKey);
    }

    this.flags.delete(flagKey);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'flags.delete',
      resourceType: 'FEATURE_FLAG',
      resourceId: flagKey,
      description: `Deleted feature flag "${flag.name}" (${flagKey})`,
      beforeState: flag as unknown as Record<string, unknown>,
    });
  }

  /**
   * Adds a tenant override for a feature flag.
   */
  async addOverride(
    flagKey: string,
    tenantId: string,
    tenantName: string,
    enabled: boolean,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<FeatureFlag> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new FlagNotFoundError(flagKey);
    }

    // Replace existing override for this tenant or add new
    const existingIdx = flag.tenantOverrides.findIndex(o => o.tenantId === tenantId);
    const override: TenantOverride = { tenantId, tenantName, enabled, reason };

    if (existingIdx >= 0) {
      flag.tenantOverrides[existingIdx] = override;
    } else {
      flag.tenantOverrides.push(override);
    }
    flag.updatedAt = new Date();
    flag.updatedBy = adminUserId;

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'flags.add_override',
      resourceType: 'FEATURE_FLAG',
      resourceId: flagKey,
      description: `Added tenant override for "${flag.name}" — tenant ${tenantId} = ${enabled}`,
      afterState: { tenantId, tenantName, enabled, reason },
    });

    return flag;
  }

  /**
   * Removes a tenant override for a feature flag.
   */
  async removeOverride(
    flagKey: string,
    tenantId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<FeatureFlag> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new FlagNotFoundError(flagKey);
    }

    const existingIdx = flag.tenantOverrides.findIndex(o => o.tenantId === tenantId);
    if (existingIdx >= 0) {
      const removed = flag.tenantOverrides.splice(existingIdx, 1)[0];
      flag.updatedAt = new Date();
      flag.updatedBy = adminUserId;

      await logAdminAction({
        adminUserId,
        adminUserEmail,
        action: 'flags.remove_override',
        resourceType: 'FEATURE_FLAG',
        resourceId: flagKey,
        description: `Removed tenant override for "${flag.name}" — tenant ${tenantId}`,
        beforeState: removed as unknown as Record<string, unknown>,
      });
    }

    return flag;
  }

  /**
   * Resolves a feature flag for a specific tenant.
   *
   * Resolution order:
   *   1. Tenant-specific override (if exists)
   *   2. Global enabled state (if disabled globally, return false)
   *   3. Rollout percentage — hash(tenantId + flagKey) % 100 < percentage
   */
  async resolveFlag(flagKey: string, tenantId: string): Promise<FlagResolution> {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new FlagNotFoundError(flagKey);
    }

    // 1. Check tenant-specific override
    const override = flag.tenantOverrides.find(o => o.tenantId === tenantId);
    if (override) {
      return {
        flagKey,
        tenantId,
        enabled: override.enabled,
        source: 'TENANT_OVERRIDE',
      };
    }

    // 2. Check global enabled state
    if (!flag.enabledGlobally) {
      return {
        flagKey,
        tenantId,
        enabled: false,
        source: 'GLOBAL',
      };
    }

    // 3. Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const hash = simpleHash(`${tenantId}:${flagKey}`);
      const bucket = hash % 100;
      return {
        flagKey,
        tenantId,
        enabled: bucket < flag.rolloutPercentage,
        source: 'ROLLOUT_PERCENTAGE',
      };
    }

    // Enabled globally with no rollout restriction
    return {
      flagKey,
      tenantId,
      enabled: true,
      source: 'GLOBAL',
    };
  }
}
