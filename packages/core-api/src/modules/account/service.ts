import {
  PrismaClient,
  UserAuthProvider as PrismaUserAuthProvider,
  UserDateFormat as PrismaUserDateFormat,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DateFormat, TimeFormat } from '@poolmaster/shared/domain';

const BCRYPT_ROUNDS = 12;

type AccountUserRow = {
  id: string;
  email: string;
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
  constructor(private readonly prisma: PrismaClient) {}

  async updateOwnProfile(
    userId: string,
    updates: { firstName: string; lastName: string },
  ): Promise<AccountUserRow> {
    const user = await this.requireUserForMutableAccountAction(userId);

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: updates.firstName.trim(),
        lastName: updates.lastName.trim(),
      },
    });
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
    const user = await this.requireUserForMutableAccountAction(userId);

    return this.prisma.user.update({
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
    const user = await this.requireUserForMutableAccountAction(userId);

    if (!user.passwordHash) {
      throw new AccountLifecycleError(
        'Password change is unavailable for this account.',
        'ACCOUNT_PASSWORD_UNAVAILABLE',
        409,
      );
    }

    if (request.newPassword !== request.confirmNewPassword) {
      throw new AccountLifecycleError(
        'New password confirmation does not match.',
        'PASSWORD_CONFIRMATION_MISMATCH',
        400,
      );
    }

    const currentMatches = await bcrypt.compare(request.currentPassword, user.passwordHash);
    if (!currentMatches) {
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
  }

  async reactivateOwnAccount(userId: string): Promise<AccountUserRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (user.isActive) {
      throw new AccountLifecycleError(
        'Account is already active',
        'ACCOUNT_ALREADY_ACTIVE',
        409,
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
  }

  async inactivateOwnAccount(userId: string): Promise<AccountUserRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (!user.isActive) {
      throw new AccountLifecycleError(
        'Account is already inactive',
        'ACCOUNT_ALREADY_INACTIVE',
        409,
      );
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return nextUser;
    });

    return updatedUser;
  }

  async deleteOwnInactiveAccount(userId: string, confirmationEmail: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (user.isActive) {
      throw new AccountLifecycleError(
        'Account must be inactive before it can be permanently deleted',
        'ACCOUNT_DELETE_REQUIRES_INACTIVE',
        409,
      );
    }

    if (user.email !== confirmationEmail) {
      throw new AccountLifecycleError(
        'Delete confirmation email must match the account email exactly',
        'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
        400,
      );
    }

    const [leagueCount, squadMembershipCount, createdLeagueCount, createdSquadCount] =
      await Promise.all([
        this.prisma.leagueMembership.count({ where: { userId } }),
        this.prisma.squadMembership.count({ where: { userId } }),
        this.prisma.league.count({ where: { createdBy: userId } }),
        this.prisma.squad.count({ where: { createdBy: userId } }),
      ]);

    if (leagueCount > 0 || squadMembershipCount > 0 || createdLeagueCount > 0 || createdSquadCount > 0) {
      throw new AccountLifecycleError(
        'Account still owns or belongs to league-scoped data. Remove those relationships before deleting the account.',
        'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
        409,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.consentRecord.deleteMany({ where: { userId } });
      await tx.leagueInvitation.deleteMany({
        where: {
          OR: [{ invitedBy: userId }, { acceptedBy: userId }],
        },
      });
      await tx.commissionerAuditLog.deleteMany({ where: { actorId: userId } });
      await tx.adminAuditEntry.deleteMany({ where: { actorId: userId } });
      await tx.migrationRun.deleteMany({ where: { startedById: userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }

  private async requireUserForMutableAccountAction(userId: string): Promise<{
    id: string;
    passwordHash: string | null;
    isActive: boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new AccountLifecycleError('User not found', 'USER_NOT_FOUND', 404);
    }

    if (!user.isActive) {
      throw new AccountLifecycleError(
        'Inactive accounts are read-only. Reactivate the account before editing profile, preferences, or password.',
        'ACCOUNT_INACTIVE_READ_ONLY',
        409,
      );
    }

    return user;
  }
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
