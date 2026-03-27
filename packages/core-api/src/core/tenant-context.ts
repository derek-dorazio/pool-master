/**
 * TenantContext — extracts and validates tenant identity from each request.
 *
 * Resolution order:
 *   1. JWT `tenantId` claim (via authUser decorator from auth-guard plugin)
 *   2. `x-tenant-id` header (for dev/testing or service-to-service calls)
 *
 * Throws 401 if no tenant can be determined on protected routes.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../plugins/auth-guard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantContext {
  tenantId: string;
}

// Extend Fastify request to carry tenant context
declare module 'fastify' {
  interface FastifyRequest {
    tenantContext?: TenantContext;
  }
}

// ---------------------------------------------------------------------------
// Public route prefixes (these skip tenant enforcement)
// ---------------------------------------------------------------------------

const TENANT_EXEMPT_PREFIXES = [
  '/health',
  '/api/v1/auth/',
];

function isTenantExempt(url: string): boolean {
  return TENANT_EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Extraction function (for use in handlers that need tenant inline)
// ---------------------------------------------------------------------------

export function extractTenantContext(request: FastifyRequest): TenantContext {
  // 1. Try JWT claim from auth-guard
  const authUser = request.authUser as AuthUser | undefined;
  if (authUser?.tenantId) {
    return { tenantId: authUser.tenantId };
  }

  // 2. Fall back to x-tenant-id header
  const headerTenant = request.headers['x-tenant-id'] as string | undefined;
  if (headerTenant) {
    return { tenantId: headerTenant };
  }

  return { tenantId: '' };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

async function tenantContextPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('tenantContext', undefined);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isTenantExempt(request.url)) {
      return;
    }

    const ctx = extractTenantContext(request);

    if (!ctx.tenantId) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Unable to determine tenant context',
      });
    }

    request.tenantContext = ctx;
  });
}

export const tenantPlugin = fp(tenantContextPlugin, {
  name: 'tenant-context',
  dependencies: ['auth-guard'],
  fastify: '5.x',
});
