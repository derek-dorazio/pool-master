/**
 * AccountService — the self-service caller's half of the `User` lifecycle operations.
 *
 * #202 step 3.3: reads and single-entity writes go through `UserRepository`, which this file
 * previously bypassed entirely — 26 raw `prisma.user.*` calls and its own row shape and enum
 * mapping, a second copy of the User model living beside the admin one (§2y, §15).
 *
 * The profile, username and preference writes have LEFT this file. They are one operation
 * with two callers — `self` or `rootAdmin`, per A6 — and now live once in
 * `modules/users/user-profile-service.ts`. What stays here is what is genuinely
 * self-service: the password change, which requires the caller's current password, and the
 * lifecycle pair that carries session and cascade side effects.
 *
 * `prisma` remains a constructor parameter for the three things that are not
 * single-aggregate operations — `$transaction`, the delete cascade, the refresh-token
 * revoke — plus the one column the port deliberately never exposes, `passwordHash`.
 */
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import type { User } from '@poolmaster/shared/domain';
import {
  countUserDeleteDependencies,
  deleteUserCascade,
  hasUserDeleteDependencies,
  isLastRootAdmin,
  revokeUserSessions,
} from '../users/user-lifecycle';
import { UserOperationError } from '../users/user-errors';

const BCRYPT_ROUNDS = 12;

export class AccountService {
  constructor(
    private readonly users: UserRepository,
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Changes the caller's own password — `self` only, per A6, because it requires the current
   * one. Resetting somebody else's is a different operation with a different subject, and
   * lives on the admin service.
   */
  async changeOwnPassword(
    userId: string,
    request: {
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
      currentRefreshToken?: string | null;
    },
  ): Promise<void> {
    const credentials = await this.requireCredentials(userId);

    if (!credentials.passwordHash) {
      this.logger?.warn({
        action: 'accountService.changePassword.unavailable',
        data: { userId },
      }, 'Rejected password change for passwordless account');
      throw new UserOperationError(
        'Password change is unavailable for this account.',
        'ACCOUNT_PASSWORD_UNAVAILABLE',
        409,
      );
    }

    if (request.newPassword !== request.confirmNewPassword) {
      this.logger?.warn({
        action: 'accountService.changePassword.confirmationMismatch',
        data: { userId },
      }, 'Rejected password change due to confirmation mismatch');
      throw new UserOperationError(
        'New password confirmation does not match.',
        'PASSWORD_CONFIRMATION_MISMATCH',
        400,
      );
    }

    const currentMatches = await bcrypt.compare(request.currentPassword, credentials.passwordHash);
    if (!currentMatches) {
      this.logger?.warn({
        action: 'accountService.changePassword.invalidCurrentPassword',
        data: { userId },
      }, 'Rejected password change due to invalid current password');
      throw new UserOperationError(
        'Current password is incorrect.',
        'INVALID_CURRENT_PASSWORD',
        400,
      );
    }

    const passwordHash = await bcrypt.hash(request.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      // NOT revokeUserSessions: a password change keeps the caller's own session alive and
      // revokes every other one. Deliberately different from the blanket revoke, so do not
      // collapse the two.
      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(request.currentRefreshToken
            ? { NOT: { token: request.currentRefreshToken } }
            : {}),
        },
        data: { revokedAt: new Date() },
      });
    });
    this.logger?.info({
      action: 'accountService.changePassword.success',
      data: { userId },
    }, 'Changed account password');
  }

  async reactivateOwnAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);

    // #202 — idempotent. The desired state already holds, so this succeeds and returns the
    // account unchanged rather than raising ACCOUNT_ALREADY_ACTIVE. A retry after a network
    // timeout must not fail when the change it asked for is already in place.
    if (user.isActive) {
      this.logger?.info({
        action: 'accountService.reactivate.alreadyActive',
        data: { userId },
      }, 'Account already active; reactivate is a no-op');
      return user;
    }

    const updated = await this.users.update(userId, { isActive: true });
    this.logger?.info({
      action: 'accountService.reactivate.success',
      data: { userId: updated.id },
    }, 'Reactivated account');
    return updated;
  }

  async inactivateOwnAccount(userId: string): Promise<User> {
    const user = await this.requireUser(userId);

    // #202 — idempotent, as for reactivate. Returning early also means no second session
    // revoke for an account whose sessions were already revoked when it went inactive.
    if (!user.isActive) {
      this.logger?.info({
        action: 'accountService.inactivate.alreadyInactive',
        data: { userId },
      }, 'Account already inactive; inactivate is a no-op');
      return user;
    }

    // #202 — the same guard admin-disable applies. Without it the sole root admin could
    // inactivate their own account and leave the platform with nobody able to administer
    // it; inactivate is also the precondition for self-delete, so this is the first of the
    // two gates on that path.
    if (await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'accountService.inactivate.lastRootAdminRejected',
        data: { userId },
      }, 'Rejected self-inactivate by the last root admin');
      throw new UserOperationError(
        'You are the only root admin. Promote another root admin before deactivating your account.',
        'ACCOUNT_LAST_ROOT_ADMIN',
        409,
      );
    }

    // The flag and the session revoke must land together, or the account reads as inactive
    // while its refresh tokens still work — so the write goes through the transaction client
    // rather than the port, and the caller gets the resulting user from the port afterwards
    // rather than from a hand-assembled row.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      await revokeUserSessions(tx, userId);
    });

    this.logger?.info({
      action: 'accountService.inactivate.success',
      data: { userId },
    }, 'Inactivated account');
    return this.requireUser(userId);
  }

  async deleteOwnInactiveAccount(userId: string, confirmationEmail: string): Promise<void> {
    const user = await this.requireUser(userId);

    // The one place `isActive` IS a write precondition rather than a read filter — permanent
    // deletion is gated on it (access rule A9, "the one exception").
    if (user.isActive) {
      this.logger?.warn({
        action: 'accountService.delete.requiresInactive',
        data: { userId },
      }, 'Rejected account delete for active account');
      throw new UserOperationError(
        'Account must be inactive before it can be permanently deleted',
        'ACCOUNT_DELETE_REQUIRES_INACTIVE',
        409,
      );
    }

    if (user.email !== confirmationEmail) {
      this.logger?.warn({
        action: 'accountService.delete.confirmationMismatch',
        data: { userId },
      }, 'Rejected account delete due to confirmation mismatch');
      throw new UserOperationError(
        'Delete confirmation email must match the account email exactly',
        'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
        400,
      );
    }

    // #202 — the same guard admin-delete applies. Belt and braces with the inactivate
    // gate above: a root admin demoted to inactive before this rule existed can still
    // reach delete, and that must not be the path that empties the root-admin set.
    if (await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'accountService.delete.lastRootAdminRejected',
        data: { userId },
      }, 'Rejected self-delete by the last root admin');
      throw new UserOperationError(
        'You are the only root admin. Promote another root admin before deleting your account.',
        'ACCOUNT_LAST_ROOT_ADMIN',
        409,
      );
    }

    const counts = await countUserDeleteDependencies(this.prisma, userId);

    if (hasUserDeleteDependencies(counts)) {
      this.logger?.warn({
        action: 'accountService.delete.dependenciesExist',
        data: { userId, ...counts },
      }, 'Rejected account delete due to remaining dependencies');
      throw new UserOperationError(
        'Account still owns or belongs to league-scoped data. Remove those relationships before deleting the account.',
        'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
        409,
      );
    }

    await this.prisma.$transaction((tx) => deleteUserCascade(tx, userId));
    this.logger?.info({
      action: 'accountService.delete.success',
      data: { userId },
    }, 'Deleted inactive account');
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      this.logger?.warn({
        action: 'accountService.requireUser.notFound',
        data: { userId },
      }, 'Account operation rejected because the user was not found');
      throw new UserOperationError('User not found', 'USER_NOT_FOUND', 404);
    }
    return user;
  }

  /**
   * The one read that stays on Prisma: `passwordHash` is a secret, so `UserRepository`
   * deliberately never returns it, and the password change has to compare against it.
   */
  private async requireCredentials(userId: string): Promise<{ passwordHash: string | null }> {
    const credentials = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!credentials) {
      this.logger?.warn({
        action: 'accountService.requireCredentials.notFound',
        data: { userId },
      }, 'Account operation rejected because the user was not found');
      throw new UserOperationError('User not found', 'USER_NOT_FOUND', 404);
    }
    return credentials;
  }
}
