/**
 * AuthService — business logic for authentication and token management.
 *
 * Handles user registration, login, JWT issuance/refresh, and logout.
 * Passwords are hashed with bcrypt. Refresh tokens are persisted in Postgres.
 *
 * #202 step 3.4 — user reads and the registration write go through `UserRepository`. This
 * file previously held the FOURTH hand-rolled User shape (`UserProfile`), the fourth copy of
 * the row→domain enum mapping, and two more hand-written email-or-username lookups. The port
 * method those two asked for, `findByIdentifier`, was added in step 3.2 for exactly this and
 * is now wired here.
 *
 * `prisma` stays for refresh tokens, which are this module's own aggregate, and for the one
 * `passwordHash` read the port deliberately never serves.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import { AuthProvider, type User } from '@poolmaster/shared/domain';
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
    private readonly users: UserRepository,
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
  ): Promise<{ user: User; tokens: TokenPair }> {
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

    const user = await this.users.create({
      email: normalizedEmail,
      username: normalizedUsername,
      firstName,
      lastName,
      isActive: true,
      isRootAdmin: false,
      authProvider: AuthProvider.EMAIL,
    }, { passwordHash });

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin === true);
    this.logger?.info({
      action: 'authService.register.success',
      data: {
        userId: user.id,
        isRootAdmin: user.isRootAdmin === true,
      },
    }, 'Registered user account');

    return { user, tokens };
  }

  /**
   * Authenticates a user with username-or-email/password and returns a token pair.
   */
  async login(identifier: string, password: string): Promise<{ user: User; tokens: TokenPair }> {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const identifierType = normalizedIdentifier.includes('@') ? 'email' : 'username';
    this.logger?.debug({
      action: 'authService.login.start',
      data: {
        identifierType,
      },
    }, 'Authenticating user');
    // One question, not two: email and username are both @unique and login accepts either.
    const user = await this.users.findByIdentifier(normalizedIdentifier);
    // The hash is read separately and by id, because `UserRepository` deliberately never
    // returns it — nothing that reads a user should be handed a secret.
    const credentials = user ? await this.readCredentials(user.id) : null;
    if (!user || !credentials?.passwordHash) {
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

    const valid = await bcrypt.compare(password, credentials.passwordHash);
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

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin === true);
    this.logger?.info({
      action: 'authService.login.success',
      data: {
        userId: user.id,
        isRootAdmin: user.isRootAdmin === true,
      },
    }, 'Authenticated user');

    return { user, tokens };
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
   * Returns the user profile for a given user ID.
   */
  async getProfile(userId: string): Promise<User> {
    this.logger?.debug({
      action: 'authService.getProfile.start',
      data: { userId },
    }, 'Loading authenticated user profile');
    const user = await this.users.findById(userId);
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
    return user;
  }

  async issueSessionForUser(userId: string): Promise<TokenPair> {
    this.logger?.debug({
      action: 'authService.issueSession.start',
      data: { userId },
    }, 'Issuing session for existing user');
    const user = await this.users.findById(userId);
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

    const tokens = await this.issueTokens(user.id, user.email, user.isRootAdmin === true);
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
    sessionId: string = randomUUID(),
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

    const refreshTokenValue = randomUUID();
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
      csrfToken: randomUUID(),
      expiresIn: ACCESS_TOKEN_EXPIRY,
      sessionId,
    };
  }

  /**
   * The one user column `UserRepository` never returns. Read by id, after the port has
   * resolved the identifier, so the lookup and the secret stay separate concerns.
   */
  private async readCredentials(userId: string): Promise<{ passwordHash: string | null } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
  }

  private async assertIdentifierAvailability(
    normalizedUsername: string,
    normalizedEmail: string,
  ): Promise<void> {
    const emailCollision = await this.users.findByIdentifier(normalizedEmail);

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

    const usernameCollision = await this.users.findByIdentifier(normalizedUsername);

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}


