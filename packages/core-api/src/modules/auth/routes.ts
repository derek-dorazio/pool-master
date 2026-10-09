/**
 * Auth module — registers authentication routes under /api/v1/auth.
 *
 * Routes:
 *   POST /register        — Create account with username/email/password
 *   POST /login           — Authenticate with username or email and receive tokens
 *   POST /refresh         — Exchange refresh token for new access token
 *   POST /logout          — Revoke refresh token
 *   GET  /me              — Current user profile from JWT
 */

import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth-service';
import { createAuthHandlers } from './handler';
import { getAppPrisma } from '../../core/prisma-context';
import { PrismaUserRepository } from '../../adapters';
// Registers ErrorEnvelope and SuccessResponse, which this module's routes $ref (#192).
import '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/auth.dto';

export function authModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const users = new PrismaUserRepository(prisma);
  const authService = new AuthService(users, prisma, fastify.log);
  const handlers = createAuthHandlers(authService);

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

  // #202 step 3.4 — `GET /auth/me` is gone. "Read a user" was one operation split two ways:
  // `getCurrentUser` here and `adminGetUserDetail` under `/admin/users/:userId`. Both are now
  // `GET /api/v1/users/:userId`, where `me` resolves to the caller — the subject is a
  // parameter, and access rule A6 decides who may ask.
}
