import bcrypt from 'bcryptjs';
import { AccountLifecycleError, AccountService } from '../../../packages/core-api/src/modules/account/service';

describe('AccountService', () => {
  it('pool-master-l40 updates the active account profile email with the user name fields', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'updated@example.com',
      username: 'user-1',
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
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(updatedUser),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.updateOwnProfile('user-1', {
        firstName: ' Derek ',
        lastName: ' Dorazio ',
        email: ' Updated@Example.com ',
      }),
    ).resolves.toEqual(updatedUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        email: 'updated@example.com',
        firstName: 'Derek',
        lastName: 'Dorazio',
      },
    });
  });

  it('pool-master-l40 rejects profile email changes when the email belongs to another account', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: '$2b$12$placeholder',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-2',
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.updateOwnProfile('user-1', {
        firstName: 'Derek',
        lastName: 'Dorazio',
        email: 'used@example.com',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_EMAIL_TAKEN',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: 'used@example.com' },
          { username: 'used@example.com' },
        ],
        NOT: {
          id: 'user-1',
        },
      },
      select: {
        id: true,
      },
    });
  });

  it('pool-master-l40 updates the active account username when it is unique', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      username: 'next-user',
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
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(updatedUser),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(service.updateOwnUsername('user-1', ' Next-User ')).resolves.toEqual(updatedUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        username: 'next-user',
      },
    });
  });

  it('pool-master-l40 rejects username changes when the username is already taken', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: '$2b$12$placeholder',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-2',
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(service.updateOwnUsername('user-1', 'Taken')).rejects.toMatchObject({
      code: 'ACCOUNT_USERNAME_TAKEN',
      statusCode: 409,
      message: 'That username is already taken. Choose another username.',
    } satisfies Partial<AccountLifecycleError>);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { username: 'taken' },
          { email: 'taken' },
        ],
        NOT: {
          id: 'user-1',
        },
      },
      select: {
        id: true,
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
        email: 'user@example.com',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE_READ_ONLY',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('rejects mutable account actions when the user does not exist', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.updateOwnPreferences('missing-user', {
        timezone: 'America/New_York',
      }),
    ).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      statusCode: 404,
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

  it('rejects password change when the account does not have a password hash', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: null,
          isActive: true,
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(
      service.changeOwnPassword('user-1', {
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'NewPass456!',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_PASSWORD_UNAVAILABLE',
      statusCode: 409,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('rejects password change when the confirmation does not match', async () => {
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
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'Mismatch456!',
      }),
    ).rejects.toMatchObject({
      code: 'PASSWORD_CONFIRMATION_MISMATCH',
      statusCode: 400,
    } satisfies Partial<AccountLifecycleError>);
  });

  it('changes the password and revokes every active refresh session when no current token is supplied', async () => {
    const existingPasswordHash = await bcrypt.hash('CurrentPass123!', 10);
    const tx = {
      user: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
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
      }),
    ).resolves.toBeUndefined();

    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
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

  it('reactivates an inactive account and rejects an already active one', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'user-1',
            isActive: false,
          })
          .mockResolvedValueOnce({
            id: 'user-1',
            isActive: true,
          }),
        update: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'user@example.com',
          firstName: 'User',
          lastName: 'Example',
          isActive: true,
          isRootAdmin: false,
          authProvider: 'EMAIL',
          timezone: null,
          locale: null,
          createdAt: new Date('2026-04-13T00:00:00.000Z'),
        }),
      },
    } as any;

    const service = new AccountService(prisma);

    await expect(service.reactivateOwnAccount('user-1')).resolves.toMatchObject({
      id: 'user-1',
      isActive: true,
    });
    await expect(service.reactivateOwnAccount('user-1')).rejects.toMatchObject({
      code: 'ACCOUNT_ALREADY_ACTIVE',
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
