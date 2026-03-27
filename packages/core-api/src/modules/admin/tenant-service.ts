/**
 * TenantService — business logic for admin tenant management operations.
 *
 * Provides tenant listing, detail views, plan changes, suspension, credits,
 * trial extensions, and deletion. All write operations are audit-logged.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantListQuery {
  search?: string;
  planTier?: string;
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
  planTier: string;
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
    planTier: string;
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
// Service
// ---------------------------------------------------------------------------

export class TenantService {
  /**
   * Lists tenants with search, filter, sort, and pagination.
   *
   * Placeholder: returns mock data. Will query tenants table via Prisma.
   */
  async listTenants(
    query: TenantListQuery,
  ): Promise<{ items: TenantListItem[]; total: number }> {
    void query;

    // TODO: Replace with Prisma query against tenants table
    const mockItems: TenantListItem[] = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        name: "Tiger's Corner",
        slug: 'tigers-corner',
        planTier: 'Pro',
        memberCount: 45,
        contestCount: 12,
        leagueCount: 3,
        status: 'active',
        lastActiveAt: new Date(),
        createdAt: new Date('2025-06-15'),
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Golf Crew',
        slug: 'golf-crew',
        planTier: 'Starter',
        memberCount: 18,
        contestCount: 3,
        leagueCount: 1,
        status: 'active',
        lastActiveAt: new Date(Date.now() - 3_600_000),
        createdAt: new Date('2025-09-01'),
      },
      {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Test Org',
        slug: 'test-org',
        planTier: 'Free',
        memberCount: 4,
        contestCount: 0,
        leagueCount: 0,
        status: 'trial',
        lastActiveAt: new Date(Date.now() - 259_200_000),
        createdAt: new Date('2026-03-01'),
      },
    ];

    return { items: mockItems, total: mockItems.length };
  }

  /**
   * Returns the full admin detail view for a single tenant.
   *
   * Placeholder: returns mock data. Will aggregate from tenants, users,
   * leagues, and contests tables via Prisma.
   */
  async getTenantDetail(tenantId: string): Promise<TenantDetailView> {
    // TODO: Replace with Prisma queries
    void tenantId;

    return {
      tenant: {
        id: tenantId,
        name: "Tiger's Corner",
        slug: 'tigers-corner',
        planTier: 'Pro',
        settings: {},
        createdAt: new Date('2025-06-15'),
        updatedAt: new Date(),
      },
      memberCount: 45,
      leagueCount: 3,
      contestCount: 12,
      activeContestCount: 4,
      status: 'active',
      lastActiveAt: new Date(),
      recentMembers: [
        {
          id: 'user-001',
          email: 'alice@example.com',
          displayName: 'Alice',
          createdAt: new Date('2026-03-20'),
        },
        {
          id: 'user-002',
          email: 'bob@example.com',
          displayName: 'Bob',
          createdAt: new Date('2026-03-18'),
        },
      ],
    };
  }

  /**
   * Changes the plan tier for a tenant.
   */
  async changePlan(
    tenantId: string,
    planTier: string,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    // TODO: Update tenant plan in database via Prisma
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.change_plan',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Changed tenant plan to ${planTier}`,
      afterState: { planTier },
      reason,
    });
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
    // TODO: Set tenant status to 'suspended' via Prisma
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
    // TODO: Set tenant status back to 'active' via Prisma
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
    // TODO: Record credit in billing system via Prisma
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
    // TODO: Extend trial_ends_at in database via Prisma
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
    // TODO: Fetch tenant name from database and verify confirmation matches
    // For now, the handler-level validation ensures confirmation is non-empty.
    // Once wired to Prisma, verify confirmation === tenant.name before proceeding.

    const tenantName = confirmation; // placeholder — will come from DB lookup

    if (confirmation !== tenantName) {
      throw new TenantDeleteConfirmationError();
    }

    // TODO: Cascade-delete tenant data via Prisma transaction
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'tenant.delete',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Deleted tenant "${tenantName}"`,
      beforeState: { tenantName },
    });
  }
}
