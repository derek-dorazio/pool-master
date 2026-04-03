/**
 * Contest DTOs — request/response schemas for contest endpoints.
 */
import { z } from 'zod';

// --- Requests ---

export const CreateContestRequestSchema = z.object({
  name: z.string().min(1).max(100),
  contestType: z.string(),
  selectionType: z.string(),
  scoringEngine: z.string(),
  scoringRules: z.record(z.unknown()).optional(),
  scoringTemplateKey: z.string().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  lockAt: z.string().datetime().optional(),
  isExclusive: z.boolean().optional(),
});
export type CreateContestRequest = z.infer<typeof CreateContestRequestSchema>;

export const UpdateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scoringRules: z.record(z.unknown()).optional(),
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
  entryCount: z.number().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type ContestSummaryDto = z.infer<typeof ContestSummaryDtoSchema>;

export const ContestDetailDtoSchema = ContestSummaryDtoSchema.extend({
  scoringRules: z.record(z.unknown()).optional(),
  lockAt: z.string().datetime().nullable().optional(),
  isExclusive: z.boolean().optional(),
  sport: z.string().nullable().optional(),
});
export type ContestDetailDto = z.infer<typeof ContestDetailDtoSchema>;

export const ContestEntryDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  leagueMembershipId: z.string(),
  name: z.string(),
  totalScore: z.number(),
  rank: z.number().nullable().optional(),
  isEliminated: z.boolean(),
  ownerId: z.string(),
  ownerDisplayName: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContestEntryDto = z.infer<typeof ContestEntryDtoSchema>;

// --- Responses ---

export const ContestResponseSchema = z.object({
  contest: ContestDetailDtoSchema,
  selectionConfig: z.record(z.unknown()).nullable().optional(),
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
  entries: z.array(ContestEntryDtoSchema),
});
export type ContestEntryListResponse = z.infer<typeof ContestEntryListResponseSchema>;

export const MyContestEntryResponseSchema = z.object({
  contestId: z.string(),
  entry: ContestEntryDtoSchema.nullable(),
});
export type MyContestEntryResponse = z.infer<typeof MyContestEntryResponseSchema>;

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
