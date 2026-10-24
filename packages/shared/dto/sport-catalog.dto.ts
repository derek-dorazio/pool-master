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
import { BracketAdvancement, MatchPeriodLayout, ParticipantType, Sport, SportLeagueNoun, TournamentFormat } from '../domain/enums';
import { DateTimeSchema } from './common.dto';
import { ParticipantDtoSchema } from './participants.dto';

// --- Sport ---------------------------------------------------------------------

export const SportDtoSchema = z.object({
  id: z.string().uuid().describe('Sport identifier — what Participant.sportId and SportLeague.sportId point at.'),
  sport: z.nativeEnum(Sport).describe('The sport.'),
  participantType: z.nativeEnum(ParticipantType).describe('Whether the sport\'s competitors are individuals or teams.'),
  tournamentFormat: z.nativeEnum(TournamentFormat).describe('Structural format of the sport\'s events; decides which contest formats are valid.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A sport the platform runs contests on.');
export type SportDto = z.infer<typeof SportDtoSchema>;

export const SportListResponseSchema = z.object({
  sports: z.array(SportDtoSchema).describe('Every sport, ordered by sport.'),
}).describe('The sports.');
export type SportListResponse = z.infer<typeof SportListResponseSchema>;

// --- SportLeague ---------------------------------------------------------------

export const SportLeagueDtoSchema = z.object({
  id: z.string().uuid().describe('Sport league identifier.'),
  sportId: z.string().uuid().describe('The sport this sport league belongs to.'),
  sport: z.nativeEnum(Sport).describe('The sport this sport league belongs to, as the sport enum.'),
  name: z.string().describe('Sport league name, e.g. "PGA Tour".'),
  matchKeyword: z.string().nullable().describe('The provider\'s tour name for this sport league (e.g. "PGA TOUR"), or a substring its event names carry. Catalog browse keeps an event that matches either way; the event-year import (importEventYearFromProvider) needs the tour name, ignoring case. null when none is set.'),
  currentEventYear: z.number().int().nullable().describe('The event year the sport league is currently on, if one is set. Always a year the sport league has events in when it was set.'),
  isActive: z.boolean().describe('Whether the sport league is in use; a read filter, not a write lock.'),
  bracketAdvancement: z.nativeEnum(BracketAdvancement).describe('How the sport league\'s bracket winners reach their next match: FIXED by each match\'s link, or RESEED_BY_SEED, where after a round whose matches link nowhere the admin places the teams left in each region, the best seed hosting the worst (the NFL). FIXED for a sport not played as a bracket.'),
  roundNames: z.array(z.string()).describe('What the sport league calls its bracket\'s rounds, first to final (the NBA: First Round, Conference Semifinals, Conference Finals, NBA Finals). Empty when the sport\'s round names are used. Set with the league\'s reference data, never by a request.'),
  matchPeriodLayout: z.nativeEnum(MatchPeriodLayout).nullable().describe('The periods the sport league\'s games are played in, when not its sport\'s: HALVES for men\'s college basketball. Null plays the sport\'s layout. Set with the league\'s reference data, never by a request.'),
  squaresFromRound: z.number().int().min(1).nullable().describe('The first round whose matches are single games a squares contest can be played on, when not every round\'s are: 5 for the Champions League, whose earlier rounds are two-legged ties, 3 for MLS, whose round one is a best-of-three series. Null when every round\'s matches can take one. Set with the league\'s reference data, never by a request.'),
  noun: z.nativeEnum(SportLeagueNoun).nullable().describe('What screens call the sport league, when not what its sport calls one: LEAGUE for the NCAA Division I tennis championships, where the ATP and the WTA are tours. Null takes the sport\'s noun. Set with the league\'s reference data, never by a request.'),
  displayName: z.string().nullable().describe('What screens call the sport league away from its sport\'s own pages, when its name alone does not say the sport: "NCAA Men\'s Basketball" for basketball\'s NCAA Division I Men. Null shows the name. Set with the league\'s reference data, never by a request.'),
  displayOrder: z.number().int().nullable().describe('Where the sport league sits among its sport\'s leagues wherever they are listed together, as on How to Play: the major professional leagues first, then the NCAA\'s. Lower comes first; null comes after every ordered league, by name. Set with the league\'s reference data, never by a request.'),
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
  bracketAdvancement: z.nativeEnum(BracketAdvancement).optional().describe('FIXED when omitted. RESEED_BY_SEED only for a sport played as a bracket: 422 SPORT_LEAGUE_NOT_BRACKET otherwise.'),
}).describe('A new sport league.');
export type CreateSportLeagueRequest = z.infer<typeof CreateSportLeagueRequestSchema>;

export const UpdateSportLeagueRequestSchema = z.object({
  name: z.string().min(1).optional(),
  matchKeyword: z.string().nullable().optional().describe('null clears it.'),
  isActive: z.boolean().optional(),
  currentEventYear: z.number().int().optional().describe('Set as current: 422 EVENT_YEAR_HAS_NO_EVENTS for a year the sport league has no events in.'),
  bracketAdvancement: z.nativeEnum(BracketAdvancement).optional().describe('RESEED_BY_SEED only for a sport played as a bracket: 422 SPORT_LEAGUE_NOT_BRACKET otherwise. A change is refused with 409 SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED while any event of the sport league has its bracket loaded; the value it already has is accepted.'),
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
