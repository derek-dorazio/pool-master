/**
 * Auth route handlers — registration, login, token refresh, logout, profile.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
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
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
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
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
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
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
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
    return reply.status(204).send();
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
    return reply.status(501).send({
      error: 'NOT_IMPLEMENTED',
      message: 'OAuth callback not yet configured. Use email/password registration.',
    });
  }

  async function handleMe(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing authorization header' });
    }

    try {
      const token = authHeader.slice(7);
      const payload = authService.verifyAccessToken(token);
      const profile = await authService.getProfile(payload.sub);
      return reply.send({ user: profile });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }
}
