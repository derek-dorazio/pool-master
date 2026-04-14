/**
 * Auth module — registers authentication routes under /api/v1/auth.
 *
 * Routes:
 *   POST /register        — Create account with email/password
 *   POST /login           — Authenticate and receive tokens
 *   POST /refresh         — Exchange refresh token for new access token
 *   POST /logout          — Revoke refresh token
 *   GET  /me              — Current user profile from JWT
 */

import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth-service';
import { createAuthHandlers } from './handler';
import { getAppPrisma } from '../../core/prisma-context';
import {
  zodToJsonSchema,
  RegisterRequestSchema,
  LoginRequestSchema,
  AuthResponseSchema,
  TokenRefreshResponseSchema,
  MeResponseSchema,
  ErrorEnvelopeSchema,
  SuccessSchema,
} from '@poolmaster/shared/dto';

export async function authModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const authService = new AuthService(prisma);
  const handlers = createAuthHandlers(authService);

  // --- Registration ---
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user account',
      description:
        'Creates a new email/password account, issues the initial auth tokens, and returns the authenticated user profile used to enter the PoolMaster app.',
      operationId: 'registerUser',
      body: zodToJsonSchema(RegisterRequestSchema),
      response: {
        201: zodToJsonSchema(AuthResponseSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
        409: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.register,
  });

  // --- Login ---
  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Authenticate with email and password',
      description:
        'Authenticates an existing email/password account and returns the authenticated user profile plus fresh access, refresh, and CSRF tokens.',
      operationId: 'loginUser',
      body: zodToJsonSchema(LoginRequestSchema),
      response: {
        200: zodToJsonSchema(AuthResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
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
        200: zodToJsonSchema(TokenRefreshResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
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
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.logout,
  });

  // --- Current User Profile ---
  fastify.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user profile from JWT',
      description:
        'Returns the authenticated user profile that drives role-aware app-shell behavior after the browser already has a valid access token.',
      operationId: 'getCurrentUser',
      response: {
        200: zodToJsonSchema(MeResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.me,
  });
}
