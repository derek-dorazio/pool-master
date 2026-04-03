/**
 * Support route handlers — request/response layer for support investigation tools.
 *
 * Provides consolidated tenant investigation data for support staff:
 * errors, notification failures, activity samples, and scoring staleness.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SupportService } from './support-service';
import { TenantNotFoundError } from './tenant-service';

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createSupportHandlers(service: SupportService) {
  return {
    getInvestigation,
    getErrors,
    getNotifications,
    getRequests,
  };

  // --- Full investigation view ---

  async function getInvestigation(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const investigation = await service.getInvestigation(request.params.tenantId);
      return reply.send(investigation);
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Errors only ---

  async function getErrors(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const items = await service.getErrors(request.params.tenantId);
      return reply.send({ items, total: items.length });
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Notification failures only ---

  async function getNotifications(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const items = await service.getNotificationFailures(request.params.tenantId);
      return reply.send({ items, total: items.length });
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Activity samples ---

  async function getRequests(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const items = await service.getActivity(request.params.tenantId);
      return reply.send({ items, total: items.length });
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }
}
