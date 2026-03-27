/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TenantService } from './tenant-service';
import { createTenantHandlers } from './tenant-handler';
import { UserService } from './user-service';
import { createUserHandlers } from './user-handler';
import { ContestService } from './contest-service';
import { createContestHandlers } from './contest-handler';

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
  const userService = new UserService();
  const contestService = new ContestService();

  // --- Handlers ---
  const tenant = createTenantHandlers(tenantService);
  const user = createUserHandlers(userService);
  const contest = createContestHandlers(contestService);

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

  // --- User Management Routes ---
  // NOTE: /users/merge is registered before /users/:userId to avoid route collision.

  fastify.get('/users', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          tenant: { type: 'string' },
          status: { type: 'string', enum: ['active', 'disabled'] },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: user.listUsers,
  });

  fastify.post('/users/merge', {
    schema: {
      body: {
        type: 'object',
        required: ['primaryId', 'duplicateId'],
        properties: {
          primaryId: { type: 'string', minLength: 1 },
          duplicateId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: user.mergeUsers,
  });

  fastify.get('/users/:userId', user.getUserDetail);

  fastify.post('/users/:userId/reset-password', user.resetPassword);

  fastify.post('/users/:userId/force-logout', user.forceLogout);

  fastify.post('/users/:userId/disable', {
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: user.disableUser,
  });

  fastify.post('/users/:userId/enable', user.enableUser);

  fastify.post('/users/:userId/email', {
    schema: {
      body: {
        type: 'object',
        required: ['subject', 'body'],
        properties: {
          subject: { type: 'string', minLength: 1, maxLength: 500 },
          body: { type: 'string', minLength: 1, maxLength: 10000 },
        },
      },
    },
    handler: user.sendAdminEmail,
  });

  // --- Contest Management Routes ---

  fastify.get('/contests', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tenant: { type: 'string' },
          league: { type: 'string' },
          sport: { type: 'string' },
          status: { type: 'string' },
          type: { type: 'string' },
          selection: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: contest.listContests,
  });

  fastify.get('/contests/:contestId', contest.getContestDetail);

  fastify.post('/contests/:contestId/force-close', {
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: contest.forceCloseContest,
  });

  fastify.post('/contests/:contestId/reopen', {
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: contest.reopenContest,
  });

  fastify.post('/contests/:contestId/override-score', {
    schema: {
      body: {
        type: 'object',
        required: ['entryId', 'newScore', 'reason'],
        properties: {
          entryId: { type: 'string', minLength: 1 },
          newScore: { type: 'number' },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: contest.overrideScore,
  });

  fastify.post('/contests/:contestId/recalculate-standings', contest.recalculateStandings);

  fastify.post('/contests/:contestId/recalculate-payouts', contest.recalculatePayouts);

  fastify.post('/contests/:contestId/re-ingest', {
    schema: {
      body: {
        type: 'object',
        required: ['eventId'],
        properties: {
          eventId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: contest.reIngestScoring,
  });
}
