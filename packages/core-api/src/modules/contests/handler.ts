/**
 * Contest route handlers — contest CRUD within a league.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { extractTenantContext } from '../../core/tenant-context';
import type { ContestService } from './service';
import { ContestNotFoundError, ContestOperationError } from './service';

export function createContestHandlers(contestService: ContestService) {
  return {
    createContest,
    listContests,
    getContest,
    updateContest,
    deleteContest,
  };

  async function createContest(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }
    const body = request.body;
    try {
      const result = await contestService.createContest({
        leagueId: request.params.id,
        tenantId,
        createdBy: userId,
        seasonId: body.seasonId as string | undefined,
        name: body.name as string,
        contestType: body.contestType as string as any,
        selectionType: body.selectionType as string as any,
        selectionConfig: (body.selectionConfig ?? {}) as any,
        scoringEngine: body.scoringEngine as string as any,
        scoringRules: body.scoringRules as Record<string, unknown> | undefined,
        scoringTemplateKey: body.scoringTemplateKey as string | undefined,
        payoutConfig: body.payoutConfig as any,
        startsAt: body.startsAt ? new Date(body.startsAt as string) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt as string) : undefined,
        lockAt: body.lockAt ? new Date(body.lockAt as string) : undefined,
        isExclusive: body.isExclusive as boolean | undefined,
        scoringStopsOnElimination: body.scoringStopsOnElimination as boolean | undefined,
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof ContestOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function listContests(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<{ contests: unknown[] }> {
    const contests = await contestService.listByLeague(request.params.id);
    return { contests };
  }

  async function getContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const result = await contestService.getContest(request.params.contestId, tenantId);
    if (!result) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contest not found' });
    }
    return reply.send(result);
  }

  async function updateContest(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    try {
      const contest = await contestService.updateContest(
        request.params.contestId,
        tenantId,
        request.body as any,
      );
      return reply.send({ contest });
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function deleteContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    try {
      await contestService.deleteContest(request.params.contestId, tenantId);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }
}
