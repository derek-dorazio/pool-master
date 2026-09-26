import {
  PrismaClient,
  UserAuthProvider as PrismaUserAuthProvider,
  UserDateFormat as PrismaUserDateFormat,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyBaseLogger } from 'fastify';
import { DateFormat, TimeFormat } from '@poolmaster/shared/domain';
import {
  countUserDeleteDependencies,
  deleteUserCascade,
  hasUserDeleteDependencies,
  isLastRootAdmin,
  revokeUserSessions,
} from '../users/user-lifecycle';

const BCRYPT_ROUNDS = 12;

type AccountUserRow = {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  authProvider: PrismaUserAuthProvider | null;
  timezone: string | null;
  locale: string | null;
  timeFormat: PrismaUserTimeFormat | null;
  dateFormat: PrismaUserDateFormat | null;
  createdAt: Date;
};

export class AccountLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AccountLifecycleError';
  }
}

export class AccountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async updateOwnProfile(
    userId: string,
    updates: { firstName: string; lastName: string; email: string },
  ): Promise<AccountUserRow> {
    const normalizedEmail = normalizeEmail(updates.email);
    this.logger?.debug({
      action: 'accountService.updateProfile.start',
      data: { userId, emailDomain: normalizedEmail.split('@')[1] ?? null },
    }, 'Updating account profile');
    const user = await this.requireUserForMutableAccountAction(userId);
    await this.assertEmailAvailableForUser(user.id, normalizedEmail);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: normalizedEmail,
        firstName: updates.firstName.trim(),
        lastName: updates.lastName.trim(),
      },
    });
    this.logger?.info({
      action: 'accountService.updateProfile.success',
      data: { userId: updatedUser.id },
    }, 'Updated account profile');
    return updatedUser;
  }

  async updateOwnUsername(userId: string, username: string): Promise<AccountUserRow> {
    const normalizedUsername = normalizeUsername(username);
    this.logger?.debug({
      action: 'accountService.updateUsername.start',
      data: { userId, requestedUsernameLength: normalizedUsername.length },
    }, 'Updating account username');
    const user = await this.requireUserForMutableAccountAction(userId);
    await this.assertUsernameAvailableForUser(user.id, normalizedUsername);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        username: normalizedUsername,
      },
    });
    this.logger?.info({
      action: 'accountService.updateUsername.success',
      data: { userId: updatedUser.id },
    }, 'Updated account username');
    return updatedUser;
  }

  async updateOwnPreferences(
    userId: string,
    updates: {
      timezone?: string | null;
      locale?: string | null;
      timeFormat?: TimeFormat | null;
      dateFormat?: DateFormat | null;
    },
  ): Promise<AccountUserRow> {
    this.logger?.debug({
      action: 'accountService.updatePreferences.start',
      data: { userId },
    }, 'Updating account preferences');
    const user = await this.requireUserForMutableAccountAction(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(updates.timezone !== undefined && { timezone: normalizeOptionalString(updates.timezone) }),
        ...(updates.locale !== undefined && { locale: normalizeOptionalString(updates.locale) }),
        ...(updates.timeFormat !== undefined && {
          timeFormat: mapTimeFormatToPrisma(updates.timeFormat),
        }),
        ...(updates.dateFormat !== undefined && {
          dateFormat: mapDateFormatToPrisma(updates.dateFormat),
        }),
      },
    });
    this.logger?.info({
      action: 'accountService.updatePreferences.success',
      data: { userId: updatedUser.id },
    }, 'Updated account preferences');
    return updatedUser;
  }

  async changeOwnPassword(
    userId: string,
    request: {
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
      currentRefreshToken?: string | null;
    },
  ): Promise<void> {
    this.logger?.debug({
      action: 'accountService.changePassword.start',
      data: {
        userId,
        retainsCurrentRefreshToken: Boolean(request.currentRefreshToken),
      },
    }, 'Changing account password');
    const user = await this.requireUserForMutableAccountAction(userId);

    if (!user.passwordHash) {
      this.logger?.warn({
        action: 'accountService.changePassword.unavailable',
        data: { userId },
      }, 'Rejected password change for passwordless account');
      throw new AccountLifecycleError(
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
      throw new AccountLifecycleError(
        'New password confirmation does not match.',
        'PASSWORD_CONFIRMATION_MISMATCH',
        400,
      );
    }

    const currentMatches = await bcrypt.compare(request.currentPassword, user.passwordHash);
    if (!currentMatches) {
      this.logger?.warn({
        action: 'accountService.changePassword.invalidCurrentPassword',
        data: { userId },
      }, 'Rejected password change due to invalid current password');
      throw new AccountLifecycleError(
        'Current password is incorrect.',
        'INVALID_CURRENT_PASSWORD',
        400,
      );
    }

    const passwordHash = await bcrypt.hash(request.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      // NOT revokeUserSessions: a password change keeps the caller's own session alive and
      // revokes every other one. Deliberately different from the blanket revoke, so do not
      // collapse the two.
      await tx.refreshToken.updateMany({
        where: {
          userId: user.id,
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

  async reactivateOwnAccount(userId: string): Promise<AccountUserRow> {
    this.logger?.debug({
      action: 'accountService.reactivate.start',
      data: { userId },
    }, 'Reactivating account');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger?.warn({
        action: 'accountService.reactivate.notFound',
        data: { userId },
      }, 'Cannot reactivate missing account');
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

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

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
    this.logger?.info({
      action: 'accountService.reactivate.success',
      data: { userId: updatedUser.id },
    }, 'Reactivated account');
    return updatedUser;
  }

  async inactivateOwnAccount(userId: string): Promise<AccountUserRow> {
    this.logger?.debug({
      action: 'accountService.inactivate.start',
      data: { userId },
    }, 'Inactivating account');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger?.warn({
        action: 'accountService.inactivate.notFound',
        data: { userId },
      }, 'Cannot inactivate missing account');
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

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
    if (await isLastRootAdmin(this.prisma, userId)) {
      this.logger?.warn({
        action: 'accountService.inactivate.lastRootAdminRejected',
        data: { userId },
      }, 'Rejected self-inactivate by the last root admin');
      throw new AccountLifecycleError(
        'You are the only root admin. Promote another root admin before deactivating your account.',
        'ACCOUNT_LAST_ROOT_ADMIN',
        409,
      );
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      await revokeUserSessions(tx, userId);

      return nextUser;
    });

    this.logger?.info({
      action: 'accountService.inactivate.success',
      data: { userId: updatedUser.id },
    }, 'Inactivated account');
    return updatedUser;
  }

  async deleteOwnInactiveAccount(userId: string, confirmationEmail: string): Promise<void> {
    this.logger?.debug({
      action: 'accountService.delete.start',
      data: { userId },
    }, 'Deleting inactive account');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger?.warn({
        action: 'accountService.delete.notFound',
        data: { userId },
      }, 'Cannot delete missing account');
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (user.isActive) {
      this.logger?.warn({
        action: 'accountService.delete.requiresInactive',
        data: { userId },
      }, 'Rejected account delete for active account');
      throw new AccountLifecycleError(
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
      throw new AccountLifecycleError(
        'Delete confirmation email must match the account email exactly',
        'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
        400,
      );
    }

    // #202 — the same guard admin-delete applies. Belt and braces with the inactivate
    // gate above: a root admin demoted to inactive before this rule existed can still
    // reach delete, and that must not be the path that empties the root-admin set.
    if (await isLastRootAdmin(this.prisma, userId)) {
      this.logger?.warn({
        action: 'accountService.delete.lastRootAdminRejected',
        data: { userId },
      }, 'Rejected self-delete by the last root admin');
      throw new AccountLifecycleError(
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
      throw new AccountLifecycleError(
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

  private async requireUserForMutableAccountAction(userId: string): Promise<{
    id: string;
    passwordHash: string | null;
    isActive: boolean;
  }> {
    this.logger?.debug({
      action: 'accountService.requireMutable.start',
      data: { userId },
    }, 'Checking mutable-account preconditions');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user) {
      this.logger?.warn({
        action: 'accountService.requireMutable.notFound',
        data: { userId },
      }, 'Mutable account action rejected because user was not found');
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (!user.isActive) {
      this.logger?.warn({
        action: 'accountService.requireMutable.inactive',
        data: { userId },
      }, 'Mutable account action rejected for inactive account');
      throw new AccountLifecycleError(
        'Inactive accounts are read-only. Reactivate the account before editing profile, preferences, or password.',
        'ACCOUNT_INACTIVE_READ_ONLY',
        409,
      );
    }

    this.logger?.debug({
      action: 'accountService.requireMutable.success',
      data: { userId },
    }, 'Mutable-account preconditions satisfied');
    return user;
  }

  private async assertEmailAvailableForUser(userId: string, normalizedEmail: string): Promise<void> {
    const collision = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: normalizedEmail },
        ],
        NOT: {
          id: userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!collision) {
      return;
    }

    this.logger?.warn({
      action: 'accountService.updateProfile.emailTaken',
      data: {
        userId,
        conflictingUserId: collision.id,
      },
    }, 'Rejected account profile update because the email is already in use');
    throw new AccountLifecycleError(
      'That email address is already in use. Choose another email address.',
      'ACCOUNT_EMAIL_TAKEN',
      409,
    );
  }

  private async assertUsernameAvailableForUser(userId: string, normalizedUsername: string): Promise<void> {
    const collision = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: normalizedUsername },
          { email: normalizedUsername },
        ],
        NOT: {
          id: userId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!collision) {
      return;
    }

    this.logger?.warn({
      action: 'accountService.updateUsername.usernameTaken',
      data: {
        userId,
        conflictingUserId: collision.id,
      },
    }, 'Rejected account username update because the username is already in use');
    throw new AccountLifecycleError(
      'That username is already taken. Choose another username.',
      'ACCOUNT_USERNAME_TAKEN',
      409,
    );
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeOptionalString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapTimeFormatToPrisma(value: TimeFormat | null): PrismaUserTimeFormat | null {
  if (value === null) {
    return null;
  }

  if (value === TimeFormat.TWELVE_HOUR) {
    return PrismaUserTimeFormat.TWELVE_HOUR;
  }

  if (value === TimeFormat.TWENTY_FOUR_HOUR) {
    return PrismaUserTimeFormat.TWENTY_FOUR_HOUR;
  }

  return null;
}

function mapDateFormatToPrisma(value: DateFormat | null): PrismaUserDateFormat | null {
  if (value === null) {
    return null;
  }

  if (value === DateFormat.MDY) {
    return PrismaUserDateFormat.MDY;
  }

  if (value === DateFormat.DMY) {
    return PrismaUserDateFormat.DMY;
  }

  if (value === DateFormat.YMD) {
    return PrismaUserDateFormat.YMD;
  }

  return null;
}
