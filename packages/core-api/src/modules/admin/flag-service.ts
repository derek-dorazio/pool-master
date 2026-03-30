/**
 * FlagService — feature flag CRUD with Prisma persistence.
 *
 * Provides flag lifecycle management, tenant-specific overrides, and
 * flag resolution with the precedence chain:
 *   tenant override -> global enabled -> rollout percentage
 */

import type { PrismaClient } from '@prisma/client';
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
// Row → domain mapping
// ---------------------------------------------------------------------------

interface FlagRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  flagType: string;
  enabledGlobally: boolean;
  rolloutPercentage: number | null;
  owner: string | null;
  createdAt: Date;
  updatedAt: Date;
  updatedById: string | null;
  overrides: {
    id: string;
    tenantId: string;
    enabled: boolean;
    reason: string | null;
    tenant: { name: string };
  }[];
}

function toFeatureFlag(row: FlagRow): FeatureFlag {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? '',
    flagType: row.flagType as FlagType,
    enabledGlobally: row.enabledGlobally,
    rolloutPercentage: row.rolloutPercentage ?? undefined,
    tenantOverrides: row.overrides.map((o) => ({
      tenantId: o.tenantId,
      tenantName: o.tenant.name,
      enabled: o.enabled,
      reason: o.reason ?? '',
    })),
    owner: row.owner ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedById ?? '',
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const INCLUDE_OVERRIDES = {
  overrides: {
    include: { tenant: { select: { name: true } } },
  },
} as const;

export class FlagService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns all feature flags.
   */
  async listFlags(): Promise<FeatureFlag[]> {
    const rows = await this.prisma.featureFlag.findMany({
      include: INCLUDE_OVERRIDES,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => toFeatureFlag(r as unknown as FlagRow));
  }

  /**
   * Creates a new feature flag.
   */
  async createFlag(
    input: CreateFlagInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<FeatureFlag> {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: input.key },
    });
    if (existing) {
      throw new FlagAlreadyExistsError(input.key);
    }

    const row = await this.prisma.featureFlag.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        flagType: input.flagType,
        enabledGlobally: input.enabledGlobally,
        rolloutPercentage: input.rolloutPercentage ?? null,
        owner: input.owner,
        updatedById: adminUserId,
      },
      include: INCLUDE_OVERRIDES,
    });

    const flag = toFeatureFlag(row as unknown as FlagRow);

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
    const row = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
      include: INCLUDE_OVERRIDES,
    });
    if (!row) {
      throw new FlagNotFoundError(flagKey);
    }
    return toFeatureFlag(row as unknown as FlagRow);
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
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
      include: INCLUDE_OVERRIDES,
    });
    if (!existing) {
      throw new FlagNotFoundError(flagKey);
    }

    const beforeState = toFeatureFlag(existing as unknown as FlagRow);

    const data: Record<string, unknown> = { updatedById: adminUserId };
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.enabledGlobally !== undefined) data.enabledGlobally = updates.enabledGlobally;
    if (updates.rolloutPercentage !== undefined) data.rolloutPercentage = updates.rolloutPercentage;
    if (updates.owner !== undefined) data.owner = updates.owner;

    const row = await this.prisma.featureFlag.update({
      where: { key: flagKey },
      data,
      include: INCLUDE_OVERRIDES,
    });

    const flag = toFeatureFlag(row as unknown as FlagRow);

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
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
      include: INCLUDE_OVERRIDES,
    });
    if (!existing) {
      throw new FlagNotFoundError(flagKey);
    }

    // Delete overrides first, then the flag
    await this.prisma.featureFlagOverride.deleteMany({
      where: { flagId: existing.id },
    });
    await this.prisma.featureFlag.delete({ where: { key: flagKey } });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'flags.delete',
      resourceType: 'FEATURE_FLAG',
      resourceId: flagKey,
      description: `Deleted feature flag "${existing.name}" (${flagKey})`,
      beforeState: toFeatureFlag(existing as unknown as FlagRow) as unknown as Record<string, unknown>,
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
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    if (!existing) {
      throw new FlagNotFoundError(flagKey);
    }

    // Upsert: replace existing override for this tenant or create new
    await this.prisma.featureFlagOverride.upsert({
      where: {
        flagId_tenantId: { flagId: existing.id, tenantId },
      },
      create: {
        flagId: existing.id,
        tenantId,
        enabled,
        reason,
        createdById: adminUserId,
      },
      update: {
        enabled,
        reason,
        createdById: adminUserId,
      },
    });

    // Touch updatedAt on the flag
    await this.prisma.featureFlag.update({
      where: { key: flagKey },
      data: { updatedById: adminUserId },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'flags.add_override',
      resourceType: 'FEATURE_FLAG',
      resourceId: flagKey,
      description: `Added tenant override for "${existing.name}" — tenant ${tenantId} = ${enabled}`,
      afterState: { tenantId, tenantName, enabled, reason },
    });

    return this.getFlagDetail(flagKey);
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
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    if (!existing) {
      throw new FlagNotFoundError(flagKey);
    }

    const deleted = await this.prisma.featureFlagOverride.deleteMany({
      where: { flagId: existing.id, tenantId },
    });

    if (deleted.count > 0) {
      await this.prisma.featureFlag.update({
        where: { key: flagKey },
        data: { updatedById: adminUserId },
      });

      await logAdminAction({
        adminUserId,
        adminUserEmail,
        action: 'flags.remove_override',
        resourceType: 'FEATURE_FLAG',
        resourceId: flagKey,
        description: `Removed tenant override for "${existing.name}" — tenant ${tenantId}`,
        beforeState: { tenantId },
      });
    }

    return this.getFlagDetail(flagKey);
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
    const row = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
      include: INCLUDE_OVERRIDES,
    });
    if (!row) {
      throw new FlagNotFoundError(flagKey);
    }

    const flag = toFeatureFlag(row as unknown as FlagRow);

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
