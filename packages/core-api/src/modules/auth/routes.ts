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
import { z } from 'zod';
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
  ApiErrorSchema,
  SuccessSchema,
} from '@poolmaster/shared/dto';

const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});

const forgotPasswordResponseSchema = z.object({
  message: z.string(),
});

const oauthCallbackRequestSchema = z.object({
  code: z.string(),
  state: z.string(),
});

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
      response: { 201: zodToJsonSchema(AuthResponseSchema) },
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
      response: { 200: zodToJsonSchema(AuthResponseSchema) },
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
      response: { 200: zodToJsonSchema(TokenRefreshResponseSchema) },
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
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: handlers.logout,
  });

  // --- Forgot Password (placeholder) ---
  fastify.post('/forgot-password', {
    schema: {
      tags: ['Auth'],
      summary: 'Request password reset email',
      operationId: 'forgotPassword',
      body: zodToJsonSchema(forgotPasswordRequestSchema),
      response: { 200: zodToJsonSchema(forgotPasswordResponseSchema) },
    },
    handler: handlers.forgotPassword,
  });

  // --- OAuth Callback (placeholder) ---
  fastify.post('/callback', {
    schema: {
      tags: ['Auth'],
      summary: 'OAuth provider callback',
      operationId: 'oauthCallback',
      body: zodToJsonSchema(oauthCallbackRequestSchema),
      response: { 501: zodToJsonSchema(ApiErrorSchema) },
    },
    handler: handlers.oauthCallback,
  });

  // --- Current User Profile ---
  fastify.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user profile from JWT',
      operationId: 'getCurrentUser',
      response: { 200: zodToJsonSchema(MeResponseSchema) },
    },
    handler: handlers.me,
  });
}
