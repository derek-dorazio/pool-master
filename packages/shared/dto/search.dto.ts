/**
 * Search & Discovery DTOs — request/response schemas for search endpoints.
 */
import { z } from 'zod';
import { ParticipantDtoSchema } from './participants.dto';

// --- Requests ---

export const SearchQuerySchema = z.object({
  q: z.string().optional(),
  sportId: z.string().optional(),
  status: z.string().optional(),
  position: z.string().optional(),
  sortBy: z.enum(['RELEVANCE', 'RANKING', 'NAME', 'PRICE', 'FORM']).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// --- Response Sub-schemas ---

export const FacetBucketDtoSchema = z.object({
  value: z.string(),
  count: z.number(),
});
export type FacetBucketDto = z.infer<typeof FacetBucketDtoSchema>;

export const SearchFacetsDtoSchema = z.object({
  positions: z.array(FacetBucketDtoSchema),
  teams: z.array(FacetBucketDtoSchema),
  nationalities: z.array(FacetBucketDtoSchema),
  rankingDistribution: z.object({
    top10: z.number(),
    top25: z.number(),
    top50: z.number(),
    top100: z.number(),
    unranked: z.number(),
  }),
});
export type SearchFacetsDto = z.infer<typeof SearchFacetsDtoSchema>;

export const DiscoverableLeagueDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sport: z.string().nullable().optional(),
  memberCount: z.number(),
  visibility: z.string(),
  createdAt: z.string().datetime().optional(),
});
export type DiscoverableLeagueDto = z.infer<typeof DiscoverableLeagueDtoSchema>;

export const DiscoverableContestDtoSchema = z.object({
  id: z.string(),
  contestName: z.string(),
  sport: z.string().nullable().optional(),
  status: z.string(),
  memberCount: z.number(),
  prizePool: z.number().nullable().optional(),
  lockTime: z.string().datetime().nullable().optional(),
});
export type DiscoverableContestDto = z.infer<typeof DiscoverableContestDtoSchema>;

// --- Responses ---

export const SearchResultsResponseSchema = z.object({
  participants: z.array(ParticipantDtoSchema),
  total: z.number(),
  facets: SearchFacetsDtoSchema,
});
export type SearchResultsResponse = z.infer<typeof SearchResultsResponseSchema>;
