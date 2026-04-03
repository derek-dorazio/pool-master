/**
 * Admin audit log request handlers — viewing, detail, and CSV export.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  queryAuditLog,
  getAuditEntryById,
  exportAuditLogCsv,
} from './audit-query-service';
import type { AuditListQuery } from './audit-query-service';

interface AuditLogQuerystring {
  adminUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: string;
  pageSize?: string;
}

interface AuditEntryParams {
  entryId: string;
}

/**
 * Lists audit log entries with filtering and pagination.
 * GET /api/v1/admin/audit-log
 */
export async function listAuditLog(
  request: FastifyRequest<{ Querystring: AuditLogQuerystring }>,
  reply: FastifyReply,
): Promise<void> {
  const qs = request.query;
  const query: AuditListQuery = {
    adminUserId: qs.adminUserId,
    action: qs.action,
    resourceType: qs.resourceType,
    resourceId: qs.resourceId,
    dateFrom: qs.dateFrom,
    dateTo: qs.dateTo,
    search: qs.search,
    page: qs.page ? parseInt(qs.page, 10) : undefined,
    pageSize: qs.pageSize ? parseInt(qs.pageSize, 10) : undefined,
  };
  const result = await queryAuditLog(query);
  return reply.send({
    ...result,
    items: result.items.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
}

/**
 * Retrieves a single audit log entry with full detail.
 * GET /api/v1/admin/audit-log/:entryId
 */
export async function getAuditEntry(
  request: FastifyRequest<{ Params: AuditEntryParams }>,
  reply: FastifyReply,
): Promise<void> {
  const entry = await getAuditEntryById(request.params.entryId);
  if (!entry) {
    return reply.status(404).send({ error: 'Audit entry not found' });
  }
  return reply.send({
    entry: {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    },
  });
}

/**
 * Exports audit log entries as CSV for compliance reporting.
 * GET /api/v1/admin/audit-log/export
 */
export async function exportAuditLog(
  request: FastifyRequest<{ Querystring: AuditLogQuerystring }>,
  reply: FastifyReply,
): Promise<void> {
  const qs = request.query;
  const query: AuditListQuery = {
    adminUserId: qs.adminUserId,
    action: qs.action,
    resourceType: qs.resourceType,
    resourceId: qs.resourceId,
    dateFrom: qs.dateFrom,
    dateTo: qs.dateTo,
    search: qs.search,
  };
  const csv = await exportAuditLogCsv(query);
  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  return reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(csv);
}
