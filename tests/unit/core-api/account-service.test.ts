import { AccountLifecycleError, AccountService } from '../../../packages/core-api/src/modules/account/service';

describe('AccountService', () => {
  it('inactivates an active account and revokes refresh tokens', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User Example',
      isActive: false,
      isRootAdmin: false,
      authProvider: 'EMAIL',
      timezone: null,
      locale: null,
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
    };

    const tx = {
      user: {
        update: jest.fn().mockResolvedValue(updatedUser),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          ...updatedUser,
          isActive: true,
        }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
    } as any;

    const service = new AccountService(prisma);

    await expect(service.inactivateOwnAccount('user-1')).resolves.toEqual(updatedUser);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isActive: false },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects inactivation when the account is already inactive', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          isActive: false,
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(service.inactivateOwnAccount('user-1')).rejects.toMatchObject({
      code: 'ACCOUNT_ALREADY_INACTIVE',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('rejects account delete while the account is still active', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          isActive: true,
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.deleteOwnInactiveAccount('user-1', 'user@example.com'),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DELETE_REQUIRES_INACTIVE',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('rejects account delete when the confirmation email does not match', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          isActive: false,
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.deleteOwnInactiveAccount('user-1', 'other@example.com'),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
      statusCode: 400,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('rejects account delete while league-scoped dependencies still exist', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          isActive: false,
        }),
      },
      leagueMembership: {
        count: jest.fn().mockResolvedValue(1),
      },
      squadMembership: {
        count: jest.fn().mockResolvedValue(0),
      },
      league: {
        count: jest.fn().mockResolvedValue(0),
      },
      squad: {
        count: jest.fn().mockResolvedValue(0),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.deleteOwnInactiveAccount('user-1', 'user@example.com'),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('deletes an inactive account and its user-owned account data', async () => {
    const tx = {
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      consentRecord: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      leagueInvitation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      commissionerAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      adminAuditEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      migrationRun: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { delete: jest.fn().mockResolvedValue(undefined) },
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          isActive: false,
        }),
      },
      leagueMembership: {
        count: jest.fn().mockResolvedValue(0),
      },
      squadMembership: {
        count: jest.fn().mockResolvedValue(0),
      },
      league: {
        count: jest.fn().mockResolvedValue(0),
      },
      squad: {
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.deleteOwnInactiveAccount('user-1', 'user@example.com'),
    ).resolves.toBeUndefined();

    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });
});
