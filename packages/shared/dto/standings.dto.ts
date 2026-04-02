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
  userId: z.string(),
  displayName: z.string(),
  score: z.number(),
  wins: z.number(),
  losses: z.number(),
  previousRank: z.number().nullable().optional(),
  movement: z.enum(['up', 'down', 'same', 'new']).optional(),
  isEliminated: z.boolean().optional(),
});
export type StandingEntryDto = z.infer<typeof StandingEntryDtoSchema>;

// --- Responses ---

export const StandingsResponseSchema = z.object({
  standings: z.array(StandingEntryDtoSchema),
  total: z.number(),
  contestId: z.string(),
});
export type StandingsResponse = z.infer<typeof StandingsResponseSchema>;
