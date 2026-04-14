/**
 * User admin route handlers — request/response layer for root-admin user management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserService } from './user-service';
import { UserNotFoundError } from './user-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

export function createUserHandlers(userService: UserService) {
  return {
    listUsers,
    getUserDetail,
    forceLogout,
    disableUser,
    enableUser,
  };

  async function listUsers(
    request: FastifyRequest<{
      Querystring: {
        search?: string;
        tenant?: string;
        isActive?: boolean;
        page?: number;
        pageSize?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const query = request.query;
    const result = await userService.searchUsers({
      search: query.search,
      isActive: query.isActive,
      page: query.page,
      pageSize: query.pageSize,
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    return {
      items: result.items.map((item) => ({
        id: item.id,
        email: item.email,
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
      total: result.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }

  async function getUserDetail(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const detail = await userService.getUserDetail(request.params.userId);
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
}
