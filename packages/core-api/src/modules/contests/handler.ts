/**
 * Contest route handlers — contest CRUD within a league.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CONTEST_CONFIGURATION_REQUIRED,
  CreateContestRequestSchema,
  UpdateContestEntryRequestSchema,
} from '@poolmaster/shared/dto';
import type { z } from 'zod';
import { z as zod } from 'zod';
import {
  toContestListResponse,
  toContestEntryDetailResponse,
  toContestEntryListResponse,
  toContestEntryResponse,
  toMyContestEntryResponse,
  toContestResponse,
  toContestLeaderboardResponse,
} from '../../mappers/contests.mapper';
import { createRequestContextLogger } from '../../core/logger';
import { sendError } from '../../core/error-handler';
import type { ContestService, ContestViewer } from './service';
import {
  ContestManagementError,
  type ContestManagementService,
} from '../contest-management/service';
import {
  ContestEntryAccessError,
  ContestEntryNotFoundError,
  ContestEntryOperationError,
  ContestNotFoundError,
  ContestOperationError,
} from './service';

const UpdateContestBodySchema = zod.object({
  name: zod.string().min(1).max(100).optional(),
  startsAt: zod.string().datetime().optional(),
  endsAt: zod.string().datetime().optional(),
  isExclusive: zod.boolean().optional(),
});

/** The signed-in reader of a contest read. Both reads sit behind a membership gate, so there is one. */
function readContestViewer(request: FastifyRequest): ContestViewer {
  return {
    userId: request.authUser?.userId as string,
    isRootAdmin: request.authUser?.isRootAdmin === true,
  };
}

export function createContestHandlers(contestService: ContestService) {
  return {
    listContests,
    getContest,
    listEntries,
    getEntry,
    getGolfLeaderboard,
    getMyEntry,
    createMyEntry,
    deleteMyEntry,
    updateEntry,
    updateContest,
    deleteContest,
  };

  async function listContests(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<{ contests: unknown[] }> {
    const logger = createRequestContextLogger(request);
    logger.debug({ leagueId: request.params.id }, 'contest list route start');
    const contests = await contestService.listByLeague(request.params.id, readContestViewer(request));
    const entryCounts = await contestService.countEntriesByContest(contests.map((contest) => contest.id));
    logger.info({
      leagueId: request.params.id,
      contestCount: contests.length,
      entryCount: Array.from(entryCounts.values()).reduce((sum, count) => sum + count, 0),
    }, 'contest list route completed');
    return toContestListResponse(contests, entryCounts);
  }

  async function getContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest get route start');
    const result = await contestService.getContest(request.params.contestId, readContestViewer(request));
    if (!result) {
      logger.warn({ contestId: request.params.contestId }, 'contest get route missing contest');
      return sendError(reply, 404, 'CONTEST_NOT_FOUND', 'Contest not found');
    }
    logger.info({ contestId: request.params.contestId }, 'contest get route completed');
    return reply.send(toContestResponse(result.contest, result.contestConfiguration));
  }

  async function listEntries(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    logger.debug({ contestId: request.params.contestId, userId }, 'contest entries list route start');
    try {
      const result = await contestService.listEntries(request.params.contestId, userId);
      logger.info({
        contestId: request.params.contestId,
        userId,
        entryCount: result.entries.length,
        isJoined: result.isJoined,
      }, 'contest entries list route completed');
      return reply.send(toContestEntryListResponse({
        contestId: request.params.contestId,
        entries: result.entries,
        isJoined: result.isJoined,
        myEntryId: result.myEntryId,
        myEntryIds: result.myEntryIds,
        picksRevealed: result.picksRevealed,
      }));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        logger.warn({ contestId: request.params.contestId, userId }, 'contest entries list route missing contest');
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        logger.warn({ contestId: request.params.contestId, userId, code: err.code }, 'contest entries list route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, userId, err }, 'contest entries list route failed');
      throw err;
    }
  }

  async function getEntry(
    request: FastifyRequest<{ Params: { contestId: string; entryId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    try {
      const result = await contestService.getEntryDetail(
        request.params.contestId,
        request.params.entryId,
        userId,
      );
      logger.info({
        contestId: request.params.contestId,
        entryId: request.params.entryId,
        userId,
        picksRevealed: result.picksRevealed,
      }, 'contest entry detail route completed');
      return reply.send(
        toContestEntryDetailResponse(
          request.params.contestId,
          result.entry,
          result.picksRevealed,
        ),
      );
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        logger.warn({ contestId: request.params.contestId, entryId: request.params.entryId, userId }, 'contest entry detail route missing entry');
        return sendError(reply, 404, 'CONTEST_ENTRY_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        logger.warn({ contestId: request.params.contestId, entryId: request.params.entryId, userId, code: err.code }, 'contest entry detail route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, entryId: request.params.entryId, userId, err }, 'contest entry detail route failed');
      throw err;
    }
  }

  async function getGolfLeaderboard(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    logger.debug({ contestId: request.params.contestId, userId }, 'contest golf leaderboard route start');
    try {
      const leaderboard = await contestService.getGolfLeaderboard(
        request.params.contestId,
        userId,
      );
      logger.info({
        contestId: request.params.contestId,
        userId,
        entryCount: leaderboard.entries.length,
        participantCount: leaderboard.participants.length,
      }, 'contest golf leaderboard route completed');
      return reply.send(toContestLeaderboardResponse(leaderboard));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        logger.warn({ contestId: request.params.contestId, userId }, 'contest golf leaderboard route missing contest');
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestOperationError || err instanceof ContestEntryOperationError) {
        logger.warn({
          contestId: request.params.contestId,
          userId,
          code: err.code,
        }, 'contest golf leaderboard route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, userId, err }, 'contest golf leaderboard route failed');
      throw err;
    }
  }

  async function getMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    logger.debug({ contestId: request.params.contestId, userId }, 'contest my-entry route start');
    try {
      const entry = await contestService.getMyEntry(request.params.contestId, userId);
      logger.info({ contestId: request.params.contestId, userId, hasEntry: entry !== null }, 'contest my-entry route completed');
      return reply.send(toMyContestEntryResponse(request.params.contestId, entry));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        logger.warn({ contestId: request.params.contestId, userId }, 'contest my-entry route missing contest');
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        logger.warn({ contestId: request.params.contestId, userId, code: err.code }, 'contest my-entry route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, userId, err }, 'contest my-entry route failed');
      throw err;
    }
  }

  async function createMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    logger.debug({ contestId: request.params.contestId, userId }, 'contest create entry route start');
    try {
      const entry = await contestService.createEntry(request.params.contestId, userId);
      logger.info({
        contestId: request.params.contestId,
        userId,
        entryId: entry.id,
      }, 'contest create entry route completed');
      return reply.status(201).send(
        toContestEntryResponse(request.params.contestId, entry),
      );
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        logger.warn({ contestId: request.params.contestId, userId }, 'contest create entry route missing contest');
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryAccessError) {
        logger.warn({ contestId: request.params.contestId, userId, code: err.code }, 'contest create entry route forbidden');
        return sendError(reply, 403, err.code, err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        logger.warn({ contestId: request.params.contestId, userId, code: err.code }, 'contest create entry route rejected');
        const statusCode = err.code === 'CONTEST_ENTRY_LIMIT_REACHED' ? 409 : 400;
        return sendError(reply, statusCode, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, userId, err }, 'contest create entry route failed');
      throw err;
    }
  }

  async function deleteMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    logger.debug({ contestId: request.params.contestId, userId }, 'contest delete entry route start');
    try {
      await contestService.deleteMyEntry(request.params.contestId, userId);
      logger.info({ contestId: request.params.contestId, userId }, 'contest delete entry route completed');
      return reply.send({
        contestId: request.params.contestId,
        deleted: true as const,
      });
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        logger.warn({ contestId: request.params.contestId, userId }, 'contest delete entry route missing contest or entry');
        return sendError(reply, 404, 'CONTEST_ENTRY_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryAccessError) {
        logger.warn({ contestId: request.params.contestId, userId, code: err.code }, 'contest delete entry route forbidden');
        return sendError(reply, 403, err.code, err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        logger.warn({ contestId: request.params.contestId, userId, code: err.code }, 'contest delete entry route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, userId, err }, 'contest delete entry route failed');
      throw err;
    }
  }

  async function updateEntry(
    request: FastifyRequest<{
      Params: { contestId: string; entryId: string };
      Body: z.infer<typeof UpdateContestEntryRequestSchema>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId as string;
    logger.debug({ contestId: request.params.contestId, entryId: request.params.entryId, userId }, 'contest update entry route start');
    try {
      const body = UpdateContestEntryRequestSchema.parse(request.body);
      const entry = await contestService.updateEntry(
        request.params.contestId,
        request.params.entryId,
        userId,
        {
          name: body.name,
          tiebreakerValue: body.tiebreakerValue,
        },
      );
      logger.info({ contestId: request.params.contestId, entryId: request.params.entryId, userId }, 'contest update entry route completed');
      return reply.send(toContestEntryResponse(request.params.contestId, entry));
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        logger.warn({ contestId: request.params.contestId, entryId: request.params.entryId, userId }, 'contest update entry route missing contest or entry');
        return sendError(reply, 404, 'CONTEST_ENTRY_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryAccessError) {
        logger.warn({ contestId: request.params.contestId, entryId: request.params.entryId, userId, code: err.code }, 'contest update entry route forbidden');
        return sendError(reply, 403, err.code, err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        logger.warn({ contestId: request.params.contestId, entryId: request.params.entryId, userId, code: err.code }, 'contest update entry route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, entryId: request.params.entryId, userId, err }, 'contest update entry route failed');
      throw err;
    }
  }

  async function updateContest(
    request: FastifyRequest<{
      Params: { contestId: string };
      Body: z.infer<typeof UpdateContestBodySchema>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest update route start');
    try {
      const body = UpdateContestBodySchema.parse(request.body);
      const contest = await contestService.updateContest(
        request.params.contestId,
        {
          name: body.name,
          startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
          endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
          isExclusive: body.isExclusive,
        },
      );
      logger.info({ contestId: request.params.contestId }, 'contest update route completed');
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        logger.warn({ contestId: request.params.contestId }, 'contest update route missing contest');
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestOperationError) {
        logger.warn({ contestId: request.params.contestId, code: err.code }, 'contest update route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, err }, 'contest update route failed');
      throw err;
    }
  }

  async function deleteContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    logger.debug({ contestId: request.params.contestId }, 'contest delete route start');
    try {
      await contestService.deleteContest(request.params.contestId);
      logger.info({ contestId: request.params.contestId }, 'contest delete route completed');
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        logger.warn({ contestId: request.params.contestId }, 'contest delete route missing contest');
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestOperationError) {
        logger.warn({ contestId: request.params.contestId, code: err.code }, 'contest delete route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ contestId: request.params.contestId, err }, 'contest delete route failed');
      throw err;
    }
  }
}

/**
 * `createContest` (#245) — the one creation path. The body's refine carries the rule OpenAPI
 * cannot state structurally: a template, a configuration, or both. Creation itself is the
 * contest-management service's; the response is the canonical contest read.
 */
export function createCreateContestHandler(
  contestService: ContestService,
  contestManagementService: ContestManagementService,
) {
  return async function createContest(
    request: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    // Fastify has already validated the structure against the published schema, so the one
    // failure left for zod is the refine: neither a template nor a configuration.
    const parsed = CreateContestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      const isPairingRule = issue?.code === 'custom';
      logger.warn({ leagueId: request.params.id, isPairingRule }, 'contest create route rejected');
      return sendError(
        reply,
        400,
        isPairingRule ? CONTEST_CONFIGURATION_REQUIRED : 'FST_ERR_VALIDATION',
        issue?.message ?? 'Invalid contest create request.',
      );
    }
    try {
      const contestId = await contestManagementService.createContest(
        { leagueId: request.params.id },
        parsed.data,
      );
      const created = await contestService.getContest(contestId);
      if (!created) {
        throw new ContestNotFoundError(contestId);
      }
      logger.info({ contestId, leagueId: request.params.id }, 'contest create route completed');
      return reply.status(201).send(toContestResponse(created.contest, created.contestConfiguration));
    } catch (error) {
      if (error instanceof ContestManagementError) {
        logger.warn({ leagueId: request.params.id, code: error.code }, 'contest create route rejected');
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      logger.error({ leagueId: request.params.id, err: error }, 'contest create route failed');
      throw error;
    }
  };
}
