import bcrypt from 'bcryptjs';
import { AccountLifecycleError, AccountService } from '../../../packages/core-api/src/modules/account/service';

describe('AccountService', () => {
  it('updates the active account profile', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Derek',
      lastName: 'Dorazio',
      isActive: true,
      isRootAdmin: false,
      authProvider: 'EMAIL',
      timezone: null,
      locale: null,
      timeFormat: null,
      dateFormat: null,
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: '$2b$12$placeholder',
          isActive: true,
        }),
        update: jest.fn().mockResolvedValue(updatedUser),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.updateOwnProfile('user-1', {
        firstName: ' Derek ',
        lastName: ' Dorazio ',
      }),
    ).resolves.toEqual(updatedUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        firstName: 'Derek',
        lastName: 'Dorazio',
      },
    });
  });

  it('rejects profile changes for inactive accounts', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: '$2b$12$placeholder',
          isActive: false,
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.updateOwnProfile('user-1', {
        firstName: 'Derek',
        lastName: 'Dorazio',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE_READ_ONLY',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('updates account preferences and allows clearing values', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Derek',
      lastName: 'Dorazio',
      isActive: true,
      isRootAdmin: false,
      authProvider: 'EMAIL',
      timezone: 'America/New_York',
      locale: null,
      timeFormat: 'TWELVE_HOUR',
      dateFormat: 'MDY',
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: '$2b$12$placeholder',
          isActive: true,
        }),
        update: jest.fn().mockResolvedValue(updatedUser),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.updateOwnPreferences('user-1', {
        timezone: ' America/New_York ',
        locale: ' ',
        timeFormat: '12H',
        dateFormat: 'MDY',
      }),
    ).resolves.toEqual(updatedUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        timezone: 'America/New_York',
        locale: null,
        timeFormat: 'TWELVE_HOUR',
        dateFormat: 'MDY',
      },
    });
  });

  it('changes the password and revokes only other refresh sessions', async () => {
    const existingPasswordHash = await bcrypt.hash('CurrentPass123!', 10);
    const tx = {
      user: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: existingPasswordHash,
          isActive: true,
        }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.changeOwnPassword('user-1', {
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'NewPass456!',
        currentRefreshToken: 'keep-me',
      }),
    ).resolves.toBeUndefined();

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: expect.any(String),
      },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        NOT: { token: 'keep-me' },
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects password change when the current password is wrong', async () => {
    const existingPasswordHash = await bcrypt.hash('CurrentPass123!', 10);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: existingPasswordHash,
          isActive: true,
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.changeOwnPassword('user-1', {
        currentPassword: 'WrongPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'NewPass456!',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
      statusCode: 400,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('inactivates an active account and revokes refresh tokens', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'User',
      lastName: 'Example',
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
