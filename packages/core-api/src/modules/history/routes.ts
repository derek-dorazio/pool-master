/**
 * History module — first-pass contest history endpoints only.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  HistoryObjectSchema,
  HistoryPayoutsResponseSchema,
  HistoryResultsResponseSchema,
  HistoryStandingsResponseSchema,
} from '@poolmaster/shared/dto/history.dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { HistoryService } from './history-service';
import { sendError } from '../../core/error-handler';

export async function historyModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const historyService = new HistoryService(prisma);

  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/summary',
    {
      schema: {
        tags: ['History'],
        summary: 'Get contest history summary',
        operationId: 'getContestHistorySummary',
        response: {
          200: zodToJsonSchema(HistoryObjectSchema),
          404: zodToJsonSchema(ErrorEnvelopeSchema),
        },
      },
    },
    async (request, reply) => {
      const summary = await historyService.getContestSummary(request.params.id);
      if (!summary) {
        return sendError(reply, 404, 'NOT_FOUND', 'No history for this contest');
      }
      return reply.send(summary);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/standings',
    {
      schema: {
        tags: ['History'],
        summary: 'Get contest historical standings',
        operationId: 'getContestHistoryStandings',
        response: { 200: zodToJsonSchema(HistoryStandingsResponseSchema) },
      },
    },
    async (request) => {
      const standings = await historyService.getContestStandings(request.params.id);
      return { standings };
    },
  );

  fastify.get<{ Params: { id: string; entryId: string } }>(
    '/contests/:id/history/roster/:entryId',
    {
      schema: {
        tags: ['History'],
        summary: 'Get roster history for an entry',
        operationId: 'getRosterHistory',
        response: {
          200: zodToJsonSchema(HistoryObjectSchema),
          404: zodToJsonSchema(ErrorEnvelopeSchema),
        },
      },
    },
    async (request, reply) => {
      const roster = await historyService.getRosterHistory(
        request.params.id,
        request.params.entryId,
      );
      if (!roster) {
        return sendError(reply, 404, 'NOT_FOUND', 'Roster history not found');
      }
      return reply.send({ rosterHistory: roster });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/contests/:id/history/payouts',
    {
      schema: {
        tags: ['History'],
        summary: 'Get contest payout history',
        operationId: 'getContestPayouts',
        response: { 200: zodToJsonSchema(HistoryPayoutsResponseSchema) },
      },
    },
    async (request) => {
      const payouts = await historyService.getContestPayouts(request.params.id);
      return { payouts };
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/history/results',
    {
      schema: {
        tags: ['History'],
        summary: 'Get league contest results',
        operationId: 'getLeagueResults',
        response: { 200: zodToJsonSchema(HistoryResultsResponseSchema) },
      },
    },
    async (request) => {
      const results = await historyService.getLeagueResults(request.params.id);
      return { results };
    },
  );

  fastify.get<{ Params: { id: string; mid: string } }>(
    '/leagues/:id/history/members/:mid/results',
    {
      schema: {
        tags: ['History'],
        summary: 'Get member contest results within a league',
        operationId: 'getMemberResults',
        response: { 200: zodToJsonSchema(HistoryResultsResponseSchema) },
      },
    },
    async (request) => {
      const results = await historyService.getMemberResults(request.params.mid);
      return { results };
    },
  );
}
