/**
 * UserService — business logic for root-admin user management operations.
 *
 * Root-admin reads should reflect the same underlying User model used by the
 * rest of the product rather than inventing a parallel admin-user shape.
 */

import { randomBytes } from 'node:crypto';
import type {
  PrismaClient,
  UserAuthProvider as PrismaUserAuthProvider,
  UserDateFormat as PrismaUserDateFormat,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyBaseLogger } from 'fastify';
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';
import { logAdminAction } from './admin-audit-service';
import {
  countUserDeleteDependencies,
  deleteUserCascade,
  findUserDeleteDependencyDetails,
  hasUserDeleteDependencies,
  revokeUserSessions,
  type UserDeleteDependencyDetails,
} from '../users/user-lifecycle';

const BCRYPT_ROUNDS = 12;

export interface UserSearchQuery {
  search?: string;
  isActive?: boolean;
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
  viewerAuthority: {
    self: boolean;
    rootAdmin: boolean;
    viewer: boolean;
  };
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

export class UserDeleteConfirmationMismatchError extends Error {
  constructor(userId: string) {
    super(`Delete confirmation email must match the account email exactly: ${userId}`);
    this.name = 'UserDeleteConfirmationMismatchError';
  }
}

export class UserDeleteRequiresInactiveError extends Error {
  constructor(userId: string) {
    super(`Account must be inactive before delete: ${userId}`);
    this.name = 'UserDeleteRequiresInactiveError';
  }
}

// UserDeleteDependencyDetails now lives in modules/users/user-lifecycle.ts (#202),
// shared with the self-service path that reports the same blockers.
export type { UserDeleteDependencyDetails };

export class UserDeleteDependenciesExistError extends Error {
  constructor(userId: string, readonly details?: UserDeleteDependencyDetails) {
    super(`Account still owns or belongs to league-scoped data: ${userId}`);
    this.name = 'UserDeleteDependenciesExistError';
  }
}

export class UserService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  // #202 — not paged (§16). Filters narrow the set; nothing slices it.
  async searchUsers(query: UserSearchQuery): Promise<UserListItem[]> {
    const trimmedSearch = query.search?.trim();
    this.logger?.debug({
      action: 'adminUserService.search.start',
      data: {
        hasSearch: Boolean(trimmedSearch),
        isActive: query.isActive ?? null,
      },
    }, 'Searching users');

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

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

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
      data: { count: items.length },
    }, 'Searched users');
    return items;
  }

  async getUserDetail(userId: string, viewerUserId: string): Promise<UserDetailView> {
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
      viewerAuthority: {
        self: userId === viewerUserId,
        rootAdmin: true,
        viewer: false,
      },
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

    const revokedCount = await revokeUserSessions(this.prisma, userId);

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
        revokedCount,
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

    // #202 — idempotent. Already inactive means the desired state holds, so this succeeds
    // without re-revoking sessions or writing a second audit entry for a change that did
    // not happen. Returning early also means the last-root-admin guard below cannot reject
    // a no-op.
    if (!user.isActive) {
      this.logger?.info({
        action: 'adminUserService.disable.alreadyInactive',
        data: { userId },
      }, 'User already inactive; disable is a no-op');
      return;
    }

    if (user.isRootAdmin) {
      const rootAdminCount = await this.prisma.user.count({
        where: { isRootAdmin: true },
      });
      if (rootAdminCount <= 1) {
        this.logger?.warn({
          action: 'adminUserService.disable.lastRejected',
          data: { userId, rootAdminCount },
        }, 'Rejected disable of the last root admin');
        throw new LastRootAdminError(userId);
      }
    }

    // #202 — one transaction. These were two statements, so a failure between them left
    // the user flagged inactive with live refresh tokens: disabled in the UI, still able
    // to refresh a session for up to the refresh-token lifetime.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });
      await revokeUserSessions(tx, userId);
    });

    // Deliberately outside the transaction. logAdminAction writes through its own client
    // and takes no transaction, so placing it inside a callback only looks atomic (#202).
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

    // #202 — idempotent, matching disable.
    if (user.isActive) {
      this.logger?.info({
        action: 'adminUserService.enable.alreadyActive',
        data: { userId },
      }, 'User already active; enable is a no-op');
      return;
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

  async resetUserPassword(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
    reason?: string,
  ): Promise<{ temporaryPassword: string }> {
    this.logger?.debug({
      action: 'adminUserService.resetPassword.start',
      data: { userId },
    }, 'Resetting user password');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.resetPassword.notFound',
        data: { userId },
      }, 'Cannot reset password for missing user');
      throw new UserNotFoundError(userId);
    }

    const temporaryPassword = buildTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    const trimmedReason = reason?.trim() || undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await revokeUserSessions(tx, userId);
    });

    // #202 — audit is written AFTER the transaction commits, not inside the callback.
    // logAdminAction writes through its own client and takes no transaction, so a call
    // inside the callback was never enrolled in it: the entry committed immediately and
    // would have survived a rollback, recording an action that did not happen.
    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'user.reset_password',
      resourceType: 'USER',
      resourceId: userId,
      description: `Reset password for user ${userId}`,
      beforeState: { hadPassword: Boolean(user.passwordHash) },
      afterState: { hasTemporaryPassword: true },
      reason: trimmedReason,
    });

    this.logger?.info({
      action: 'adminUserService.resetPassword.success',
      data: { userId },
    }, 'Reset user password');

    return { temporaryPassword };
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
        // Demotion revokes sessions so the removed authority cannot be used until re-login.
        await revokeUserSessions(tx, userId);
      }
    });

    // #202 — audit is written AFTER the transaction commits, not inside the callback.
    // logAdminAction writes through its own client and takes no transaction, so a call
    // inside the callback was never enrolled in it: the entry committed immediately and
    // would have survived a rollback, recording an action that did not happen.
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

    this.logger?.info({
      action: 'adminUserService.setRootAdmin.success',
      data: {
        userId,
        nextValue,
      },
    }, 'Updated root-admin role');
  }

  async deleteUser(
    userId: string,
    confirmationEmail: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
    reason?: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'adminUserService.delete.start',
      data: { userId },
    }, 'Deleting user');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        isRootAdmin: true,
      },
    });

    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.delete.notFound',
        data: { userId },
      }, 'Cannot delete missing user');
      throw new UserNotFoundError(userId);
    }

    if (user.isActive) {
      this.logger?.warn({
        action: 'adminUserService.delete.activeRejected',
        data: { userId },
      }, 'Rejected delete for active user');
      throw new UserDeleteRequiresInactiveError(userId);
    }

    if (user.email !== confirmationEmail) {
      this.logger?.warn({
        action: 'adminUserService.delete.confirmationMismatch',
        data: { userId },
      }, 'Rejected delete due to email confirmation mismatch');
      throw new UserDeleteConfirmationMismatchError(userId);
    }

    if (user.isRootAdmin) {
      const rootAdminCount = await this.prisma.user.count({
        where: { isRootAdmin: true },
      });
      if (rootAdminCount <= 1) {
        this.logger?.warn({
          action: 'adminUserService.delete.lastRejected',
          data: { userId, rootAdminCount },
        }, 'Rejected delete of the last root admin');
        throw new LastRootAdminError(userId);
      }
    }

    const counts = await countUserDeleteDependencies(this.prisma, userId);

    if (hasUserDeleteDependencies(counts)) {
      const dependencyDetails = await findUserDeleteDependencyDetails(
        this.prisma,
        userId,
        counts,
      );

      this.logger?.warn({
        action: 'adminUserService.delete.dependenciesExist',
        data: { userId, ...counts, dependencyDetails },
      }, 'Rejected delete due to remaining dependencies');
      throw new UserDeleteDependenciesExistError(userId, dependencyDetails);
    }

    const trimmedReason = reason?.trim() || undefined;

    await this.prisma.$transaction((tx) => deleteUserCascade(tx, userId));

    // #202 — audit is written AFTER the transaction commits, not inside the callback.
    // logAdminAction writes through its own client and takes no transaction, so a call
    // inside the callback was never enrolled in it: the entry committed immediately and
    // would have survived a rollback, recording an action that did not happen.
    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'user.delete',
      resourceType: 'USER',
      resourceId: userId,
      description: `Deleted inactive user ${userId}`,
      beforeState: { isActive: false, isRootAdmin: user.isRootAdmin },
      afterState: { deleted: true },
      reason: trimmedReason,
    });

    this.logger?.info({
      action: 'adminUserService.delete.success',
      data: { userId },
    }, 'Deleted user');
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

function buildTemporaryPassword(): string {
  return `Pm-${randomBytes(12).toString('base64url')}!9a`;
}
