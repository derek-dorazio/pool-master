/**
 * #202 step 3.4 — `AuthService` against the `UserRepository` port.
 *
 * User reads and the registration write go through the port now, so the fake repo IS the user
 * table here. `prisma` is mocked only for refresh tokens, which are this module's own
 * aggregate, and for the single `passwordHash` read the port deliberately never serves.
 *
 * The assertions that checked Prisma query shapes — `expect(prisma.user.create)
 * .toHaveBeenCalledWith({ data: … })` — are gone rather than re-pointed at the fake, per
 * plans/145 "Test layering". What survives is behaviour: the normalization, the typed errors,
 * the token pair, and the guards.
 */
import bcrypt from 'bcryptjs';
import { AuthError, AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { fakeUserRepo } from '../../support/repo-fakes';
import { AuthProvider, type User } from '../../../packages/shared/domain';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'userone',
    firstName: 'User',
    lastName: 'One',
    isActive: true,
    isRootAdmin: false,
    authProvider: AuthProvider.EMAIL,
    createdAt: new Date('2026-04-21T00:00:00.000Z'),
    updatedAt: new Date('2026-04-21T00:00:00.000Z'),
    ...overrides,
  };
}

/** The refresh-token side, plus the credentials read the port does not serve. */
function createPrismaMock(passwordHash: string | null = null) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ passwordHash }) },
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn(),
    },
  } as any;
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

  describe('register', () => {
    it('normalizes the username and email, and issues a token pair', async () => {
      const users = fakeUserRepo({
        create: jest.fn().mockImplementation(async (input: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) =>
          buildUser({ ...input })),
      });
      const service = new AuthService(users, createPrismaMock());

      const result = await service.register(' NewUser ', ' New@Example.com ', 'Password123!', 'New', 'User');

      expect(result.user.email).toBe('new@example.com');
      expect(result.user.username).toBe('newuser');
      expect(result.tokens.accessToken).toBeTruthy();
      // #206 — the session id lives on the token pair only; it is never duplicated onto the
      // user and never reaches a response body.
      expect(result.tokens.sessionId).toBeTruthy();
    });

    it('stores a hash of the password, never the password', async () => {
      let stored: string | undefined;
      const users = fakeUserRepo({
        create: jest.fn().mockImplementation(async (
          input: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
          credentials?: { passwordHash?: string },
        ) => {
          stored = credentials?.passwordHash;
          return buildUser({ ...input });
        }),
      });
      const service = new AuthService(users, createPrismaMock());

      await service.register('newuser', 'new@example.com', 'Password123!', 'New', 'User');

      expect(stored).toBeTruthy();
      expect(stored).not.toBe('Password123!');
      await expect(bcrypt.compare('Password123!', stored as string)).resolves.toBe(true);
    });

    it('rejects a normalized email somebody already holds', async () => {
      const users = fakeUserRepo({
        findByIdentifier: jest.fn().mockResolvedValue(buildUser()),
      });
      const service = new AuthService(users, createPrismaMock());

      await expect(
        service.register('NewUser', 'user@example.com', 'Password123!', 'New', 'User'),
      ).rejects.toMatchObject({
        code: 'EMAIL_EXISTS',
        statusCode: 409,
      } satisfies Partial<AuthError>);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('rejects a normalized username somebody already holds', async () => {
      const users = fakeUserRepo({
        // The email is free; the username is taken.
        findByIdentifier: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(buildUser()),
      });
      const service = new AuthService(users, createPrismaMock());

      await expect(
        service.register('TakenUser', 'new@example.com', 'Password123!', 'New', 'User'),
      ).rejects.toMatchObject({
        code: 'USERNAME_EXISTS',
        statusCode: 409,
      } satisfies Partial<AuthError>);
      expect(users.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('accepts either the email or the username, through one lookup', async () => {
      const passwordHash = await bcrypt.hash('Password123!', 10);
      const users = fakeUserRepo({ findByIdentifier: jest.fn().mockResolvedValue(buildUser()) });
      const service = new AuthService(users, createPrismaMock(passwordHash));

      await expect(service.login(' User@Example.com ', 'Password123!'))
        .resolves.toMatchObject({ user: { id: 'user-1' } });
      // Normalized before the lookup, so the identifier the port sees is lower-cased and
      // trimmed — and it is ONE question, because email and username are both @unique.
      expect(users.findByIdentifier).toHaveBeenCalledTimes(1);
      expect(users.findByIdentifier).toHaveBeenCalledWith('user@example.com');
    });

    it('rejects an inactive account with a distinct code, not INVALID_CREDENTIALS', async () => {
      const passwordHash = await bcrypt.hash('Password123!', 10);
      const users = fakeUserRepo({
        findByIdentifier: jest.fn().mockResolvedValue(buildUser({ isActive: false })),
      });
      const service = new AuthService(users, createPrismaMock(passwordHash));

      await expect(service.login('user@example.com', 'Password123!')).rejects.toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        statusCode: 403,
      } satisfies Partial<AuthError>);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('Password123!', 10);
      const users = fakeUserRepo({ findByIdentifier: jest.fn().mockResolvedValue(buildUser()) });
      const service = new AuthService(users, createPrismaMock(passwordHash));

      await expect(service.login('userone', 'WrongPassword123!')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        statusCode: 401,
      } satisfies Partial<AuthError>);
    });

    it('rejects a passwordless account without revealing that it exists', async () => {
      const users = fakeUserRepo({ findByIdentifier: jest.fn().mockResolvedValue(buildUser()) });
      const service = new AuthService(users, createPrismaMock(null));

      await expect(service.login('userone', 'Password123!')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        statusCode: 401,
      } satisfies Partial<AuthError>);
    });
  });

  describe('refresh', () => {
    it('rotates the stored token and keeps the session id', async () => {
      const prisma = createPrismaMock();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'refresh-1',
        token: 'refresh-token',
        sessionId: 'session-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', email: 'user@example.com', isRootAdmin: false, isActive: true },
      });
      const service = new AuthService(fakeUserRepo(), prisma);

      const result = await service.refresh('refresh-token');

      // The old token must be revoked, or a stolen refresh token stays usable after rotation.
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'refresh-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.sessionId).toBe('session-1');
      expect(result.refreshToken).toBeTruthy();
      expect(result.accessToken).toBeTruthy();
    });

    it('rejects a token whose user has gone inactive', async () => {
      const prisma = createPrismaMock();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'refresh-1',
        token: 'refresh-token',
        sessionId: 'session-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', email: 'user@example.com', isRootAdmin: false, isActive: false },
      });
      const service = new AuthService(fakeUserRepo(), prisma);

      await expect(service.refresh('refresh-token')).rejects.toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        statusCode: 403,
      } satisfies Partial<AuthError>);
    });

    it('rejects a missing token and an expired one alike', async () => {
      const prisma = createPrismaMock();
      prisma.refreshToken.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'refresh-1',
          token: 'expired-token',
          sessionId: 'session-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() - 60_000),
          user: { id: 'user-1', email: 'user@example.com', isRootAdmin: false, isActive: true },
        });
      const service = new AuthService(fakeUserRepo(), prisma);

      await expect(service.refresh('missing-token')).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
        statusCode: 401,
      } satisfies Partial<AuthError>);
      await expect(service.refresh('expired-token')).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
        statusCode: 401,
      } satisfies Partial<AuthError>);
    });
  });

  describe('sessions and profile', () => {
    it('issues a session for an active user and refuses an inactive one', async () => {
      const users = fakeUserRepo({
        findById: jest.fn()
          .mockResolvedValueOnce(buildUser())
          .mockResolvedValueOnce(buildUser({ isActive: false })),
      });
      const service = new AuthService(users, createPrismaMock());

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

    it('refuses to issue a session or read a profile for a user who does not exist', async () => {
      const service = new AuthService(fakeUserRepo(), createPrismaMock());

      await expect(service.issueSessionForUser('missing-user')).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      } satisfies Partial<AuthError>);
      await expect(service.getProfile('missing-user')).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      } satisfies Partial<AuthError>);
    });

    it('returns the canonical User from getProfile, with no password hash on it', async () => {
      const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
      const service = new AuthService(users, createPrismaMock());

      const profile = await service.getProfile('user-1');

      expect(profile).toEqual(buildUser());
      expect(profile).not.toHaveProperty('passwordHash');
    });
  });

  it('verifies a valid access token and rejects a forged one', async () => {
    const service = new AuthService(fakeUserRepo(), createPrismaMock());
    const tokens = await (service as any).issueTokens('user-1', 'user@example.com', false, 'session-1');

    expect(service.verifyAccessToken(tokens.accessToken)).toEqual(
      expect.objectContaining({
        sub: 'user-1',
        email: 'user@example.com',
        sid: 'session-1',
      }),
    );

    expect(() => service.verifyAccessToken('not-a-real-token')).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });
});
