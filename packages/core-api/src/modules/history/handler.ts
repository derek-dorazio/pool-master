import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ListContestResultsQuery } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toContestResultSummaryDto, toHistorySummaryDto } from '../../mappers/history.mapper';
import { HistorySquadNotFoundError, HistorySquadRequiredError, type HistoryService } from './service';

export function createHistoryHandlers(service: HistoryService) {
  return { listContestResults, getHistorySummary };

  async function getHistorySummary(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    return reply.send({ summary: toHistorySummaryDto(await service.getSummary(request.params.id)) });
  }

  async function listContestResults(
    request: FastifyRequest<{ Params: { id: string }; Querystring: ListContestResultsQuery }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { year, squadId, place } = request.query;
    try {
      const contests = await service.listYearContests(request.params.id, year, { squadId, place });
      return reply.send({ contests: contests.map(toContestResultSummaryDto) });
    } catch (error) {
      if (error instanceof HistorySquadRequiredError) {
        return sendError(reply, 400, error.code, error.message);
      }
      if (error instanceof HistorySquadNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }
}
