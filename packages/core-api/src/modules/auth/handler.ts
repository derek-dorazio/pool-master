/**
 * Auth route handlers — registration, login, token refresh, logout, profile.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../core/error-handler';
import type { AuthService } from './auth-service';
import { AuthError } from './auth-service';
import {
  createClearedSessionCookieHeaders,
  createSessionCookieHeaders,
  readRefreshCookie,
} from '../../core/session-cookies';

export function createAuthHandlers(authService: AuthService) {
  return {
    register: handleRegister,
    login: handleLogin,
    refresh: handleRefresh,
    logout: handleLogout,
    forgotPassword: handleForgotPassword,
    oauthCallback: handleOAuthCallback,
    me: handleMe,
  };

  async function handleRegister(
    request: FastifyRequest<{
      Body: { email: string; password: string; displayName: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { email, password, displayName } = request.body;
      const result = await authService.register(email, password, displayName);
      reply.header('Set-Cookie', createSessionCookieHeaders(result.tokens));
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function handleLogin(
    request: FastifyRequest<{
      Body: { email: string; password: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { email, password } = request.body;
      const result = await authService.login(email, password);
      reply.header('Set-Cookie', createSessionCookieHeaders(result.tokens));
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function handleRefresh(
    request: FastifyRequest<{
      Body?: { refreshToken?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const refreshToken = request.body?.refreshToken ?? readRefreshCookie(request.headers.cookie);
      if (!refreshToken) {
        return sendError(reply, 401, 'INVALID_REFRESH_TOKEN', 'Missing refresh token');
      }
      const tokens = await authService.refresh(refreshToken);
      reply.header('Set-Cookie', createSessionCookieHeaders(tokens));
      return reply.send(tokens);
    } catch (err) {
      if (err instanceof AuthError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function handleLogout(
    request: FastifyRequest<{
      Body?: { refreshToken?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const refreshToken = request.body?.refreshToken ?? readRefreshCookie(request.headers.cookie);
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    reply.header('Set-Cookie', createClearedSessionCookieHeaders());
    return reply.send({ success: true });
  }

  async function handleForgotPassword(
    request: FastifyRequest<{
      Body: { email: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    // Placeholder — always returns success to prevent email enumeration
    return reply.send({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  }

  async function handleOAuthCallback(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Placeholder for Auth0/Cognito OAuth callback
    return sendError(
      reply,
      501,
      'NOT_IMPLEMENTED',
      'OAuth callback not yet configured. Use email/password registration.',
    );
  }

  async function handleMe(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      if (!request.authUser?.userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }
      const profile = await authService.getProfile(request.authUser.userId);
      return reply.send({ user: profile });
    } catch (err) {
      if (err instanceof AuthError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
