/**
 * Export route handlers — request/response layer for tenant data exports.
 *
 * Allows admins to trigger, check status of, and download tenant data exports.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ExportService } from './export-service';
import { ExportNotFoundError, ExportNotReadyError } from './export-service';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createExportHandlers(service: ExportService) {
  return {
    startExport,
    getExportStatus,
    downloadExport,
  };

  // --- Start export ---

  async function startExport(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const tenantExport = await service.startExport(
      request.params.tenantId,
      adminUserId,
      adminUserEmail,
    );
    return reply.status(201).send(tenantExport);
  }

  // --- Get export status ---

  async function getExportStatus(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const tenantExport = await service.getExportStatus(request.params.tenantId);
      return reply.send(tenantExport);
    } catch (err) {
      if (err instanceof ExportNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Download export data ---

  async function downloadExport(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const data = await service.getExportData(request.params.tenantId);
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="export-${request.params.tenantId}.json"`)
        .send(data);
    } catch (err) {
      if (err instanceof ExportNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ExportNotReadyError) {
        return reply.status(409).send({ error: 'NOT_READY', message: err.message });
      }
      throw err;
    }
  }
}
