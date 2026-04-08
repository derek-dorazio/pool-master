/**
 * Contest route handlers — contest CRUD within a league.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ContestType,
  ScoringEngine,
  SelectionType,
  type Sport,
} from '@poolmaster/shared/domain';
import type { z } from 'zod';
import { z as zod } from 'zod';
import { extractTenantContext } from '../../core/tenant-context';
import {
  toContestListResponse,
  toContestEntryListResponse,
  toContestEntryResponse,
  toMyContestEntryResponse,
  toContestResponse,
} from '../../mappers/contests.mapper';
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

const SelectionConfigBodySchema = zod.object({
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
  survivorStyle: zod.string().optional(),
  picksPerPeriod: zod.number().int().optional(),
  oneEntityPerSeason: zod.boolean().optional(),
  strikesBeforeElimination: zod.number().int().optional(),
  buybacksAllowed: zod.boolean().optional(),
  roundValues: zod.array(zod.number()).optional(),
  startRound: zod.string().optional(),
  isExclusive: zod.boolean().optional(),
  bestBallN: zod.number().int().optional(),
  missedCutPenalty: zod.number().optional(),
  captainSlot: zod.boolean().optional(),
  captainMultiplier: zod.number().optional(),
});

const PayoutConfigBodySchema = zod.object({
  entryFee: zod.number().int().min(0).optional(),
  prizePool: zod.number().int().min(0).optional(),
  payoutStructure: zod.array(zod.object({
    rank: zod.number().int().min(1),
    percentage: zod.number().min(0).max(100),
    fixedAmount: zod.number().int().min(0).optional(),
  })),
  intermediatePrizes: zod.array(zod.object({
    name: zod.string(),
    description: zod.string().optional(),
    amount: zod.number().int().min(0).optional(),
    percentage: zod.number().min(0).max(100).optional(),
  })),
});

const CreateContestBodySchema = zod.object({
  name: zod.string().min(1).max(100),
  sport: zod.string().min(1),
  eventId: zod.string().optional(),
  seasonId: zod.string().optional(),
  contestType: zod.enum([ContestType.SINGLE_EVENT]),
  selectionType: zod.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
  ]),
  selectionConfig: SelectionConfigBodySchema.optional(),
  scoringEngine: zod.enum([
    ScoringEngine.ADVANCEMENT,
    ScoringEngine.STAT_ACCUMULATION,
    ScoringEngine.STROKE_PLAY,
    ScoringEngine.POSITION,
    ScoringEngine.BRACKET,
    ScoringEngine.FIGHT_RESULT,
    ScoringEngine.CUMULATIVE,
  ]),
  scoringRules: zod.record(zod.unknown()).optional(),
  payoutConfig: PayoutConfigBodySchema.optional(),
  startsAt: zod.string().datetime().optional(),
  endsAt: zod.string().datetime().optional(),
  lockAt: zod.string().datetime().optional(),
  isExclusive: zod.boolean().optional(),
  scoringStopsOnElimination: zod.boolean().optional(),
});

const UpdateContestBodySchema = zod.object({
  name: zod.string().min(1).max(100).optional(),
  scoringRules: zod.record(zod.unknown()).optional(),
  payoutConfig: PayoutConfigBodySchema.optional(),
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
    getMyEntry,
    createMyEntry,
    deleteMyEntry,
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
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }
    const body = CreateContestBodySchema.parse(request.body);
    try {
      validateCreateContestBody(body);
      const result = await contestService.createContest({
        leagueId: request.params.id,
        tenantId,
        createdBy: userId,
        seasonId: body.seasonId,
        name: body.name,
        sport: body.sport as Sport,
        contestType: body.contestType,
        selectionType: body.selectionType,
        selectionConfig: mapSelectionConfig(body.selectionConfig),
        scoringEngine: body.scoringEngine,
        scoringRules: body.scoringRules,
        payoutConfig: body.payoutConfig,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        lockAt: body.lockAt ? new Date(body.lockAt) : undefined,
        isExclusive: body.isExclusive,
        scoringStopsOnElimination: body.scoringStopsOnElimination,
      });

      return reply.status(201).send(toContestResponse(result.contest, result.selectionConfig));
    } catch (err) {
      if (err instanceof ContestOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
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
    const { tenantId } = extractTenantContext(request);
    const result = await contestService.getContest(request.params.contestId, tenantId);
    if (!result) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contest not found' });
    }
    return reply.send(toContestResponse(result.contest, result.selectionConfig));
  }

  async function listEntries(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      const result = await contestService.listEntries(request.params.contestId, tenantId, userId);
      return reply.send(toContestEntryListResponse({
        contestId: request.params.contestId,
        entries: result.entries,
        isJoined: result.isJoined,
        myEntryId: result.myEntryId,
        myEntryIds: result.myEntryIds,
      }));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function getMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      const entry = await contestService.getMyEntry(request.params.contestId, tenantId, userId);
      return reply.send(toMyContestEntryResponse(request.params.contestId, entry));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function createMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      const result = await contestService.createEntry(request.params.contestId, tenantId, userId);
      return reply.status(result.created ? 201 : 200).send(
        toContestEntryResponse(request.params.contestId, result.entry),
      );
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function deleteMyEntry(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    try {
      await contestService.deleteMyEntry(request.params.contestId, tenantId, userId);
      return reply.send({
        contestId: request.params.contestId,
        deleted: true as const,
      });
    } catch (err) {
      if (err instanceof ContestNotFoundError || err instanceof ContestEntryNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestEntryOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
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
    const { tenantId } = extractTenantContext(request);
    try {
      const body = UpdateContestBodySchema.parse(request.body);
      const contest = await contestService.updateContest(
        request.params.contestId,
        tenantId,
        {
          name: body.name,
          scoringRules: body.scoringRules,
          payoutConfig: body.payoutConfig,
          startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
          endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
          lockAt: body.lockAt ? new Date(body.lockAt) : undefined,
          isExclusive: body.isExclusive,
        },
      );
      return reply.send(toContestResponse(contest, null));
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function deleteContest(
    request: FastifyRequest<{ Params: { contestId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    try {
      await contestService.deleteContest(request.params.contestId, tenantId);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof ContestOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }
}

function validateCreateContestBody(body: z.infer<typeof CreateContestBodySchema>): void {
  if (body.selectionType === SelectionType.TIERED) {
    const tiers = body.selectionConfig?.tierConfig;
    if (!tiers || tiers.length === 0) {
      throw new ContestOperationError('Tiered contests require tier configuration');
    }
  }
}

function mapSelectionConfig(
  selectionConfig: z.infer<typeof SelectionConfigBodySchema> | undefined,
): CreateContestInput['selectionConfig'] {
  if (!selectionConfig) {
    return {};
  }

  return {
    ...selectionConfig,
    tierConfig: selectionConfig.tierConfig?.map((tier) => ({
      ...tier,
      rankingRange: tier.rankingRange ? [tier.rankingRange[0], tier.rankingRange[1]] as [number, number] : undefined,
      priceRange: tier.priceRange ? [tier.priceRange[0], tier.priceRange[1]] as [number, number] : undefined,
    })),
  } as CreateContestInput['selectionConfig'];
}
