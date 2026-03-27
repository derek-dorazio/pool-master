/**
 * UserService — business logic for admin user management operations.
 *
 * Provides user search, detail views, password reset, force logout,
 * account enable/disable, admin email, and account merge.
 * All write operations are audit-logged.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSearchQuery {
  search?: string;
  tenantId?: string;
  status?: 'active' | 'disabled';
  page?: number;
  pageSize?: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  tenants: { id: string; name: string; role: string }[];
  lastLoginAt?: Date;
  status: 'active' | 'disabled';
  createdAt: Date;
}

export interface UserDetailView {
  id: string;
  email: string;
  displayName: string;
  authProvider?: string;
  status: 'active' | 'disabled';
  createdAt: Date;
  lastLoginAt?: Date;
  tenants: { id: string; name: string; slug: string; role: string; joinedAt: Date }[];
  leagues: { id: string; name: string; sport: string; role: string; tenantName: string }[];
  activeContests: { id: string; name: string; sport: string; status: string; rank?: number }[];
  devices: { id: string; platform: string; lastActiveAt: Date; tokenStatus: string }[];
  recentAuthEvents: { type: string; timestamp: Date; ipAddress?: string; success: boolean }[];
}

export interface MergeResult {
  primaryUserId: string;
  duplicateUserId: string;
  leaguesTransferred: number;
  entriesTransferred: number;
  historyRecordsTransferred: number;
  mergedAt: Date;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UserService {
  /**
   * Searches users across all tenants with filtering and pagination.
   *
   * Placeholder: returns mock data. Will query users table via Prisma.
   */
  async searchUsers(
    query: UserSearchQuery,
  ): Promise<{ items: UserListItem[]; total: number }> {
    void query;

    // TODO: Replace with Prisma query against users table
    const mockItems: UserListItem[] = [
      {
        id: 'user-001',
        email: 'alice@example.com',
        displayName: 'Alice Johnson',
        tenants: [
          { id: '00000000-0000-0000-0000-000000000001', name: "Tiger's Corner", role: 'admin' },
        ],
        lastLoginAt: new Date(),
        status: 'active',
        createdAt: new Date('2025-06-20'),
      },
      {
        id: 'user-002',
        email: 'bob@example.com',
        displayName: 'Bob Smith',
        tenants: [
          { id: '00000000-0000-0000-0000-000000000001', name: "Tiger's Corner", role: 'member' },
          { id: '00000000-0000-0000-0000-000000000002', name: 'Golf Crew', role: 'admin' },
        ],
        lastLoginAt: new Date(Date.now() - 3_600_000),
        status: 'active',
        createdAt: new Date('2025-07-10'),
      },
      {
        id: 'user-003',
        email: 'carol@example.com',
        displayName: 'Carol Davis',
        tenants: [
          { id: '00000000-0000-0000-0000-000000000002', name: 'Golf Crew', role: 'member' },
        ],
        lastLoginAt: new Date(Date.now() - 86_400_000),
        status: 'active',
        createdAt: new Date('2025-08-05'),
      },
      {
        id: 'user-004',
        email: 'dave@example.com',
        displayName: 'Dave Wilson',
        tenants: [
          { id: '00000000-0000-0000-0000-000000000001', name: "Tiger's Corner", role: 'member' },
        ],
        lastLoginAt: undefined,
        status: 'disabled',
        createdAt: new Date('2025-09-15'),
      },
      {
        id: 'user-005',
        email: 'eve@example.com',
        displayName: 'Eve Martinez',
        tenants: [
          { id: '00000000-0000-0000-0000-000000000001', name: "Tiger's Corner", role: 'member' },
          { id: '00000000-0000-0000-0000-000000000002', name: 'Golf Crew', role: 'member' },
        ],
        lastLoginAt: new Date(Date.now() - 7_200_000),
        status: 'active',
        createdAt: new Date('2025-10-01'),
      },
    ];

    return { items: mockItems, total: mockItems.length };
  }

  /**
   * Returns the full admin detail view for a single user.
   *
   * Placeholder: returns mock data. Will aggregate from users, tenants,
   * leagues, contests, and devices tables via Prisma.
   */
  async getUserDetail(userId: string): Promise<UserDetailView> {
    // TODO: Replace with Prisma queries
    void userId;

    return {
      id: userId,
      email: 'alice@example.com',
      displayName: 'Alice Johnson',
      authProvider: 'email',
      status: 'active',
      createdAt: new Date('2025-06-20'),
      lastLoginAt: new Date(),
      tenants: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: "Tiger's Corner",
          slug: 'tigers-corner',
          role: 'admin',
          joinedAt: new Date('2025-06-20'),
        },
      ],
      leagues: [
        {
          id: 'league-001',
          name: 'NFL Sunday League',
          sport: 'nfl',
          role: 'commissioner',
          tenantName: "Tiger's Corner",
        },
        {
          id: 'league-002',
          name: 'March Madness 2026',
          sport: 'ncaa',
          role: 'member',
          tenantName: "Tiger's Corner",
        },
      ],
      activeContests: [
        {
          id: 'contest-001',
          name: 'Week 12 Picks',
          sport: 'nfl',
          status: 'in_progress',
          rank: 3,
        },
        {
          id: 'contest-002',
          name: 'Sweet 16 Bracket',
          sport: 'ncaa',
          status: 'open',
        },
      ],
      devices: [
        {
          id: 'device-001',
          platform: 'iOS',
          lastActiveAt: new Date(),
          tokenStatus: 'valid',
        },
        {
          id: 'device-002',
          platform: 'Web',
          lastActiveAt: new Date(Date.now() - 86_400_000),
          tokenStatus: 'valid',
        },
      ],
      recentAuthEvents: [
        {
          type: 'login',
          timestamp: new Date(),
          ipAddress: '192.168.1.100',
          success: true,
        },
        {
          type: 'login',
          timestamp: new Date(Date.now() - 86_400_000),
          ipAddress: '192.168.1.100',
          success: true,
        },
        {
          type: 'password_change',
          timestamp: new Date(Date.now() - 604_800_000),
          success: true,
        },
      ],
    };
  }

  /**
   * Triggers a password reset email for the user.
   */
  async resetUserPassword(
    userId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    // TODO: Trigger password reset email via auth service
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.reset_password',
      resourceType: 'USER',
      resourceId: userId,
      description: `Triggered password reset for user ${userId}`,
    });
  }

  /**
   * Invalidates all sessions for the user, forcing them to log in again.
   */
  async forceUserLogout(
    userId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    // TODO: Invalidate all session tokens for user via auth service
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.force_logout',
      resourceType: 'USER',
      resourceId: userId,
      description: `Force-logged out all sessions for user ${userId}`,
    });
  }

  /**
   * Disables a user account with a reason.
   */
  async disableUser(
    userId: string,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    // TODO: Set user status to 'disabled' via Prisma
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.disable',
      resourceType: 'USER',
      resourceId: userId,
      description: `Disabled user ${userId} — reason: ${reason}`,
      afterState: { status: 'disabled' },
      reason,
    });
  }

  /**
   * Re-enables a previously disabled user account.
   */
  async enableUser(
    userId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    // TODO: Set user status back to 'active' via Prisma
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.enable',
      resourceType: 'USER',
      resourceId: userId,
      description: `Re-enabled user ${userId}`,
      afterState: { status: 'active' },
    });
  }

  /**
   * Sends an administrative email to a user.
   */
  async sendAdminEmail(
    userId: string,
    subject: string,
    body: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    // TODO: Send email via notification service
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.send_email',
      resourceType: 'USER',
      resourceId: userId,
      description: `Sent admin email to user ${userId}: "${subject}"`,
      afterState: { subject },
    });
  }

  /**
   * Merges a duplicate user account into a primary account.
   * Transfers all memberships, entries, and history records.
   */
  async mergeUsers(
    primaryId: string,
    duplicateId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<MergeResult> {
    // TODO: Execute merge in a Prisma transaction:
    //   1. Transfer league memberships from duplicate to primary
    //   2. Transfer contest entries from duplicate to primary
    //   3. Transfer history records from duplicate to primary
    //   4. Disable the duplicate account

    const result: MergeResult = {
      primaryUserId: primaryId,
      duplicateUserId: duplicateId,
      leaguesTransferred: 2,
      entriesTransferred: 5,
      historyRecordsTransferred: 12,
      mergedAt: new Date(),
    };

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.merge',
      resourceType: 'USER',
      resourceId: primaryId,
      description: `Merged user ${duplicateId} into ${primaryId}`,
      afterState: {
        duplicateUserId: duplicateId,
        leaguesTransferred: result.leaguesTransferred,
        entriesTransferred: result.entriesTransferred,
        historyRecordsTransferred: result.historyRecordsTransferred,
      },
    });

    return result;
  }
}
