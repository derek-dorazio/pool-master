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
  maxMembers: z.number().nullable().optional(),
  activeContestCount: z.number(),
  activityLevel: z.string(),
  joinPolicy: z.string(),
  commissionerName: z.string().nullable().optional(),
  visibility: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type DiscoverableLeagueDto = z.infer<typeof DiscoverableLeagueDtoSchema>;

export const DiscoverableContestDtoSchema = z.object({
  id: z.string(),
  leagueName: z.string().nullable().optional(),
  contestName: z.string(),
  sport: z.string().nullable().optional(),
  eventName: z.string().nullable().optional(),
  draftType: z.string().nullable().optional(),
  status: z.string(),
  memberCount: z.number(),
  maxMembers: z.number().nullable().optional(),
  entryFee: z.number().nullable().optional(),
  prizePool: z.number().nullable().optional(),
  draftStart: z.string().datetime().nullable().optional(),
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

export const DiscoverLeaguesResponseSchema = z.object({
  leagues: z.array(DiscoverableLeagueDtoSchema),
  total: z.number(),
});
export type DiscoverLeaguesResponse = z.infer<typeof DiscoverLeaguesResponseSchema>;

export const DiscoverContestsResponseSchema = z.object({
  contests: z.array(DiscoverableContestDtoSchema),
  total: z.number(),
});
export type DiscoverContestsResponse = z.infer<typeof DiscoverContestsResponseSchema>;

export const DiscoveryReportResponseSchema = z.object({
  report: z.object({
    id: z.string(),
  }),
  reportCount: z.number(),
});
export type DiscoveryReportResponse = z.infer<typeof DiscoveryReportResponseSchema>;
