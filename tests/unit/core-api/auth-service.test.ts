import bcrypt from 'bcryptjs';
import { AuthError, AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'userone',
    firstName: 'User',
    lastName: 'One',
    isActive: true,
    isRootAdmin: false,
    passwordHash: '$2b$12$placeholder',
    authProvider: 'EMAIL',
    timezone: null,
    locale: null,
    timeFormat: null,
    dateFormat: null,
    createdAt: new Date('2026-04-21T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AuthService', () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    jest.restoreAllMocks();
  });

  it('registers a user with normalized username/email and issues tokens', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(createUser({
          username: 'newuser',
          email: 'new@example.com',
        })),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const service = new AuthService(prisma);

    const result = await service.register(' NewUser ', ' New@Example.com ', 'Password123!', 'New', 'User');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'new@example.com',
        username: 'newuser',
        passwordHash: expect.any(String),
      }),
    });
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    expect(result.user.email).toBe('new@example.com');
    expect(result.user.username).toBe('newuser');
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('rejects registration when the normalized email is already in use', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(createUser()),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
    } as any;

    const service = new AuthService(prisma);

    await expect(
      service.register('NewUser', 'user@example.com', 'Password123!', 'New', 'User'),
    ).rejects.toMatchObject({
      code: 'EMAIL_EXISTS',
      statusCode: 409,
    } satisfies Partial<AuthError>);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects registration when the normalized username is already in use', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(createUser()),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
    } as any;

    const service = new AuthService(prisma);

    await expect(
      service.register('TakenUser', 'new@example.com', 'Password123!', 'New', 'User'),
    ).rejects.toMatchObject({
      code: 'USERNAME_EXISTS',
      statusCode: 409,
    } satisfies Partial<AuthError>);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects login when the user is inactive', async () => {
    const existingPasswordHash = await bcrypt.hash('Password123!', 10);
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(createUser({
          isActive: false,
          passwordHash: existingPasswordHash,
        })),
      },
    } as any;

    const service = new AuthService(prisma);

    await expect(service.login('user@example.com', 'Password123!')).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      statusCode: 403,
    } satisfies Partial<AuthError>);
  });

  it('rejects login when the password is wrong', async () => {
    const existingPasswordHash = await bcrypt.hash('Password123!', 10);
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(createUser({
          passwordHash: existingPasswordHash,
        })),
      },
      refreshToken: {
        create: jest.fn(),
      },
    } as any;

    const service = new AuthService(prisma);

    await expect(service.login('userone', 'WrongPassword123!')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    } satisfies Partial<AuthError>);
  });

  it('rotates refresh tokens for an active session', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refresh-1',
          token: 'refresh-token',
          sessionId: 'session-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: createUser(),
        }),
        update,
        create,
      },
    } as any;

    const service = new AuthService(prisma);

    const result = await service.refresh('refresh-token');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'refresh-1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-1',
      }),
    });
    expect(result.refreshToken).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
  });

  it('rejects refresh when the persisted token belongs to an inactive user', async () => {
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refresh-1',
          token: 'refresh-token',
          sessionId: 'session-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: createUser({ isActive: false }),
        }),
      },
    } as any;

    const service = new AuthService(prisma);

    await expect(service.refresh('refresh-token')).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      statusCode: 403,
    } satisfies Partial<AuthError>);
  });

  it('issues a session for an active user and rejects inactive users', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(createUser())
          .mockResolvedValueOnce(createUser({ isActive: false })),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const service = new AuthService(prisma);

    await expect(service.issueSessionForUser('user-1')).resolves.toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      }),
    );
    await expect(service.issueSessionForUser('user-1')).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      statusCode: 403,
    } satisfies Partial<AuthError>);
  });

  it('verifies valid access tokens and rejects invalid ones', async () => {
    const prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const service = new AuthService(prisma);
    const tokens = await (service as any).issueTokens('user-1', 'user@example.com', false, 'session-1');

    expect(service.verifyAccessToken(tokens.accessToken)).toEqual(
      expect.objectContaining({
        sub: 'user-1',
        email: 'user@example.com',
        sid: 'session-1',
      }),
    );

    expect(() => service.verifyAccessToken('not-a-real-token')).toThrow(
      expect.objectContaining({
        code: 'INVALID_TOKEN',
      }),
    );
  });
});
