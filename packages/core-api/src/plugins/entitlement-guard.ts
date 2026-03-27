/**
 * Entitlement guard — Fastify preHandler hook factory for plan-gating routes.
 *
 * Usage:
 *   fastify.post('/leagues', {
 *     preHandler: requireEntitlement('league.create'),
 *     handler: leagueController.create,
 *   });
 *
 * At launch all checks pass (Free tier = unlimited). When paid tiers are
 * enabled, routes using this guard will automatically enforce limits.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { EntitlementKey } from '@poolmaster/shared/domain';
import { extractTenantContext } from '../core/tenant-context';
import { EntitlementService } from '../modules/billing/entitlement-service';

// ---------------------------------------------------------------------------
// Shared service instance
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();
const entitlementService = new EntitlementService(prisma);

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

export function requireEntitlement(
  entitlementKey: EntitlementKey,
  context?: Record<string, unknown>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantCtx = extractTenantContext(request);

    if (!tenantCtx.tenantId) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Unable to determine tenant context',
      });
    }

    const result = await entitlementService.check(
      tenantCtx.tenantId,
      entitlementKey,
      context,
    );

    if (!result.entitled) {
      return reply.status(403).send({
        error: 'PLAN_LIMIT_REACHED',
        message: result.reason,
        upgrade_plan: result.upgradePlan,
        current_usage: result.currentUsage,
        limit: result.limit,
      });
    }
  };
}

export { entitlementService };
