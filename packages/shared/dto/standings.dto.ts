/**
 * Standings DTOs — request/response schemas for standings and leaderboard endpoints.
 */
import { z } from 'zod';

// --- Requests ---

export const StandingsQuerySchema = z.object({
  period: z.string().optional().describe('Optional scoring period, round, or time slice supported by the contest.'),
  page: z.number().int().min(1).optional().describe('Requested standings page number.'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Requested page size for standings pagination.'),
  sortBy: z.enum(['rank', 'score', 'name']).optional().describe('Requested sort key for standings presentation.'),
}).describe('Standings query parameters.');
export type StandingsQuery = z.infer<typeof StandingsQuerySchema>;

// --- Response Sub-schemas ---

export const StandingEntryDtoSchema = z.object({
  rank: z.number().describe('Current standing rank for the entry.'),
  entryId: z.string().describe('Contest entry identifier.'),
  entryName: z.string().describe('Display name for the entry.'),
  ownerDisplayName: z.string().describe('Display name for the entry owner.'),
  ownerId: z.string().describe('Owner user or membership identifier associated with the entry.'),
  totalScore: z.number().describe('Current total score for the entry.'),
  previousRank: z.number().nullable().describe('Previous published rank when movement can be computed.'),
  movement: z.enum(['up', 'down', 'same', 'new']).describe('Rank movement indicator since the last standings update.'),
  isEliminated: z.boolean().describe('Whether the entry can no longer improve because it has been eliminated.'),
  lastUpdatedAt: z.string().datetime().describe('When the standing entry was last recalculated.'),
}).describe('Single standings row returned by leaderboard endpoints.');
export type StandingEntryDto = z.infer<typeof StandingEntryDtoSchema>;

// --- Responses ---

export const StandingsResponseSchema = z.object({
  standings: z.array(StandingEntryDtoSchema).describe('Requested standings page.'),
  total: z.number().describe('Total number of standings entries in the contest.'),
  page: z.number().describe('Current standings page number.'),
  pageSize: z.number().describe('Current standings page size.'),
  contestId: z.string().describe('Contest whose standings are being returned.'),
}).describe('Paginated standings response.');
export type StandingsResponse = z.infer<typeof StandingsResponseSchema>;

export const StandingsSummaryResponseSchema = z.object({
  topEntries: z.array(StandingEntryDtoSchema).describe('Top-ranked entries used for condensed leaderboard surfaces.'),
  totalEntries: z.number().describe('Total number of entries in the contest.'),
  contestId: z.string().describe('Contest whose standings summary is being returned.'),
}).describe('Condensed standings-summary response.');

export const MyStandingsEntryResponseSchema = z.object({
  entry: StandingEntryDtoSchema.describe('Current user entry row within the contest standings.'),
  totalEntries: z.number().describe('Total number of entries in the contest.'),
  contestId: z.string().describe('Contest whose personal standings entry is being returned.'),
}).describe('Current-user standings-entry response.');
