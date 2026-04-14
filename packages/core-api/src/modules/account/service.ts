import type { PrismaClient } from '@prisma/client';

type AccountUserRow = {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  authProvider: string | null;
  timezone: string | null;
  locale: string | null;
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
      await tx.userLocalePreference.deleteMany({ where: { userId } });
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
}
