import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createClearedSessionCookieHeaders,
  createSessionCookieHeaders,
  readRefreshCookie,
} from '../../core/session-cookies';
import { sendError } from '../../core/error-handler';
import { mapAccountResponse } from '../../mappers';
import { AuthError, AuthService } from '../auth/auth-service';
import { AccountLifecycleError, AccountService } from './service';

export function createAccountHandlers(accountService: AccountService, authService: AuthService) {
  return {
    reactivate: handleReactivate,
    updateProfile: handleUpdateProfile,
    updatePreferences: handleUpdatePreferences,
    changePassword: handleChangePassword,
    inactivate: handleInactivate,
    deleteAccount: handleDeleteAccount,
  };

  async function handleReactivate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.reactivateOwnAccount(userId);
      const tokens = await authService.issueSessionForUser(user.id);
      reply.header('Set-Cookie', createSessionCookieHeaders(tokens));
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      if (error instanceof AuthError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleUpdateProfile(
    request: FastifyRequest<{
      Body: { firstName: string; lastName: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.updateOwnProfile(userId, request.body);
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleUpdatePreferences(
    request: FastifyRequest<{
      Body: {
        timezone?: string | null;
        locale?: string | null;
        timeFormat?: '12H' | '24H' | null;
        dateFormat?: 'MDY' | 'DMY' | 'YMD' | null;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.updateOwnPreferences(userId, request.body);
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleChangePassword(
    request: FastifyRequest<{
      Body: {
        currentPassword: string;
        newPassword: string;
        confirmNewPassword: string;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      await accountService.changeOwnPassword(userId, {
        ...request.body,
        currentRefreshToken: readRefreshCookie(request.headers.cookie),
      });
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleInactivate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.inactivateOwnAccount(userId);
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleDeleteAccount(
    request: FastifyRequest<{ Body: { email: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userId = request.authUser?.userId;
      if (!userId) {
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      await accountService.deleteOwnInactiveAccount(userId, request.body.email);
      reply.header('Set-Cookie', createClearedSessionCookieHeaders());
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }
}
