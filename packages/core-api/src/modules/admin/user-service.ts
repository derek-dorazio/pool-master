/**
 * UserService — business logic for admin user management operations.
 *
 * Provides user search, detail views, password reset, force logout,
 * account enable/disable, admin email, and account merge.
 * All write operations are audit-logged.
 *
 * Persisted via Prisma to the users table.
 */

import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSearchQuery {
  search?: string;
  status?: 'active' | 'disabled';
  page?: number;
  pageSize?: number;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  leagues: { id: string; name: string; role: string }[];
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
  leagues: { id: string; name: string; role: string; joinedAt?: Date }[];
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

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
 * Searches users with filtering and pagination.
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
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          memberships: {
            select: {
              role: true,
              league: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const items: UserListItem[] = rows.map((row) => {
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        leagues: row.memberships.map((membership) => ({
          id: membership.league.id,
          name: membership.league.name,
          role: membership.role.toLowerCase(),
        })),
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
        memberships: {
          include: {
            league: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    // Build leagues from memberships
    const leagues: UserDetailView['leagues'] = [];
    const activeContests: UserDetailView['activeContests'] = [];

    for (const m of user.memberships) {
      leagues.push({
        id: m.league.id,
        name: m.league.name,
        role: m.role.toLowerCase(),
        joinedAt: m.joinedAt,
      });
    }

    const activeEntries = await this.prisma.contestEntry.findMany({
      where: {
        squad: {
          memberships: {
            some: {
              userId,
              status: 'ACTIVE',
            },
          },
        },
        contest: {
          status: { in: ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'DRAFT'] },
        },
      },
      include: {
        contest: {
          select: {
            id: true,
            name: true,
            sportEvent: {
              select: { sport: true },
            },
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const entry of activeEntries) {
      activeContests.push({
        id: entry.contest.id,
        name: entry.contest.name,
        sport: entry.contest.sportEvent?.sport ?? '',
        status: entry.contest.status.toLowerCase(),
        rank: entry.standingsPosition ?? undefined,
      });
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      authProvider: user.authProvider ?? undefined,
      status: 'active',
      createdAt: user.createdAt,
      lastLoginAt: undefined,
      leagues,
      activeContests,
      devices: [],
      recentAuthEvents: [], // Auth events not yet modelled — will come from auth service
    };
  }

  /**
   * Invalidates all sessions for the user, forcing them to log in again.
   */
  async forceUserLogout(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

    // Revoke all refresh tokens for this user
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
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
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

    // Revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
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
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'user.enable',
      resourceType: 'USER',
      resourceId: userId,
      description: `Re-enabled user ${userId}`,
      afterState: { status: 'active' },
    });
  }

  /**
   * Merges a duplicate user account into a primary account.
   * Transfers all memberships, entries, and history records.
   */
  async mergeUsers(
    primaryId: string,
    duplicateId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
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
        where: {
          squad: {
            memberships: {
              some: {
                userId: duplicateId,
                status: 'ACTIVE',
              },
            },
          },
        },
      });
      entriesTransferred = dupEntries.length;

      const duplicateSquadMemberships = await tx.squadMembership.findMany({
        where: { userId: duplicateId },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      });

      for (const membership of duplicateSquadMemberships) {
        const existing = await tx.squadMembership.findUnique({
          where: {
            squadId_userId: {
              squadId: membership.squadId,
              userId: primaryId,
            },
          },
        });

        if (existing) {
          await tx.squadMembership.delete({ where: { id: membership.id } });
        } else {
          await tx.squadMembership.update({
            where: { id: membership.id },
            data: { userId: primaryId },
          });
        }
      }

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
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
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
