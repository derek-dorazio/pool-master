/**
 * The cross-sport catalog's contract (#236): Sport, SportLeague and the
 * Participant↔SportLeague affiliation edge. One DTO per object; the counts
 * and derived facts a screen reads are fields of that DTO, never a second shape
 * (plans/145 rules 3 and 5). These replace the golf-named admin DTOs, which were
 * projections of the same rows.
 *
 * `SportLeague` is never abbreviated to "league" here (#203 stage 2, decision 6): the
 * product's League is a pool of players; a SportLeague is the PGA Tour or the NFL.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { ParticipantType, Sport, SportCategory, TournamentFormat } from '../domain/enums';
import { DateTimeSchema } from './common.dto';
import { ParticipantDtoSchema } from './participants.dto';

// --- Sport ---------------------------------------------------------------------

export const SportDtoSchema = z.object({
  id: z.string().uuid().describe('Sport identifier — what Participant.sportId and SportLeague.sportId point at.'),
  name: z.nativeEnum(Sport).describe('The sport.'),
  participantType: z.nativeEnum(ParticipantType).describe('Whether the sport\'s competitors are individuals or teams.'),
  category: z.nativeEnum(SportCategory).describe('Sport category.'),
  tournamentFormat: z.nativeEnum(TournamentFormat).describe('Structural format of the sport\'s events; decides which contest formats are valid.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A sport the platform runs contests on.');
export type SportDto = z.infer<typeof SportDtoSchema>;

export const SportListResponseSchema = z.object({
  sports: z.array(SportDtoSchema).describe('Every sport, by name.'),
}).describe('The sports.');
export type SportListResponse = z.infer<typeof SportListResponseSchema>;

// --- SportLeague ---------------------------------------------------------------

export const SportLeagueDtoSchema = z.object({
  id: z.string().uuid().describe('Sport league identifier.'),
  sportId: z.string().uuid().describe('The sport this sport league belongs to.'),
  name: z.string().describe('Sport league name, e.g. "PGA Tour".'),
  matchKeyword: z.string().nullable().describe('Substring a provider event name carries when it belongs to this sport league (catalog browse), and the provider tour name it equals, ignoring case, for the event-year import (importEventYearFromProvider); null when none is set.'),
  currentEventYear: z.number().int().nullable().describe('The event year the sport league is currently on, if one is set. Always a year the sport league has events in when it was set.'),
  isActive: z.boolean().describe('Whether the sport league is in use; a read filter, not a write lock.'),
  affiliationCount: z.number().int().describe('Participants currently affiliated with the sport league.'),
  sportEventCount: z.number().int().describe('Events on record for the sport league, across every series and year.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A real-world league, tour or conference within a sport — the PGA Tour, the NBA. Never the product\'s League.');
export type SportLeagueDto = z.infer<typeof SportLeagueDtoSchema>;

/** The one list that takes a sport: a sport league is where the sport is chosen (#203 stage 2, decision 5). */
export const SportLeagueListQuerySchema = z.object({
  sport: z.nativeEnum(Sport).optional().describe('Only sport leagues of this sport.'),
  isActive: z.boolean().optional().describe('Only active, or only inactive, sport leagues.'),
}).describe('Filters for the sport-league list.');
export type SportLeagueListQuery = z.infer<typeof SportLeagueListQuerySchema>;

export const SportLeagueListResponseSchema = z.object({
  sportLeagues: z.array(SportLeagueDtoSchema).describe('Matching sport leagues, by name.'),
}).describe('Sport leagues matching the filters.');
export type SportLeagueListResponse = z.infer<typeof SportLeagueListResponseSchema>;

export const SportLeagueResponseSchema = z.object({
  sportLeague: SportLeagueDtoSchema,
}).describe('One sport league.');
export type SportLeagueResponse = z.infer<typeof SportLeagueResponseSchema>;

export const CreateSportLeagueRequestSchema = z.object({
  sport: z.nativeEnum(Sport).describe('The sport the new sport league belongs to.'),
  name: z.string().min(1).describe('Unique within the sport.'),
  matchKeyword: z.string().optional().describe('Provider event-name keyword for this sport league; set it to the provider\'s tour name (e.g. "PGA TOUR") to use the event-year import.'),
}).describe('A new sport league.');
export type CreateSportLeagueRequest = z.infer<typeof CreateSportLeagueRequestSchema>;

export const UpdateSportLeagueRequestSchema = z.object({
  name: z.string().min(1).optional(),
  matchKeyword: z.string().nullable().optional().describe('null clears it.'),
  isActive: z.boolean().optional(),
  currentEventYear: z.number().int().optional().describe('Set as current: 422 EVENT_YEAR_HAS_NO_EVENTS for a year the sport league has no events in.'),
}).describe('Changes to a sport league; omitted fields are left alone.');
export type UpdateSportLeagueRequest = z.infer<typeof UpdateSportLeagueRequestSchema>;

// --- ParticipantLeagueAffiliation — the Participant↔SportLeague edge ----------

export const ParticipantLeagueAffiliationDtoSchema = z.object({
  id: z.string().uuid().describe('Affiliation identifier.'),
  sportLeagueId: z.string().uuid(),
  participantId: z.string().uuid(),
  ranking: z.number().int().nullable().describe('The participant\'s current rank in the sport league; 1 is best. Null when unranked.'),
  participant: ParticipantDtoSchema.describe('The canonical participant.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A participant\'s membership of a sport league, and their current rank there.');
export type ParticipantLeagueAffiliationDto = z.infer<typeof ParticipantLeagueAffiliationDtoSchema>;

export const ParticipantLeagueAffiliationListResponseSchema = z.object({
  affiliations: z.array(ParticipantLeagueAffiliationDtoSchema).describe('Best rank first, unranked last, then by name.'),
}).describe('A sport league\'s affiliations.');
export type ParticipantLeagueAffiliationListResponse = z.infer<typeof ParticipantLeagueAffiliationListResponseSchema>;

export const ParticipantLeagueAffiliationResponseSchema = z.object({
  affiliation: ParticipantLeagueAffiliationDtoSchema,
}).describe('One affiliation.');
export type ParticipantLeagueAffiliationResponse = z.infer<typeof ParticipantLeagueAffiliationResponseSchema>;

export const CreateParticipantLeagueAffiliationRequestSchema = z.object({
  participantId: z.string().uuid(),
}).describe('Affiliates a participant with the sport league.');
export type CreateParticipantLeagueAffiliationRequest = z.infer<typeof CreateParticipantLeagueAffiliationRequestSchema>;

export const UpdateParticipantLeagueAffiliationRankingsRequestSchema = z.object({
  rankings: z.array(z.object({
    participantId: z.string().uuid(),
    ranking: z.number().int().nullable().describe('null unranks.'),
  })).min(1).max(500).describe('Existing affiliations to re-rank, all or none.'),
}).describe('Re-ranks existing affiliations.');
export type UpdateParticipantLeagueAffiliationRankingsRequest = z.infer<typeof UpdateParticipantLeagueAffiliationRankingsRequestSchema>;

export const ParticipantLeagueAffiliationUploadRowSchema = z.object({
  participantId: z.string().uuid().optional(),
  externalId: z.string().optional(),
  playerName: z.string().optional(),
  ranking: z.number().int().optional(),
}).describe('One uploaded affiliation. The first identifier present is used: participantId, then externalId, then an exact case-insensitive playerName.');
export type ParticipantLeagueAffiliationUploadRow = z.infer<typeof ParticipantLeagueAffiliationUploadRowSchema>;

export const ParticipantLeagueAffiliationUploadRequestSchema = z.object({
  rows: z.array(ParticipantLeagueAffiliationUploadRowSchema).min(1).max(2000),
}).describe('An affiliation upload.');
export type ParticipantLeagueAffiliationUploadRequest = z.infer<typeof ParticipantLeagueAffiliationUploadRequestSchema>;

export const UploadRowResolutionDtoSchema = z.enum(['MATCHED', 'UNRESOLVED', 'AMBIGUOUS'])
  .describe('How an uploaded row resolved to a participant: one match, none, or several.');
export type UploadRowResolutionDto = z.infer<typeof UploadRowResolutionDtoSchema>;

export const ParticipantLeagueAffiliationUploadPreviewRowDtoSchema = z.object({
  row: ParticipantLeagueAffiliationUploadRowSchema,
  resolution: UploadRowResolutionDtoSchema,
  participantId: z.string().uuid().nullable().describe('Set only when MATCHED.'),
  participantName: z.string().nullable().describe('Set only when MATCHED.'),
}).describe('What applying one uploaded row would do.');
export type ParticipantLeagueAffiliationUploadPreviewRowDto = z.infer<typeof ParticipantLeagueAffiliationUploadPreviewRowDtoSchema>;

export const ParticipantLeagueAffiliationUploadPreviewResponseSchema = z.object({
  rows: z.array(ParticipantLeagueAffiliationUploadPreviewRowDtoSchema).describe('One per uploaded row, in upload order.'),
}).describe('A dry run of an affiliation upload. Nothing is written.');
export type ParticipantLeagueAffiliationUploadPreviewResponse = z.infer<typeof ParticipantLeagueAffiliationUploadPreviewResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('SportDto', SportDtoSchema);
registerSchema('SportListResponse', SportListResponseSchema);
registerSchema('SportLeagueDto', SportLeagueDtoSchema);
registerSchema('SportLeagueListQuery', SportLeagueListQuerySchema);
registerSchema('SportLeagueListResponse', SportLeagueListResponseSchema);
registerSchema('SportLeagueResponse', SportLeagueResponseSchema);
registerSchema('CreateSportLeagueRequest', CreateSportLeagueRequestSchema);
registerSchema('UpdateSportLeagueRequest', UpdateSportLeagueRequestSchema);
registerSchema('ParticipantLeagueAffiliationDto', ParticipantLeagueAffiliationDtoSchema);
registerSchema('ParticipantLeagueAffiliationListResponse', ParticipantLeagueAffiliationListResponseSchema);
registerSchema('ParticipantLeagueAffiliationResponse', ParticipantLeagueAffiliationResponseSchema);
registerSchema('CreateParticipantLeagueAffiliationRequest', CreateParticipantLeagueAffiliationRequestSchema);
registerSchema('UpdateParticipantLeagueAffiliationRankingsRequest', UpdateParticipantLeagueAffiliationRankingsRequestSchema);
registerSchema('ParticipantLeagueAffiliationUploadRequest', ParticipantLeagueAffiliationUploadRequestSchema);
registerSchema('UploadRowResolutionDto', UploadRowResolutionDtoSchema);
registerSchema('ParticipantLeagueAffiliationUploadPreviewResponse', ParticipantLeagueAffiliationUploadPreviewResponseSchema);
