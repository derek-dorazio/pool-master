/**
 * Auth route handlers — registration, login, token refresh, logout, profile.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../core/error-handler';
import type { AuthService } from './auth-service';
import { AuthError } from './auth-service';

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
      Body: { refreshToken: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { refreshToken } = request.body;
      const tokens = await authService.refresh(refreshToken);
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
      Body: { refreshToken: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { refreshToken } = request.body;
    await authService.logout(refreshToken);
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
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing authorization header');
    }

    try {
      const token = authHeader.slice(7);
      const payload = authService.verifyAccessToken(token);

      if (!payload.sub) {
        return sendError(reply, 401, 'UNAUTHORIZED', 'Token missing required sub claim');
      }

      const profile = await authService.getProfile(payload.sub);
      return reply.send({ user: profile });
    } catch (err) {
      if (err instanceof AuthError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
