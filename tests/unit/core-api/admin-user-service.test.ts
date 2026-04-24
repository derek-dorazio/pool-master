import { logAdminAction } from '../../../packages/core-api/src/modules/admin/admin-audit-service';
import {
  LastRootAdminError,
  SelfRootAdminChangeError,
  UserNotFoundError,
  UserService,
} from '../../../packages/core-api/src/modules/admin/user-service';

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

function createPrismaMock() {
  const tx = {
    user: {
      update: jest.fn().mockResolvedValue(undefined),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  } as any;

  return { prisma, tx };
}

describe('admin user service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('searches users by username in addition to other profile fields', async () => {
    const { prisma } = createPrismaMock();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    const service = new UserService(prisma, createLogger() as any);

    await service.searchUsers({ search: 'captain', page: 1, pageSize: 25 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { username: { contains: 'captain', mode: 'insensitive' } },
        ]),
      }),
    }));
  });

  it('promotes a user to root admin and records the audit entry', async () => {
    const { prisma, tx } = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      isRootAdmin: false,
    });

    const service = new UserService(prisma, createLogger() as any);

    await expect(
      service.setRootAdmin('user-1', true, 'admin-1', 'admin@example.com', 'Operational coverage'),
    ).resolves.toBeUndefined();

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isRootAdmin: true },
    });
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.set_root_admin',
      resourceId: 'user-1',
      beforeState: { isRootAdmin: false },
      afterState: { isRootAdmin: true },
      reason: 'Operational coverage',
    }));
  });

  it('demotes a root admin, revokes refresh tokens, and records the audit entry', async () => {
    const { prisma, tx } = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      isRootAdmin: true,
    });
    prisma.user.count.mockResolvedValue(2);

    const service = new UserService(prisma, createLogger() as any);

    await expect(
      service.setRootAdmin('user-2', false, 'admin-1', 'admin@example.com', 'Role cleanup'),
    ).resolves.toBeUndefined();

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { isRootAdmin: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { isRootAdmin: false },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      beforeState: { isRootAdmin: true },
      afterState: { isRootAdmin: false },
      reason: 'Role cleanup',
    }));
  });

  it('rejects self-demotion before any write work happens', async () => {
    const { prisma, tx } = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      isRootAdmin: true,
    });

    const service = new UserService(prisma, createLogger() as any);

    await expect(
      service.setRootAdmin('admin-1', false, 'admin-1', 'admin@example.com'),
    ).rejects.toBeInstanceOf(SelfRootAdminChangeError);

    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects removal of the last remaining root admin', async () => {
    const { prisma, tx } = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-3',
      isRootAdmin: true,
    });
    prisma.user.count.mockResolvedValue(1);

    const service = new UserService(prisma, createLogger() as any);

    await expect(
      service.setRootAdmin('user-3', false, 'admin-1', 'admin@example.com'),
    ).rejects.toBeInstanceOf(LastRootAdminError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('treats unchanged root-admin requests as a no-op', async () => {
    const { prisma, tx } = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-4',
      isRootAdmin: true,
    });

    const service = new UserService(prisma, createLogger() as any);

    await expect(
      service.setRootAdmin('user-4', true, 'admin-1', 'admin@example.com'),
    ).resolves.toBeUndefined();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('rejects missing users', async () => {
    const { prisma } = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);

    const service = new UserService(prisma, createLogger() as any);

    await expect(
      service.setRootAdmin('missing-user', true, 'admin-1', 'admin@example.com'),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
