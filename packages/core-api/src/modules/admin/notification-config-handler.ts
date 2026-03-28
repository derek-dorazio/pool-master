/**
 * Notification config admin route handlers — request/response layer for
 * notification template management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NotificationConfigService } from './notification-config-service';
import { NotificationTemplateNotFoundError } from './notification-config-service';

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

export function createNotificationConfigHandlers(service: NotificationConfigService) {
  return {
    listTemplates,
    getTemplate,
    updateTemplate,
    resetTemplate,
  };

  async function listTemplates(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    return service.listTemplates();
  }

  async function getTemplate(
    request: FastifyRequest<{ Params: { eventType: string } }>,
    reply: FastifyReply,
  ) {
    try {
      return await service.getTemplate(request.params.eventType);
    } catch (err) {
      if (err instanceof NotificationTemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function updateTemplate(
    request: FastifyRequest<{
      Params: { eventType: string };
      Body: {
        pushTitle?: string;
        pushBody?: string;
        emailSubject?: string;
        emailText?: string;
        inAppTitle?: string;
        inAppBody?: string;
        inAppIcon?: string;
        smsBody?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      return await service.updateTemplate(
        request.params.eventType,
        request.body,
        adminUserId,
        adminUserEmail,
      );
    } catch (err) {
      if (err instanceof NotificationTemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function resetTemplate(
    request: FastifyRequest<{ Params: { eventType: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      return await service.resetTemplate(
        request.params.eventType,
        adminUserId,
        adminUserEmail,
      );
    } catch (err) {
      if (err instanceof NotificationTemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }
}
