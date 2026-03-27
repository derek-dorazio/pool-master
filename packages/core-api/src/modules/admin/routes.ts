/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TenantService } from './tenant-service';
import { createTenantHandlers } from './tenant-handler';

// ---------------------------------------------------------------------------
// Admin auth preHandler (placeholder — will be replaced with real SSO check)
// ---------------------------------------------------------------------------

async function adminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const adminUserId = request.headers['x-admin-user-id'] as string | undefined;
  if (!adminUserId) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Admin authentication required',
    });
  }
  // TODO: Verify admin JWT / SSO session and load admin user + permissions
}

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------

export async function adminModule(fastify: FastifyInstance): Promise<void> {
  // Apply admin auth to every route in this module
  fastify.addHook('preHandler', adminAuth);

  // --- Services ---
  const tenantService = new TenantService();

  // --- Handlers ---
  const tenant = createTenantHandlers(tenantService);

  // --- Tenant Management Routes ---

  fastify.get('/tenants', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          planTier: { type: 'string' },
          status: { type: 'string', enum: ['active', 'suspended', 'trial'] },
          sortBy: { type: 'string', enum: ['name', 'created', 'members', 'lastActive'] },
          sortDir: { type: 'string', enum: ['asc', 'desc'] },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: tenant.listTenants,
  });

  fastify.get('/tenants/:tenantId', tenant.getTenantDetail);

  fastify.put('/tenants/:tenantId/plan', {
    schema: {
      body: {
        type: 'object',
        required: ['planTier', 'reason'],
        properties: {
          planTier: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.changePlan,
  });

  fastify.post('/tenants/:tenantId/suspend', {
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.suspendTenant,
  });

  fastify.post('/tenants/:tenantId/unsuspend', tenant.unsuspendTenant);

  fastify.post('/tenants/:tenantId/credit', {
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'reason'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.applyCredit,
  });

  fastify.post('/tenants/:tenantId/extend-trial', {
    schema: {
      body: {
        type: 'object',
        required: ['days', 'reason'],
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.extendTrial,
  });

  fastify.delete('/tenants/:tenantId', {
    schema: {
      body: {
        type: 'object',
        required: ['confirmation'],
        properties: {
          confirmation: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: tenant.deleteTenant,
  });
}
