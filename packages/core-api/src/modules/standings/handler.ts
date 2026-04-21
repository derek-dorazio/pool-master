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
import { createRequestContextLogger } from '../../core/logger';
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
    const logger = createRequestContextLogger(request);
    const { contestId } = request.params;
    const query = request.query as { page?: string; pageSize?: string; sortBy?: string };

    const page = query.page ? parseInt(query.page, 10) : undefined;
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : undefined;
    const sortBy = (query.sortBy as SortField) || undefined;

    logger.debug({ contestId, page: page ?? null, pageSize: pageSize ?? null, sortBy: sortBy ?? null }, 'standings route start');
    try {
      const result = await standingsService.getStandings(contestId, { page, pageSize, sortBy });
      reply.header('X-Poll-Interval', String(STANDINGS_POLL_INTERVAL));
      reply.header('X-Poll-Interval-Unit', 'ms');
      logger.info({ contestId, returnedCount: result.standings.length, total: result.total }, 'standings route completed');
      return reply.send(mapStandingsPageToDto(result));
    } catch (err) {
      if (err instanceof StandingsError) {
        logger.warn({ contestId, code: err.code }, 'standings route rejected');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      logger.error({ contestId, err }, 'standings route failed');
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
    const logger = createRequestContextLogger(request);
    const { contestId } = request.params;
    const query = request.query as { topN?: string };
    const topN = query.topN ? parseInt(query.topN, 10) : 5;

    logger.debug({ contestId, topN }, 'standings summary route start');
    try {
      const result = await standingsService.getSummary(contestId, topN);
      reply.header('X-Poll-Interval', String(STANDINGS_POLL_INTERVAL));
      reply.header('X-Poll-Interval-Unit', 'ms');
      logger.info({ contestId, returnedCount: result.topEntries.length, totalEntries: result.totalEntries }, 'standings summary route completed');
      return reply.send(mapStandingsSummaryToDto(result));
    } catch (err) {
      if (err instanceof StandingsError) {
        logger.warn({ contestId, code: err.code }, 'standings summary route rejected');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      logger.error({ contestId, err }, 'standings summary route failed');
      throw err;
    }
  }

  async function getMyEntry(
    request: FastifyRequest<{
      Params: { contestId: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const { contestId } = request.params;

    const userId = request.authUser?.userId;

    if (!userId) {
      logger.warn({ contestId }, 'standings my-entry route missing auth session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    logger.debug({ contestId, userId }, 'standings my-entry route start');
    try {
      const result = await standingsService.getMyEntry(contestId, userId);
      reply.header('X-Poll-Interval', String(STANDINGS_POLL_INTERVAL));
      reply.header('X-Poll-Interval-Unit', 'ms');
      logger.info({ contestId, userId, entryId: result.entry.entryId }, 'standings my-entry route completed');
      return reply.send(mapMyEntryResultToDto(result));
    } catch (err) {
      if (err instanceof StandingsError) {
        logger.warn({ contestId, userId, code: err.code }, 'standings my-entry route rejected');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      logger.error({ contestId, userId, err }, 'standings my-entry route failed');
      throw err;
    }
  }
}
