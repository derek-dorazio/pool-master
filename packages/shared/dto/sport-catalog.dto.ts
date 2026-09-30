/**
 * The cross-sport catalog's contract (#236): Sport, SportLeague, the
 * Participant↔SportLeague affiliation edge, and Season. One DTO per object; the counts
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
  matchKeyword: z.string().nullable().describe('Substring a provider event name carries when it belongs to this sport league; null when none is set.'),
  currentSeasonId: z.string().uuid().nullable().describe('The season designated current, if any.'),
  isActive: z.boolean().describe('Whether the sport league is in use; a read filter, not a write lock.'),
  affiliationCount: z.number().int().describe('Participants currently affiliated with the sport league.'),
  seasonCount: z.number().int().describe('Seasons on record for the sport league.'),
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
  matchKeyword: z.string().optional().describe('Provider event-name keyword for this sport league.'),
}).describe('A new sport league.');
export type CreateSportLeagueRequest = z.infer<typeof CreateSportLeagueRequestSchema>;

export const UpdateSportLeagueRequestSchema = z.object({
  name: z.string().min(1).optional(),
  matchKeyword: z.string().nullable().optional().describe('null clears it.'),
  isActive: z.boolean().optional(),
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

// --- Season --------------------------------------------------------------------

export const SeasonDtoSchema = z.object({
  id: z.string().uuid().describe('Season identifier.'),
  sportLeagueId: z.string().uuid().describe('The sport league whose calendar year this is.'),
  name: z.string(),
  year: z.number().int(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema,
  isActive: z.boolean(),
  sportEventCount: z.number().int().describe('Events in this season.'),
  isCurrent: z.boolean().describe('Whether this is its sport league\'s current season — derived from the sport league, not stored.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A sport league\'s calendar year: a grouping of events, not a roster boundary.');
export type SeasonDto = z.infer<typeof SeasonDtoSchema>;

export const SeasonListQuerySchema = z.object({
  isActive: z.boolean().optional().describe('Only active, or only inactive, seasons.'),
}).describe('Filters for a sport league\'s seasons.');
export type SeasonListQuery = z.infer<typeof SeasonListQuerySchema>;

export const SeasonListResponseSchema = z.object({
  seasons: z.array(SeasonDtoSchema).describe('Newest year first.'),
}).describe('A sport league\'s seasons.');
export type SeasonListResponse = z.infer<typeof SeasonListResponseSchema>;

export const SeasonResponseSchema = z.object({
  season: SeasonDtoSchema,
}).describe('One season.');
export type SeasonResponse = z.infer<typeof SeasonResponseSchema>;

export const CreateSeasonRequestSchema = z.object({
  name: z.string().min(1),
  year: z.number().int().describe('Unique within the sport league.'),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema,
}).describe('A new season for the sport league in the path.');
export type CreateSeasonRequest = z.infer<typeof CreateSeasonRequestSchema>;

export const UpdateSeasonRequestSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: DateTimeSchema.optional(),
  endDate: DateTimeSchema.optional(),
  isActive: z.boolean().optional(),
}).describe('Changes to a season; omitted fields are left alone.');
export type UpdateSeasonRequest = z.infer<typeof UpdateSeasonRequestSchema>;

export const CloneSeasonRequestSchema = z.object({
  targetYear: z.number().int().optional().describe('Year for the new season; defaults to the source season\'s year + 1.'),
}).describe('Clones a season\'s event calendar forward (plans/124 §4.2a).');
export type CloneSeasonRequest = z.infer<typeof CloneSeasonRequestSchema>;

export const CloneSeasonResponseSchema = z.object({
  season: SeasonDtoSchema.describe('The new season.'),
  clonedEventCount: z.number().int().describe('Source-season events re-created as fresh events in the new season.'),
}).describe('The cloned season. Fields, tiers, prices, scores and provider links are never copied; the current season does not change.');
export type CloneSeasonResponse = z.infer<typeof CloneSeasonResponseSchema>;

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
registerSchema('SeasonDto', SeasonDtoSchema);
registerSchema('SeasonListQuery', SeasonListQuerySchema);
registerSchema('SeasonListResponse', SeasonListResponseSchema);
registerSchema('SeasonResponse', SeasonResponseSchema);
registerSchema('CreateSeasonRequest', CreateSeasonRequestSchema);
registerSchema('UpdateSeasonRequest', UpdateSeasonRequestSchema);
registerSchema('CloneSeasonRequest', CloneSeasonRequestSchema);
registerSchema('CloneSeasonResponse', CloneSeasonResponseSchema);
