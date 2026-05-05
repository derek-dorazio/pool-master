/**
 * Audit log route handlers — commissioner and member audit trail views.
 *
 * Per pool-master-rop.14.1, these handlers apply `mapLeagueAuditEntryToDto`
 * before sending the response so the wire format matches the typed
 * `LeagueAuditEntryDtoSchema` (rather than emitting service-layer
 * `AuditLogEntry` objects with raw `Date` values).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { mapLeagueAuditEntryToDto } from '../../mappers/leagues-audit.mapper';
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
    return reply.send({ entries: entries.map(mapLeagueAuditEntryToDto) });
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
    return reply.send({ entries: entries.map(mapLeagueAuditEntryToDto) });
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
    return reply.send({ entries: entries.map(mapLeagueAuditEntryToDto) });
  }
}
