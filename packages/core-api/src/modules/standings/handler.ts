/**
 * Standings route handlers — leaderboard, summary, and my-entry lookups.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StandingsService, SortField } from './service';
import { StandingsError } from './service';

export function createStandingsHandlers(standingsService: StandingsService) {
  return {
    getStandings,
    getSummary,
    getMyEntry,
  };

  async function getStandings(
    request: FastifyRequest<{
      Params: { contestId: string };
      Querystring: { page?: string; pageSize?: string; sortBy?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { contestId } = request.params;
    const query = request.query as { page?: string; pageSize?: string; sortBy?: string };

    const page = query.page ? parseInt(query.page, 10) : undefined;
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : undefined;
    const sortBy = (query.sortBy as SortField) || undefined;

    try {
      const result = await standingsService.getStandings(contestId, { page, pageSize, sortBy });
      return reply.send(result);
    } catch (err) {
      if (err instanceof StandingsError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function getSummary(
    request: FastifyRequest<{
      Params: { contestId: string };
      Querystring: { topN?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { contestId } = request.params;
    const query = request.query as { topN?: string };
    const topN = query.topN ? parseInt(query.topN, 10) : 5;

    try {
      const result = await standingsService.getSummary(contestId, topN);
      return reply.send(result);
    } catch (err) {
      if (err instanceof StandingsError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }

  async function getMyEntry(
    request: FastifyRequest<{
      Params: { contestId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { contestId } = request.params;

    // Get userId from auth context or header fallback
    const userId = (request.authUser?.userId
      ?? request.headers['x-user-id']) as string | undefined;

    if (!userId) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing user identity',
      });
    }

    try {
      const result = await standingsService.getMyEntry(contestId, userId);
      return reply.send(result);
    } catch (err) {
      if (err instanceof StandingsError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }
}
