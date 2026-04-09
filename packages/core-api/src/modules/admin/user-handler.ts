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

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  // TODO: Extract from verified admin JWT / session
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

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
        status?: 'active' | 'disabled';
        page?: number;
        pageSize?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const query = request.query;
    const result = await userService.searchUsers({
      search: query.search,
      tenantId: query.tenant,
      status: query.status,
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
        tenants: item.tenants,
        lastLoginAt: item.lastLoginAt?.toISOString(),
        status: item.status,
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
        tenants: detail.tenants.map((tenant) => ({
          ...tenant,
          joinedAt: tenant.joinedAt.toISOString(),
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
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Force logout ---

  async function forceLogout(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { userId } = request.params;

    try {
      await userService.forceUserLogout(userId, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
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
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { userId } = request.params;
    const { reason } = request.body;

    try {
      await userService.disableUser(userId, reason, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Enable user ---

  async function enableUser(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { userId } = request.params;

    try {
      await userService.enableUser(userId, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
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
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { primaryId, duplicateId } = request.body;

    const result = await userService.mergeUsers(
      primaryId,
      duplicateId,
      adminUserId,
      adminUserEmail,
    );
    return reply.send(result);
  }
}
