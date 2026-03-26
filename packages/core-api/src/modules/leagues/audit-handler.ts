/**
 * Audit log route handlers — commissioner and member audit trail views.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuditService, AuditCategory } from './audit-service';

export function createAuditHandlers(auditService: AuditService) {
  return {
    getLeagueAuditLog,
    getMemberAuditLog,
    getContestAuditLog,
  };

  async function getLeagueAuditLog(
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: { category?: string; actorId?: string; limit?: number; offset?: number };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { category, actorId, limit, offset } = request.query;
    const entries = await auditService.getLeagueAuditLog(
      request.params.id,
      {
        ...(category && { category: category as AuditCategory }),
        ...(actorId && { actorId }),
      },
      limit ?? 50,
      offset ?? 0,
    );
    return reply.send({ entries });
  }

  async function getMemberAuditLog(
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: { limit?: number };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const entries = await auditService.getMemberAuditLog(
      request.params.id,
      request.query.limit ?? 50,
    );
    return reply.send({ entries });
  }

  async function getContestAuditLog(
    request: FastifyRequest<{
      Params: { contestId: string };
      Querystring: { limit?: number };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const entries = await auditService.getContestAuditLog(
      request.params.contestId,
      request.query.limit ?? 50,
    );
    return reply.send({ entries });
  }
}
