/**
 * Auth route handlers — registration, login, token refresh, logout, profile.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../core/error-handler';
import type { AuthService } from './auth-service';
import { AuthError } from './auth-service';
import { PasswordResetError, type PasswordResetService } from './password-reset-service';
import { EmailChangeUndoError, type EmailChangeUndoService } from './email-change-undo-service';
import type { EmailChangeUndoRequest, PasswordResetConfirmRequest, PasswordResetRequest } from '@poolmaster/shared/dto';
import {
  createClearedSessionCookieHeaders,
  createSessionCookieHeaders,
  readRefreshCookie,
} from '../../core/session-cookies';
// #206 — these five sends used to pass service results straight to reply.send, so the
// response DTO was enforced only by Fastify's serializer stripping undeclared fields.
// That is how `sessionId` reached three response bodies without a compile error. Going
// through the mappers makes the contract type-checked.
import {
  toAuthResponse,
  toTokenRefreshResponse,
} from '../../mappers';

export function createAuthHandlers(
  authService: AuthService,
  passwordResetService: PasswordResetService,
  emailChangeUndoService: EmailChangeUndoService,
) {
  return {
    register: handleRegister,
    login: handleLogin,
    refresh: handleRefresh,
    logout: handleLogout,
    requestPasswordReset: handleRequestPasswordReset,
    confirmPasswordReset: handleConfirmPasswordReset,
    undoEmailChange: handleUndoEmailChange,
  };

  async function handleRegister(
    request: FastifyRequest<{
      Body: { username: string; email: string; password: string; firstName: string; lastName: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;

    try {
      const { username, email, password, firstName, lastName } = request.body;
      logger.debug({
        action: 'auth.register.request',
        data: {
          username,
          emailDomain: extractEmailDomain(email),
          hasPassword: password.length > 0,
          hasFirstName: firstName.trim().length > 0,
          hasLastName: lastName.trim().length > 0,
        },
      }, 'Handling auth registration request');
      const result = await authService.register(username, email, password, firstName, lastName);
      logger.info({
        action: 'auth.register.succeeded',
        data: {
          userId: result.user.id,
          username: result.user.username,
        },
      }, 'Registered user account');
      logger.debug({
        action: 'auth.register.response_ready',
        data: {
          userId: result.user.id,
          statusCode: 201,
        },
      }, 'Auth registration response ready');
      reply.header('Set-Cookie', createSessionCookieHeaders(result.tokens));
      return reply.status(201).send(toAuthResponse(result.user, result.tokens));
    } catch (err) {
      if (err instanceof AuthError) {
        logger.warn({
          action: 'auth.register.rejected',
          errorCode: err.code,
          statusCode: err.statusCode,
          data: {
            username: request.body.username,
            emailDomain: extractEmailDomain(request.body.email),
          },
        }, 'Auth registration rejected');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function handleLogin(
    request: FastifyRequest<{
      Body: { identifier: string; password: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;

    try {
      const { identifier, password } = request.body;
      logger.debug({
        action: 'auth.login.request',
        data: {
          identifierType: inferIdentifierType(identifier),
          hasPassword: password.length > 0,
        },
      }, 'Handling auth login request');
      const result = await authService.login(identifier, password);
      logger.info({
        action: 'auth.login.succeeded',
        data: {
          userId: result.user.id,
          sessionEstablished: true,
        },
      }, 'Authenticated user');
      logger.debug({
        action: 'auth.login.response_ready',
        data: {
          userId: result.user.id,
          statusCode: 200,
        },
      }, 'Auth login response ready');
      reply.header('Set-Cookie', createSessionCookieHeaders(result.tokens));
      return reply.send(toAuthResponse(result.user, result.tokens));
    } catch (err) {
      if (err instanceof AuthError) {
        logger.warn({
          action: 'auth.login.rejected',
          errorCode: err.code,
          statusCode: err.statusCode,
          data: {
            identifierType: inferIdentifierType(request.body.identifier),
          },
        }, 'Auth login rejected');
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
    const logger = request.contextLogger ?? request.log;

    try {
      logger.debug({
        action: 'auth.refresh.request',
        data: {
          tokenSource: resolveTokenSource(request.body?.refreshToken, request.headers.cookie),
        },
      }, 'Handling auth refresh request');
      const refreshToken = request.body?.refreshToken ?? readRefreshCookie(request.headers.cookie);
      if (!refreshToken) {
        logger.warn({
          action: 'auth.refresh.rejected',
          errorCode: 'INVALID_REFRESH_TOKEN',
          statusCode: 401,
          data: {
            tokenSource: 'missing',
          },
        }, 'Auth refresh rejected');
        return sendError(reply, 401, 'INVALID_REFRESH_TOKEN', 'Missing refresh token');
      }
      const tokens = await authService.refresh(refreshToken);
      logger.info({
        action: 'auth.refresh.succeeded',
        data: {
          sessionRotated: true,
        },
      }, 'Rotated auth session');
      logger.debug({
        action: 'auth.refresh.response_ready',
        data: {
          statusCode: 200,
        },
      }, 'Auth refresh response ready');
      reply.header('Set-Cookie', createSessionCookieHeaders(tokens));
      return reply.send(toTokenRefreshResponse(tokens));
    } catch (err) {
      if (err instanceof AuthError) {
        logger.warn({
          action: 'auth.refresh.rejected',
          errorCode: err.code,
          statusCode: err.statusCode,
          data: {
            tokenSource: resolveTokenSource(request.body?.refreshToken, request.headers.cookie),
          },
        }, 'Auth refresh rejected');
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
    const logger = request.contextLogger ?? request.log;
    const refreshToken = request.body?.refreshToken ?? readRefreshCookie(request.headers.cookie);
    logger.debug({
      action: 'auth.logout.request',
      data: {
        tokenSource: resolveTokenSource(request.body?.refreshToken, request.headers.cookie),
      },
    }, 'Handling auth logout request');
    if (refreshToken) {
      await authService.logout(refreshToken);
      logger.info({
        action: 'auth.logout.succeeded',
        data: {
          sessionRevoked: true,
        },
      }, 'Revoked auth session');
    } else {
      logger.debug({
        action: 'auth.logout.noop',
        data: {
          tokenSource: 'missing',
        },
      }, 'Auth logout request had no refresh token to revoke');
    }
    logger.debug({
      action: 'auth.logout.response_ready',
      data: {
        statusCode: 200,
      },
    }, 'Auth logout response ready');
    reply.header('Set-Cookie', createClearedSessionCookieHeaders());
    return reply.send({ success: true });
  }

  /**
   * Answers 202 BEFORE the account lookup, token write and email, so a matching account is not
   * measurably slower than none. Only the per-address limit can refuse, and it says nothing about
   * any account.
   */
  async function handleRequestPasswordReset(
    request: FastifyRequest<{ Body: PasswordResetRequest }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const logger = request.contextLogger ?? request.log;
    try {
      passwordResetService.assertRequestAllowed(request.ip);
    } catch (err) {
      if (err instanceof PasswordResetError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
    logger.debug({
      action: 'auth.passwordReset.request',
      data: { identifierType: inferIdentifierType(request.body.identifier) },
    }, 'Handling password reset request');
    void reply.status(202).send({ success: true });
    await passwordResetService.requestReset(request.body.identifier);
    return reply;
  }

  async function handleConfirmPasswordReset(
    request: FastifyRequest<{ Body: PasswordResetConfirmRequest }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    try {
      passwordResetService.assertConfirmAllowed(request.ip);
      const { token, newPassword, confirmNewPassword } = request.body;
      await passwordResetService.confirmReset(token, newPassword, confirmNewPassword);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof PasswordResetError) {
        logger.warn({
          action: 'auth.passwordReset.rejected',
          errorCode: err.code,
          statusCode: err.statusCode,
        }, 'Password reset confirm rejected');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function handleUndoEmailChange(
    request: FastifyRequest<{ Body: EmailChangeUndoRequest }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    try {
      emailChangeUndoService.assertUndoAllowed(request.ip);
      await emailChangeUndoService.undo(request.body.token);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof EmailChangeUndoError) {
        logger.warn({
          action: 'auth.emailChangeUndo.rejected',
          errorCode: err.code,
          statusCode: err.statusCode,
        }, 'Email change undo rejected');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}

function extractEmailDomain(email: string): string | null {
  return email.trim().toLowerCase().split('@').at(1) ?? null;
}

function inferIdentifierType(identifier: string): 'email' | 'username' {
  return identifier.includes('@') ? 'email' : 'username';
}

function resolveTokenSource(bodyRefreshToken: string | undefined, cookieHeader: string | undefined): 'body' | 'cookie' | 'missing' {
  if (bodyRefreshToken) {
    return 'body';
  }

  return readRefreshCookie(cookieHeader) ? 'cookie' : 'missing';
}
