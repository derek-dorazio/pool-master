/**
 * #202 step 3.3 — `UserService` against the `UserRepository` port.
 *
 * Per plans/145 "Test layering", no test here asserts a positive repository call. What is
 * asserted is what this service owns and nothing else can observe: the returned value, the
 * typed error, the ABSENCE of a write (which is how idempotence and a short-circuiting guard
 * are visible at all), the atomicity of the writes that must land together, and the audit
 * entry’s content. Query shapes and filters belong to the adapter and are covered against
 * real Postgres in `tests/integration/core-api/identity-repositories.integration.ts`.
 *
 * Every read and single-entity write now goes through the port, so the fake repo IS the
 * database as far as this suite is concerned; `prisma` is mocked only for the three things
 * that legitimately stay on it — `$transaction`, the delete cascade, and the refresh-token
 * revoke.
 *
 * That is why these tests no longer stub `prisma.user.findUnique` and then assert on
 * `prisma.user.count`: those assertions pinned the service's *query shapes*, which is the
 * adapter's business and is covered against a real database in
 * `tests/integration/core-api/identity-repositories.integration.ts`. What is left here is
 * what this service actually owns: the guards, the idempotence, the ordering, and the audit
 * entries.
 */
import bcrypt from 'bcryptjs';
import { logAdminAction } from '../../../packages/core-api/src/modules/admin/admin-audit-service';
import {
  LastRootAdminError,
  UserDeleteConfirmationMismatchError,
  UserDeleteDependenciesExistError,
  UserDeleteRequiresInactiveError,
  UserNotFoundError,
  UserService,
} from '../../../packages/core-api/src/modules/admin/user-service';
import { fakeUserRepo } from '../../support/repo-fakes';
import type { User } from '../../../packages/shared/domain';

jest.mock('../../../packages/core-api/src/modules/admin/admin-audit-service', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'target@example.com',
    username: 'target',
    firstName: 'Target',
    lastName: 'User',
    isActive: true,
    isRootAdmin: false,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createPrismaMock() {
  const tx = {
    user: {
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    consentRecord: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    leagueInvitation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    commissionerAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    adminAuditEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    migrationRun: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };

  const prisma = {
    // The non-transactional revoke, used by force-logout.
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    // The delete-dependency counts. Zero means "nothing blocks the delete".
    leagueMembership: { count: jest.fn().mockResolvedValue(0) },
    squadMembership: { count: jest.fn().mockResolvedValue(0) },
    squad: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  } as any;

  return { prisma, tx };
}

describe('admin user service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('reads', () => {
    it('returns the canonical user, with no viewer context attached', async () => {
      // #202 — this used to return a `UserDetailView` with a `viewerAuthority` block the
      // service computed from a viewer id. Who is asking is request context (A8), so the
      // service answers "what is this user" and nothing else.
      const user = buildUser();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(user) });
      const service = new UserService(users, createPrismaMock().prisma, createLogger() as any);

      await expect(service.getUser('user-1')).resolves.toEqual(user);
    });

    it('throws UserNotFoundError for a missing user', async () => {
      const service = new UserService(fakeUserRepo(), createPrismaMock().prisma, createLogger() as any);

      await expect(service.getUser('missing')).rejects.toBeInstanceOf(UserNotFoundError);
    });

  });

  describe('force logout', () => {
    it('revokes every live session and records the audit entry', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await service.forceUserLogout('user-1', 'admin-1', 'admin@example.com');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.force_logout',
        resourceId: 'user-1',
      }));
    });

    it('rejects a missing user before revoking anything', async () => {
      const { prisma } = createPrismaMock();
      const service = new UserService(fakeUserRepo(), prisma, createLogger() as any);

      await expect(
        service.forceUserLogout('missing', 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(UserNotFoundError);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(logAdminAction).not.toHaveBeenCalled();
    });
  });

  describe('disable and enable', () => {
    it('disables an active user atomically, writing state and revoke in one transaction', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await service.disableUser('user-1', 'abuse', 'root-1', 'root@example.com');

      // Both writes go through the SAME transaction client. Previously they were two
      // separate statements, so a failure between them left the user flagged inactive with
      // live refresh tokens.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
      expect(tx.refreshToken.updateMany).toHaveBeenCalled();
      // The non-transactional client must not be the one doing the revoke.
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.disable',
        reason: 'abuse',
      }));
    });

    it('treats disabling an already-inactive user as a no-op', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isActive: false })),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.disableUser('user-1', 'abuse', 'root-1', 'root@example.com'),
      ).resolves.toBeUndefined();

      // No write at all, through either client, and no audit entry for a change that did
      // not happen.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
      expect(logAdminAction).not.toHaveBeenCalled();
    });

    it('refuses to disable the last remaining root admin', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isRootAdmin: true })),
        countRootAdmins: jest.fn().mockResolvedValue(1),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.disableUser('user-1', 'abuse', 'root-1', 'root@example.com'),
      ).rejects.toBeInstanceOf(LastRootAdminError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('enables an inactive user through the port', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isActive: false })),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await service.enableUser('user-1', 'root-1', 'root@example.com');

      expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.enable',
        afterState: { isActive: true },
      }));
    });

    it('treats enabling an already-active user as a no-op', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.enableUser('user-1', 'root-1', 'root@example.com'),
      ).resolves.toBeUndefined();

      expect(users.update).not.toHaveBeenCalled();
      expect(logAdminAction).not.toHaveBeenCalled();
    });
  });

  it('resets a password to a temporary credential and revokes sessions in the same transaction', async () => {
    const { prisma, tx } = createPrismaMock();
    const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
    const service = new UserService(users, prisma, createLogger() as any);

    const result = await service.resetUserPassword('user-1', 'admin-1', 'admin@example.com', 'Support recovery');

    expect(result.temporaryPassword).toMatch(/^Pm-/);
    // The returned credential must be the one actually stored, hashed.
    const nextHash = tx.user.update.mock.calls[0]?.[0]?.data?.passwordHash;
    await expect(bcrypt.compare(result.temporaryPassword, nextHash)).resolves.toBe(true);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // The event is audited; the credential state either side of it is not.
    const audited = (logAdminAction as jest.Mock).mock.calls[0][0];
    expect(audited).toMatchObject({ action: 'user.reset_password', reason: 'Support recovery' });
    expect(audited).not.toHaveProperty('beforeState');
    expect(audited).not.toHaveProperty('afterState');
  });

  describe('root-admin role', () => {
    it('promotes a user without revoking their sessions', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await service.setRootAdmin('user-1', true, 'admin-1', 'admin@example.com', 'Operational coverage');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isRootAdmin: true },
      });
      // Gaining authority does not invalidate the session that already exists.
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.set_root_admin',
        beforeState: { isRootAdmin: false },
        afterState: { isRootAdmin: true },
        reason: 'Operational coverage',
      }));
    });

    it('demotes a root admin and revokes their sessions, so the lost authority cannot be used', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isRootAdmin: true })),
        countRootAdmins: jest.fn().mockResolvedValue(2),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await service.setRootAdmin('user-1', false, 'admin-1', 'admin@example.com', 'Role cleanup');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isRootAdmin: false },
      });
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
        beforeState: { isRootAdmin: true },
        afterState: { isRootAdmin: false },
      }));
    });

    it('lets a root admin demote THEMSELVES while another remains', async () => {
      // #202 — the self-demotion block is gone. The only rule is that the platform keeps an
      // administrator, and that is the count below; with two, one stepping down is a
      // legitimate operation.
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ id: 'admin-1', isRootAdmin: true })),
        countRootAdmins: jest.fn().mockResolvedValue(2),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.setRootAdmin('admin-1', false, 'admin-1', 'admin@example.com'),
      ).resolves.toBeUndefined();
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('refuses to remove the last remaining root admin, whoever asks', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isRootAdmin: true })),
        countRootAdmins: jest.fn().mockResolvedValue(1),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.setRootAdmin('user-1', false, 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(LastRootAdminError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('treats an unchanged role as a no-op, without counting or writing', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ isRootAdmin: true })),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.setRootAdmin('user-1', true, 'admin-1', 'admin@example.com'),
      ).resolves.toBeUndefined();

      expect(users.countRootAdmins).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(logAdminAction).not.toHaveBeenCalled();
    });

    it('rejects a missing user', async () => {
      const service = new UserService(fakeUserRepo(), createPrismaMock().prisma, createLogger() as any);

      await expect(
        service.setRootAdmin('missing', true, 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe('permanent delete', () => {
    const inactive = () => buildUser({
      email: 'delete.me@example.com',
      isActive: false,
    });

    it('cascades the delete after exact email confirmation, then audits', async () => {
      const { prisma, tx } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await service.deleteUser('user-1', 'delete.me@example.com', 'admin-1', 'admin@example.com', 'Cleanup');

      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user.delete',
        reason: 'Cleanup',
      }));
    });

    it('rejects a confirmation email that does not match exactly', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.deleteUser('user-1', 'wrong@example.com', 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(UserDeleteConfirmationMismatchError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an ACTIVE user — the one place isActive gates a write (A9)', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({ email: 'active@example.com' })),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.deleteUser('user-1', 'active@example.com', 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(UserDeleteRequiresInactiveError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete the last remaining root admin', async () => {
      const { prisma } = createPrismaMock();
      const users = fakeUserRepo({
        findById: jest.fn().mockResolvedValue(buildUser({
          email: 'delete.me@example.com',
          isActive: false,
          isRootAdmin: true,
        })),
        countRootAdmins: jest.fn().mockResolvedValue(1),
      });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.deleteUser('user-1', 'delete.me@example.com', 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(LastRootAdminError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a user who still holds league-scoped data', async () => {
      const { prisma } = createPrismaMock();
      prisma.leagueMembership.count.mockResolvedValue(1);
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(inactive()) });
      const service = new UserService(users, prisma, createLogger() as any);

      await expect(
        service.deleteUser('user-1', 'delete.me@example.com', 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(UserDeleteDependenciesExistError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
