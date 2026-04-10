/**
 * Standings route handlers — leaderboard, summary, and my-entry lookups.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StandingsService, SortField } from './service';
import { StandingsError } from './service';
import {
  mapMyEntryResultToDto,
  mapStandingsPageToDto,
  mapStandingsSummaryToDto,
} from '../../mappers';
import { sendError } from '../../core/error-handler';

const STANDINGS_POLL_INTERVAL = 10000;

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
      reply.header('X-Poll-Interval', String(STANDINGS_POLL_INTERVAL));
      reply.header('X-Poll-Interval-Unit', 'ms');
      return reply.send(mapStandingsPageToDto(result));
    } catch (err) {
      if (err instanceof StandingsError) {
        return sendError(reply, err.statusCode, err.code, err.message);
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
      reply.header('X-Poll-Interval', String(STANDINGS_POLL_INTERVAL));
      reply.header('X-Poll-Interval-Unit', 'ms');
      return reply.send(mapStandingsSummaryToDto(result));
    } catch (err) {
      if (err instanceof StandingsError) {
        return sendError(reply, err.statusCode, err.code, err.message);
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

    const userId = request.authUser?.userId;

    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    }

    try {
      const result = await standingsService.getMyEntry(contestId, userId);
      reply.header('X-Poll-Interval', String(STANDINGS_POLL_INTERVAL));
      reply.header('X-Poll-Interval-Unit', 'ms');
      return reply.send(mapMyEntryResultToDto(result));
    } catch (err) {
      if (err instanceof StandingsError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
