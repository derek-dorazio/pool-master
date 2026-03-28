/**
 * Push trigger config admin route handlers — request/response layer for
 * push trigger configuration management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PushTriggerConfigService } from './push-trigger-config-service';
import { PushTriggerNotFoundError } from './push-trigger-config-service';

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

export function createPushTriggerConfigHandlers(service: PushTriggerConfigService) {
  return {
    listTriggers,
    updateTrigger,
    enableTrigger,
    disableTrigger,
    resetAll,
  };

  async function listTriggers(
    _request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    return service.listTriggers();
  }

  async function updateTrigger(
    request: FastifyRequest<{
      Params: { eventType: string };
      Body: {
        enabled?: boolean;
        title?: string;
        body?: string;
        sound?: string;
        priority?: 'high' | 'normal';
        category?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      return await service.updateTrigger(
        request.params.eventType,
        request.body,
        adminUserId,
        adminUserEmail,
      );
    } catch (err) {
      if (err instanceof PushTriggerNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function enableTrigger(
    request: FastifyRequest<{ Params: { eventType: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      return await service.enableTrigger(
        request.params.eventType,
        adminUserId,
        adminUserEmail,
      );
    } catch (err) {
      if (err instanceof PushTriggerNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function disableTrigger(
    request: FastifyRequest<{ Params: { eventType: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    try {
      return await service.disableTrigger(
        request.params.eventType,
        adminUserId,
        adminUserEmail,
      );
    } catch (err) {
      if (err instanceof PushTriggerNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function resetAll(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return service.resetAll(adminUserId, adminUserEmail);
  }
}
