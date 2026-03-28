/**
 * UsageService — tracks resource usage per tenant.
 *
 * All methods are gated by the billing_enabled feature flag.
 * When billing is OFF, usage is reported as 0 with unlimited limits.
 */

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
// In-memory storage (replaces Prisma TenantUsage table for now)
// ---------------------------------------------------------------------------

const usageStore: Map<string, UsageRecord> = new Map();

function storageKey(tenantId: string, resource: UsageResource): string {
  return `${tenantId}:${resource}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Increments or decrements usage count for a resource.
 * When billing is OFF, returns a no-op result.
 */
export async function trackUsage(
  tenantId: string,
  resource: UsageResource,
  delta: number,
): Promise<UsageTrackResult> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return { resource, previousCount: 0, newCount: 0 };
  }
  const key = storageKey(tenantId, resource);
  const existing = usageStore.get(key);
  const previousCount = existing?.currentCount ?? 0;
  const newCount = Math.max(0, previousCount + delta);
  usageStore.set(key, {
    tenantId,
    resource,
    currentCount: newCount,
    countedAt: new Date(),
  });
  return { resource, previousCount, newCount };
}

/**
 * Returns the current usage count for a resource.
 * When billing is OFF, returns 0.
 */
export async function getUsage(
  tenantId: string,
  resource: UsageResource,
): Promise<number> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return 0;
  }
  const key = storageKey(tenantId, resource);
  const record = usageStore.get(key);
  return record?.currentCount ?? 0;
}

/**
 * Recounts usage from actual data (mock implementation).
 * When billing is OFF, returns zeroed counts.
 */
export async function refreshAllUsage(
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
  // Mock: return realistic counts from hypothetical data
  const mockCounts: Record<UsageResource, number> = {
    LEAGUES: 2,
    MEMBERS: 14,
    CONTESTS: 5,
  };
  for (const [resource, count] of Object.entries(mockCounts) as [UsageResource, number][]) {
    const key = storageKey(tenantId, resource);
    usageStore.set(key, {
      tenantId,
      resource,
      currentCount: count,
      countedAt: new Date(),
    });
    results.set(resource, count);
  }
  return results;
}
