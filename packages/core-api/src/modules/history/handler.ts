import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GetSquadYearQuery, ListContestResultsQuery } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toContestResultSummaryDto, toHistorySummaryDto, toPerpetualTrophyDto, toRecordDto, toSquadHistoryDto, toSquadYearDto, toYearReviewDto } from '../../mappers/history.mapper';
import { HistorySquadNotFoundError, HistorySquadRequiredError, type HistoryService } from './service';
import {
  YearReviewAlreadySentError,
  YearReviewNothingToSendError,
  YearReviewNotOpenError,
  type YearReviewService,
} from './year-review-service';

export function createHistoryHandlers(service: HistoryService, yearReviews: YearReviewService) {
  return { listContestResults, getHistorySummary, getSquadYear, getSquadHistory, getYearReview, sendYearReview, listRecords, listPerpetualTrophies };

  async function getYearReview(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    return reply.send({ yearReview: toYearReviewDto(await yearReviews.getLastYear(request.params.id)) });
  }

  async function sendYearReview(
    request: FastifyRequest<{ Params: { id: string; year: number } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const view = await yearReviews.send(request.params.id, request.params.year, request.authUser?.userId as string);
      return reply.send({ yearReview: toYearReviewDto(view) });
    } catch (error) {
      if (error instanceof YearReviewNotOpenError || error instanceof YearReviewNothingToSendError || error instanceof YearReviewAlreadySentError) {
        return sendError(reply, 409, error.code, error.message);
      }
      throw error;
    }
  }

  async function listPerpetualTrophies(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    return reply.send({ trophies: (await service.getPerpetualTrophies(request.params.id)).map(toPerpetualTrophyDto) });
  }

  async function listRecords(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    return reply.send({ records: (await service.getRecords(request.params.id)).map(toRecordDto) });
  }

  async function getSquadHistory(
    request: FastifyRequest<{ Params: { id: string; squadId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const view = await service.getSquadHistory(request.params.id, request.params.squadId);
      return reply.send({ squadHistory: toSquadHistoryDto(view) });
    } catch (error) {
      if (error instanceof HistorySquadNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }

  async function getSquadYear(
    request: FastifyRequest<{ Params: { id: string; squadId: string }; Querystring: GetSquadYearQuery }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const view = await service.getSquadYear(request.params.id, request.params.squadId, request.query.year);
      return reply.send({ squadYear: toSquadYearDto(view) });
    } catch (error) {
      if (error instanceof HistorySquadNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }

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
