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
  contestType: zod.enum([ContestType.SINGLE_EVENT]),
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
    const userId = request.authUser?.userId;
    if (!userId) {
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const body = CreateContestBodySchema.parse(request.body);
    try {
      validateCreateContestBody(body);
      const result = await contestService.createContest({
        leagueId: request.params.id,
        createdBy: userId,
        sportEventId: body.eventId,
        name: body.name,
        contestType: body.contestType,
        selectionType: body.selectionType,
        contestConfiguration: mapContestConfiguration(body.contestConfiguration),
        scoringEngine: body.scoringEngine,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        lockAt: body.lockAt ? new Date(body.lockAt) : undefined,
        isExclusive: body.isExclusive,
        scoringStopsOnElimination: body.scoringStopsOnElimination,
      });

      return reply.status(201).send(toContestResponse(result.contest, result.contestConfiguration));
    } catch (err) {
      if (err instanceof ContestOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function listContests(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<{ contests: unknown[] }> {
    const contests = await contestService.listByLeague(request.params.id);
    return toContestListResponse(contests);
  }

  async function getContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const result = await contestService.getContest(request.params.contestId);
    if (!result) {
      return sendError(reply, 404, 'CONTEST_NOT_FOUND', 'Contest not found');
    }
    return reply.send(toContestResponse(result.contest, result.contestConfiguration));
  }

  async function listEntries(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId as string;
    try {
      const result = await contestService.listEntries(request.params.contestId, userId);
      return reply.send(toContestEntryListResponse({
        contestId: request.params.contestId,
        entries: result.entries,
        isJoined: result.isJoined,
        myEntryId: result.myEntryId,
        myEntryIds: result.myEntryIds,
      }));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function getEntry(
    request: FastifyRequest<{ Params: { contestId: string; entryId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const entry = await contestService.getEntryDetail(
        request.params.contestId,
        request.params.entryId,
      );
      return reply.send(
        toContestEntryDetailResponse(request.params.contestId, entry),
      );
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return sendError(reply, 404, 'CONTEST_ENTRY_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function getMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId as string;
    try {
      const entry = await contestService.getMyEntry(request.params.contestId, userId);
      return reply.send(toMyContestEntryResponse(request.params.contestId, entry));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function createMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId as string;
    try {
      const result = await contestService.createEntry(request.params.contestId, userId);
      return reply.status(result.created ? 201 : 200).send(
        toContestEntryResponse(request.params.contestId, result.entry),
      );
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function deleteMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId as string;
    try {
      await contestService.deleteMyEntry(request.params.contestId, userId);
      return reply.send({
        contestId: request.params.contestId,
        deleted: true as const,
      });
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return sendError(reply, 404, 'CONTEST_ENTRY_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
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
    const userId = request.authUser?.userId as string;
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
      return reply.send(toContestEntryResponse(request.params.contestId, entry));
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return sendError(reply, 404, 'CONTEST_ENTRY_NOT_FOUND', err.message);
      }
      if (err instanceof ContestEntryOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
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
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
      throw err;
    }
  }

  async function deleteContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await contestService.deleteContest(request.params.contestId);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return sendError(reply, 404, 'CONTEST_NOT_FOUND', err.message);
      }
      if (err instanceof ContestOperationError) {
        return sendError(reply, 400, err.code, err.message);
      }
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
