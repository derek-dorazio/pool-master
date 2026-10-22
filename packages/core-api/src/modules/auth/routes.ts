/**
 * Auth module — registers authentication routes under /api/v1/auth.
 *
 * Routes:
 *   POST /register        — Create account with username/email/password
 *   POST /login           — Authenticate with username or email and receive tokens
 *   POST /refresh         — Exchange refresh token for new access token
 *   POST /logout          — Revoke refresh token
 *   POST /password-reset/request — Email a one-time reset link (#847)
 *   POST /password-reset/confirm — Set a new password with that link (#847)
 */

import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth-service';
import { PasswordResetService } from './password-reset-service';
import { createAuthHandlers } from './handler';
import { readApplicationBaseUrl, type MailModuleOptions } from '../email';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaUserRepository } from '../../adapters';
// Registers ErrorEnvelope and SuccessResponse, which this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/auth.dto';

export function authModule(fastify: FastifyInstance, opts: MailModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const users = new PrismaUserRepository(prisma);
  const authService = new AuthService(users, prisma, fastify.log);
  const passwordResetService = new PasswordResetService({
    users,
    prisma,
    mailDelivery: opts.mailDelivery,
    appBaseUrl: readApplicationBaseUrl(process.env),
    logger: fastify.log,
  });
  const handlers = createAuthHandlers(authService, passwordResetService);

  // --- Registration ---
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user account',
      description:
        'Creates a new username/email/password account, issues the initial auth tokens, and returns the authenticated user profile used to enter the PoolMaster app.',
      operationId: 'registerUser',
      body: schemaRef('RegisterRequest'),
      response: {
        201: schemaRef('AuthResponse'),
        400: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.register,
  });

  // --- Login ---
  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Authenticate with username or email and password',
      description:
        'Authenticates an existing account using username or email plus password, then returns the authenticated user profile plus fresh access, refresh, and CSRF tokens.',
      operationId: 'loginUser',
      body: schemaRef('LoginRequest'),
      response: {
        200: schemaRef('AuthResponse'),
        401: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.login,
  });

  // --- Token Refresh ---
  fastify.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Exchange refresh token for new access token',
      description:
        'Rotates the refresh-token session forward and returns a new token bundle. Browser clients normally rely on the refresh cookie rather than sending a body payload.',
      operationId: 'refreshToken',
      response: {
        200: schemaRef('TokenRefreshResponse'),
        401: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.refresh,
  });

  // --- Logout ---
  fastify.post('/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Revoke refresh token',
      description:
        'Revokes the current refresh-token session so the browser or client must authenticate again before making further authenticated requests.',
      operationId: 'logoutUser',
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.logout,
  });

  // --- Password recovery (#847, plans/password-recovery.md) ---
  fastify.post('/password-reset/request', {
    schema: {
      tags: ['Auth'],
      summary: 'Email a password reset link',
      description:
        'Public. Looks up the account by email or username and, when one matches, emails it a link that sets a new password. The link works once and expires after 10 minutes, and a newer request cancels it. The answer is 202 whether or not an account matched, so it never tells a caller which emails or usernames have accounts. 429 PASSWORD_RESET_RATE_LIMITED when this address has asked too often in the last minute.',
      operationId: 'requestPasswordReset',
      body: schemaRef('PasswordResetRequest'),
      response: {
        202: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        429: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.requestPasswordReset,
  });

  fastify.post('/password-reset/confirm', {
    schema: {
      tags: ['Auth'],
      summary: 'Set a new password with a reset link',
      description:
        'Public; the token from the reset link is the whole authority. Sets the new password, cancels the account\'s other reset links and signs the account out on every device; the caller then signs in with the new password. 400 PASSWORD_RESET_LINK_INVALID for a link that is unknown, used, cancelled or expired (one code for all four), 400 PASSWORD_CONFIRMATION_MISMATCH when the two passwords differ, 429 PASSWORD_RESET_RATE_LIMITED when this address has tried too often in the last minute.',
      operationId: 'confirmPasswordReset',
      body: schemaRef('PasswordResetConfirmRequest'),
      response: {
        200: schemaRef('SuccessResponse'),
        400: schemaRef('ErrorEnvelope'),
        429: schemaRef('ErrorEnvelope'),
      },
    },
    handler: handlers.confirmPasswordReset,
  });

  // #202 step 3.4 — `GET /auth/me` is gone. "Read a user" was one operation split two ways:
  // `getCurrentUser` here and `adminGetUserDetail` under `/admin/users/:userId`. Both are now
  // `GET /api/v1/users/:userId`, where `me` resolves to the caller — the subject is a
  // parameter, and access rule A6 decides who may ask.
}
