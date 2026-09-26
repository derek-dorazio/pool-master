/**
 * User admin route handlers — request/response layer for root-admin user management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserService } from './user-service';
import {
  LastRootAdminError,
  SelfRootAdminChangeError,
  UserDeleteConfirmationMismatchError,
  UserDeleteDependenciesExistError,
  UserDeleteRequiresInactiveError,
  UserNotFoundError,
} from './user-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

export function createUserHandlers(userService: UserService) {
  return {
    listUsers,
    getUserDetail,
    forceLogout,
    disableUser,
    enableUser,
    resetPassword,
    setRootAdmin,
    deleteUser,
  };

  async function listUsers(
    request: FastifyRequest<{
      Querystring: {
        search?: string;
        tenant?: string;
        isActive?: boolean;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const query = request.query;
    // #202 — no paging (§16). `search` and `isActive` narrow the result; nothing slices it.
    const users = await userService.searchUsers({
      search: query.search,
      isActive: query.isActive,
    });

    return {
      users: users.map((item) => ({
        id: item.id,
        email: item.email,
        username: item.username,
        firstName: item.firstName,
        lastName: item.lastName,
        isRootAdmin: item.isRootAdmin,
        authProvider: item.authProvider,
        isActive: item.isActive,
        timezone: item.timezone,
        locale: item.locale,
        timeFormat: item.timeFormat,
        dateFormat: item.dateFormat,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  async function getUserDetail(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { rootAdminUserId } = extractRootAdminContext(request);
      const detail = await userService.getUserDetail(request.params.userId, rootAdminUserId);
      return reply.send({
        ...detail,
        createdAt: detail.createdAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function forceLogout(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { userId } = request.params;

    try {
      await userService.forceUserLogout(userId, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function disableUser(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { userId } = request.params;
    const { reason } = request.body;

    try {
      await userService.disableUser(userId, reason, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function enableUser(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { userId } = request.params;

    try {
      await userService.enableUser(userId, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function resetPassword(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { reason?: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { userId } = request.params;
    const { reason } = request.body ?? {};

    try {
      const result = await userService.resetUserPassword(
        userId,
        rootAdminUserId,
        rootAdminEmail,
        reason,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function setRootAdmin(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { isRootAdmin: boolean; reason?: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { userId } = request.params;
    const { isRootAdmin, reason } = request.body;

    try {
      await userService.setRootAdmin(userId, isRootAdmin, rootAdminUserId, rootAdminEmail, reason);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      if (err instanceof SelfRootAdminChangeError) {
        return sendError(reply, 400, 'SELF_ROOT_ADMIN_CHANGE', err.message);
      }
      if (err instanceof LastRootAdminError) {
        return sendError(reply, 409, 'LAST_ROOT_ADMIN', err.message);
      }
      throw err;
    }
  }

  async function deleteUser(
    request: FastifyRequest<{
      Params: { userId: string };
      Body: { email: string; reason?: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { userId } = request.params;
    const { email, reason } = request.body;

    try {
      await userService.deleteUser(userId, email, rootAdminUserId, rootAdminEmail, reason);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      if (err instanceof UserDeleteConfirmationMismatchError) {
        return sendError(reply, 400, 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH', err.message);
      }
      if (err instanceof UserDeleteRequiresInactiveError) {
        return sendError(reply, 409, 'ACCOUNT_DELETE_REQUIRES_INACTIVE', err.message);
      }
      if (err instanceof UserDeleteDependenciesExistError) {
        return sendError(reply, 409, 'ACCOUNT_DELETE_DEPENDENCIES_EXIST', err.message, err.details);
      }
      if (err instanceof LastRootAdminError) {
        return sendError(reply, 409, 'LAST_ROOT_ADMIN', err.message);
      }
      throw err;
    }
  }
}
