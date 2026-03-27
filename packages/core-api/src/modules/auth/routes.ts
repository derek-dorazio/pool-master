/**
 * Auth module — registers authentication routes under /api/v1/auth.
 *
 * Routes:
 *   POST /register        — Create account with email/password
 *   POST /login           — Authenticate and receive tokens
 *   POST /refresh         — Exchange refresh token for new access token
 *   POST /logout          — Revoke refresh token
 *   POST /forgot-password — Request password reset (placeholder)
 *   POST /callback        — OAuth callback (placeholder)
 *   GET  /me              — Current user profile from JWT
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { AuthService } from './auth-service';
import { createAuthHandlers } from './handler';

export async function authModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const authService = new AuthService(prisma);
  const handlers = createAuthHandlers(authService);

  // --- Registration ---
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'displayName'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
    handler: handlers.register,
  });

  // --- Login ---
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
    },
    handler: handlers.login,
  });

  // --- Token Refresh ---
  fastify.post('/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
    handler: handlers.refresh,
  });

  // --- Logout ---
  fastify.post('/logout', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
    handler: handlers.logout,
  });

  // --- Forgot Password (placeholder) ---
  fastify.post('/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
    handler: handlers.forgotPassword,
  });

  // --- OAuth Callback (placeholder) ---
  fastify.post('/callback', handlers.oauthCallback);

  // --- Current User Profile ---
  fastify.get('/me', handlers.me);
}
