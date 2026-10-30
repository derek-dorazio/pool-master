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
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import { AuthProvider, isKnownLocale, isKnownTimeZone, type User } from '@poolmaster/shared/domain';
import { readJwtSecret } from '../../core/config';
import { lockMemberRow } from '../../adapters';
import { hashRefreshToken } from './refresh-token-hash';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the signup form read from the browser (#1039); either may be missing. */
export interface SignupDisplayPreferences {
  timezone?: string;
  locale?: string;
}

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
/**
 * How long after a rotation its old token may come back without ending the session (#1229). Two
 * tabs share the refresh cookie, and a tab can send the old token before the other's refresh has
 * set the new one; that is a race, not a stolen token, and it is refused without ending anything.
 */
const ROTATED_TOKEN_GRACE_MS = 10_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
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
   * Registers a new user with username/email/password and returns a token pair. The time zone
   * and locale the signup form read from the browser are kept, when given; with none the member
   * sees US Eastern and en-US.
   */
  async register(
    username: string,
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    preferences: SignupDisplayPreferences = {},
  ): Promise<{ user: User; tokens: TokenPair }> {
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    if (preferences.timezone !== undefined && !isKnownTimeZone(preferences.timezone)) {
      throw new AuthError(`Unknown time zone: ${preferences.timezone}.`, 'TIME_ZONE_UNKNOWN', 400);
    }
    if (preferences.locale !== undefined && !isKnownLocale(preferences.locale)) {
      throw new AuthError(`Unknown locale: ${preferences.locale}.`, 'LOCALE_UNKNOWN', 400);
    }
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
      ...(preferences.timezone !== undefined && { timezone: preferences.timezone }),
      ...(preferences.locale !== undefined && { locale: preferences.locale }),
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
    // No `isActive` check: an inactive account signs in, because reactivating or deleting it
    // needs a session (DOMAIN-OPERATIONS A9). The check used to sit before the password
    // comparison, so a wrong password on an inactive account answered ACCOUNT_INACTIVE and
    // told a stranger the account existed.
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
      where: { tokenHash: hashRefreshToken(refreshTokenValue) },
      include: { user: true },
    });

    const now = new Date();
    if (stored?.rotatedAt && now.getTime() - stored.rotatedAt.getTime() > ROTATED_TOKEN_GRACE_MS) {
      // A token a refresh replaced has come back after the two-tab grace window: someone holds a
      // copy of it. Whoever refreshed first may be the thief, so the whole session ends (#1229).
      // Behind the member's lock, so a rotation in flight commits its new token first and the
      // revoke sees it (#1264).
      const ended = await this.prisma.$transaction(async (tx) => {
        await lockMemberRow(tx, stored.userId);
        return tx.refreshToken.updateMany({
          where: { userId: stored.userId, sessionId: stored.sessionId, revokedAt: null },
          data: { revokedAt: now },
        });
      });
      this.logger?.warn({
        action: 'authService.refresh.reuseDetected',
        data: {
          userId: stored.userId,
          sessionId: stored.sessionId,
          revokedCount: ended.count,
        },
      }, 'Ended a session because a rotated refresh token was used again');
      throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    if (!stored || stored.revokedAt || stored.expiresAt < now) {
      this.logger?.warn({
        action: 'authService.refresh.invalidToken',
      }, 'Rejected refresh for invalid or expired token');
      throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }
    // An inactive account keeps its session, for the same reason it may sign in (A9).

    // Revoke the old refresh token (rotation). The read above is not enough: two refreshes with
    // the same token can both see it live, so only the one whose conditional update revokes it
    // may issue the next token (#1175). One transaction, so a failed insert leaves the old token
    // live rather than signing the member out. The member's lock comes first, so a reuse revoke
    // under way finishes before this rotation reads the token (#1264).
    const tokens = await this.prisma.$transaction(async (tx) => {
      await lockMemberRow(tx, stored.userId);
      const rotated = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now, rotatedAt: now },
      });
      if (rotated.count === 0) {
        this.logger?.warn({
          action: 'authService.refresh.alreadyRotated',
          data: {
            userId: stored.user.id,
            sessionId: stored.sessionId,
          },
        }, 'Rejected refresh for a token another refresh already rotated');
        throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
      }
      return this.issueTokens(
        stored.user.id,
        stored.user.email,
        stored.user.isRootAdmin,
        stored.sessionId,
        tx,
      );
    });
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
      where: { tokenHash: hashRefreshToken(refreshTokenValue), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger?.info({
      action: 'authService.logout.success',
      data: {
        revokedCount: result.count,
      },
    }, 'Revoked refresh token');
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
    db: Pick<Prisma.TransactionClient, 'refreshToken'> = this.prisma,
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

    await db.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(refreshTokenValue),
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
      throw new AuthError('Email is already in use', 'ACCOUNT_EMAIL_TAKEN', 409);
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
      throw new AuthError('Username is already in use', 'ACCOUNT_USERNAME_TAKEN', 409);
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


