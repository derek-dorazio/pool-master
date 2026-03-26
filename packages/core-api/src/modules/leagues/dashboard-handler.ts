/**
 * Dashboard route handlers — commissioner dashboard data.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { extractTenantContext } from '../../core/tenant-context';
import type { DashboardService } from './dashboard-service';

export function createDashboardHandlers(dashboardService: DashboardService) {
  return {
    getDashboard,
    resolveActionItem,
  };

  async function getDashboard(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const dashboard = await dashboardService.getDashboard(request.params.id, tenantId);
    if (!dashboard) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'League not found' });
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
