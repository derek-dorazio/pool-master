/**
 * Contest route handlers — contest CRUD within a league.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { extractTenantContext } from '../../core/tenant-context';
import {
  toContestListResponse,
  toContestEntryListResponse,
  toContestEntryResponse,
  toMyContestEntryResponse,
  toContestResponse,
} from '../../mappers/contests.mapper';
import type { ContestService } from './service';
import {
  ContestEntryNotFoundError,
  ContestEntryOperationError,
  ContestNotFoundError,
  ContestOperationError,
} from './service';

export function createContestHandlers(contestService: ContestService) {
  return {
    createContest,
    listContests,
    getContest,
    listEntries,
    getMyEntry,
    createMyEntry,
    deleteMyEntry,
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
      return reply.status(201).send(toContestResponse(result.contest, result.selectionConfig));
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
    return toContestListResponse(contests);
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
    return reply.send(toContestResponse(result.contest, result.selectionConfig));
  }

  async function listEntries(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      const result = await contestService.listEntries(request.params.contestId, tenantId, userId);
      return reply.send(toContestEntryListResponse({
        contestId: request.params.contestId,
        entries: result.entries,
        isJoined: result.isJoined,
        myEntryId: result.myEntryId,
      }));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function getMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      const entry = await contestService.getMyEntry(request.params.contestId, tenantId, userId);
      return reply.send(toMyContestEntryResponse(request.params.contestId, entry));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function createMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      const result = await contestService.createEntry(request.params.contestId, tenantId, userId);
      return reply.status(result.created ? 201 : 200).send(
        toContestEntryResponse(request.params.contestId, result.entry),
      );
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function deleteMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      await contestService.deleteMyEntry(request.params.contestId, tenantId, userId);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
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
      return reply.send(toContestResponse(contest, null));
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
