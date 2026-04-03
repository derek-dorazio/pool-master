/**
 * Participant DTOs — request/response schemas for participant endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema, StringRecordSchema } from './common.dto';

// --- Response Sub-schemas ---

export const ParticipantDtoSchema = z.object({
  id: z.string(),
  sportId: z.string(),
  name: z.string(),
  participantType: z.string(),
  externalId: z.string().optional(),
  metadata: JsonObjectSchema,
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  shortName: z.string().optional(),
  nationality: z.string().optional(),
  position: z.string().nullable().optional(),
  teamAffiliation: z.string().nullable().optional(),
  status: z.string(),
  injuryStatus: z.object({
    status: z.string(),
    detail: z.string().optional(),
    expectedReturn: DateTimeSchema.optional(),
    updatedAt: DateTimeSchema.optional(),
    source: z.string().optional(),
  }),
  photoUrl: z.string().nullable().optional(),
  photoLastUpdated: DateTimeSchema.optional(),
  externalIds: StringRecordSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type ParticipantDto = z.infer<typeof ParticipantDtoSchema>;

export const ParticipantSeasonRankingDtoSchema = z.object({
  rankingType: z.string(),
  rank: z.number(),
  points: z.number().optional(),
  asOfDate: DateTimeSchema,
});

export const ParticipantSeasonRecordDtoSchema = z.object({
  id: z.string(),
  participantId: z.string(),
  sport: z.string(),
  season: z.string(),
  rankings: z.array(ParticipantSeasonRankingDtoSchema),
  budgetPrice: z.number(),
  priceTier: z.string().optional(),
  priceUpdatedAt: DateTimeSchema.optional(),
  eventsEntered: z.number(),
  eventsCompleted: z.number(),
  wins: z.number(),
  top5Finishes: z.number(),
  top10Finishes: z.number(),
  top25Finishes: z.number(),
  seasonStats: z.record(z.number()),
  formRating: z.number(),
  formTrend: z.string(),
  lastUpdated: DateTimeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const DraftSearchFacetBucketDtoSchema = z.object({
  value: z.string(),
  count: z.number(),
});

export const DraftSearchItemDtoSchema = z.object({
  participantId: z.string(),
  displayName: z.string(),
  photoUrl: z.string(),
  sport: z.string(),
  position: z.string().optional(),
  teamAffiliation: z.string().optional(),
  nationality: z.string().optional(),
  ranking: z.number().optional(),
  budgetPrice: z.number().optional(),
  tier: z.string().optional(),
  injuryStatus: z.object({
    status: z.string(),
    detail: z.string().optional(),
    expectedReturn: DateTimeSchema.optional(),
    updatedAt: DateTimeSchema.optional(),
    source: z.string().optional(),
  }),
  isAvailable: z.boolean(),
  unavailableReason: z.string().optional(),
  isDrafted: z.boolean(),
});

export const DraftSearchResponseSchema = z.object({
  participants: z.array(DraftSearchItemDtoSchema),
  total: z.number(),
  facets: z.object({
    positions: z.array(DraftSearchFacetBucketDtoSchema),
    teams: z.array(DraftSearchFacetBucketDtoSchema),
    nationalities: z.array(DraftSearchFacetBucketDtoSchema),
    tiers: z.array(DraftSearchFacetBucketDtoSchema),
    injuryStatuses: z.array(DraftSearchFacetBucketDtoSchema),
  }),
});

// --- Responses ---

export const ParticipantListResponseSchema = z.object({
  participants: z.array(ParticipantDtoSchema),
  total: z.number(),
});
export type ParticipantListResponse = z.infer<typeof ParticipantListResponseSchema>;

export const ParticipantResponseSchema = z.object({
  participant: ParticipantDtoSchema,
});

export const ParticipantSeasonRecordResponseSchema = z.object({
  seasonRecord: ParticipantSeasonRecordDtoSchema,
});

export const ParticipantSeasonRecordListResponseSchema = z.object({
  seasonRecords: z.array(ParticipantSeasonRecordDtoSchema),
});

export const ContestPoolResponseSchema = z.object({
  pool: z.array(ParticipantDtoSchema),
  contestId: z.string(),
});
export type ContestPoolResponse = z.infer<typeof ContestPoolResponseSchema>;
