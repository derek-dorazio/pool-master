/**
 * History module — first-pass contest history endpoints only.
 */

import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  HistoryObjectSchema,
  HistoryPayoutsResponseSchema,
  HistoryResultsResponseSchema,
  HistoryStandingsResponseSchema,
} from '@poolmaster/shared/dto/history.dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { HistoryService } from './history-service';
import { createRequestContextLogger } from '../../core/logger';
import { sendError } from '../../core/error-handler';
import { getAppPrisma } from '../../core/prisma-context';

export async function historyModule(fastify: FastifyInstance): Promise<void> {
  const prisma = getAppPrisma(fastify);
  const historyService = new HistoryService(prisma, fastify.log);

  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/summary',
    {
      schema: {
        tags: ['History'],
        summary: 'Get contest history summary',
        description:
          'Returns summary history for a completed or historical contest, including high-level context used by history landing views.',
        operationId: 'getContestHistorySummary',
        response: {
          200: zodToJsonSchema(HistoryObjectSchema),
          404: zodToJsonSchema(ErrorEnvelopeSchema),
        },
      },
    },
    async (request, reply) => {
      const logger = createRequestContextLogger(request);
      logger.debug({ contestId: request.params.id }, 'history summary route start');
      const summary = await historyService.getContestSummary(request.params.id);
      if (!summary) {
        logger.warn({ contestId: request.params.id }, 'history summary route missing history');
        return sendError(
          reply,
          404,
          'CONTEST_HISTORY_NOT_FOUND',
          'No history exists for this contest',
        );
      }
      logger.info({ contestId: request.params.id }, 'history summary route completed');
      return reply.send(summary);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/standings',
    {
      schema: {
        tags: ['History'],
        summary: 'Get contest historical standings',
        description:
          'Returns historical standings for the contest so users can review prior leaderboard states and completed results.',
        operationId: 'getContestHistoryStandings',
        response: { 200: zodToJsonSchema(HistoryStandingsResponseSchema) },
      },
    },
    async (request) => {
      const logger = createRequestContextLogger(request);
      logger.debug({ contestId: request.params.id }, 'history standings route start');
      const standings = await historyService.getContestStandings(request.params.id);
      logger.info({ contestId: request.params.id, standingCount: standings.length }, 'history standings route completed');
      return { standings };
    },
  );

  fastify.get<{ Params: { id: string; entryId: string } }>(
    '/contests/:id/history/roster/:entryId',
    {
      schema: {
        tags: ['History'],
        summary: 'Get roster history for an entry',
        description:
          'Returns the roster or pick history for a specific entry within a historical contest context.',
        operationId: 'getRosterHistory',
        response: {
          200: zodToJsonSchema(HistoryObjectSchema),
          404: zodToJsonSchema(ErrorEnvelopeSchema),
        },
      },
    },
    async (request, reply) => {
      const logger = createRequestContextLogger(request);
      logger.debug({ contestId: request.params.id, entryId: request.params.entryId }, 'history roster route start');
      const roster = await historyService.getRosterHistory(
        request.params.id,
        request.params.entryId,
      );
      if (!roster) {
        logger.warn({ contestId: request.params.id, entryId: request.params.entryId }, 'history roster route missing roster');
        return sendError(reply, 404, 'ROSTER_HISTORY_NOT_FOUND', 'Roster history not found');
      }
      logger.info({ contestId: request.params.id, entryId: request.params.entryId }, 'history roster route completed');
      return reply.send({ rosterHistory: roster });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/payouts',
    {
      schema: {
        tags: ['History'],
        summary: 'Get contest payout history',
        description:
          'Returns the historical payout results for a completed contest when payout data is available.',
        operationId: 'getContestPayouts',
        response: { 200: zodToJsonSchema(HistoryPayoutsResponseSchema) },
      },
    },
    async (request) => {
      const logger = createRequestContextLogger(request);
      logger.debug({ contestId: request.params.id }, 'history payouts route start');
      const payouts = await historyService.getContestPayouts(request.params.id);
      logger.info({ contestId: request.params.id, payoutCount: payouts.length }, 'history payouts route completed');
      return { payouts };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/results',
    {
      schema: {
        tags: ['History'],
        summary: 'Get league contest results',
        description:
          'Returns completed contest results for the league across its historical contests.',
        operationId: 'getLeagueResults',
        response: { 200: zodToJsonSchema(HistoryResultsResponseSchema) },
      },
    },
    async (request) => {
      const logger = createRequestContextLogger(request);
      logger.debug({ leagueId: request.params.id }, 'history league results route start');
      const results = await historyService.getLeagueResults(request.params.id);
      logger.info({ leagueId: request.params.id, resultCount: results.length }, 'history league results route completed');
      return { results };
    },
  );

  fastify.get<{ Params: { id: string; mid: string } }>(
    '/leagues/:id/history/members/:mid/results',
    {
      schema: {
        tags: ['History'],
        summary: 'Get member contest results within a league',
        description:
          'Returns the target member results across league contests so member-history surfaces can show personal league performance.',
        operationId: 'getMemberResults',
        response: { 200: zodToJsonSchema(HistoryResultsResponseSchema) },
      },
    },
    async (request) => {
      const logger = createRequestContextLogger(request);
      logger.debug({ leagueId: request.params.id, leagueMembershipId: request.params.mid }, 'history member results route start');
      const results = await historyService.getMemberResults(request.params.mid);
      logger.info({ leagueId: request.params.id, leagueMembershipId: request.params.mid, resultCount: results.length }, 'history member results route completed');
      return { results };
    },
  );
}
