/**
 * Participant DTOs — request/response schemas for participant endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  InjuryStatusCode,
  MappingConfidence,
  ParticipantStatus,
  ParticipantType,
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
  role: z.string().nullable().optional().describe('Playing role when known ("GOLFER", "QB"). Not a rank: `position` means rank on the standing objects.'),
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

// --- Responses ---

/** Filters narrow the list; nothing pages it (§16). Multi-valued filters are comma-separated. */
export const ParticipantListQuerySchema = z.object({
  q: z.string().optional().describe('Case-insensitive text matched against name, first, last and short name, and team.'),
  sportId: z.string().optional().describe('Only participants of this sport.'),
  status: z.string().optional().describe('Comma-separated participant statuses to include.'),
  role: z.string().optional().describe('Comma-separated playing roles to include.'),
  team: z.string().optional().describe('Comma-separated team affiliations to include.'),
  nationality: z.string().optional().describe('Comma-separated nationalities to include.'),
}).describe('Filters for the participant catalog.');
export type ParticipantListQuery = z.infer<typeof ParticipantListQuerySchema>;

export const ParticipantListResponseSchema = z.object({
  participants: z.array(ParticipantDtoSchema).describe('Every participant matching the filters, ordered by name.'),
}).describe('Participant-list response.');
export type ParticipantListResponse = z.infer<typeof ParticipantListResponseSchema>;

export const ParticipantResponseSchema = z.object({
  participant: ParticipantDtoSchema,
}).describe('Single-participant detail response.');

export const ParticipantProviderMappingDtoSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
  providerId: z.string().describe('The provider that knows the participant by externalId.'),
  externalId: z.string(),
  confidence: z.nativeEnum(MappingConfidence).describe('How the identity was matched.'),
  mappedAt: DateTimeSchema,
}).describe('A provider\'s identifier for a participant — how synced data finds them.');
export type ParticipantProviderMappingDto = z.infer<typeof ParticipantProviderMappingDtoSchema>;

export const ParticipantProviderMappingListResponseSchema = z.object({
  providerMappings: z.array(ParticipantProviderMappingDtoSchema),
}).describe('A participant\'s provider identities.');
export type ParticipantProviderMappingListResponse = z.infer<typeof ParticipantProviderMappingListResponseSchema>;

export const BindParticipantProviderMappingRequestSchema = z.object({
  providerId: z.string().min(1).describe('The provider whose identifier this binds.'),
  externalId: z.string().min(1).describe('The provider\'s identifier for the competitor — from the unmapped-competitor list.'),
}).describe('Binds a provider identity to this participant. An identity already bound to another participant moves here.');
export type BindParticipantProviderMappingRequest = z.infer<typeof BindParticipantProviderMappingRequestSchema>;

export const ParticipantProviderMappingResponseSchema = z.object({
  providerMapping: ParticipantProviderMappingDtoSchema,
}).describe('A single provider identity of a participant.');
export type ParticipantProviderMappingResponse = z.infer<typeof ParticipantProviderMappingResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('ParticipantProviderMappingDto', ParticipantProviderMappingDtoSchema);
registerSchema('ParticipantProviderMappingListResponse', ParticipantProviderMappingListResponseSchema);
registerSchema('BindParticipantProviderMappingRequest', BindParticipantProviderMappingRequestSchema);
registerSchema('ParticipantProviderMappingResponse', ParticipantProviderMappingResponseSchema);
registerSchema('ParticipantDto', ParticipantDtoSchema);
registerSchema('ParticipantListQuery', ParticipantListQuerySchema);
registerSchema('ParticipantListResponse', ParticipantListResponseSchema);
registerSchema('ParticipantResponse', ParticipantResponseSchema);
