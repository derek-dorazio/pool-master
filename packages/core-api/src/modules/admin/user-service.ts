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

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

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
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
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

    return { items, total };
  }

  async getUserDetail(userId: string): Promise<UserDetailView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UserNotFoundError(userId);
    }

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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

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

  async disableUser(
    userId: string,
    reason: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

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
  }

  async enableUser(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError(userId);

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
