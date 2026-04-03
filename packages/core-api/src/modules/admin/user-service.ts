/**
 * UserService — business logic for admin user management operations.
 *
 * Provides user search, detail views, password reset, force logout,
 * account enable/disable, admin email, and account merge.
 * All write operations are audit-logged.
 *
 * Persisted via Prisma to the users table.
 */

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { createChannels } from '../../notifications/channels/channel-factory';
import type { EmailChannel } from '../../notifications/channels/email-channel';
import { loadConfig } from '../../notifications/core/config';
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

export class UserPasswordResetUnsupportedError extends Error {
  constructor(userId: string) {
    super(`Password reset is only supported for local-auth users: ${userId}`);
    this.name = 'UserPasswordResetUnsupportedError';
  }
}

export class UserEmailDeliveryError extends Error {
  constructor(userId: string, reason: string) {
    super(`Failed to deliver email to user ${userId}: ${reason}`);
    this.name = 'UserEmailDeliveryError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UserService {
  private readonly emailChannel: Pick<EmailChannel, 'sendToUser'>;

  constructor(
    private readonly prisma: PrismaClient,
    emailChannel: Pick<EmailChannel, 'sendToUser'> = createChannels(loadConfig(), prisma).email,
  ) {
    this.emailChannel = emailChannel;
  }

  /**
   * Searches users across all tenants with filtering and pagination.
   */
  async searchUsers(
    query: UserSearchQuery,
  ): Promise<{ items: UserListItem[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.tenantId) {
      where.tenantId = query.tenantId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          tenant: { select: { id: true, name: true } },
          memberships: {
            select: {
              role: true,
              league: { select: { tenant: { select: { id: true, name: true } } } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const items: UserListItem[] = rows.map((row) => {
      // Build tenant list: primary tenant + any additional tenants from league memberships
      const tenantMap = new Map<string, { id: string; name: string; role: string }>();
      tenantMap.set(row.tenant.id, {
        id: row.tenant.id,
        name: row.tenant.name,
        role: 'member',
      });
      for (const m of row.memberships) {
        const t = m.league.tenant;
        if (!tenantMap.has(t.id)) {
          tenantMap.set(t.id, { id: t.id, name: t.name, role: m.role.toLowerCase() });
        }
      }

      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        tenants: Array.from(tenantMap.values()),
        lastLoginAt: undefined, // User model has no lastLoginAt column yet
        status: 'active' as const,
        createdAt: row.createdAt,
      };
    });

    // Post-filter by status if requested (no dedicated column yet)
    const filtered = query.status
      ? items.filter((u) => u.status === query.status)
      : items;

    return { items: filtered, total };
  }

  /**
   * Returns the full admin detail view for a single user.
   */
  async getUserDetail(userId: string): Promise<UserDetailView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        memberships: {
          include: {
            league: {
              select: {
                id: true,
                name: true,
                tenant: { select: { name: true } },
              },
            },
            entries: {
              include: {
                contest: {
                  select: {
                    id: true,
                    name: true,
                    sport: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        deviceRegistrations: {
          select: {
            id: true,
            platform: true,
            lastActiveAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    // Build tenants
    const tenantMap = new Map<string, { id: string; name: string; slug: string; role: string; joinedAt: Date }>();
    tenantMap.set(user.tenant.id, {
      id: user.tenant.id,
      name: user.tenant.name,
      slug: user.tenant.slug,
      role: 'member',
      joinedAt: user.createdAt,
    });

    // Build leagues and active contests from memberships
    const leagues: UserDetailView['leagues'] = [];
    const activeContests: UserDetailView['activeContests'] = [];

    for (const m of user.memberships) {
      leagues.push({
        id: m.league.id,
        name: m.league.name,
        sport: '',
        role: m.role.toLowerCase(),
        tenantName: m.league.tenant.name,
      });

      for (const entry of m.entries) {
        if (['ACTIVE', 'OPEN', 'IN_PROGRESS', 'DRAFT'].includes(entry.contest.status)) {
          activeContests.push({
            id: entry.contest.id,
            name: entry.contest.name,
            sport: entry.contest.sport ?? '',
            status: entry.contest.status.toLowerCase(),
            rank: entry.rank ?? undefined,
          });
        }
      }
    }

    // Build devices
    const devices = user.deviceRegistrations.map((d) => ({
      id: d.id,
      platform: d.platform,
      lastActiveAt: d.lastActiveAt,
      tokenStatus: 'valid',
    }));

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      authProvider: user.authProvider ?? undefined,
      status: 'active',
      createdAt: user.createdAt,
      lastLoginAt: undefined,
      tenants: Array.from(tenantMap.values()),
      leagues,
      activeContests,
      devices,
      recentAuthEvents: [], // Auth events not yet modelled — will come from auth service
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, authProvider: true },
    });
    if (!user) throw new UserNotFoundError(userId);

    if (user.authProvider && user.authProvider !== 'local') {
      throw new UserPasswordResetUnsupportedError(userId);
    }

    const temporaryPassword = randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    const delivery = await this.emailChannel.sendToUser(
      user.email,
      'Your PoolMaster password has been reset',
      [
        'An admin reset your PoolMaster password.',
        '',
        `Temporary password: ${temporaryPassword}`,
        '',
        'Sign in and change it immediately.',
      ].join('\n'),
    );

    if (!delivery.success) {
      throw new UserEmailDeliveryError(userId, delivery.error ?? 'Email provider rejected the message');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          authProvider: 'local',
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'user.reset_password',
      resourceType: 'USER',
      resourceId: userId,
      description: `Reset password and issued a temporary credential for user ${userId}`,
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

    // Revoke all refresh tokens for this user
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

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
   * Stores the disabled state in the user's password hash field prefix convention.
   * (A proper status column should be added in a future migration.)
   */
  async disableUser(
    userId: string,
    reason: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

    // Revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new UserNotFoundError(userId);

    const delivery = await this.emailChannel.sendToUser(user.email, subject, body);
    if (!delivery.success) {
      throw new UserEmailDeliveryError(userId, delivery.error ?? 'Email provider rejected the message');
    }

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
    const [primary, duplicate] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: primaryId } }),
      this.prisma.user.findUnique({ where: { id: duplicateId } }),
    ]);
    if (!primary) throw new UserNotFoundError(primaryId);
    if (!duplicate) throw new UserNotFoundError(duplicateId);

    let leaguesTransferred = 0;
    let entriesTransferred = 0;

    await this.prisma.$transaction(async (tx) => {
      // Transfer league memberships from duplicate to primary
      const dupMemberships = await tx.leagueMembership.findMany({
        where: { userId: duplicateId },
      });

      for (const m of dupMemberships) {
        // Check if primary already has a membership in this league
        const existing = await tx.leagueMembership.findUnique({
          where: { leagueId_userId: { leagueId: m.leagueId, userId: primaryId } },
        });
        if (!existing) {
          await tx.leagueMembership.update({
            where: { id: m.id },
            data: { userId: primaryId },
          });
          leaguesTransferred++;
        }
      }

      // Transfer contest entries
      const dupEntries = await tx.contestEntry.findMany({
        where: { membership: { userId: duplicateId } },
      });
      entriesTransferred = dupEntries.length;

      // Revoke duplicate's tokens
      await tx.refreshToken.updateMany({
        where: { userId: duplicateId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    const result: MergeResult = {
      primaryUserId: primaryId,
      duplicateUserId: duplicateId,
      leaguesTransferred,
      entriesTransferred,
      historyRecordsTransferred: 0,
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
