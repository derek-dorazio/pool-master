/**
 * Tenant admin route handlers — request/response layer for tenant management.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to TenantService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TenantService } from './tenant-service';
import { TenantNotFoundError, TenantDeleteConfirmationError } from './tenant-service';

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

export function createTenantHandlers(tenantService: TenantService) {
  return {
    listTenants,
    getTenantDetail,
    suspendTenant,
    unsuspendTenant,
    applyCredit,
    extendTrial,
    deleteTenant,
  };

  // --- List tenants ---

  async function listTenants(
    request: FastifyRequest<{
      Querystring: {
        search?: string;
        status?: 'active' | 'suspended' | 'trial';
        sortBy?: 'name' | 'created' | 'members' | 'lastActive';
        sortDir?: 'asc' | 'desc';
        page?: number;
        pageSize?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const query = request.query;
    const result = await tenantService.listTenants({
      search: query.search,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      pageSize: query.pageSize,
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    return {
      items: result.items.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        memberCount: item.memberCount,
        contestCount: item.contestCount,
        leagueCount: item.leagueCount,
        status: item.status,
        lastActiveAt: item.lastActiveAt?.toISOString(),
        createdAt: item.createdAt.toISOString(),
      })),
      total: result.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }

  // --- Tenant detail ---

  async function getTenantDetail(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const detail = await tenantService.getTenantDetail(request.params.tenantId);
      return reply.send({
        tenant: {
          ...detail.tenant,
          createdAt: detail.tenant.createdAt.toISOString(),
          updatedAt: detail.tenant.updatedAt.toISOString(),
        },
        memberCount: detail.memberCount,
        leagueCount: detail.leagueCount,
        contestCount: detail.contestCount,
        activeContestCount: detail.activeContestCount,
        status: detail.status,
        lastActiveAt: detail.lastActiveAt?.toISOString(),
        recentMembers: detail.recentMembers.map((member) => ({
          ...member,
          createdAt: member.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Suspend tenant ---

  async function suspendTenant(
    request: FastifyRequest<{
      Params: { tenantId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { tenantId } = request.params;
    const { reason } = request.body;

    try {
      await tenantService.suspendTenant(tenantId, reason, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Unsuspend tenant ---

  async function unsuspendTenant(
    request: FastifyRequest<{
      Params: { tenantId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { tenantId } = request.params;

    try {
      await tenantService.unsuspendTenant(tenantId, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Apply credit ---

  async function applyCredit(
    request: FastifyRequest<{
      Params: { tenantId: string };
      Body: { amount: number; reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { tenantId } = request.params;
    const { amount, reason } = request.body;

    try {
      await tenantService.applyCredit(tenantId, amount, reason, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Extend trial ---

  async function extendTrial(
    request: FastifyRequest<{
      Params: { tenantId: string };
      Body: { days: number; reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { tenantId } = request.params;
    const { days, reason } = request.body;

    try {
      await tenantService.extendTrial(tenantId, days, reason, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Delete tenant ---

  async function deleteTenant(
    request: FastifyRequest<{
      Params: { tenantId: string };
      Body: { confirmation: string };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { tenantId } = request.params;
    const { confirmation } = request.body;

    try {
      await tenantService.deleteTenant(tenantId, confirmation, adminUserId, adminUserEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof TenantDeleteConfirmationError) {
        return reply.status(400).send({
          error: 'CONFIRMATION_MISMATCH',
          message: err.message,
        });
      }
      throw err;
    }
  }
}
