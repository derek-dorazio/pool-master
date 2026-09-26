/**
 * UserService — the root-admin caller's half of the `User` operations (#202 step 3.3).
 *
 * Reads and single-entity writes go through `UserRepository`. Before #202 this file held 36
 * raw `prisma.user.*` calls and its own row→view mapping, which is how a service with no
 * repository port ends up owning a second copy of the User model (§2y, §15). The port was
 * declared and never implemented; `PrismaUserRepository` now implements it, and this is one
 * of its two consumers.
 *
 * `prisma` is still a constructor parameter, and that is deliberate rather than a leftover.
 * Three things here are not single-aggregate operations and so do not belong behind a port:
 * `$transaction`, the eight-table delete cascade, and the refresh-token revoke. They live in
 * `modules/users/user-lifecycle.ts`, shared with the self-service path.
 */

import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository, UserSearchFilters } from '@poolmaster/shared/db';
import type { User } from '@poolmaster/shared/domain';
import { logAdminAction } from './admin-audit-service';
import {
  countUserDeleteDependencies,
  deleteUserCascade,
  hasUserDeleteDependencies,
  isLastRootAdmin,
  revokeUserSessions,
} from '../users/user-lifecycle';

const BCRYPT_ROUNDS = 12;

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
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

export class UserDeleteDependenciesExistError extends Error {
  constructor(userId: string) {
    super(`Account still owns or belongs to league-scoped data: ${userId}`);
    this.name = 'UserDeleteDependenciesExistError';
  }
}

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * The unscoped user read — access rule A1, root admin only, enforced by the route.
   *
   * Not paged (§16). Filters narrow the set; nothing slices it.
   */
  async searchUsers(filters: UserSearchFilters): Promise<User[]> {
    const users = await this.users.findAll(filters);
    this.logger?.info({
      action: 'adminUserService.search.success',
      data: { count: users.length },
    }, 'Searched users');
    return users;
  }

  /**
   * Reads one user as the canonical `User`.
   *
   * #202 — this returned a `UserDetailView` carrying a `viewerAuthority` block the service
   * computed from a `viewerUserId` parameter. Who is asking is request context, not a
   * property of the user being read, so it is assembled in the handler that already has the
   * caller. A8: viewer context is delivered once, by the surface that knows the viewer.
   */
  async getUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);

    if (!user) {
      this.logger?.warn({
        action: 'adminUserService.read.notFound',
        data: { userId },
      }, 'Admin user read not found');
      throw new UserNotFoundError(userId);
    }

    return user;
  }

  async forceUserLogout(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<void> {
    await this.getUser(userId);

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
    const user = await this.getUser(userId);

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

    if (await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'adminUserService.disable.lastRejected',
        data: { userId },
      }, 'Rejected disable of the last root admin');
      throw new LastRootAdminError(userId);
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
    const user = await this.getUser(userId);

    // #202 — idempotent, matching disable.
    if (user.isActive) {
      this.logger?.info({
        action: 'adminUserService.enable.alreadyActive',
        data: { userId },
      }, 'User already active; enable is a no-op');
      return;
    }

    await this.users.update(userId, { isActive: true });

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

  /**
   * Resets another user's password — access rule A6, `rootAdmin`. Distinct from a self-serve
   * change by SUBJECT, not just by precondition, which is why it is its own operation.
   *
   * The write stays on the transaction client: `passwordHash` is the one column
   * `UserRepository` deliberately never exposes, and it has to be atomic with the revoke.
   */
  async resetUserPassword(
    userId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
    reason?: string,
  ): Promise<{ temporaryPassword: string }> {
    await this.getUser(userId);

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
      // #202 — the EVENT is audited, not the credential state either side of it. The
      // before/after pair recorded `hadPassword` and `hasTemporaryPassword`, and neither
      // told a reader anything the action name does not.
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
    const user = await this.getUser(userId);
    const currentValue = user.isRootAdmin === true;

    if (nextValue === currentValue) {
      this.logger?.debug({
        action: 'adminUserService.setRootAdmin.noop',
        data: {
          userId,
          isRootAdmin: currentValue,
        },
      }, 'Skipping no-op root-admin role change');
      return;
    }

    // Self-demotion is permitted (#202): the only rule here is that the platform keeps an
    // administrator, and that is this count — for every caller, not just for the self case.
    if (!nextValue && await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'adminUserService.setRootAdmin.lastRejected',
        data: { userId },
      }, 'Rejected removal of the last root admin');
      throw new LastRootAdminError(userId);
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
    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'user.set_root_admin',
      resourceType: 'USER',
      resourceId: userId,
      description: nextValue
        ? `Granted root-admin role to user ${userId}`
        : `Revoked root-admin role from user ${userId}`,
      beforeState: { isRootAdmin: currentValue },
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
    const user = await this.getUser(userId);

    // The one place `isActive` IS a precondition on a write rather than a read filter —
    // permanent deletion is gated on it (access rule A9, "the one exception").
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

    if (await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'adminUserService.delete.lastRejected',
        data: { userId },
      }, 'Rejected delete of the last root admin');
      throw new LastRootAdminError(userId);
    }

    const counts = await countUserDeleteDependencies(this.prisma, userId);

    if (hasUserDeleteDependencies(counts)) {
      this.logger?.warn({
        action: 'adminUserService.delete.dependenciesExist',
        data: { userId, ...counts },
      }, 'Rejected delete due to remaining dependencies');
      throw new UserDeleteDependenciesExistError(userId);
    }

    const trimmedReason = reason?.trim() || undefined;

    await this.prisma.$transaction((tx) => deleteUserCascade(tx, userId));

    // #202 — audit is written AFTER the transaction commits, not inside the callback.
    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'user.delete',
      resourceType: 'USER',
      resourceId: userId,
      description: `Deleted inactive user ${userId}`,
      beforeState: { isActive: false, isRootAdmin: user.isRootAdmin === true },
      afterState: { deleted: true },
      reason: trimmedReason,
    });

    this.logger?.info({
      action: 'adminUserService.delete.success',
      data: { userId },
    }, 'Deleted user');
  }
}

function buildTemporaryPassword(): string {
  return `Pm-${randomBytes(12).toString('base64url')}!9a`;
}
