/**
 * Admin audit log routes — registered as a sub-plugin under /api/v1/admin.
 */

import type { FastifyInstance } from 'fastify';
import { listAuditLog, getAuditEntry, exportAuditLog } from './audit-handler';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const querySchema = {
    querystring: {
      type: 'object' as const,
      properties: {
        adminUserId: { type: 'string' as const },
        action: { type: 'string' as const },
        resourceType: { type: 'string' as const },
        resourceId: { type: 'string' as const },
        dateFrom: { type: 'string' as const, format: 'date' as const },
        dateTo: { type: 'string' as const, format: 'date' as const },
        search: { type: 'string' as const },
        page: { type: 'string' as const },
        pageSize: { type: 'string' as const },
      },
    },
  };
  // Export must be registered before :entryId to avoid route collision
  app.get('/audit-log/export', { schema: querySchema }, exportAuditLog);
  app.get('/audit-log', { schema: querySchema }, listAuditLog);
  app.get<{ Params: { entryId: string } }>('/audit-log/:entryId', {
    schema: {
      params: {
        type: 'object' as const,
        required: ['entryId'] as const,
        properties: {
          entryId: { type: 'string' as const },
        },
      },
    },
  }, getAuditEntry);
}
