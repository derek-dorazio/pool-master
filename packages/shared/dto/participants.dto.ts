/**
 * Participant DTOs — request/response schemas for participant endpoints.
 */
import { z } from 'zod';
import {
  InjuryStatusCode,
  ParticipantStatus,
  ParticipantType,
  Sport,
} from '../domain/enums';
import { DateTimeSchema, StringRecordSchema } from './common.dto';

// --- Response Sub-schemas ---

export const ParticipantDtoSchema = z.object({
  id: z.string().describe('Participant identifier.'),
  sportId: z.string().describe('Owning sport identifier.'),
  name: z.string().describe('Primary participant display name.'),
  participantType: z
    .enum([ParticipantType.INDIVIDUAL, ParticipantType.TEAM])
    .describe('Whether the participant is an individual or team.'),
  externalId: z.string().optional().describe('Primary provider identifier when one exists.'),
  firstName: z.string().optional().describe('First name when the participant is a person.'),
  lastName: z.string().optional().describe('Last name when the participant is a person.'),
  shortName: z.string().optional().describe('Short-form display name for compact UI surfaces.'),
  nationality: z.string().optional().describe('Participant nationality or country code when known.'),
  position: z.string().nullable().optional().describe('Position, role, or event classification when known.'),
  teamAffiliation: z.string().nullable().optional().describe('Current team affiliation when the participant is not itself a team.'),
  status: z
    .enum([
      ParticipantStatus.ACTIVE,
      ParticipantStatus.INACTIVE,
      ParticipantStatus.RETIRED,
      ParticipantStatus.SUSPENDED,
    ])
    .describe('Current participant lifecycle or availability status.'),
  injuryStatus: z.object({
    status: z
      .enum([
        InjuryStatusCode.HEALTHY,
        InjuryStatusCode.QUESTIONABLE,
        InjuryStatusCode.DOUBTFUL,
        InjuryStatusCode.OUT,
        InjuryStatusCode.WITHDRAWN,
        InjuryStatusCode.SUSPENDED,
        InjuryStatusCode.SCRATCHED,
      ])
      .describe('Current injury or availability status code.'),
    detail: z.string().optional().describe('Optional injury-status detail or summary.'),
    expectedReturn: DateTimeSchema.optional().describe('Expected return timestamp when known.'),
    updatedAt: DateTimeSchema.optional().describe('When the injury-status record was last updated.'),
    source: z.string().optional().describe('Source that provided the injury-status update.'),
  }).describe('Normalized participant injury or availability state.'),
  photoUrl: z.string().nullable().optional().describe('Optional participant image URL.'),
  photoLastUpdated: DateTimeSchema.optional().describe('When the participant image metadata was last refreshed.'),
  externalIds: StringRecordSchema.describe('Map of provider identifiers keyed by provider code.'),
  createdAt: DateTimeSchema.describe('When the participant record was created.'),
  updatedAt: DateTimeSchema.describe('When the participant record was last updated.'),
}).describe('Participant summary returned by participant-search and detail APIs.');
export type ParticipantDto = z.infer<typeof ParticipantDtoSchema>;

export const DraftSearchFacetBucketDtoSchema = z.object({
  value: z.string().describe('Facet value returned by the draft search.'),
  count: z.number().describe('How many participants matched the facet value.'),
}).describe('Facet bucket returned by participant draft-search endpoints.');

export const DraftSearchItemDtoSchema = z.object({
  participantId: z.string(),
  displayName: z.string(),
  photoUrl: z.string().describe('Participant image URL.'),
  sport: z.enum([
    Sport.GOLF,
    Sport.NFL,
    Sport.NBA,
    Sport.F1,
    Sport.NASCAR,
    Sport.NCAA_BASKETBALL,
    Sport.NCAA_HOCKEY,
    Sport.NCAA_FOOTBALL,
    Sport.TENNIS,
    Sport.HORSE_RACING,
    Sport.SOCCER,
    Sport.NHL,
    Sport.MLB,
    Sport.UFC,
  ]),
  position: z.string().optional(),
  teamAffiliation: z.string().optional(),
  nationality: z.string().optional(),
  ranking: z.number().optional(),
  budgetPrice: z.number().optional(),
  tier: z.string().optional(),
  injuryStatus: z.object({
    status: z.enum([
      InjuryStatusCode.HEALTHY,
      InjuryStatusCode.QUESTIONABLE,
      InjuryStatusCode.DOUBTFUL,
      InjuryStatusCode.OUT,
      InjuryStatusCode.WITHDRAWN,
      InjuryStatusCode.SUSPENDED,
      InjuryStatusCode.SCRATCHED,
    ]),
    detail: z.string().optional(),
    expectedReturn: DateTimeSchema.optional(),
    updatedAt: DateTimeSchema.optional(),
    source: z.string().optional(),
  }),
  isAvailable: z.boolean().describe('Whether the participant can currently be selected.'),
  unavailableReason: z.string().optional().describe('Reason the participant is unavailable, when applicable.'),
  isDrafted: z.boolean().describe('Whether the participant has already been drafted in the contest.'),
}).describe('Participant row used in draft-search and draft-room selection lists.');

export const DraftSearchResponseSchema = z.object({
  participants: z.array(DraftSearchItemDtoSchema).describe('Draft-search result rows.'),
  total: z.number().describe('Total participants matching the search filters.'),
  facets: z.object({
    positions: z.array(DraftSearchFacetBucketDtoSchema),
    teams: z.array(DraftSearchFacetBucketDtoSchema),
    nationalities: z.array(DraftSearchFacetBucketDtoSchema),
    tiers: z.array(DraftSearchFacetBucketDtoSchema),
    injuryStatuses: z.array(DraftSearchFacetBucketDtoSchema),
  }).describe('Facet counts used to refine draft-search results.'),
}).describe('Draft-search response payload.');

// --- Responses ---

export const ParticipantListResponseSchema = z.object({
  participants: z.array(ParticipantDtoSchema).describe('Participant page or slice returned by the API.'),
  total: z.number().describe('Total participants matching the current filters.'),
}).describe('Participant-list response.');
export type ParticipantListResponse = z.infer<typeof ParticipantListResponseSchema>;

export const ParticipantResponseSchema = z.object({
  participant: ParticipantDtoSchema,
}).describe('Single-participant detail response.');

