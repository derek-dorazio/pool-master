/**
 * User admin route handlers — request/response layer for user management.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to UserService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserService } from './user-service';
import { UserNotFoundError } from './user-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createUserHandlers(userService: UserService) {
  return {
    listUsers,
    getUserDetail,
    forceLogout,
    disableUser,
    enableUser,
    mergeUsers,
  };

  // --- List / search users ---

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
        displayName: item.displayName,
        leagues: item.leagues,
        lastLoginAt: item.lastLoginAt?.toISOString(),
        isActive: item.isActive,
        createdAt: item.createdAt.toISOString(),
      })),
      total: result.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }

  // --- User detail ---

  async function getUserDetail(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const detail = await userService.getUserDetail(request.params.userId);
      return reply.send({
        ...detail,
        createdAt: detail.createdAt.toISOString(),
        lastLoginAt: detail.lastLoginAt?.toISOString(),
        leagues: detail.leagues.map((league) => ({
          ...league,
          joinedAt: league.joinedAt?.toISOString(),
        })),
        devices: detail.devices.map((device) => ({
          ...device,
          lastActiveAt: device.lastActiveAt.toISOString(),
        })),
        recentAuthEvents: detail.recentAuthEvents.map((event) => ({
          ...event,
          timestamp: event.timestamp.toISOString(),
        })),
      });
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'USER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Force logout ---

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

  // --- Disable user ---

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

  // --- Enable user ---

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

  // --- Merge users ---

  async function mergeUsers(
    request: FastifyRequest<{
      Body: { primaryId: string; duplicateId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { primaryId, duplicateId } = request.body;

    const result = await userService.mergeUsers(
      primaryId,
      duplicateId,
      rootAdminUserId,
      rootAdminEmail,
    );
    return reply.send(result);
  }
}
