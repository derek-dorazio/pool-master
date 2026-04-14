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
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
  isRootAdmin: boolean;
  iat: number;
  exp: number;
}

export interface UserProfile {
  id: string;
  email: string;
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

  constructor(private readonly prisma: PrismaClient) {
    this.jwtSecret = process.env.JWT_SECRET ?? 'poolmaster-dev-secret-change-in-production';
  }

  /**
   * Registers a new user with email/password and returns a token pair.
   */
  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AuthError('Email already registered', 'EMAIL_EXISTS', 409);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        authProvider: PrismaUserAuthProvider.EMAIL,
      },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin);

    return {
      user: mapUserProfile(user),
      tokens,
    };
  }

  /**
   * Authenticates a user with email/password and returns a token pair.
   */
  async login(email: string, password: string): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      throw new AuthError(
        'This account is inactive. Sign in is unavailable until the account is reactivated or deleted.',
        'ACCOUNT_INACTIVE',
        403,
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin);

    return {
      user: mapUserProfile(user),
      tokens,
    };
  }

  /**
   * Validates a refresh token and issues a new access token.
   */
  async refresh(refreshTokenValue: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshTokenValue },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }
    if (!stored.user.isActive) {
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

    return this.issueTokens(stored.user.id, stored.user.email, stored.user.isRootAdmin);
  }

  /**
   * Revokes a refresh token (logout).
   */
  async logout(refreshTokenValue: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshTokenValue, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Decodes and verifies a JWT access token. Returns the payload.
   */
  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as JwtPayload;
    } catch {
      throw new AuthError('Invalid or expired access token', 'INVALID_TOKEN');
    }
  }

  /**
   * Returns the user profile for a given user ID.
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    }
    return mapUserProfile(user);
  }

  async issueSessionForUser(userId: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    }
    if (!user.isActive) {
      throw new AuthError(
        'This account is inactive. Session refresh is unavailable.',
        'ACCOUNT_INACTIVE',
        403,
      );
    }

    return this.issueTokens(user.id, user.email, user.isRootAdmin);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async issueTokens(userId: string, email: string, isRootAdmin: boolean): Promise<TokenPair> {
    const now = Math.floor(Date.now() / 1000);

    const accessToken = jwt.sign(
      { sub: userId, email, isRootAdmin, iat: now, exp: now + ACCESS_TOKEN_EXPIRY },
      this.jwtSecret,
    );

    const refreshTokenValue = uuidv4();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      csrfToken: uuidv4(),
      expiresIn: ACCESS_TOKEN_EXPIRY,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapUserProfile(user: {
  id: string;
  email: string;
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
