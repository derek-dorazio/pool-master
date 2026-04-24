/**
 * UserService — business logic for root-admin user management operations.
 *
 * Root-admin reads should reflect the same underlying User model used by the
 * rest of the product rather than inventing a parallel admin-user shape.
 */

import type {
  PrismaClient,
  UserAuthProvider as PrismaUserAuthProvider,
  UserDateFormat as PrismaUserDateFormat,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';
import { logAdminAction } from './admin-audit-service';

export interface UserSearchQuery {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface UserListItem {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isRootAdmin: boolean;
  authProvider?: AuthProvider;
  isActive: boolean;
  timezone?: string;
  locale?: string;
  timeFormat?: TimeFormat;
  dateFormat?: DateFormat;
  createdAt: Date;
}

export interface UserDetailView {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isRootAdmin: boolean;
  authProvider?: AuthProvider;
  isActive: boolean;
  timezone?: string;
  locale?: string;
  timeFormat?: TimeFormat;
  dateFormat?: DateFormat;
  createdAt: Date;
}

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

export class SelfRootAdminChangeError extends Error {
  constructor(userId: string) {
    super(`Root admins cannot change their own root-admin role: ${userId}`);
    this.name = 'SelfRootAdminChangeError';
  }
}

export class LastRootAdminError extends Error {
  constructor(userId: string) {
    super(`Cannot remove the last remaining root admin: ${userId}`);
    this.name = 'LastRootAdminError';
  }
}

export class UserService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async searchUsers(
    query: UserSearchQuery,
  ): Promise<{ items: UserListItem[]; total: number }> {
    const trimmedSearch = query.search?.trim();
    this.logger?.debug({
      action: 'adminUserService.search.start',
      data: {
        hasSearch: Boolean(trimmedSearch),
        isActive: query.isActive ?? null,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 25,
      },
    }, 'Searching users');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};

    if (trimmedSearch) {
      where.OR = [
        { email: { contains: trimmedSearch, mode: 'insensitive' } },
        { username: { contains: trimmedSearch, mode: 'insensitive' } },
        { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
        { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
      ];
    }
    if (typeof query.isActive === 'boolean') {
      where.isActive = query.isActive;
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const items: UserListItem[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      isRootAdmin: row.isRootAdmin,
      authProvider: mapAuthProvider(row.authProvider),
      isActive: row.isActive,
      timezone: row.timezone ?? undefined,
      locale: row.locale ?? undefined,
      timeFormat: mapTimeFormat(row.timeFormat),
      dateFormat: mapDateFormat(row.dateFormat),
      createdAt: row.createdAt,
    }));

    this.logger?.info({
      action: 'adminUserService.search.success',
      data: {
        total,
        count: items.length,
        page,
        pageSize,
      },
    }, 'Searched users');
    return { items, total };
  }

  async getUserDetail(userId: string): Promise<UserDetailView> {
    this.logger?.debug({
      action: 'adminUserService.detail.start',
      data: { userId },
    }, 'Loading admin user detail');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.detail.notFound',
        data: { userId },
      }, 'Admin user detail not found');
      throw new UserNotFoundError(userId);
    }

    this.logger?.info({
      action: 'adminUserService.detail.success',
      data: { userId },
    }, 'Loaded admin user detail');
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      isRootAdmin: user.isRootAdmin,
      authProvider: mapAuthProvider(user.authProvider),
      isActive: user.isActive,
      timezone: user.timezone ?? undefined,
      locale: user.locale ?? undefined,
      timeFormat: mapTimeFormat(user.timeFormat),
      dateFormat: mapDateFormat(user.dateFormat),
      createdAt: user.createdAt,
    };
  }

  async forceUserLogout(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'adminUserService.forceLogout.start',
      data: { userId },
    }, 'Force-logging out user');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.forceLogout.notFound',
        data: { userId },
      }, 'Cannot force logout missing user');
      throw new UserNotFoundError(userId);
    }

    const result = await this.prisma.refreshToken.updateMany({
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
    this.logger?.info({
      action: 'adminUserService.forceLogout.success',
      data: {
        userId,
        revokedCount: result.count,
      },
    }, 'Force-logged out user');
  }

  async disableUser(
    userId: string,
    reason: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'adminUserService.disable.start',
      data: { userId },
    }, 'Disabling user');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.disable.notFound',
        data: { userId },
      }, 'Cannot disable missing user');
      throw new UserNotFoundError(userId);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

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
      afterState: { isActive: false },
      reason,
    });
    this.logger?.info({
      action: 'adminUserService.disable.success',
      data: { userId, reason },
    }, 'Disabled user');
  }

  async enableUser(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'adminUserService.enable.start',
      data: { userId },
    }, 'Enabling user');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.enable.notFound',
        data: { userId },
      }, 'Cannot enable missing user');
      throw new UserNotFoundError(userId);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'user.enable',
      resourceType: 'USER',
      resourceId: userId,
      description: `Re-enabled user ${userId}`,
      afterState: { isActive: true },
    });
    this.logger?.info({
      action: 'adminUserService.enable.success',
      data: { userId },
    }, 'Enabled user');
  }

  async setRootAdmin(
    userId: string,
    nextValue: boolean,
    rootAdminUserId: string,
    rootAdminEmail: string,
    reason?: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'adminUserService.setRootAdmin.start',
      data: {
        userId,
        nextValue,
      },
    }, 'Updating root-admin role');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.setRootAdmin.notFound',
        data: { userId },
      }, 'Cannot change root-admin role for missing user');
      throw new UserNotFoundError(userId);
    }

    if (nextValue === user.isRootAdmin) {
      this.logger?.debug({
        action: 'adminUserService.setRootAdmin.noop',
        data: {
          userId,
          isRootAdmin: user.isRootAdmin,
        },
      }, 'Skipping no-op root-admin role change');
      return;
    }

    if (!nextValue && userId === rootAdminUserId) {
      this.logger?.warn({
        action: 'adminUserService.setRootAdmin.selfRejected',
        data: { userId },
      }, 'Rejected self root-admin role change');
      throw new SelfRootAdminChangeError(userId);
    }

    if (!nextValue && user.isRootAdmin) {
      const rootAdminCount = await this.prisma.user.count({
        where: { isRootAdmin: true },
      });
      if (rootAdminCount <= 1) {
        this.logger?.warn({
          action: 'adminUserService.setRootAdmin.lastRejected',
          data: { userId, rootAdminCount },
        }, 'Rejected removal of the last root admin');
        throw new LastRootAdminError(userId);
      }
    }

    const trimmedReason = reason?.trim() || undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isRootAdmin: nextValue },
      });

      if (!nextValue) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await logAdminAction({
        actorUserId: rootAdminUserId,
        actorEmail: rootAdminEmail,
        action: 'user.set_root_admin',
        resourceType: 'USER',
        resourceId: userId,
        description: nextValue
          ? `Granted root-admin role to user ${userId}`
          : `Revoked root-admin role from user ${userId}`,
        beforeState: { isRootAdmin: user.isRootAdmin },
        afterState: { isRootAdmin: nextValue },
        reason: trimmedReason,
      });
    });

    this.logger?.info({
      action: 'adminUserService.setRootAdmin.success',
      data: {
        userId,
        nextValue,
      },
    }, 'Updated root-admin role');
  }
}

function mapAuthProvider(provider: PrismaUserAuthProvider | null | undefined): AuthProvider | undefined {
  if (provider === 'EMAIL') return AuthProvider.EMAIL;
  if (provider === 'GOOGLE') return AuthProvider.GOOGLE;
  if (provider === 'APPLE') return AuthProvider.APPLE;
  return undefined;
}

function mapTimeFormat(value: PrismaUserTimeFormat | null | undefined): TimeFormat | undefined {
  if (value === 'TWELVE_HOUR') return TimeFormat.TWELVE_HOUR;
  if (value === 'TWENTY_FOUR_HOUR') return TimeFormat.TWENTY_FOUR_HOUR;
  return undefined;
}

function mapDateFormat(value: PrismaUserDateFormat | null | undefined): DateFormat | undefined {
  if (value === 'MDY') return DateFormat.MDY;
  if (value === 'DMY') return DateFormat.DMY;
  if (value === 'YMD') return DateFormat.YMD;
  return undefined;
}
