/**
 * Support route handlers — request/response layer for support investigation tools.
 *
 * Provides consolidated tenant investigation data for support staff:
 * errors, notification failures, and API request samples.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SupportService } from './support-service';

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
    const investigation = await service.getInvestigation(request.params.tenantId);
    return reply.send(investigation);
  }

  // --- Errors only ---

  async function getErrors(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const items = await service.getErrors(request.params.tenantId);
    return reply.send({ items, total: items.length });
  }

  // --- Notification failures only ---

  async function getNotifications(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const items = await service.getNotificationFailures(request.params.tenantId);
    return reply.send({ items, total: items.length });
  }

  // --- API request samples ---

  async function getRequests(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const items = await service.getRequests(request.params.tenantId);
    return reply.send({ items, total: items.length });
  }
}
