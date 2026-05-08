/**
 * AuthService — business logic for authentication and token management.
 *
 * Handles user registration, login, JWT issuance/refresh, and logout.
 * Passwords are hashed with bcrypt. Refresh tokens are persisted in Postgres.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UserAuthProvider as PrismaUserAuthProvider, UserDateFormat as PrismaUserDateFormat, UserTimeFormat as PrismaUserTimeFormat } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';
import { readJwtSecret } from '../../core/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  isRootAdmin: boolean;
  sid?: string;
  iat: number;
  exp: number;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  authProvider?: AuthProvider;
  timezone?: string | null;
  locale?: string | null;
  timeFormat?: TimeFormat | null;
  dateFormat?: DateFormat | null;
  createdAt: Date;
  sessionId?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuthService {
  private readonly jwtSecret: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {
    // pool-master-rop.76.1 — single bootstrap source, throws if unset.
    this.jwtSecret = readJwtSecret();
  }

  /**
   * Registers a new user with username/email/password and returns a token pair.
   */
  async register(
    username: string,
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    this.logger?.debug({
      action: 'authService.register.start',
      data: {
        username: normalizedUsername,
        email: normalizedEmail,
      },
    }, 'Registering user account');

    await this.assertIdentifierAvailability(normalizedUsername, normalizedEmail);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash,
        firstName,
        lastName,
        authProvider: PrismaUserAuthProvider.EMAIL,
      },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin);
    this.logger?.info({
      action: 'authService.register.success',
      data: {
        userId: user.id,
        isRootAdmin: user.isRootAdmin,
      },
    }, 'Registered user account');

    return {
      user: {
        ...mapUserProfile(user),
        sessionId: tokens.sessionId,
      },
      tokens,
    };
  }

  /**
   * Authenticates a user with username-or-email/password and returns a token pair.
   */
  async login(identifier: string, password: string): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const identifierType = normalizedIdentifier.includes('@') ? 'email' : 'username';
    this.logger?.debug({
      action: 'authService.login.start',
      data: {
        identifierType,
      },
    }, 'Authenticating user');
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedIdentifier },
          { username: normalizedIdentifier },
        ],
      },
    });
    if (!user || !user.passwordHash) {
      this.logger?.warn({
        action: 'authService.login.invalidCredentials',
        data: {
          identifierType,
        },
      }, 'Rejected login for missing or passwordless user');
      throw new AuthError('Invalid username, email, or password', 'INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      this.logger?.warn({
        action: 'authService.login.inactiveAccount',
        data: {
          userId: user.id,
          identifierType,
        },
      }, 'Rejected login for inactive account');
      throw new AuthError(
        'This account is inactive. Sign in is unavailable until the account is reactivated or deleted.',
        'ACCOUNT_INACTIVE',
        403,
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.logger?.warn({
        action: 'authService.login.invalidCredentials',
        data: {
          userId: user.id,
          identifierType,
        },
      }, 'Rejected login for invalid password');
      throw new AuthError('Invalid username, email, or password', 'INVALID_CREDENTIALS');
    }

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin);
    this.logger?.info({
      action: 'authService.login.success',
      data: {
        userId: user.id,
        isRootAdmin: user.isRootAdmin,
      },
    }, 'Authenticated user');

    return {
      user: {
        ...mapUserProfile(user),
        sessionId: tokens.sessionId,
      },
      tokens,
    };
  }

  /**
   * Validates a refresh token and issues a new access token.
   */
  async refresh(refreshTokenValue: string): Promise<TokenPair> {
    this.logger?.debug({
      action: 'authService.refresh.start',
    }, 'Refreshing session');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshTokenValue },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      this.logger?.warn({
        action: 'authService.refresh.invalidToken',
      }, 'Rejected refresh for invalid or expired token');
      throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }
    if (!stored.user.isActive) {
      this.logger?.warn({
        action: 'authService.refresh.inactiveAccount',
        data: {
          userId: stored.user.id,
          sessionId: stored.sessionId,
        },
      }, 'Rejected refresh for inactive account');
      throw new AuthError(
        'This account is inactive. Session refresh is unavailable.',
        'ACCOUNT_INACTIVE',
        403,
      );
    }

    // Revoke the old refresh token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.isRootAdmin,
      stored.sessionId,
    );
    this.logger?.info({
      action: 'authService.refresh.success',
      data: {
        userId: stored.user.id,
        sessionId: stored.sessionId,
      },
    }, 'Refreshed session');
    return tokens;
  }

  /**
   * Revokes a refresh token (logout).
   */
  async logout(refreshTokenValue: string): Promise<void> {
    this.logger?.debug({
      action: 'authService.logout.start',
    }, 'Revoking refresh token');
    const result = await this.prisma.refreshToken.updateMany({
      where: { token: refreshTokenValue, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger?.info({
      action: 'authService.logout.success',
      data: {
        revokedCount: result.count,
      },
    }, 'Revoked refresh token');
  }

  /**
   * Decodes and verifies a JWT access token. Returns the payload.
   */
  verifyAccessToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;
      this.logger?.debug({
        action: 'authService.verifyAccessToken.success',
        data: {
          userId: payload.sub,
          sessionId: payload.sid ?? null,
        },
      }, 'Verified access token');
      return payload;
    } catch (error) {
      this.logger?.warn({
        action: 'authService.verifyAccessToken.invalid',
        err: error,
      }, 'Rejected invalid access token');
      throw new AuthError('Invalid or expired access token', 'INVALID_TOKEN');
    }
  }

  /**
   * Returns the user profile for a given user ID.
   */
  async getProfile(userId: string, sessionId?: string | null): Promise<UserProfile> {
    this.logger?.debug({
      action: 'authService.getProfile.start',
      data: { userId },
    }, 'Loading authenticated user profile');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'authService.getProfile.notFound',
        data: { userId },
      }, 'Authenticated user profile was not found');
      throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    }
    this.logger?.info({
      action: 'authService.getProfile.success',
      data: { userId },
    }, 'Loaded authenticated user profile');
    return {
      ...mapUserProfile(user),
      sessionId: sessionId ?? null,
    };
  }

  async issueSessionForUser(userId: string): Promise<TokenPair> {
    this.logger?.debug({
      action: 'authService.issueSession.start',
      data: { userId },
    }, 'Issuing session for existing user');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger?.warn({
        action: 'authService.issueSession.notFound',
        data: { userId },
      }, 'Cannot issue session for missing user');
      throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    }
    if (!user.isActive) {
      this.logger?.warn({
        action: 'authService.issueSession.inactiveAccount',
        data: { userId },
      }, 'Cannot issue session for inactive account');
      throw new AuthError(
        'This account is inactive. Session refresh is unavailable.',
        'ACCOUNT_INACTIVE',
        403,
      );
    }

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin);
    this.logger?.info({
      action: 'authService.issueSession.success',
      data: { userId: user.id },
    }, 'Issued session for existing user');
    return tokens;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async issueTokens(
    userId: string,
    email: string,
    isRootAdmin: boolean,
    sessionId: string = uuidv4(),
  ): Promise<TokenPair> {
    this.logger?.debug({
      action: 'authService.issueTokens.start',
      data: {
        userId,
        sessionId,
        isRootAdmin,
      },
    }, 'Issuing auth tokens');
    const now = Math.floor(Date.now() / 1000);

    const accessToken = jwt.sign(
      { sub: userId, email, isRootAdmin, sid: sessionId, iat: now, exp: now + ACCESS_TOKEN_EXPIRY },
      this.jwtSecret,
    );

    const refreshTokenValue = uuidv4();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        sessionId,
        userId,
        expiresAt,
      },
    });
    this.logger?.info({
      action: 'authService.issueTokens.success',
      data: {
        userId,
        sessionId,
      },
    }, 'Issued auth tokens');

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      csrfToken: uuidv4(),
      expiresIn: ACCESS_TOKEN_EXPIRY,
      sessionId,
    };
  }

  private async assertIdentifierAvailability(
    normalizedUsername: string,
    normalizedEmail: string,
  ): Promise<void> {
    const emailCollision = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: normalizedEmail },
        ],
      },
    });

    if (emailCollision) {
      this.logger?.warn({
        action: 'authService.assertIdentifierAvailability.emailCollision',
        data: {
          email: normalizedEmail,
          conflictingUserId: emailCollision.id,
        },
      }, 'Rejected registration for duplicate email');
      throw new AuthError('Email is already in use', 'EMAIL_EXISTS', 409);
    }

    if (normalizedUsername === normalizedEmail) {
      return;
    }

    const usernameCollision = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: normalizedUsername },
          { email: normalizedUsername },
        ],
      },
    });

    if (usernameCollision) {
      this.logger?.warn({
        action: 'authService.assertIdentifierAvailability.usernameCollision',
        data: {
          username: normalizedUsername,
          conflictingUserId: usernameCollision.id,
        },
      }, 'Rejected registration for duplicate username');
      throw new AuthError('Username is already in use', 'USERNAME_EXISTS', 409);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapUserProfile(user: {
  id: string;
  email: string;
  username: string;
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
}): UserProfile {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    isRootAdmin: user.isRootAdmin,
    authProvider: mapAuthProvider(user.authProvider),
    timezone: user.timezone ?? undefined,
    locale: user.locale ?? undefined,
    timeFormat: mapTimeFormat(user.timeFormat),
    dateFormat: mapDateFormat(user.dateFormat),
    createdAt: user.createdAt,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function mapAuthProvider(provider: PrismaUserAuthProvider | null): UserProfile['authProvider'] {
  if (provider === PrismaUserAuthProvider.EMAIL) return AuthProvider.EMAIL;
  if (provider === PrismaUserAuthProvider.GOOGLE) return AuthProvider.GOOGLE;
  if (provider === PrismaUserAuthProvider.APPLE) return AuthProvider.APPLE;
  return undefined;
}

function mapTimeFormat(format: PrismaUserTimeFormat | null): UserProfile['timeFormat'] {
  if (format === PrismaUserTimeFormat.TWELVE_HOUR) return TimeFormat.TWELVE_HOUR;
  if (format === PrismaUserTimeFormat.TWENTY_FOUR_HOUR) return TimeFormat.TWENTY_FOUR_HOUR;
  return undefined;
}

function mapDateFormat(format: PrismaUserDateFormat | null): UserProfile['dateFormat'] {
  if (format === PrismaUserDateFormat.MDY) return DateFormat.MDY;
  if (format === PrismaUserDateFormat.DMY) return DateFormat.DMY;
  if (format === PrismaUserDateFormat.YMD) return DateFormat.YMD;
  return undefined;
}
