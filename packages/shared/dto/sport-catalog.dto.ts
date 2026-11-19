/**
 * The cross-sport catalog's contract (#236): Sport, SportLeague and a sport league's roster of
 * participants and their ranks (#1853). One DTO per object; the counts
 * and derived facts a screen reads are fields of that DTO, never a second shape
 * (plans/145 rules 3 and 5). These replace the golf-named admin DTOs, which were
 * projections of the same rows.
 *
 * `SportLeague` is never abbreviated to "league" here (#203 stage 2, decision 6): the
 * product's League is a pool of players; a SportLeague is the PGA Tour or the NFL.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  BracketAdvancement,
  MatchPeriodLayout,
  ParticipantType,
  ProviderSyncKind,
  Sport,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueKind,
  SportLeagueNoun,
  SportLeagueSyncHealth,
  TournamentFormat,
} from '../domain/enums';
import { ScoringFamily } from '../domain/sports/scoring-family';
import { AUTO_RELEASE_DAYS_MAX, ReleaseCheckKey } from '../domain/release-checks';
import { DateTimeSchema } from './common.dto';

// --- Sport ---------------------------------------------------------------------

export const SportDtoSchema = z.object({
  id: z.uuid().describe('Sport identifier — what Participant.sportId and SportLeague.sportId point at.'),
  sport: z.enum(Sport).describe('The sport.'),
  participantType: z.enum(ParticipantType).describe('Whether the sport\'s competitors are individuals or teams.'),
  tournamentFormat: z.enum(TournamentFormat).describe('Structural format of the sport\'s events; decides which contest formats are valid.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A sport the platform runs contests on.');
export type SportDto = z.infer<typeof SportDtoSchema>;

export const SportListResponseSchema = z.object({
  sports: z.array(SportDtoSchema).describe('Every sport, ordered by sport.'),
}).describe('The sports.');
export type SportListResponse = z.infer<typeof SportListResponseSchema>;

// --- SportLeague ---------------------------------------------------------------

/** The automatic release window, in days before an event's start (#1823); the database checks the same range. */
const AutoReleaseDaysSchema = z.number().int().min(1).max(AUTO_RELEASE_DAYS_MAX);

export const SportLeagueDtoSchema = z.object({
  id: z.uuid().describe('Sport league identifier.'),
  sportId: z.uuid().describe('The sport this sport league belongs to.'),
  sport: z.enum(Sport).describe('The sport this sport league belongs to, as the sport enum.'),
  name: z.string().describe('Sport league name, e.g. "PGA Tour".'),
  matchKeyword: z.string().nullable().describe('The provider\'s tour name for this sport league (e.g. "PGA TOUR"), or words its event names carry. Catalog browse keeps an event that matches either way, a name matching only on whole words ("NBA" does not match "WNBA Playoffs"); the event-year import (importEventYearFromProvider) needs the tour name, ignoring case. null when none is set.'),
  currentEventYear: z.number().int().nullable().describe('The event year the sport league is currently on, if one is set. Always a year the sport league has events in when it was set.'),
  isActive: z.boolean().describe('Whether the sport league is in use; a read filter, not a write lock.'),
  eventSyncProviderId: z.string().nullable().describe('The provider whose sync creates and keeps the sport league\'s events (ADR 0011): once a day it imports the provider\'s events for the league\'s tour (matchKeyword) for this calendar year and the next, each born DRAFT and linked for scores, skipping events already linked and series that already have that year\'s edition. null when an admin authors its events.'),
  autoReleaseDaysBeforeStart: AutoReleaseDaysSchema.nullable().describe('How many days before its start a synced DRAFT event of the sport league is released for contests on its own, once every ready check passes (releaseChecks on the event). An hourly sweep tries each such event in the window, and logs each try with every check and its value. Null: events are released only by a root admin. 7 for a new sport league.'),
  tierProfileId: z.uuid().describe('The tier profile the sport league names (TierProfileDto): a new event of the league starts with its tiers, and its field is auto-tiered by it.'),
  pricingProfileId: z.uuid().describe('The pricing profile the sport league names (PricingProfileDto): a synced field of the league never priced before is priced with its values.'),
  bracketAdvancement: z.enum(BracketAdvancement).describe('How the sport league\'s bracket winners reach their next match: FIXED by each match\'s link, or RESEED_BY_SEED, where after a round whose matches link nowhere the admin places the teams left in each region, the best seed hosting the worst (the NFL). FIXED for a sport not played as a bracket.'),
  roundNames: z.array(z.string()).describe('What the sport league calls its bracket\'s rounds, first to final (the NBA: First Round, Conference Semifinals, Conference Finals, NBA Finals). Empty when the sport\'s round names are used. Set with the league\'s reference data, never by a request.'),
  matchPeriodLayout: z.enum(MatchPeriodLayout).nullable().describe('The periods the sport league\'s games are played in, when not its sport\'s: HALVES for men\'s college basketball. Null plays the sport\'s layout. Set with the league\'s reference data, never by a request.'),
  squaresFromRound: z.number().int().min(1).nullable().describe('The first round whose matches are single games a squares contest can be played on, when not every round\'s are: 5 for the Champions League, whose earlier rounds are two-legged ties, 3 for MLS, whose round one is a best-of-three series. Null when every round\'s matches can take one. Set with the league\'s reference data, never by a request.'),
  noun: z.enum(SportLeagueNoun).nullable().describe('What screens call the sport league, when not what its sport calls one: LEAGUE for the NCAA Division I tennis championships, where the ATP and the WTA are tours. Null takes the sport\'s noun. Set with the league\'s reference data, never by a request.'),
  displayName: z.string().nullable().describe('What screens call the sport league away from its sport\'s own pages, when its name alone does not say the sport: "NCAA Men\'s Basketball" for basketball\'s NCAA Division I Men. Null shows the name. Set with the league\'s reference data, never by a request.'),
  participantType: z.enum(ParticipantType).nullable().describe('Who competes in the sport league\'s events, when not its sport\'s: INDIVIDUAL for a championship stat pool (the World Series\' players, where baseball\'s are teams). Null takes the sport\'s. Set with the league\'s reference data, never by a request.'),
  scoringFamily: z.enum(ScoringFamily).nullable().describe('How the sport league\'s events are scored, when not as its sport\'s: COMPOSITE for a championship stat pool, each game a player\'s sport composite. Null takes the sport\'s. Set with the league\'s reference data, never by a request.'),
  displayOrder: z.number().int().nullable().describe('Where the sport league sits among its sport\'s leagues wherever they are listed together, as on How to Play: the major professional leagues first, then the NCAA\'s. Lower comes first; null comes after every ordered league, by name. Set with the league\'s reference data, never by a request.'),
  parentSportLeagueId: z.uuid().nullable().describe('The season league this sport league is a playoff round of, so pages list it under that league: the NHL for the Stanley Cup Final, NCAA Division I Men for the Men\'s Frozen Four. Null for a league that is no other\'s round. Set with the league\'s reference data, never by a request.'),
  parentRoundNumbers: z.array(z.number().int()).describe('The rounds of its parent league\'s season event each of its events covers, first to last: 4 for the World Series, round 4 of the MLB Postseason. Set on every Clutch Card league; empty for any other. Set with the league\'s reference data, never by a request.'),
  participantCount: z.number().int().describe('The sport league\'s participants.'),
  sportEventCount: z.number().int().describe('Events on record for the sport league, across every series and year.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A real-world league, tour or conference within a sport — the PGA Tour, the NBA. Never the product\'s League.');
export type SportLeagueDto = z.infer<typeof SportLeagueDtoSchema>;

/** The one list that takes a sport: a sport league is where the sport is chosen (#203 stage 2, decision 5). */
export const SportLeagueListQuerySchema = z.object({
  sport: z.enum(Sport).optional().describe('Only sport leagues of this sport.'),
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
  sport: z.enum(Sport).describe('The sport the new sport league belongs to.'),
  name: z.string().min(1).describe('Unique within the sport.'),
  matchKeyword: z.string().optional().describe('Provider event-name keyword for this sport league; set it to the provider\'s tour name (e.g. "PGA TOUR") to use the event-year import.'),
  bracketAdvancement: z.enum(BracketAdvancement).optional().describe('FIXED when omitted. RESEED_BY_SEED only for a sport played as a bracket: 422 SPORT_LEAGUE_NOT_BRACKET otherwise.'),
  tierProfileId: z.uuid().describe('The tier profile the sport league names. 404 TIER_PROFILE_NOT_FOUND for one that does not exist.'),
  pricingProfileId: z.uuid().describe('The pricing profile the sport league names. 404 PRICING_PROFILE_NOT_FOUND for one that does not exist.'),
}).describe('A new sport league.');
export type CreateSportLeagueRequest = z.infer<typeof CreateSportLeagueRequestSchema>;

export const UpdateSportLeagueRequestSchema = z.object({
  name: z.string().min(1).optional(),
  matchKeyword: z.string().nullable().optional().describe('null clears it.'),
  isActive: z.boolean().optional(),
  autoReleaseDaysBeforeStart: AutoReleaseDaysSchema.nullable().optional().describe('Days before an event\'s start that its automatic release begins, 1 to 30; null turns automatic release off for the sport league.'),
  eventSyncProviderId: z.string().min(1).nullable().optional().describe('Turns the sport league\'s event sync on with that provider, or off with null. 404 PROVIDER_NOT_FOUND for a provider that is not registered; 422 PROVIDER_SPORT_MISMATCH for one that does not cover the sport league\'s sport; 422 SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD when the sport league has no match keyword after the update, since the sync finds the league\'s events by it. Clearing the keyword of a synced league is refused the same way.'),
  currentEventYear: z.number().int().optional().describe('Set as current: 422 EVENT_YEAR_HAS_NO_EVENTS for a year the sport league has no events in.'),
  tierProfileId: z.uuid().optional().describe('Names another tier profile. 404 TIER_PROFILE_NOT_FOUND for one that does not exist. An event already made keeps its tiers; its next auto-tiering uses the new profile.'),
  pricingProfileId: z.uuid().optional().describe('Names another pricing profile. 404 PRICING_PROFILE_NOT_FOUND for one that does not exist. A field already priced keeps its values; a field never priced is priced with the new profile.'),
  bracketAdvancement: z.enum(BracketAdvancement).optional().describe('RESEED_BY_SEED only for a sport played as a bracket: 422 SPORT_LEAGUE_NOT_BRACKET otherwise. A change is refused with 409 SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED while any event of the sport league has its bracket loaded; the value it already has is accepted.'),
}).describe('Changes to a sport league; omitted fields are left alone.');
export type UpdateSportLeagueRequest = z.infer<typeof UpdateSportLeagueRequestSchema>;

// --- A sport league's roster: its participants and their ranks (#1853) ----------

export const SportLeagueParticipantRankingsRequestSchema = z.object({
  rankings: z.array(z.object({
    participantId: z.uuid(),
    ranking: z.number().int().nullable().describe('null unranks.'),
  })).min(1).max(500).describe('Participants of the sport league to re-rank, all or none.'),
}).describe('Re-ranks participants of the sport league.');
export type SportLeagueParticipantRankingsRequest = z.infer<typeof SportLeagueParticipantRankingsRequestSchema>;

export const SportLeagueRankingUploadRowSchema = z.object({
  participantId: z.uuid().optional(),
  externalId: z.string().optional(),
  playerName: z.string().optional(),
  ranking: z.number().int().optional(),
}).describe('One uploaded rank. The first identifier present is used: participantId, then externalId, then an exact case-insensitive playerName, among the sport league\'s participants.');
export type SportLeagueRankingUploadRow = z.infer<typeof SportLeagueRankingUploadRowSchema>;

export const SportLeagueRankingUploadRequestSchema = z.object({
  rows: z.array(SportLeagueRankingUploadRowSchema).min(1).max(2000),
}).describe('A ranking upload for a sport league\'s participants.');
export type SportLeagueRankingUploadRequest = z.infer<typeof SportLeagueRankingUploadRequestSchema>;

export const UploadRowResolutionDtoSchema = z.enum(['MATCHED', 'UNRESOLVED', 'AMBIGUOUS'])
  .describe('How an uploaded row resolved to a participant: one match, none, or several.');
export type UploadRowResolutionDto = z.infer<typeof UploadRowResolutionDtoSchema>;

export const SportLeagueRankingUploadPreviewRowDtoSchema = z.object({
  row: SportLeagueRankingUploadRowSchema,
  resolution: UploadRowResolutionDtoSchema,
  participantId: z.uuid().nullable().describe('Set only when MATCHED.'),
  participantName: z.string().nullable().describe('Set only when MATCHED.'),
}).describe('What applying one uploaded row would do.');
export type SportLeagueRankingUploadPreviewRowDto = z.infer<typeof SportLeagueRankingUploadPreviewRowDtoSchema>;

export const SportLeagueRankingUploadPreviewResponseSchema = z.object({
  rows: z.array(SportLeagueRankingUploadPreviewRowDtoSchema).describe('One per uploaded row, in upload order.'),
}).describe('A dry run of a ranking upload. Nothing is written.');
export type SportLeagueRankingUploadPreviewResponse = z.infer<typeof SportLeagueRankingUploadPreviewResponseSchema>;

// --- Sport league overview: the root admin's Sports page (#1847) -----------------

const SportLeagueIssueTargetDtoSchema = z.object({
  type: z.enum(SportLeagueIssueTargetType).describe('What the item opens: SYNC_RUN a provider sync run on the run log, SPORT_EVENT an event\'s page.'),
  id: z.uuid().describe('The sync run\'s or event\'s id.'),
}).describe('What an issue item links to.');

const issueItemFields = {
  label: z.string().describe('The item\'s name as data, never a sentence: a failed run\'s outcome summary as the sync history shows it (its sync kind when it has none), or an event\'s name.'),
  occurredAt: DateTimeSchema.describe('When the run was written, or the event was last checked.'),
  target: SportLeagueIssueTargetDtoSchema,
};

export const SportLeagueSyncIssueDtoSchema = z.object({
  type: z.literal(SportLeagueIssueType.SYNC),
  count: z.number().int().min(1).describe('How many of its syncs\' latest runs failed.'),
  items: z.array(z.object({
    ...issueItemFields,
    syncKind: z.enum(ProviderSyncKind).describe('Which sync failed: the event list (EVENTS, a Clutch Card\'s parent\'s), the field (FIELD) or live scores and results (SCORES).'),
  }).describe('A sync whose latest run failed; its target is that run.')).describe('Event list, then field, then scores.'),
}).describe('Syncs whose latest run failed.');

export const SportLeagueReleaseIssueDtoSchema = z.object({
  type: z.literal(SportLeagueIssueType.RELEASE),
  count: z.number().int().min(1).describe('How many draft events the latest automatic release check held.'),
  items: z.array(z.object({
    ...issueItemFields,
    failedChecks: z.array(z.enum(ReleaseCheckKey)).min(1).describe('The ready checks that held it, in check order.'),
  }).describe('A draft event its latest automatic release check held; its target is the event.')).describe('By event name.'),
}).describe('Draft events held by a failed ready check.');

export const SportLeagueIssueDtoSchema = z.discriminatedUnion('type', [
  SportLeagueSyncIssueDtoSchema,
  SportLeagueReleaseIssueDtoSchema,
]).describe('One kind of thing on a sport league that needs a root admin, with a count and every item, each linking to its fix.');
export type SportLeagueIssueDto = z.infer<typeof SportLeagueIssueDtoSchema>;

export const SportLeagueOverviewDtoSchema = z.object({
  id: z.uuid(),
  sport: z.enum(Sport),
  name: z.string(),
  parentSportLeagueId: z.uuid().nullable().describe('The season league it is a round of: a Clutch Card\'s parent league, the NHL for the Stanley Cup Final. Null for a league that is no other\'s round.'),
  kind: z.enum(SportLeagueKind).describe('REAL for a league, tour or championship; CLUTCH_CARD for a Clutch Card\'s stat pool league, whose events are rounds of its parent league\'s season event.'),
  providerId: z.string().nullable().describe('The provider that syncs its events; a Clutch Card\'s parent league\'s, since its parent\'s event list sync creates its events. Null when none does.'),
  isActive: z.boolean().describe('On: offered to customers and synced. Off: hidden and not synced.'),
  syncHealth: z.enum(SportLeagueSyncHealth).describe('From the latest run of each of its syncs (event list, field, live scores and results): OFF while it is off or no provider syncs it; ERROR when any of those runs failed (the SYNC issue names which); NOT_RUN_YET when no sync has run; OK otherwise. A run still under way counts as not failed.'),
  issues: z.array(SportLeagueIssueDtoSchema).describe('Only the types with something to do, always in the order SYNC, RELEASE. Empty when nothing needs attention.'),
  season: z.object({
    start: DateTimeSchema.describe('The start of its first event.'),
    end: DateTimeSchema.describe('The end of its last event, or its start when it has no end.'),
  }).nullable().describe('The first to last event of its event year under way now; between seasons, of the next one to start; with no next one known, of the latest one. A Clutch Card\'s spans the parent event rounds its events cover. Cancelled events are left out. Null while it has no events.'),
  nextEventStartsAt: DateTimeSchema.nullable().describe('The start of its next event that has not started, cancelled ones aside. Null when none, as while a season-long event is under way.'),
  eventCount: z.number().int().min(0).describe('Its events, past and upcoming, cancelled ones included.'),
}).describe('One sport league on the root admin\'s Sports page: what it is, how its syncs are doing, what needs attention, and when it plays. No contest counts.');
export type SportLeagueOverviewDto = z.infer<typeof SportLeagueOverviewDtoSchema>;

export const SportLeagueOverviewListResponseSchema = z.object({
  sportLeagues: z.array(SportLeagueOverviewDtoSchema).describe('Every sport league, on or off, never paged: by sport, most popular first, then by name, each Clutch Card straight after its parent league.'),
}).describe('The root admin\'s Sports page.');
export type SportLeagueOverviewListResponse = z.infer<typeof SportLeagueOverviewListResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('SportDto', SportDtoSchema);
registerSchema('SportListResponse', SportListResponseSchema);
registerSchema('SportLeagueDto', SportLeagueDtoSchema);
registerSchema('SportLeagueListQuery', SportLeagueListQuerySchema);
registerSchema('SportLeagueListResponse', SportLeagueListResponseSchema);
registerSchema('SportLeagueResponse', SportLeagueResponseSchema);
registerSchema('CreateSportLeagueRequest', CreateSportLeagueRequestSchema);
registerSchema('UpdateSportLeagueRequest', UpdateSportLeagueRequestSchema);
registerSchema('SportLeagueOverviewDto', SportLeagueOverviewDtoSchema);
registerSchema('SportLeagueOverviewListResponse', SportLeagueOverviewListResponseSchema);
registerSchema('SportLeagueParticipantRankingsRequest', SportLeagueParticipantRankingsRequestSchema);
registerSchema('SportLeagueRankingUploadRequest', SportLeagueRankingUploadRequestSchema);
registerSchema('UploadRowResolutionDto', UploadRowResolutionDtoSchema);
registerSchema('SportLeagueRankingUploadPreviewResponse', SportLeagueRankingUploadPreviewResponseSchema);
