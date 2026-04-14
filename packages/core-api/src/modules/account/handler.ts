import type { FastifyReply, FastifyRequest } from 'fastify';
import { createClearedSessionCookieHeaders } from '../../core/session-cookies';
import { sendError } from '../../core/error-handler';
import { mapAccountResponse } from '../../mappers';
import { AccountLifecycleError, AccountService } from './service';

export function createAccountHandlers(accountService: AccountService) {
  return {
    inactivate: handleInactivate,
    deleteAccount: handleDeleteAccount,
  };

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
