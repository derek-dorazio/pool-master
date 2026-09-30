/**
 * The `User` operations. One implementation per operation, for every caller (#202 step 3.4).
 *
 * This replaces `admin/user-service.ts` and `account/service.ts`, which implemented the same
 * operations twice — once for a root admin acting on somebody, once for a user acting on
 * themselves. `docs/DOMAIN-OPERATIONS.md` lists them as eight pairs that are **one operation
 * with two callers**: disable, enable, delete, revoke sessions, read one, list, update
 * profile/username/preferences.
 *
 * **Scope is a parameter of the operation, not a second operation.** Every method takes the
 * actor and the subject. When they are the same id it is self-service; when they differ the
 * actor must be a root admin. That rule is stated once, in `requireWritableUser` and
 * `requireReadableUser`, rather than being implicit in which route prefix the request arrived
 * on — which is how the two halves came to disagree about their guards in the first place.
 *
 * `prisma` is a constructor parameter for the three things that are not single-aggregate
 * operations — `$transaction`, the six-table delete cascade, the refresh-token revoke, all
 * in `user-lifecycle.ts` — plus the one column `UserRepository` deliberately never serves,
 * `passwordHash`.
 */
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository, UserSearchFilters } from '@poolmaster/shared/db';
import type { DateFormat, TimeFormat, User } from '@poolmaster/shared/domain';
import { UserOperationError } from './user-errors';
import {
  countUserDeleteDependencies,
  deleteUserCascade,
  hasUserDeleteDependencies,
  isLastRootAdmin,
  revokeUserSessions,
} from './user-lifecycle';

const BCRYPT_ROUNDS = 12;

/** Who is asking. Both fields come straight off the authenticated request. */
export interface UserWriteActor {
  userId: string;
  isRootAdmin: boolean;
}

export interface UserProfileUpdate {
  firstName: string;
  lastName: string;
  email: string;
}

export interface UserPreferencesUpdate {
  timezone?: string | null;
  locale?: string | null;
  timeFormat?: TimeFormat | null;
  dateFormat?: DateFormat | null;
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  /** Kept alive across the change; every other session is revoked. */
  currentRefreshToken?: string | null;
}

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  // --- Reads ------------------------------------------------------------------

  /**
   * The unscoped read — access rule A1, root admin only. Not paged (§16): filters narrow the
   * set, nothing slices it.
   */
  async listUsers(actor: UserWriteActor, filters: UserSearchFilters): Promise<User[]> {
    this.requireRootAdmin(actor, 'list users');
    const users = await this.users.findAll(filters);
    this.logger?.info({
      action: 'userService.list.success',
      data: { actorUserId: actor.userId, count: users.length },
    }, 'Listed users');
    return users;
  }

  /** Read one — A6: `self` or `rootAdmin`. */
  async readUser(actor: UserWriteActor, targetUserId: string): Promise<User> {
    return this.requireReadableUser(actor, targetUserId);
  }

  // --- Profile writes ---------------------------------------------------------

  async updateProfile(
    actor: UserWriteActor,
    targetUserId: string,
    updates: UserProfileUpdate,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);
    const email = updates.email.trim().toLowerCase();
    await this.assertIdentifierAvailable(email, user.id, 'ACCOUNT_EMAIL_TAKEN');

    const updated = await this.users.update(user.id, {
      email,
      firstName: updates.firstName.trim(),
      lastName: updates.lastName.trim(),
    });
    this.logger?.info({
      action: 'userService.updateProfile.success',
      data: { userId: updated.id, actorUserId: actor.userId },
    }, 'Updated user profile');
    return updated;
  }

  async updateUsername(
    actor: UserWriteActor,
    targetUserId: string,
    username: string,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);
    const normalized = username.trim().toLowerCase();
    await this.assertIdentifierAvailable(normalized, user.id, 'ACCOUNT_USERNAME_TAKEN');

    const updated = await this.users.update(user.id, { username: normalized });
    this.logger?.info({
      action: 'userService.updateUsername.success',
      data: { userId: updated.id, actorUserId: actor.userId },
    }, 'Updated user username');
    return updated;
  }

  async updatePreferences(
    actor: UserWriteActor,
    targetUserId: string,
    updates: UserPreferencesUpdate,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);

    // `undefined` means "leave it"; `null` means "clear it". The port keeps that distinction,
    // so this passes the caller's intent straight through.
    const updated = await this.users.update(user.id, {
      ...(updates.timezone !== undefined && { timezone: normalizeOptional(updates.timezone) }),
      ...(updates.locale !== undefined && { locale: normalizeOptional(updates.locale) }),
      ...(updates.timeFormat !== undefined && { timeFormat: updates.timeFormat }),
      ...(updates.dateFormat !== undefined && { dateFormat: updates.dateFormat }),
    });
    this.logger?.info({
      action: 'userService.updatePreferences.success',
      data: { userId: updated.id, actorUserId: actor.userId },
    }, 'Updated user preferences');
    return updated;
  }

  // --- Credentials ------------------------------------------------------------

  /**
   * Changing your own password — `self` only, because it requires the current one. A6
   * distinguishes this from a reset by SUBJECT, not just by precondition, so they are two
   * operations rather than one with a flag.
   */
  async changeOwnPassword(
    actor: UserWriteActor,
    targetUserId: string,
    request: PasswordChangeRequest,
  ): Promise<void> {
    if (actor.userId !== targetUserId) {
      throw new UserOperationError(
        'You may only change your own password. Use the password reset operation instead.',
        'USER_WRITE_FORBIDDEN',
        403,
      );
    }
    const credentials = await this.requireCredentials(targetUserId);

    if (!credentials.passwordHash) {
      this.logger?.warn({
        action: 'userService.changePassword.unavailable',
        data: { userId: targetUserId },
      }, 'Rejected password change for passwordless account');
      throw new UserOperationError(
        'Password change is unavailable for this account.',
        'ACCOUNT_PASSWORD_UNAVAILABLE',
        409,
      );
    }

    if (request.newPassword !== request.confirmNewPassword) {
      throw new UserOperationError(
        'New password confirmation does not match.',
        'PASSWORD_CONFIRMATION_MISMATCH',
        400,
      );
    }

    if (!await bcrypt.compare(request.currentPassword, credentials.passwordHash)) {
      this.logger?.warn({
        action: 'userService.changePassword.invalidCurrentPassword',
        data: { userId: targetUserId },
      }, 'Rejected password change due to invalid current password');
      throw new UserOperationError('Current password is incorrect.', 'INVALID_CURRENT_PASSWORD', 400);
    }

    const passwordHash = await bcrypt.hash(request.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: targetUserId }, data: { passwordHash } });

      // NOT revokeUserSessions: a password change keeps the caller's own session alive and
      // revokes every other one. Deliberately different from the blanket revoke, so do not
      // collapse the two.
      await tx.refreshToken.updateMany({
        where: {
          userId: targetUserId,
          revokedAt: null,
          ...(request.currentRefreshToken ? { NOT: { token: request.currentRefreshToken } } : {}),
        },
        data: { revokedAt: new Date() },
      });
    });
    this.logger?.info({
      action: 'userService.changePassword.success',
      data: { userId: targetUserId },
    }, 'Changed own password');
  }

  /**
   * Resetting somebody else's password — `rootAdmin`. No current password, and the subject
   * differs from the actor, which is what makes it a separate operation from the change above.
   */
  async resetPassword(
    actor: UserWriteActor,
    targetUserId: string,
  ): Promise<{ temporaryPassword: string }> {
    this.requireRootAdmin(actor, 'reset another user password');
    const user = await this.requireUser(targetUserId);

    const temporaryPassword = buildTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await revokeUserSessions(tx, user.id);
    });

    this.logger?.info({
      action: 'userService.resetPassword.success',
      data: { userId: user.id },
    }, 'Reset user password');

    return { temporaryPassword };
  }

  // --- Lifecycle --------------------------------------------------------------

  /**
   * Disable — `self` or `rootAdmin`. **Self-inactivate and admin-disable are one operation**;
   * they were `inactivateAccount` and `adminDisableUser`, and only the admin half carried the
   * last-root-admin guard.
   *
   * Idempotent: already inactive means the desired state holds, so this succeeds without
   * re-revoking sessions for a change that did not happen.
   * Returning early also means the guard below cannot reject a no-op.
   */
  async disableUser(
    actor: UserWriteActor,
    targetUserId: string,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);

    if (!user.isActive) {
      this.logger?.info({
        action: 'userService.disable.alreadyInactive',
        data: { userId: user.id },
      }, 'User already inactive; disable is a no-op');
      return user;
    }

    if (await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'userService.disable.lastRootAdminRejected',
        data: { userId: user.id },
      }, 'Rejected disable of the last root admin');
      throw new UserOperationError(
        'This is the only root admin. Promote another root admin before deactivating the account.',
        'ACCOUNT_LAST_ROOT_ADMIN',
        409,
      );
    }

    // One transaction. These were two statements, so a failure between them left the user
    // flagged inactive with live refresh tokens: disabled in the UI, still able to refresh a
    // session for up to the refresh-token lifetime.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
      await revokeUserSessions(tx, user.id);
    });

    this.logger?.info({
      action: 'userService.disable.success',
      data: { userId: user.id, actorUserId: actor.userId },
    }, 'Disabled user');
    return this.requireUser(user.id);
  }

  /** Enable — `self` or `rootAdmin`, idempotent, matching disable. */
  async enableUser(actor: UserWriteActor, targetUserId: string): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);

    if (user.isActive) {
      this.logger?.info({
        action: 'userService.enable.alreadyActive',
        data: { userId: user.id },
      }, 'User already active; enable is a no-op');
      return user;
    }

    const updated = await this.users.update(user.id, { isActive: true });
    this.logger?.info({
      action: 'userService.enable.success',
      data: { userId: user.id, actorUserId: actor.userId },
    }, 'Enabled user');
    return updated;
  }

  /**
   * Revoke every live session — `self` or `rootAdmin`. Self-logout-everywhere and
   * `adminForceLogout` are one operation.
   */
  async revokeSessions(actor: UserWriteActor, targetUserId: string): Promise<number> {
    const user = await this.requireWritableUser(actor, targetUserId);
    const revokedCount = await revokeUserSessions(this.prisma, user.id);

    this.logger?.info({
      action: 'userService.revokeSessions.success',
      data: { userId: user.id, revokedCount },
    }, 'Revoked user sessions');
    return revokedCount;
  }

  /**
   * Permanent delete — `self` or `rootAdmin`, and the ONE place `isActive` gates a write
   * rather than filtering a read (access rule A9, "the one exception").
   */
  async deleteUser(
    actor: UserWriteActor,
    targetUserId: string,
    confirmationEmail: string,
  ): Promise<void> {
    const user = await this.requireWritableUser(actor, targetUserId);

    if (user.isActive) {
      this.logger?.warn({
        action: 'userService.delete.requiresInactive',
        data: { userId: user.id },
      }, 'Rejected delete for active user');
      throw new UserOperationError(
        'Account must be inactive before it can be permanently deleted',
        'ACCOUNT_DELETE_REQUIRES_INACTIVE',
        409,
      );
    }

    if (user.email !== confirmationEmail) {
      this.logger?.warn({
        action: 'userService.delete.confirmationMismatch',
        data: { userId: user.id },
      }, 'Rejected delete due to email confirmation mismatch');
      throw new UserOperationError(
        'Delete confirmation email must match the account email exactly',
        'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
        400,
      );
    }

    // Belt and braces with the disable gate: a root admin who went inactive before that rule
    // existed can still reach delete, and that must not be the path that empties the
    // root-admin set.
    if (await isLastRootAdmin(this.users, user)) {
      throw new UserOperationError(
        'This is the only root admin. Promote another root admin before deleting the account.',
        'ACCOUNT_LAST_ROOT_ADMIN',
        409,
      );
    }

    const counts = await countUserDeleteDependencies(this.prisma, user.id);
    if (hasUserDeleteDependencies(counts)) {
      this.logger?.warn({
        action: 'userService.delete.dependenciesExist',
        data: { userId: user.id, ...counts },
      }, 'Rejected delete due to remaining dependencies');
      throw new UserOperationError(
        'Account still owns or belongs to league-scoped data. Remove those relationships before deleting the account.',
        'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
        409,
      );
    }

    await this.prisma.$transaction((tx) => deleteUserCascade(tx, user.id));

    this.logger?.info({
      action: 'userService.delete.success',
      data: { userId: user.id, actorUserId: actor.userId },
    }, 'Deleted user');
  }

  /**
   * Grant or revoke the platform role — `rootAdmin` only.
   *
   * Self-demotion is permitted (#202): the only rule is that the platform keeps an
   * administrator, and that is the last-root-admin count, which applies to every caller.
   */
  async setRootAdmin(
    actor: UserWriteActor,
    targetUserId: string,
    nextValue: boolean,
  ): Promise<void> {
    this.requireRootAdmin(actor, 'change a root-admin role');
    const user = await this.requireUser(targetUserId);
    const currentValue = user.isRootAdmin === true;

    if (nextValue === currentValue) {
      this.logger?.debug({
        action: 'userService.setRootAdmin.noop',
        data: { userId: user.id, isRootAdmin: currentValue },
      }, 'Skipping no-op root-admin role change');
      return;
    }

    if (!nextValue && await isLastRootAdmin(this.users, user)) {
      this.logger?.warn({
        action: 'userService.setRootAdmin.lastRootAdminRejected',
        data: { userId: user.id },
      }, 'Rejected removal of the last root admin');
      throw new UserOperationError(
        'Cannot remove the last remaining root admin.',
        'LAST_ROOT_ADMIN',
        409,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isRootAdmin: nextValue } });
      if (!nextValue) {
        // Demotion revokes sessions so the removed authority cannot be used until re-login.
        await revokeUserSessions(tx, user.id);
      }
    });

    this.logger?.info({
      action: 'userService.setRootAdmin.success',
      data: { userId: user.id, nextValue },
    }, 'Updated root-admin role');
  }

  // --- The authority rules, stated once ---------------------------------------

  /**
   * Access rule A6: a `User` is written by themselves or by a root admin. A commissioner has
   * no write row here.
   *
   * Note what is NOT checked: `isActive`. Per A9 `isActive` is a read filter, not a write
   * lock, so an inactive account can still correct its own details — which is the
   * precondition for reactivating it, not a reason to freeze it.
   */
  private async requireWritableUser(actor: UserWriteActor, targetUserId: string): Promise<User> {
    if (actor.userId !== targetUserId && !actor.isRootAdmin) {
      this.logger?.warn({
        action: 'userService.forbidden',
        data: { userId: targetUserId, actorUserId: actor.userId },
      }, 'Rejected user write by a caller who is neither the subject nor a root admin');
      throw new UserOperationError(
        'You may only change your own account.',
        'USER_WRITE_FORBIDDEN',
        403,
      );
    }
    return this.requireUser(targetUserId);
  }

  /** A6 again — reads of one user are the same two callers. */
  private async requireReadableUser(actor: UserWriteActor, targetUserId: string): Promise<User> {
    if (actor.userId !== targetUserId && !actor.isRootAdmin) {
      throw new UserOperationError(
        'You may only read your own account.',
        'USER_READ_FORBIDDEN',
        403,
      );
    }
    return this.requireUser(targetUserId);
  }

  private requireRootAdmin(actor: UserWriteActor, what: string): void {
    if (!actor.isRootAdmin) {
      throw new UserOperationError(
        `Root-admin authority is required to ${what}.`,
        'ROOT_ADMIN_ACCESS_REQUIRED',
        403,
      );
    }
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      this.logger?.warn({
        action: 'userService.requireUser.notFound',
        data: { userId },
      }, 'User operation rejected because the user was not found');
      throw new UserOperationError(`User not found: ${userId}`, 'USER_NOT_FOUND', 404);
    }
    return user;
  }

  /**
   * Rejects an email or username already held by someone else.
   *
   * One check for both, because both columns are `@unique` and login accepts either: a
   * username that matches another account's email is just as unusable as a duplicate
   * username. `account/service.ts` had this twice, as `assertEmailAvailableForUser` and
   * `assertUsernameAvailableForUser`, identical but for the order of the `OR` arms.
   */
  private async assertIdentifierAvailable(
    identifier: string,
    targetUserId: string,
    code: 'ACCOUNT_EMAIL_TAKEN' | 'ACCOUNT_USERNAME_TAKEN',
  ): Promise<void> {
    const holder = await this.users.findByIdentifier(identifier);
    if (!holder || holder.id === targetUserId) {
      return;
    }

    this.logger?.warn({
      action: 'userService.identifierTaken',
      errorCode: code,
      data: { userId: targetUserId, conflictingUserId: holder.id },
    }, 'Rejected user write because the identifier is already in use');
    throw new UserOperationError(
      code === 'ACCOUNT_EMAIL_TAKEN'
        ? 'That email address is already in use. Choose another email address.'
        : 'That username is already taken. Choose another username.',
      code,
      409,
    );
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
      throw new UserOperationError(`User not found: ${userId}`, 'USER_NOT_FOUND', 404);
    }
    return credentials;
  }

}

function normalizeOptional(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildTemporaryPassword(): string {
  return `Pm-${randomBytes(12).toString('base64url')}!9a`;
}
