/**
 * Standings DTOs — request/response schemas for standings and leaderboard endpoints.
 */
import { z } from 'zod';

// --- Requests ---

export const StandingsQuerySchema = z.object({
  period: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: z.enum(['rank', 'score', 'name']).optional(),
});
export type StandingsQuery = z.infer<typeof StandingsQuerySchema>;

// --- Response Sub-schemas ---

export const StandingEntryDtoSchema = z.object({
  rank: z.number(),
  entryId: z.string(),
  entryName: z.string(),
  ownerDisplayName: z.string(),
  ownerId: z.string(),
  totalScore: z.number(),
  previousRank: z.number().nullable(),
  movement: z.enum(['up', 'down', 'same', 'new']),
  isEliminated: z.boolean(),
  lastUpdatedAt: z.string().datetime(),
});
export type StandingEntryDto = z.infer<typeof StandingEntryDtoSchema>;

// --- Responses ---

export const StandingsResponseSchema = z.object({
  standings: z.array(StandingEntryDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  contestId: z.string(),
});
export type StandingsResponse = z.infer<typeof StandingsResponseSchema>;

export const StandingsSummaryResponseSchema = z.object({
  topEntries: z.array(StandingEntryDtoSchema),
  totalEntries: z.number(),
  contestId: z.string(),
});

export const MyStandingsEntryResponseSchema = z.object({
  entry: StandingEntryDtoSchema,
  totalEntries: z.number(),
  contestId: z.string(),
});
