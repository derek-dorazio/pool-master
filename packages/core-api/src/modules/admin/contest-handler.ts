/**
 * Contest admin route handlers — request/response layer for contest operations.
 *
 * Each handler extracts params, query, and body from the request, delegates
 * to ContestService for business logic, and returns the appropriate response.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ContestService } from './contest-service';
import { ContestNotFoundError } from './contest-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createContestHandlers(contestService: ContestService) {
  return {
    listContests,
    getContestDetail,
    forceCloseContest,
    reopenContest,
    overrideScore,
    recalculateStandings,
    recalculatePayouts,
    reIngestScoring,
  };

  // --- List / search contests ---

  async function listContests(
    request: FastifyRequest<{
      Querystring: {
        league?: string;
        sport?: string;
        status?: string;
        type?: string;
        selection?: string;
        page?: number;
        pageSize?: number;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const query = request.query;
    const result = await contestService.searchContests({
      leagueId: query.league,
      sport: query.sport,
      status: query.status,
      contestType: query.type,
      selectionType: query.selection,
      page: query.page,
      pageSize: query.pageSize,
    });
    return result;
  }

  // --- Contest detail ---

  async function getContestDetail(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const detail = await contestService.getContestAdminDetail(request.params.contestId);
      return reply.send(detail);
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Force-close contest ---

  async function forceCloseContest(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { contestId } = request.params;
    const { reason } = request.body;

    try {
      await contestService.forceCloseContest(contestId, reason, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Reopen contest ---

  async function reopenContest(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { contestId } = request.params;
    const { reason } = request.body;

    try {
      await contestService.reopenContest(contestId, reason, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Override score ---

  async function overrideScore(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { entryId: string; newScore: number; reason: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { contestId } = request.params;
    const { entryId, newScore, reason } = request.body;

    try {
      await contestService.overrideScore(contestId, entryId, newScore, reason, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Recalculate standings ---

  async function recalculateStandings(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { contestId } = request.params;

    try {
      const result = await contestService.recalculateStandings(contestId, rootAdminUserId, rootAdminEmail);
      return reply.send(result);
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Recalculate payouts ---

  async function recalculatePayouts(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { contestId } = request.params;

    try {
      await contestService.recalculatePayouts(contestId, rootAdminUserId, rootAdminEmail);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // --- Re-ingest scoring ---

  async function reIngestScoring(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: { eventId: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    const { contestId } = request.params;
    const { eventId } = request.body;

    try {
      const result = await contestService.reIngestScoring(contestId, eventId, rootAdminUserId, rootAdminEmail);
      return reply.send(result);
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      throw err;
    }
  }
}
