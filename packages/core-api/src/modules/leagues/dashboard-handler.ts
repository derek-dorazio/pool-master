/**
 * Dashboard route handlers — commissioner dashboard data.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardService } from './dashboard-service';
import { sendError } from '../../core/error-handler';

export function createDashboardHandlers(dashboardService: DashboardService) {
  return {
    getDashboard,
    resolveActionItem,
  };

  async function getDashboard(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const dashboard = await dashboardService.getDashboard(request.params.id, '');
    if (!dashboard) {
      return sendError(reply, 404, 'NOT_FOUND', 'League not found');
    }
    return reply.send(dashboard);
  }

  async function resolveActionItem(
    request: FastifyRequest<{ Params: { id: string; itemId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const item = await dashboardService.resolveActionItem(request.params.itemId);
    return reply.send({ actionItem: item });
  }
}
