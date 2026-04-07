/**
 * Template config admin route handlers — request/response layer for
 * scoring and selection template management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TemplateConfigService } from './template-config-service';
import {
  TemplateNotFoundError,
  TemplateAlreadyExistsError,
} from './template-config-service';

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

export function createTemplateConfigHandlers(service: TemplateConfigService) {
  return {
    // Selection
    listSelectionTemplates,
    getSelectionTemplate,
    createSelectionTemplate,
    updateSelectionTemplate,
    deleteSelectionTemplate,
  };

  // --- Selection Templates ---

  async function listSelectionTemplates(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    return service.listSelectionTemplates();
  }

  async function getSelectionTemplate(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      return await service.getSelectionTemplate(request.params.id);
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function createSelectionTemplate(
    request: FastifyRequest<{
      Body: {
        id: string;
        name: string;
        description: string;
        sport: string;
        contestType: string;
        selectionType: string;
        config: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      const template = await service.createSelectionTemplate(
        request.body,
        adminUserId,
        adminUserEmail,
      );
      return reply.status(201).send(template);
    } catch (err) {
      if (err instanceof TemplateAlreadyExistsError) {
        return reply.status(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  }

  async function updateSelectionTemplate(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        description?: string;
        sport?: string;
        contestType?: string;
        selectionType?: string;
        config?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      return await service.updateSelectionTemplate(
        request.params.id,
        request.body,
        adminUserId,
        adminUserEmail,
      );
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function deleteSelectionTemplate(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      await service.deleteSelectionTemplate(
        request.params.id,
        adminUserId,
        adminUserEmail,
      );
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }
}
