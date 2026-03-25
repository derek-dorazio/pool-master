import type { FastifyRequest } from 'fastify';

export interface TenantContext {
  tenantId: string;
}

export function extractTenantContext(request: FastifyRequest): TenantContext {
  // TODO: Extract tenant from JWT claims or subdomain
  const tenantId = (request.headers['x-tenant-id'] as string) ?? '';
  return { tenantId };
}
