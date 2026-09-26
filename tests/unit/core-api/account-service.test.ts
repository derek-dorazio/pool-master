/**
 * #202 step 3.3 — `AccountService` against the `UserRepository` port.
 *
 * Only the self-service LIFECYCLE operations are here now. The profile, username and
 * preference writes were one half of an operation `docs/DOMAIN-OPERATIONS.md` defines for
 * `self` OR `rootAdmin`; they live once in `modules/users/user-profile-service.ts` and are
 * tested in `user-profile-service.test.ts`.
 *
 * `prisma` is mocked only for what legitimately stays on it: `$transaction`, the delete
 * cascade, the refresh-token writes, and the single `passwordHash` read the port
 * deliberately never serves.
 */
import bcrypt from 'bcryptjs';
import { AccountService } from '../../../packages/core-api/src/modules/account/service';
import type { UserOperationError } from '../../../packages/core-api/src/modules/users/user-errors';
import { fakeUserRepo } from '../../support/repo-fakes';
import type { User } from '../../../packages/shared/domain';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user-1',
    firstName: 'Derek',
    lastName: 'Dorazio',
    isActive: true,
    isRootAdmin: false,
    createdAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  };
}

function createPrismaMock(passwordHash: string | null = null) {
  const tx = {
    user: {
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    consentRecord: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    leagueInvitation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    commissionerAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    adminAuditEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    migrationRun: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };

  const prisma = {
    // The ONE read that stays on Prisma: passwordHash is a secret the port never returns.
    user: { findUnique: jest.fn().mockResolvedValue({ passwordHash }) },
    leagueMembership: { count: jest.fn().mockResolvedValue(0) },
    squadMembership: { count: jest.fn().mockResolvedValue(0) },
    squad: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
  } as any;

  return { prisma, tx };
}

describe('AccountService', () => {
  describe('changeOwnPassword', () => {
    it('keeps the calling session alive and revokes every other one', async () => {
      const { prisma, tx } = createPrismaMock(await bcrypt.hash('CurrentPass123!', 10));
      const service = new AccountService(fakeUserRepo(), prisma);

      await expect(
        service.changeOwnPassword('user-1', {
          currentPassword: 'CurrentPass123!',
          newPassword: 'NewPass456!',
          confirmNewPassword: 'NewPass456!',
          currentRefreshToken: 'keep-me',
        }),
      ).resolves.toBeUndefined();

      // Deliberately NOT the blanket revoke: the caller stays signed in.
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null, NOT: { token: 'keep-me' } },
        data: { revokedAt: expect.any(Date) },
      });
      const nextHash = tx.user.update.mock.calls[0]?.[0]?.data?.passwordHash;
      await expect(bcrypt.compare('NewPass456!', nextHash)).resolves.toBe(true);
    });

    it('revokes every session when no current token is supplied', async () => {
      const { prisma, tx } = createPrismaMock(await bcrypt.hash('CurrentPass123!', 10));
      const service = new AccountService(fakeUserRepo(), prisma);

      await service.changeOwnPassword('user-1', {
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'NewPass456!',
      });

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects a wrong current password', async () => {
      const { prisma } = createPrismaMock(await bcrypt.hash('CurrentPass123!', 10));
      const service = new AccountService(fakeUserRepo(), prisma);

      await expect(
        service.changeOwnPassword('user-1', {
          currentPassword: 'WrongPass123!',
          newPassword: 'NewPass456!',
          confirmNewPassword: 'NewPass456!',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_CURRENT_PASSWORD',
        statusCode: 400,
      } satisfies Partial<UserOperationError>);
    });

    it('rejects a confirmation that does not match the new password', async () => {
      const { prisma } = createPrismaMock(await bcrypt.hash('CurrentPass123!', 10));
      const service = new AccountService(fakeUserRepo(), prisma);

      await expect(
        service.changeOwnPassword('user-1', {
          currentPassword: 'CurrentPass123!',
          newPassword: 'NewPass456!',
          confirmNewPassword: 'Different789!',
        }),
      ).rejects.toMatchObject({ code: 'PASSWORD_CONFIRMATION_MISMATCH', statusCode: 400 });
    });

    it('rejects a provider-authenticated account that has no password at all', async () => {
      const { prisma } = createPrismaMock(null);
      const service = new AccountService(fakeUserRepo(), prisma);

      await expect(
        service.changeOwnPassword('user-1', {
          currentPassword: 'AnyPass123!',
          newPassword: 'NewPass456!',
          confirmNewPassword: 'NewPass456!',
        }),
      ).rejects.toMatchObject({ code: 'ACCOUNT_PASSWORD_UNAVAILABLE', statusCode: 409 });
    });

    it('rejects a missing user', async () => {
      const { prisma } = createPrismaMock();
      prisma.user.findUnique.mockResolvedValue(null);
      const service = new AccountService(fakeUserRepo(), prisma);

      await expect(
        service.changeOwnPassword('missing', {
          currentPassword: 'AnyPass123!',
          newPassword: 'NewPass456!',
          confirmNewPassword: 'NewPass456!',
        }),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    });
  });

  describe('reactivate', () => {
    it('reactivates an inactive account through the port', async () => {
      const inactive = buildUser({ isActive: false });
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(inactive),
        update: jest.fn().mockResolvedValue({ ...inactive, isActive: true }),
      });
      const service = new AccountService(users, createPrismaMock().prisma);

      await expect(service.reactivateOwnAccount('user-1')).resolves.toMatchObject({ isActive: true });
      expect(users.update).toHaveBeenCalledWith('user-1', { isActive: true });
    });

    it('is a no-op for an already-active account, so a retry cannot fail', async () => {
      const active = buildUser();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(active) });
      const service = new AccountService(users, createPrismaMock().prisma);

      await expect(service.reactivateOwnAccount('user-1')).resolves.toEqual(active);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('rejects a missing user', async () => {
      const service = new AccountService(fakeUserRepo(), createPrismaMock().prisma);

      await expect(service.reactivateOwnAccount('missing'))
        .rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    });
  });

  describe('inactivate', () => {
    it('flags the account inactive and revokes its sessions in one transaction', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn()
          .mockResolvedValueOnce(buildUser())
          .mockResolvedValueOnce(buildUser({ isActive: false })),
      });
      const service = new AccountService(users, prisma);

      await expect(service.inactivateOwnAccount('user-1')).resolves.toMatchObject({ isActive: false });

      // Atomic: an account that reads as inactive must not still have working refresh
      // tokens, so both writes go through the same transaction client.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
      expect(tx.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('is a no-op for an already-inactive account, with no second revoke', async () => {
      const { prisma } = createPrismaMock();
      const inactive = buildUser({ isActive: false });
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive) });
      const service = new AccountService(users, prisma);

      await expect(service.inactivateOwnAccount('user-1')).resolves.toEqual(inactive);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses the last root admin, who would leave nobody able to administer the platform', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isRootAdmin: true })),
        countRootAdmins: jest.fn().mockResolvedValue(1),
      });
      const service = new AccountService(users, prisma);

      await expect(service.inactivateOwnAccount('user-1'))
        .rejects.toMatchObject({ code: 'ACCOUNT_LAST_ROOT_ADMIN', statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('permanent self-delete', () => {
    const inactive = () => buildUser({ isActive: false });

    it('cascades the delete after exact email confirmation', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive()) });
      const service = new AccountService(users, prisma);

      await expect(service.deleteOwnInactiveAccount('user-1', 'user@example.com'))
        .resolves.toBeUndefined();

      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('rejects an ACTIVE account — the one place isActive gates a write (A9)', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
      const service = new AccountService(users, prisma);

      await expect(service.deleteOwnInactiveAccount('user-1', 'user@example.com'))
        .rejects.toMatchObject({ code: 'ACCOUNT_DELETE_REQUIRES_INACTIVE', statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a confirmation email that does not match exactly', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive()) });
      const service = new AccountService(users, prisma);

      await expect(service.deleteOwnInactiveAccount('user-1', 'wrong@example.com'))
        .rejects.toMatchObject({ code: 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH', statusCode: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an account that still holds league-scoped data', async () => {
      const { prisma } = createPrismaMock();
      prisma.squadMembership.count.mockResolvedValue(1);
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive()) });
      const service = new AccountService(users, prisma);

      await expect(service.deleteOwnInactiveAccount('user-1', 'user@example.com'))
        .rejects.toMatchObject({ code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST', statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses the last root admin, even though they are already inactive', async () => {
      // Belt and braces with the inactivate gate: a root admin who went inactive before that
      // rule existed can still reach delete, and this must not be the path that empties the
      // root-admin set.
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isActive: false, isRootAdmin: true })),
        countRootAdmins: jest.fn().mockResolvedValue(1),
      });
      const service = new AccountService(users, prisma);

      await expect(service.deleteOwnInactiveAccount('user-1', 'user@example.com'))
        .rejects.toMatchObject({ code: 'ACCOUNT_LAST_ROOT_ADMIN', statusCode: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
