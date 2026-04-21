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
    const logger = request.contextLogger ?? request.log;

    try {
      const userId = request.authUser?.userId;
      logger.debug({
        action: 'account.reactivate.request',
        data: {
          userId: userId ?? null,
        },
      }, 'Handling account reactivation request');
      if (!userId) {
        logger.warn({
          action: 'account.reactivate.rejected',
          errorCode: 'AUTH_SESSION_REQUIRED',
          statusCode: 401,
        }, 'Account reactivation rejected');
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.reactivateOwnAccount(userId);
      const tokens = await authService.issueSessionForUser(user.id);
      logger.info({
        action: 'account.reactivate.succeeded',
        data: {
          userId: user.id,
          isActive: user.isActive,
        },
      }, 'Reactivated account');
      logger.debug({
        action: 'account.reactivate.response_ready',
        data: {
          userId: user.id,
          statusCode: 200,
        },
      }, 'Account reactivation response ready');
      reply.header('Set-Cookie', createSessionCookieHeaders(tokens));
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        logger.warn({
          action: 'account.reactivate.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account reactivation rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      if (error instanceof AuthError) {
        logger.warn({
          action: 'account.reactivate.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account reactivation rejected');
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
    const logger = request.contextLogger ?? request.log;

    try {
      const userId = request.authUser?.userId;
      logger.debug({
        action: 'account.profile_update.request',
        data: {
          userId: userId ?? null,
          hasFirstName: request.body.firstName.trim().length > 0,
          hasLastName: request.body.lastName.trim().length > 0,
        },
      }, 'Handling account profile update request');
      if (!userId) {
        logger.warn({
          action: 'account.profile_update.rejected',
          errorCode: 'AUTH_SESSION_REQUIRED',
          statusCode: 401,
        }, 'Account profile update rejected');
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.updateOwnProfile(userId, request.body);
      logger.info({
        action: 'account.profile_update.succeeded',
        data: {
          userId: user.id,
        },
      }, 'Updated account profile');
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        logger.warn({
          action: 'account.profile_update.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account profile update rejected');
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
    const logger = request.contextLogger ?? request.log;

    try {
      const userId = request.authUser?.userId;
      logger.debug({
        action: 'account.preferences_update.request',
        data: {
          userId: userId ?? null,
          timezoneProvided: request.body.timezone !== undefined,
          localeProvided: request.body.locale !== undefined,
          timeFormatProvided: request.body.timeFormat !== undefined,
          dateFormatProvided: request.body.dateFormat !== undefined,
        },
      }, 'Handling account preferences update request');
      if (!userId) {
        logger.warn({
          action: 'account.preferences_update.rejected',
          errorCode: 'AUTH_SESSION_REQUIRED',
          statusCode: 401,
        }, 'Account preferences update rejected');
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.updateOwnPreferences(userId, request.body);
      logger.info({
        action: 'account.preferences_update.succeeded',
        data: {
          userId: user.id,
        },
      }, 'Updated account preferences');
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        logger.warn({
          action: 'account.preferences_update.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account preferences update rejected');
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
    const logger = request.contextLogger ?? request.log;

    try {
      const userId = request.authUser?.userId;
      logger.debug({
        action: 'account.password_change.request',
        data: {
          userId: userId ?? null,
          hasCurrentPassword: request.body.currentPassword.length > 0,
          hasNewPassword: request.body.newPassword.length > 0,
          hasConfirmation: request.body.confirmNewPassword.length > 0,
          refreshTokenSource: readRefreshCookie(request.headers.cookie) ? 'cookie' : 'missing',
        },
      }, 'Handling account password change request');
      if (!userId) {
        logger.warn({
          action: 'account.password_change.rejected',
          errorCode: 'AUTH_SESSION_REQUIRED',
          statusCode: 401,
        }, 'Account password change rejected');
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      await accountService.changeOwnPassword(userId, {
        ...request.body,
        currentRefreshToken: readRefreshCookie(request.headers.cookie),
      });
      logger.info({
        action: 'account.password_change.succeeded',
        data: {
          userId,
        },
      }, 'Changed account password');
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        logger.warn({
          action: 'account.password_change.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account password change rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleInactivate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const logger = request.contextLogger ?? request.log;

    try {
      const userId = request.authUser?.userId;
      logger.debug({
        action: 'account.inactivate.request',
        data: {
          userId: userId ?? null,
        },
      }, 'Handling account inactivation request');
      if (!userId) {
        logger.warn({
          action: 'account.inactivate.rejected',
          errorCode: 'AUTH_SESSION_REQUIRED',
          statusCode: 401,
        }, 'Account inactivation rejected');
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      const user = await accountService.inactivateOwnAccount(userId);
      logger.info({
        action: 'account.inactivate.succeeded',
        data: {
          userId: user.id,
          isActive: user.isActive,
        },
      }, 'Inactivated account');
      return reply.send(mapAccountResponse(user));
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        logger.warn({
          action: 'account.inactivate.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account inactivation rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }

  async function handleDeleteAccount(
    request: FastifyRequest<{ Body: { email: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;

    try {
      const userId = request.authUser?.userId;
      logger.debug({
        action: 'account.delete.request',
        data: {
          userId: userId ?? null,
          hasConfirmationEmail: request.body.email.trim().length > 0,
        },
      }, 'Handling account deletion request');
      if (!userId) {
        logger.warn({
          action: 'account.delete.rejected',
          errorCode: 'AUTH_SESSION_REQUIRED',
          statusCode: 401,
        }, 'Account deletion rejected');
        return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      }

      await accountService.deleteOwnInactiveAccount(userId, request.body.email);
      logger.info({
        action: 'account.delete.succeeded',
        data: {
          userId,
        },
      }, 'Deleted account');
      reply.header('Set-Cookie', createClearedSessionCookieHeaders());
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof AccountLifecycleError) {
        logger.warn({
          action: 'account.delete.rejected',
          errorCode: error.code,
          statusCode: error.statusCode,
          data: {
            userId: request.authUser?.userId ?? null,
          },
        }, 'Account deletion rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  }
}
