/**
 * Contest route handlers — contest CRUD within a league.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ContestType,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import {
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
} from '../../mappers/contests.mapper';
import { createRequestContextLogger } from '../../core/logger';
import { sendError } from '../../core/error-handler';
import type { ContestService } from './service';
import type { CreateContestInput } from './service';
import {
  ContestEntryNotFoundError,
  ContestEntryOperationError,
  ContestNotFoundError,
  ContestOperationError,
} from './service';

const TierDefinitionBodySchema = zod.object({
  tierId: zod.string(),
  tierName: zod.string(),
  tierNumber: zod.number().int(),
  picksFromTier: zod.number().int(),
  rankingRange: zod.tuple([zod.number(), zod.number()]).optional(),
  priceRange: zod.tuple([zod.number(), zod.number()]).optional(),
  maxParticipants: zod.number().int().optional(),
  participantIds: zod.array(zod.string()),
});

const ContestConfigurationBodySchema = zod.object({
  draftMode: zod.string().optional(),
  rounds: zod.number().int().optional(),
  timePerPickSeconds: zod.number().int().optional(),
  autoPickPolicy: zod.string().optional(),
  tierConfig: zod.array(TierDefinitionBodySchema).optional(),
  tierAssignmentMethod: zod.string().optional(),
  budget: zod.number().optional(),
  pricingMethod: zod.string().optional(),
  rosterSize: zod.number().int().optional(),
  pickCount: zod.number().int().optional(),
  picksPerPeriod: zod.number().int().optional(),
  roundValues: zod.array(zod.number()).optional(),
  startRound: zod.string().optional(),
  isExclusive: zod.boolean().optional(),
  bestBallN: zod.number().int().optional(),
  missedCutPenalty: zod.number().optional(),
  captainSlot: zod.boolean().optional(),
  captainMultiplier: zod.number().optional(),
});

const CreateContestBodySchema = zod.object({
  name: zod.string().min(1).max(100),
  eventId: zod.string().optional(),
  contestFormat: zod.enum([ContestFormat.ROSTER]),
  selectionType: zod.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
  ]),
  contestConfiguration: ContestConfigurationBodySchema.optional(),
  scoringEngine: zod.enum([
    ScoringEngine.ADVANCEMENT,
    ScoringEngine.STAT_ACCUMULATION,
    ScoringEngine.STROKE_PLAY,
    ScoringEngine.POSITION,
    ScoringEngine.BRACKET,
    ScoringEngine.FIGHT_RESULT,
    ScoringEngine.CUMULATIVE,
  ]),
  startsAt: zod.string().datetime().optional(),
  endsAt: zod.string().datetime().optional(),
  lockAt: zod.string().datetime().optional(),
  isExclusive: zod.boolean().optional(),
  scoringStopsOnElimination: zod.boolean().optional(),
});

const UpdateContestBodySchema = zod.object({
  name: zod.string().min(1).max(100).optional(),
  startsAt: zod.string().datetime().optional(),
  endsAt: zod.string().datetime().optional(),
  lockAt: zod.string().datetime().optional(),
  isExclusive: zod.boolean().optional(),
});

export function createContestHandlers(contestService: ContestService) {
  return {
    createContest,
    listContests,
    getContest,
    listEntries,
    getEntry,
    getMyEntry,
    createMyEntry,
    deleteMyEntry,
    updateEntry,
    updateContest,
    deleteContest,
  };

  async function createContest(
    request: FastifyRequest<{
      Params: { id: string };
      Body: z.infer<typeof CreateContestBodySchema>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = createRequestContextLogger(request);
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({ leagueId: request.params.id }, 'contest create route missing auth session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const body = CreateContestBodySchema.parse(request.body);
    logger.debug({
      leagueId: request.params.id,
      userId,
      contestFormat: body.contestFormat,
      selectionType: body.selectionType,
    }, 'contest create route start');
    try {
      validateCreateContestBody(body);
      const result = await contestService.createContest({
        leagueId: request.params.id,
        createdBy: userId,
        sportEventId: body.eventId,
        name: body.name,
        contestFormat: body.contestFormat,
        selectionType: body.selectionType,
        contestConfiguration: mapContestConfiguration(body.contestConfiguration),
        scoringEngine: body.scoringEngine,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        lockAt: body.lockAt ? new Date(body.lockAt) : undefined,
        isExclusive: body.isExclusive,
        scoringStopsOnElimination: body.scoringStopsOnElimination,
      });

      logger.info({ contestId: result.contest.id, leagueId: request.params.id, userId }, 'contest create route completed');
      return reply.status(201).send(toContestResponse(result.contest, result.contestConfiguration));
    } catch (err) {
      if (err instanceof ContestOperationError) {
        logger.warn({ leagueId: request.params.id, userId, code: err.code }, 'contest create route rejected');
        return sendError(reply, 400, err.code, err.message);
      }
      logger.error({ leagueId: request.params.id, userId, err }, 'contest create route failed');
      throw err;
    }
  }

  async function listContests(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<{ contests: unknown[] }> {
    const logger = createRequestContextLogger(request);
    logger.debug({ leagueId: request.params.id }, 'contest list route start');
    const contests = await contestService.listByLeague(request.params.id);
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
    const result = await contestService.getContest(request.params.contestId);
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
          lockAt: body.lockAt ? new Date(body.lockAt) : undefined,
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

function validateCreateContestBody(body: z.infer<typeof CreateContestBodySchema>): void {
  if (body.selectionType === SelectionType.TIERED) {
    const tiers = body.contestConfiguration?.tierConfig;
    if (!tiers || tiers.length === 0) {
      throw new ContestOperationError(
        'Tiered contests require tier configuration',
        'CONTEST_TIER_CONFIGURATION_REQUIRED',
      );
    }
  }
}

function mapContestConfiguration(
  contestConfiguration: z.infer<typeof ContestConfigurationBodySchema> | undefined,
): CreateContestInput['contestConfiguration'] {
  if (!contestConfiguration) {
    return {};
  }

  return {
    ...contestConfiguration,
    tierConfig: contestConfiguration.tierConfig?.map((tier) => ({
      ...tier,
      rankingRange: tier.rankingRange ? [tier.rankingRange[0], tier.rankingRange[1]] as [number, number] : undefined,
      priceRange: tier.priceRange ? [tier.priceRange[0], tier.priceRange[1]] as [number, number] : undefined,
    })),
  } as CreateContestInput['contestConfiguration'];
}
