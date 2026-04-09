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
import {
  zodToJsonSchema,
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  AuthResponseSchema,
  TokenRefreshResponseSchema,
  MeResponseSchema,
  ErrorEnvelopeSchema,
  SuccessSchema,
  ForgotPasswordRequestSchema,
  ForgotPasswordResponseSchema,
  OAuthCallbackRequestSchema,
  OAuthCallbackResponseSchema,
} from '@poolmaster/shared/dto';

export async function authModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const authService = new AuthService(prisma);
  const handlers = createAuthHandlers(authService);

  // --- Registration ---
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user account',
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
      operationId: 'refreshToken',
      body: zodToJsonSchema(RefreshRequestSchema),
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
      operationId: 'logoutUser',
      body: zodToJsonSchema(LogoutRequestSchema),
      response: {
        200: zodToJsonSchema(SuccessSchema),
        400: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.logout,
  });

  // --- Forgot Password (placeholder) ---
  fastify.post('/forgot-password', {
    schema: {
      tags: ['Auth'],
      summary: 'Request password reset email',
      operationId: 'forgotPassword',
      body: zodToJsonSchema(ForgotPasswordRequestSchema),
      response: { 200: zodToJsonSchema(ForgotPasswordResponseSchema) },
    },
    handler: handlers.forgotPassword,
  });

  // --- OAuth Callback (placeholder) ---
  fastify.post('/callback', {
    schema: {
      tags: ['Auth'],
      summary: 'OAuth provider callback',
      operationId: 'oauthCallback',
      body: zodToJsonSchema(OAuthCallbackRequestSchema),
      response: { 501: zodToJsonSchema(OAuthCallbackResponseSchema) },
    },
    handler: handlers.oauthCallback,
  });

  // --- Current User Profile ---
  fastify.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user profile from JWT',
      operationId: 'getCurrentUser',
      response: {
        200: zodToJsonSchema(MeResponseSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: handlers.me,
  });
}
