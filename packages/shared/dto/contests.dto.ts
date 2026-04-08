/**
 * Contest DTOs — request/response schemas for contest endpoints.
 */
import { z } from 'zod';
import {
  ContestType,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

// --- Requests ---

export const TierDefinitionRequestSchema = z.object({
  tierId: z.string(),
  tierName: z.string(),
  tierNumber: z.number().int(),
  picksFromTier: z.number().int(),
  rankingRange: z.tuple([z.number(), z.number()]).optional(),
  priceRange: z.tuple([z.number(), z.number()]).optional(),
  maxParticipants: z.number().int().optional(),
  participantIds: z.array(z.string()),
});

export const ContestCrudConfigurationRequestSchema = z.object({
  draftMode: z.string().optional(),
  rounds: z.number().int().optional(),
  timePerPickSeconds: z.number().int().optional(),
  autoPickPolicy: z.string().optional(),
  tierConfig: z.array(TierDefinitionRequestSchema).optional(),
  tierAssignmentMethod: z.string().optional(),
  budget: z.number().optional(),
  pricingMethod: z.string().optional(),
  rosterSize: z.number().int().optional(),
  pickCount: z.number().int().optional(),
  picksPerPeriod: z.number().int().optional(),
  roundValues: z.array(z.number()).optional(),
  startRound: z.string().optional(),
  isExclusive: z.boolean().optional(),
  bestBallN: z.number().int().optional(),
  missedCutPenalty: z.number().optional(),
  captainSlot: z.boolean().optional(),
  captainMultiplier: z.number().optional(),
});

export const CreateContestRequestSchema = z.object({
  name: z.string().min(1).max(100),
  sport: z.string().min(1),
  eventId: z.string().optional(),
  contestType: z.enum([ContestType.SINGLE_EVENT]),
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
  ]),
  contestConfiguration: ContestCrudConfigurationRequestSchema.optional(),
  scoringEngine: z.enum([
    ScoringEngine.ADVANCEMENT,
    ScoringEngine.STAT_ACCUMULATION,
    ScoringEngine.STROKE_PLAY,
    ScoringEngine.POSITION,
    ScoringEngine.BRACKET,
    ScoringEngine.FIGHT_RESULT,
    ScoringEngine.CUMULATIVE,
  ]),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  lockAt: z.string().datetime().optional(),
  isExclusive: z.boolean().optional(),
  scoringStopsOnElimination: z.boolean().optional(),
});
export type CreateContestRequest = z.infer<typeof CreateContestRequestSchema>;

export const UpdateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  lockAt: z.string().datetime().optional(),
  isExclusive: z.boolean().optional(),
});
export type UpdateContestRequest = z.infer<typeof UpdateContestRequestSchema>;

// --- Response Sub-schemas ---

export const ContestSummaryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  contestType: z.string(),
  selectionType: z.string(),
  scoringEngine: z.string(),
  leagueId: z.string(),
  sportEventId: z.string().nullable().optional(),
  sport: z.string().nullable().optional(),
  entryCount: z.number().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type ContestSummaryDto = z.infer<typeof ContestSummaryDtoSchema>;

export const ContestDetailDtoSchema = ContestSummaryDtoSchema.extend({
  lockAt: z.string().datetime().nullable().optional(),
  isExclusive: z.boolean().optional(),
  sport: z.string().nullable().optional(),
});
export type ContestDetailDto = z.infer<typeof ContestDetailDtoSchema>;

export const ContestEntryDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  squadId: z.string(),
  squadName: z.string(),
  entryNumber: z.number().int().min(1),
  name: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  totalScore: z.number(),
  standingsPosition: z.number().nullable().optional(),
  isEliminated: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContestEntryDto = z.infer<typeof ContestEntryDtoSchema>;

// --- Responses ---

export const ContestResponseSchema = z.object({
  contest: ContestDetailDtoSchema,
  contestConfiguration: z.record(z.unknown()).nullable().optional(),
});
export type ContestResponse = z.infer<typeof ContestResponseSchema>;

export const ContestListResponseSchema = z.object({
  contests: z.array(ContestSummaryDtoSchema),
});
export type ContestListResponse = z.infer<typeof ContestListResponseSchema>;

export const ContestEntryResponseSchema = z.object({
  contestId: z.string(),
  entry: ContestEntryDtoSchema,
});
export type ContestEntryResponse = z.infer<typeof ContestEntryResponseSchema>;

export const ContestEntryListResponseSchema = z.object({
  contestId: z.string(),
  total: z.number(),
  isJoined: z.boolean(),
  myEntryId: z.string().nullable(),
  myEntryIds: z.array(z.string()).optional(),
  entries: z.array(ContestEntryDtoSchema),
});
export type ContestEntryListResponse = z.infer<typeof ContestEntryListResponseSchema>;

export const MyContestEntryResponseSchema = z.object({
  contestId: z.string(),
  entry: ContestEntryDtoSchema.nullable(),
});
export type MyContestEntryResponse = z.infer<typeof MyContestEntryResponseSchema>;

export const ContestEntryDeletionResponseSchema = z.object({
  contestId: z.string(),
  deleted: z.literal(true),
});
export type ContestEntryDeletionResponse = z.infer<typeof ContestEntryDeletionResponseSchema>;

export const ContestStandingsRecalculationResponseSchema = z.object({
  contestId: z.string(),
  teamsAffected: z.number(),
  standingsChanged: z.boolean(),
  changes: z.array(
    z.object({
      entryId: z.string(),
      oldRank: z.number(),
      newRank: z.number(),
      oldScore: z.number(),
      newScore: z.number(),
    }),
  ),
});
