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
  AutoReleaseCheckOutcome,
  LeaguePhase,
  SeasonCompetitionStatus,
  MatchFormat,
  PeriodUnit,
  SeasonSlotStatus,
  SeriesFormat,
  SlotKind,
  SlotPairing,
  SlotWindowStatus,
  SlotProviderMatchType,
  MatchPeriodLayout,
  ParticipantAddedBy,
  ParticipantType,
  ProviderCode,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  SelectionType,
  Sport,
  SportEventReleaseAtKind,
  SportEventReleaseMode,
  SportEventStatus,
  ProviderSyncFindingSeverity,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueNoun,
  SportLeagueSyncHealth,
  SportLeagueSyncMode,
  TournamentFormat,
} from '../domain/enums';
import { ScoringFamily } from '../domain/sports/scoring-family';
import { AUTO_RELEASE_DAYS_MAX, ReleaseCheckKey } from '../domain/release-checks';
import { DateTimeSchema } from './common.dto';
import { FieldOrderBasis } from '../domain/field-ordering';
import { URL_SEGMENT_PATTERN } from '../domain/url-segment';

// --- Sport ---------------------------------------------------------------------

export const SportDtoSchema = z.object({
  id: z.uuid().describe('Sport identifier — what Participant.sportId and SportLeague.sportId point at.'),
  sport: z.enum(Sport).describe('The sport.'),
  urlSegment: z.string().regex(URL_SEGMENT_PATTERN).describe('The sport\'s name in web addresses, such as football (/play/football/..., /manage/sports/football, ?sport=football). Stored, never built from the code: link with it as given.'),
  displayOrder: z.number().int().describe('Where the sport sits wherever sports are listed together, lower first: the most popular first. Display only, never an identity.'),
  tournamentFormat: z.enum(TournamentFormat).describe('Structural format of the sport\'s events; decides which contest formats are valid.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A sport the platform runs contests on.');
export type SportDto = z.infer<typeof SportDtoSchema>;

export const SportListResponseSchema = z.object({
  sports: z.array(SportDtoSchema).describe('Every sport, in display order.'),
}).describe('The sports.');
export type SportListResponse = z.infer<typeof SportListResponseSchema>;

// --- SportLeague ---------------------------------------------------------------

export const SportLeagueProviderMappingDtoSchema = z.object({
  id: z.uuid().describe('The mapping.'),
  providerLeagueId: z.uuid().describe('The provider league the sport league is mapped to (ProviderLeagueDto).'),
  providerLeagueCode: z.string().describe('The provider\'s own code for its league, e.g. "nfl".'),
  providerLeagueName: z.string().describe('The provider\'s own name for its league, e.g. "NFL".'),
  providerCode: z.enum(ProviderCode).describe('The provider.'),
  providerName: z.string().describe('The provider\'s name, e.g. "BALLDONTLIE".'),
  providerId: z.string().describe('The id the provider\'s events carry as their providerId (SportEventDto.providerId).'),
}).describe('A sport league\'s link to one provider\'s league (#1997).');
export type SportLeagueProviderMappingDto = z.infer<typeof SportLeagueProviderMappingDtoSchema>;

/** The automatic release window, in days before an event's start (#1823); the database checks the same range. */
const AutoReleaseDaysSchema = z.number().int().min(1).max(AUTO_RELEASE_DAYS_MAX);

export const SportLeagueDtoSchema = z.object({
  id: z.uuid().describe('Sport league identifier.'),
  sportId: z.uuid().describe('The sport this sport league belongs to.'),
  sport: z.enum(Sport).describe('The sport this sport league belongs to, as the sport enum.'),
  sportUrlSegment: z.string().regex(URL_SEGMENT_PATTERN).describe('Its sport\'s URL segment (SportDto.urlSegment), such as basketball: the ?sport= of a link to the league.'),
  sportDisplayOrder: z.number().int().describe('Its sport\'s display order (SportDto.displayOrder): lists that group leagues by sport put the sports in this order, lower first.'),
  sportName: z.string().describe('Its sport\'s name, such as "Football", as screens title the sport (#2107).'),
  selectionTypes: z.array(z.enum(SelectionType)).describe('The ways of picking a contest in the sport league may use, in the order screens list them (#2107): its sport\'s formats.'),
  name: z.string().describe('Sport league name, e.g. "PGA Tour".'),
  urlSegment: z.string().regex(URL_SEGMENT_PATTERN).describe('The sport league\'s name in web addresses within its sport, such as wnba (How to Play\'s ?sport=basketball&league=wnba). Stored, never built from the name, and kept forever.'),
  currentSeasonId: z.uuid().nullable().describe('The sport league\'s current Season (SportLeagueSeasonDto): the Season under way; between Seasons the next once the sync has made an event in it, otherwise the one that ended last. Recomputed once a day, never set by a request. Null only for a sport league no migration has given a Season.'),
  timeZone: z.string().describe('The IANA time zone the sport league\'s calendar weeks break in, Monday to Sunday there, such as America/New_York. Set with the league\'s reference data.'),
  isActive: z.boolean().describe('Whether the sport league is in use; a read filter, not a write lock.'),
  selectedProviderMapping: SportLeagueProviderMappingDtoSchema.nullable().describe('The provider league whose sync creates and keeps the sport league\'s events (ADR 0011): a scheduled pass imports that provider league\'s events for its current Season and every later one, each born DRAFT and linked for scores, skipping events already linked and series that already have that Season\'s edition. null when the league is not synced.'),
  autoReleaseDaysBeforeStart: AutoReleaseDaysSchema.nullable().describe('How many days before its start a synced DRAFT event of the sport league is released for contests on its own, once every ready check passes (releaseChecks on the event). An hourly sweep tries each such event in the window, and logs each try with every check and its value. Null: events are released only by a root admin. 7 for a new sport league.'),
  platformTierProfileId: z.uuid().describe('The tier profile the sport league names (PlatformTierProfileDto): a new event of the league starts with its tiers, and its field is auto-tiered by it.'),
  platformPricingProfileId: z.uuid().describe('The pricing profile the sport league names (PlatformPricingProfileDto): a synced field of the league never priced before is priced with its values.'),
  matchPeriodLayout: z.enum(MatchPeriodLayout).nullable().describe('The periods the sport league\'s games are played in, when not its sport\'s: HALVES for men\'s college basketball. Null plays the sport\'s layout. Set with the league\'s reference data, never by a request.'),
  squaresFromRound: z.number().int().min(1).nullable().describe('The first round whose matches are single games a squares contest can be played on, when not every round\'s are: 5 for the Champions League, whose earlier rounds are two-legged ties, 3 for MLS, whose round one is a best-of-three series. Null when every round\'s matches can take one. Set with the league\'s reference data, never by a request.'),
  noun: z.enum(SportLeagueNoun).nullable().describe('What screens call the sport league, when not what its sport calls one: LEAGUE for the NCAA Division I tennis championships, where the ATP and the WTA are tours. Null takes the sport\'s noun. Set with the league\'s reference data, never by a request.'),
  participantType: z.enum(ParticipantType).describe('Who competes in the sport league\'s events: teams or individuals. Set when the league is created, never changed.'),
  scoringFamily: z.enum(ScoringFamily).describe('How the sport league\'s events are scored. Set when the league is created, never changed.'),
  displayOrder: z.number().int().nullable().describe('Where the sport league sits among its sport\'s leagues wherever they are listed together, as on How to Play: the major professional leagues first, then the NCAA\'s. Lower comes first; null comes after every ordered league, by name. Set with the league\'s reference data, never by a request.'),
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

/** The roster, or a test event's choices (#2096). */
export const SportLeagueParticipantListQuerySchema = z.object({
  testData: z.boolean().optional().describe('True lists only the league\'s test participants, the ones a test event\'s field takes; false or omitted lists its roster, which holds no test participant.'),
}).describe('Which of a sport league\'s participants to list.');
export type SportLeagueParticipantListQuery = z.infer<typeof SportLeagueParticipantListQuerySchema>;

export const SportLeagueListResponseSchema = z.object({
  sportLeagues: z.array(SportLeagueDtoSchema).describe('Matching sport leagues, by name.'),
}).describe('Sport leagues matching the filters.');
export type SportLeagueListResponse = z.infer<typeof SportLeagueListResponseSchema>;

export const SportLeagueResponseSchema = z.object({
  sportLeague: SportLeagueDtoSchema,
}).describe('One sport league.');
export type SportLeagueResponse = z.infer<typeof SportLeagueResponseSchema>;

export const UpdateSportLeagueRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  autoReleaseDaysBeforeStart: AutoReleaseDaysSchema.nullable().optional().describe('Days before an event\'s start that its automatic release begins, 1 to 30; null turns automatic release off for the sport league.'),
  syncProviderLeagueId: z.uuid().nullable().optional().describe('Turns the sport league\'s event sync on with that provider league (a ProviderLeagueDto id), mapping the sport league to it when it is not yet, or off with null, which keeps the mapping. 404 PROVIDER_LEAGUE_NOT_FOUND for one that does not exist; 422 PROVIDER_SPORT_MISMATCH for one of another sport; 422 PROVIDER_NOT_FOUND when its provider or the league is switched off or not running.'),
  platformTierProfileId: z.uuid().optional().describe('Names another tier profile. 404 PLATFORM_TIER_PROFILE_NOT_FOUND for one that does not exist. An event already made keeps its tiers; its next auto-tiering uses the new profile.'),
  platformPricingProfileId: z.uuid().optional().describe('Names another pricing profile. 404 PLATFORM_PRICING_PROFILE_NOT_FOUND for one that does not exist. A field already priced keeps its values; a field never priced is priced with the new profile.'),
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
  occurredAt: DateTimeSchema.describe('When the run was written, the event was last checked, or an overdue event should have ended (how late it is runs from here).'),
  target: SportLeagueIssueTargetDtoSchema,
};

export const SportLeagueFindingsIssueDtoSchema = z.object({
  type: z.literal(SportLeagueIssueType.FINDINGS),
  count: z.number().int().min(1).describe('How many OPEN sync findings the league has.'),
  items: z.array(z.object({
    severity: z.enum(ProviderSyncFindingSeverity).describe('ERROR, WARNING or INFO.'),
    count: z.number().int().min(1).describe('How many OPEN findings of that severity.'),
  }).describe('The league\'s OPEN findings of one severity; the Findings list (listProviderSyncFindings) has each.')).describe('Most serious first; only severities it has.'),
}).describe('The league\'s OPEN sync findings, counted by severity (#1999).');

export const SportLeagueSyncIssueDtoSchema = z.object({
  type: z.literal(SportLeagueIssueType.SYNC),
  count: z.number().int().min(1).describe('How many of its syncs\' latest runs failed.'),
  items: z.array(z.object({
    ...issueItemFields,
    syncKind: z.enum(ProviderSyncKind).describe('Which sync failed: the event list (EVENTS), the field (FIELD) or live scores and results (SCORES).'),
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

export const SportLeagueOverdueIssueDtoSchema = z.object({
  type: z.literal(SportLeagueIssueType.OVERDUE),
  count: z.number().int().min(1).describe('How many released events are neither completed nor cancelled more than 4 hours after their last round or match should have ended. A never-released draft is never counted.'),
  items: z.array(z.object(issueItemFields).describe(
    'An event whose results are overdue; occurredAt is when it should have ended: its last round\'s scheduled end, or the last scheduled start plus the sport\'s typical play. Its target is the event.',
  )).describe('Most overdue first.'),
}).describe('Events whose results are still missing well after they should have ended.');

export const SportLeagueIssueDtoSchema = z.discriminatedUnion('type', [
  SportLeagueFindingsIssueDtoSchema,
  SportLeagueSyncIssueDtoSchema,
  SportLeagueReleaseIssueDtoSchema,
  SportLeagueOverdueIssueDtoSchema,
]).describe('One kind of thing on a sport league that needs a root admin, with a count and every item, each linking to its fix.');
export type SportLeagueIssueDto = z.infer<typeof SportLeagueIssueDtoSchema>;

export const SportLeagueOverviewDtoSchema = z.object({
  id: z.uuid(),
  sport: z.enum(Sport),
  sportUrlSegment: z.string().describe('Its sport\'s URL segment (SportDto.urlSegment): what a link to the league\'s Manage page names the sport by.'),
  sportDisplayOrder: z.number().int().describe('Its sport\'s place wherever sports are listed together, lower first (the sport row\'s displayOrder): sort the sport column by it.'),
  name: z.string(),
  providerId: z.string().nullable().describe('The provider that syncs its events. Null when none does.'),
  providerName: z.string().nullable().describe('That provider\'s name, so no reader looks it up by id (#1999). Null when none syncs it.'),
  isActive: z.boolean().describe('On: offered to customers and synced. Off: hidden and not synced.'),
  syncHealth: z.enum(SportLeagueSyncHealth).describe('From the latest run of each of its syncs (event list, field, live scores and results): OFF while it is off or no provider syncs it; ERROR when any of those runs failed (the SYNC issue names which); NOT_RUN_YET when no sync has run; OK otherwise. A run still under way counts as not failed.'),
  issues: z.array(SportLeagueIssueDtoSchema).describe('Only the types with something to do, always in the order FINDINGS, SYNC, RELEASE, OVERDUE. Empty when nothing needs attention.'),
  season: z.object({
    start: DateTimeSchema.describe('The start of its first event.'),
    end: DateTimeSchema.describe('The end of its last event, or its start when it has no end.'),
  }).nullable().describe('The first to last event of its event year under way now; between seasons, of the next one to start; with no next one known, of the latest one. Cancelled events are left out. Null while it has no events.'),
  nextEventStartsAt: DateTimeSchema.nullable().describe('The start of its next event that has not started, cancelled ones aside. Null when none, as while a season-long event is under way.'),
  eventCount: z.number().int().min(0).describe('Its events, past and upcoming, cancelled ones included.'),
}).describe('One sport league on the root admin\'s Sports page: what it is, how its syncs are doing, what needs attention, and when it plays. No contest counts.');
export type SportLeagueOverviewDto = z.infer<typeof SportLeagueOverviewDtoSchema>;

export const SportLeagueOverviewListResponseSchema = z.object({
  sportLeagues: z.array(SportLeagueOverviewDtoSchema).describe('Every sport league, on or off, never paged: by sport, most popular first, then by name.'),
}).describe('The root admin\'s Sports page.');
export type SportLeagueOverviewListResponse = z.infer<typeof SportLeagueOverviewListResponseSchema>;

// --- League page: one sport league's syncs, events and participants (#1865) ------

export const SportLeagueSyncDtoSchema = z.object({
  kind: z.enum(ProviderSyncKind).describe('The event list (EVENTS, which creates its events), the fields (FIELD) or live scores and results (SCORES).'),
  health: z.enum(SportLeagueSyncHealth).describe('By the Sports page\'s rule, from this sync\'s latest run alone: OFF while the league is off or no provider syncs it, ERROR when that run failed, NOT_RUN_YET before any run, OK otherwise.'),
  mode: z.enum(SportLeagueSyncMode).describe('SCHEDULE: the ingestion schedule runs it. WEBHOOK: the provider\'s webhook drives it, with a poll only while an event is in play (live scores of a provider whose webhook is set).'),
  lastRun: z.object({
    id: z.uuid().describe('The run, on the run log.'),
    status: z.enum(ProviderSyncRunStatus),
    createdAt: DateTimeSchema.describe('When it was queued.'),
    startedAt: DateTimeSchema.nullable().describe('When it started; null while it waits.'),
    summary: z.string().nullable().describe('Its outcome summary as the sync history shows it, as data; null when it has none.'),
    changedCount: z.number().int().min(0).nullable().describe('Rows it created or updated; null unless it completed and counted them.'),
  }).nullable().describe('Its latest run; null before any.'),
}).describe('One of a sport league\'s syncs, as the League page\'s Syncs card shows it.');
export type SportLeagueSyncDto = z.infer<typeof SportLeagueSyncDtoSchema>;

export const SportLeagueSyncListResponseSchema = z.object({
  syncs: z.array(SportLeagueSyncDtoSchema).describe('One per sync kind, always all three: EVENTS, FIELD, SCORES.'),
}).describe('A sport league\'s syncs.');
export type SportLeagueSyncListResponse = z.infer<typeof SportLeagueSyncListResponseSchema>;

export const SportLeagueEventOverviewDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sportLeagueSeasonId: z.uuid().describe('The Season it is played in (SportLeagueSeasonDto).'),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.nullable(),
  status: z.enum(SportEventStatus),
  releaseMode: z.enum(SportEventReleaseMode).describe('AUTO when its league releases synced drafts on its own and the event is synced; MANUAL otherwise.'),
  releaseAt: DateTimeSchema.nullable().describe('With releaseAtKind: when it was released (ACTUAL), or for an AUTO draft when its league\'s window opens, its start less the window (PLANNED). Null for a MANUAL draft and for an event released before release times were kept.'),
  releaseAtKind: z.enum(SportEventReleaseAtKind).nullable().describe('What releaseAt is; null with it.'),
  lastReleaseCheck: z.object({
    checkedAt: DateTimeSchema.describe('When the automatic release last judged it.'),
    outcome: z.enum(AutoReleaseCheckOutcome),
    failedChecks: z.array(z.enum(ReleaseCheckKey)).describe('The ready checks that held it, in check order; empty when released.'),
  }).nullable().describe('Its latest automatic release check; null before the first, and after a release by hand.'),
  fieldSize: z.number().int().min(1).nullable().describe('How many participants its field holds; null until a field loads.'),
  issues: z.array(SportLeagueIssueDtoSchema).describe('The event\'s own issues, as the Sports page counts them, in the order SYNC (its latest field or scores run failed), RELEASE (its latest automatic check held it), OVERDUE (its results are missing). Empty when none.'),
  lastSyncedAt: DateTimeSchema.nullable().describe('When a sync last ran on it; null before any.'),
}).describe('One event on the League page\'s Events grid.');
export type SportLeagueEventOverviewDto = z.infer<typeof SportLeagueEventOverviewDtoSchema>;

export const SportLeagueEventOverviewListResponseSchema = z.object({
  events: z.array(SportLeagueEventOverviewDtoSchema).describe('Every event of the sport league, every year, never paged: by start, earliest first.'),
}).describe('A sport league\'s events.');
export type SportLeagueEventOverviewListResponse = z.infer<typeof SportLeagueEventOverviewListResponseSchema>;

export const SportLeagueParticipantOverviewDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  participantType: z.enum(ParticipantType),
  shortName: z.string().nullable(),
  nationality: z.string().nullable(),
  teamAffiliation: z.string().nullable(),
  role: z.string().nullable().describe('Playing role, such as a position; not a rank.'),
  ranking: z.number().int().nullable().describe('Its rank in the sport league, 1 best; null when unranked.'),
  feedId: z.string().nullable().describe('Its provider\'s id for it in the sport league; null when it has no provider mapping.'),
  lastInFeedAt: DateTimeSchema.nullable().describe('When a sync last saw it in its provider\'s feed; null when none has.'),
  addedBy: z.enum(ParticipantAddedBy).describe('FEED when it has a provider mapping, so a sync found it; ADMIN otherwise.'),
  createdAt: DateTimeSchema,
}).describe('One participant on the League page\'s Participants grid.');
export type SportLeagueParticipantOverviewDto = z.infer<typeof SportLeagueParticipantOverviewDtoSchema>;

export const SportLeagueParticipantOverviewListResponseSchema = z.object({
  participants: z.array(SportLeagueParticipantOverviewDtoSchema).describe('Every participant of the sport league, never paged: by name.'),
}).describe('A sport league\'s participants.');
export type SportLeagueParticipantOverviewListResponse = z.infer<typeof SportLeagueParticipantOverviewListResponseSchema>;

export const SportLeaguePositionProviderCodeDtoSchema = z.object({
  providerCode: z.string().describe('The provider\'s own code for the position, exactly as its feed sends it.'),
  provider: z.enum(ProviderCode).describe('The provider whose code it is.'),
  providerLeagueCode: z.string().describe('The provider\'s own code for the league the code is from.'),
  providerLeagueName: z.string().describe('The provider\'s own name for that league.'),
}).describe('One provider\'s code for a sport league position.');
export type SportLeaguePositionProviderCodeDto = z.infer<typeof SportLeaguePositionProviderCodeDtoSchema>;

export const SportLeaguePositionDtoSchema = z.object({
  id: z.uuid(),
  code: z.string().describe('The position\'s key within its league (QB). Screens read its words by this code.'),
  displayOrder: z.number().int().describe('Where it sits when the league\'s positions are listed. Display only.'),
  isFieldEligible: z.boolean().describe('Whether its players can be picked into an event\'s field. The roster sync keeps only these players.'),
  providerCodes: z.array(SportLeaguePositionProviderCodeDtoSchema).describe('Each provider\'s codes for the position, by provider league then code. A feed code with no row is not one of the league\'s positions.'),
}).describe('One of a sport league\'s playing positions. Set by migration; never edited through the API.');
export type SportLeaguePositionDto = z.infer<typeof SportLeaguePositionDtoSchema>;

export const SportLeaguePositionListResponseSchema = z.object({
  positions: z.array(SportLeaguePositionDtoSchema).describe('Every position of the sport league, by display order, never paged. Empty for a league with none.'),
}).describe('A sport league\'s positions.');
export type SportLeaguePositionListResponse = z.infer<typeof SportLeaguePositionListResponseSchema>;
export const SlotProviderMappingDtoSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  providerName: z.string(),
  providerLeagueCode: z.string().describe('The provider\'s own code for the league the mapping reads, such as nfl.'),
  providerLeagueName: z.string(),
  matchType: z.enum(SlotProviderMatchType).describe('How a provider\'s game is matched to the slot; the sync tries PROVIDER_CODE, then NAME_PATTERN, then DATE_WINDOW.'),
  providerValue: z.string().nullable().describe('The adapter\'s code (REG:5, POST:3) or the normalized tournament name a game is matched on; null for CALENDAR_WEEK, which matches by the global week rule.'),
}).describe('How one provider\'s games match a slot definition. Inclusion only: a provider value no mapping names is not synced.');
export type SlotProviderMappingDto = z.infer<typeof SlotProviderMappingDtoSchema>;

export const SportLeagueSlotDefinitionDtoSchema = z.object({
  id: z.uuid(),
  key: z.string().describe('A code unique in the sport league that nothing parses, such as WEEK_14, FINAL or MASTERS.'),
  slotKind: z.enum(SlotKind),
  weekNumber: z.number().int().min(1).nullable().describe('The week\'s number in its phase; set only on a WEEK slot.'),
  name: z.string().nullable().describe('The league\'s own proper name for the slot (Super Bowl, Sweet 16); null when screens show the word for its kind.'),
  awardsTrophy: z.boolean(),
  squaresEligible: z.boolean().describe('Whether a squares pool can be played on its games.'),
  seriesFormat: z.enum(SeriesFormat),
  seriesGames: z.number().int().min(1).describe('Games in one meeting: 1 for SINGLE_GAME, the series length for BEST_OF, the legs for AGGREGATE.'),
  pairing: z.enum(SlotPairing),
  matchFormat: z.enum(MatchFormat).describe('How the slot\'s games are contested: HEAD_TO_HEAD, two sides meet; FIELD, a whole field is ranked.'),
  canEndTied: z.boolean().describe('Whether a game of the slot can finish level. A slot whose games cannot is decided by overtime or a shoot-out.'),
  periodUnit: z.enum(PeriodUnit).nullable().describe('What a game is played in; null, with periodCount, for a game kept by no period (a race, a tennis match).'),
  periodCount: z.number().int().min(1).nullable().describe('How many periods a game has, overtime aside; null exactly when periodUnit is.'),
  providerMappings: z.array(SlotProviderMappingDtoSchema).describe('By provider, then in the order the sync tries them.'),
}).describe('One slot definition: a week, a knockout round or a recurring tournament. Seasons, events and contest templates link on it.');
export type SportLeagueSlotDefinitionDto = z.infer<typeof SportLeagueSlotDefinitionDtoSchema>;

const SportLeagueCompetitionDefinitionDtoSchema = z.object({
  id: z.uuid(),
  code: z.string().describe('A readable key unique in the league, such as REGULAR or CFP. Screens show it until a display key exists; nothing parses it.'),
  orderIndex: z.number().int().min(1).describe('Its place among its phase\'s competitions, from 1.'),
  slots: z.array(SportLeagueSlotDefinitionDtoSchema).describe('In play order: weeks by number, then the knockout rounds to the final; tournaments by key until a Season dates them.'),
}).describe('One competition of a phase (#2153): what the phase\'s slots are played as. No contest crosses competitions.');

export const SportLeaguePhaseDefinitionDtoSchema = z.object({
  id: z.uuid(),
  phase: z.enum(LeaguePhase),
  isSynced: z.boolean().describe('Whether the league\'s sync reads the phase. An unsynced phase has no slots.'),
  competitions: z.array(SportLeagueCompetitionDefinitionDtoSchema).describe('By their order in the phase.'),
}).describe('One phase definition of a sport league.');
export type SportLeaguePhaseDefinitionDto = z.infer<typeof SportLeaguePhaseDefinitionDtoSchema>;

export const SportLeagueStructureResponseSchema = z.object({
  phases: z.array(SportLeaguePhaseDefinitionDtoSchema).describe('In the order a Season plays them: PRESEASON, REGULAR, POSTSEASON_CONFERENCE, POSTSEASON.'),
}).describe('A sport league\'s phase, competition and slot definitions, set by migration.');
export type SportLeagueStructureResponse = z.infer<typeof SportLeagueStructureResponseSchema>;

// --- A sport league's Seasons (#2003) --------------------------------------------

export const SportLeagueSeasonProviderMappingDtoSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  providerName: z.string(),
  providerLeagueCode: z.string().describe('The provider\'s own code for the league, such as nfl.'),
  providerSeasonId: z.string().describe('The provider\'s own id for the Season, as the sync asks the feed for it.'),
}).describe('A provider\'s id for one Season.');
export type SportLeagueSeasonProviderMappingDto = z.infer<typeof SportLeagueSeasonProviderMappingDtoSchema>;

const SlotWindowDtoSchema = z.object({
  startsAt: DateTimeSchema,
  endsAt: DateTimeSchema.describe('Exclusive.'),
  status: z.enum(SlotWindowStatus).describe('TENTATIVE: a best guess, until the sync places a game in it and it becomes CONFIRMED.'),
}).describe('The dates a provider that names no place for its games has them placed by (DATE_WINDOW), kept apart from the dates its Games give.');

export const SportLeagueSeasonSlotDtoSchema = z.object({
  id: z.uuid(),
  slotDefinitionId: z.uuid().describe('The slot definition it plays (SportLeagueSlotDefinitionDto).'),
  key: z.string().describe('Its definition\'s key.'),
  slotKind: z.enum(SlotKind),
  weekNumber: z.number().int().min(1).nullable(),
  name: z.string().nullable().describe('Its definition\'s proper name; null when screens show the word for its kind.'),
  startsAt: DateTimeSchema.nullable().describe('The earliest start of its Games; null until the sync has matched one.'),
  endsAt: DateTimeSchema.nullable().describe('The latest end of its Games; null until the sync has matched one.'),
  status: z.enum(SeasonSlotStatus),
  seriesFormat: z.enum(SeriesFormat).describe('Copied from the definition when the Season was added, so a later format change never rewrites a past Season.'),
  seriesGames: z.number().int().min(1),
  pairing: z.enum(SlotPairing),
  isTestData: z.boolean().describe('A test slot: QA only, never read or written by the sync.'),
  label: z.string().nullable().describe('A test slot\'s label, unique per Season and definition; null on a synced slot.'),
  window: SlotWindowDtoSchema.nullable().describe('Its date window, set as data (#2012); null when it has none.'),
}).describe('One slot of one Season.');
export type SportLeagueSeasonSlotDto = z.infer<typeof SportLeagueSeasonSlotDtoSchema>;

const CreateTestSlotRequestSchema = z.object({
  slotDefinitionId: z.uuid().describe('The slot definition it plays (SportLeagueSlotDefinitionDto), one of the league\'s: 404 SLOT_DEFINITION_NOT_FOUND otherwise.'),
  label: z.string().trim().min(1).max(64).describe('Tells it apart from the Season\'s other test slots of that definition: 409 TEST_SLOT_LABEL_TAKEN when one already has it.'),
  startsAt: DateTimeSchema.describe('When its test event starts.'),
  endsAt: DateTimeSchema.optional().describe('When its test event ends: 422 TEST_SLOT_ENDS_BEFORE_START when not after startsAt. Omitted, the end is not known.'),
}).describe('A labelled test slot for the league\'s current Season (QA only): the sync never reads or writes it, and a test event is made on it. 422 SPORT_LEAGUE_HAS_NO_SEASON for a league with no current Season.');
export type CreateTestSlotRequest = z.infer<typeof CreateTestSlotRequestSchema>;

const SportLeagueSeasonSlotResponseSchema = z.object({
  slot: SportLeagueSeasonSlotDtoSchema,
}).describe('One Season slot.');
export type SportLeagueSeasonSlotResponse = z.infer<typeof SportLeagueSeasonSlotResponseSchema>;

const SportLeagueSeasonCompetitionSlotDtoSchema = SportLeagueSeasonSlotDtoSchema.extend({
  sportEventId: z.uuid().nullable().describe('The event covering it; null while it is free, as a test slot is before its test event is made on it.'),
  takesTestEvent: z.boolean().describe('Whether a test event can be made on it now (createEvent): a free test slot of its league\'s current Season.'),
  placedByWindow: z.boolean().describe('Whether the league\'s selected provider places its games by date window (DATE_WINDOW).'),
  needsDates: z.boolean().describe('Whether it still needs its dates (#1924): placed by date window, with no window or only a tentative one, in a Season the sync reads (the current one or a later one).'),
}).describe('One slot of one Season, as its Season lists it.');
export type SportLeagueSeasonCompetitionSlotDto = z.infer<typeof SportLeagueSeasonCompetitionSlotDtoSchema>;

const SportLeagueSeasonCompetitionDtoSchema = z.object({
  id: z.uuid(),
  sportLeagueCompetitionId: z.uuid().describe('The competition definition it plays (SportLeagueCompetitionDefinitionDto).'),
  code: z.string().describe('Its definition\'s code, such as REGULAR or CFP.'),
  orderIndex: z.number().int().min(1).describe('Its definition\'s place in its phase.'),
  status: z.enum(SeasonCompetitionStatus).describe('How far it has got this Season.'),
  championParticipantId: z.uuid().nullable().describe('Who won it; null until it is COMPLETED, and always for a competition with no FINAL slot.'),
  slots: z.array(SportLeagueSeasonCompetitionSlotDtoSchema).describe('In play order: weeks by number, then the knockout rounds to the final; tournaments by start, undated ones last. A test slot follows its definition\'s synced slot.'),
  slotsNeedingDates: z.number().int().min(0).describe('How many of its slots need dates (needsDates).'),
}).describe('One competition of one Season (#2153).');

export const SportLeagueSeasonPhaseDtoSchema = z.object({
  id: z.uuid(),
  phase: z.enum(LeaguePhase),
  isSynced: z.boolean().describe('Whether the league\'s sync reads the phase. An unsynced phase has no slots.'),
  status: z.enum(SeasonCompetitionStatus).describe('How far the phase has got this Season.'),
  competitions: z.array(SportLeagueSeasonCompetitionDtoSchema).describe('By their order in the phase.'),
}).describe('One phase of one Season.');
export type SportLeagueSeasonPhaseDto = z.infer<typeof SportLeagueSeasonPhaseDtoSchema>;

export const SportLeagueSeasonDtoSchema = z.object({
  id: z.uuid(),
  name: z.string().describe('What screens call the Season, such as 2025-26 or 2026.'),
  championshipYear: z.number().int().describe('The year the Season is named for: NFL 2025 includes the Super Bowl played in February 2026; a Season split over New Year (NBA 2025-26) is its end year; a calendar-year league\'s is its year. Set by migration.'),
  startsAt: DateTimeSchema.describe('Its span\'s first moment, in the league\'s time zone.'),
  endsAt: DateTimeSchema.describe('Its span\'s last moment.'),
  isCurrent: z.boolean().describe('Whether it is the sport league\'s current Season (SportLeagueDto.currentSeasonId).'),
  providerMappings: z.array(SportLeagueSeasonProviderMappingDtoSchema).describe('Each provider\'s id for it, by provider name.'),
  phases: z.array(SportLeagueSeasonPhaseDtoSchema).describe('In the order a Season plays them: PRESEASON, REGULAR, POSTSEASON_CONFERENCE, POSTSEASON.'),
  slotsNeedingDates: z.number().int().min(0).describe('How many of its slots need dates (needsDates), across its competitions.'),
}).describe('One Season of a sport league, added by migration.');
export type SportLeagueSeasonDto = z.infer<typeof SportLeagueSeasonDtoSchema>;

export const SportLeagueSeasonListResponseSchema = z.object({
  seasons: z.array(SportLeagueSeasonDtoSchema).describe('Every Season of the sport league, latest first, never paged.'),
}).describe('A sport league\'s Seasons.');
export type SportLeagueSeasonListResponse = z.infer<typeof SportLeagueSeasonListResponseSchema>;

// --- Event page: one event's syncs, health, issues and release (#1889) ------------

export const SportEventFieldFeedRowDtoSchema = z.object({
  sportEventParticipantId: z.uuid().describe('The field row.'),
  feedId: z.string().nullable().describe('Its participant\'s provider id in the event\'s sport league; null when it has no provider mapping.'),
  lastInFeedAt: DateTimeSchema.nullable().describe('When a sync last saw its participant in the provider\'s feed; null when none has.'),
}).describe('One field row\'s place in its provider\'s feed: the Field grid\'s Last in feed column.');
export type SportEventFieldFeedRowDto = z.infer<typeof SportEventFieldFeedRowDtoSchema>;

export const SportEventOverviewDtoSchema = z.object({
  syncHealth: z.enum(SportLeagueSyncHealth).describe('By the Sports page\'s rule, from the event\'s own latest field and scores runs: OFF while its league is off or no provider syncs the event, ERROR when either run failed, NOT_RUN_YET before any, OK otherwise.'),
  syncs: z.array(SportLeagueSyncDtoSchema).describe('Its FIELD then SCORES sync, each from the event\'s own latest run of that kind; the event list sync is the league\'s. Every row OFF for an event no provider syncs.'),
  issues: z.array(SportLeagueIssueDtoSchema).describe('The event\'s own issues as its League page row has them, in the order SYNC, RELEASE, OVERDUE. Empty when none.'),
  releaseMode: z.enum(SportEventReleaseMode).describe('AUTO when its league releases synced drafts on its own and the event is synced; MANUAL otherwise.'),
  releaseAt: DateTimeSchema.nullable().describe('With releaseAtKind: when it was released (ACTUAL), or for an AUTO draft when automatic release starts trying, its start less the league\'s window (PLANNED). Null otherwise.'),
  releaseAtKind: z.enum(SportEventReleaseAtKind).nullable().describe('What releaseAt is; null with it.'),
  tierOrderBasis: z.enum(FieldOrderBasis).nullable().describe('The value that orders its active field for automatic tiers and prices: ODDS, SEED or RANKING (the first every participant has). Null while it has no active field, or no participant has any of them, so nothing is tiered or priced automatically.'),
  tierOrderCoversField: z.boolean().describe('False when no value covers the whole active field, so tierOrderBasis is the first value anyone has and those without it go last.'),
  fieldFeed: z.array(SportEventFieldFeedRowDtoSchema).describe('One per field row, active or withdrawn, never paged.'),
  eventPagePath: z.string().nullable().describe('The web address of the active event page offering the event\'s series, /play/<sport URL segment>/<page URL segment>, built by the API from the stored segments; the first by display order when several do. Null when none does.'),
}).describe('The root admin\'s Event page header and sync rows.');
export type SportEventOverviewDto = z.infer<typeof SportEventOverviewDtoSchema>;

export const SportEventOverviewResponseSchema = z.object({
  overview: SportEventOverviewDtoSchema,
}).describe('One event\'s overview.');
export type SportEventOverviewResponse = z.infer<typeof SportEventOverviewResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('SportDto', SportDtoSchema);
registerSchema('SportListResponse', SportListResponseSchema);
registerSchema('SportLeagueProviderMappingDto', SportLeagueProviderMappingDtoSchema);
registerSchema('SportLeagueDto', SportLeagueDtoSchema);
registerSchema('SportLeagueListQuery', SportLeagueListQuerySchema);
registerSchema('SportLeagueParticipantListQuery', SportLeagueParticipantListQuerySchema);
registerSchema('SportLeagueListResponse', SportLeagueListResponseSchema);
registerSchema('SportLeagueResponse', SportLeagueResponseSchema);
registerSchema('UpdateSportLeagueRequest', UpdateSportLeagueRequestSchema);
registerSchema('SportLeagueOverviewDto', SportLeagueOverviewDtoSchema);
registerSchema('SportLeagueOverviewListResponse', SportLeagueOverviewListResponseSchema);
registerSchema('SportLeagueSyncDto', SportLeagueSyncDtoSchema);
registerSchema('SportLeagueSyncListResponse', SportLeagueSyncListResponseSchema);
registerSchema('SportLeagueEventOverviewDto', SportLeagueEventOverviewDtoSchema);
registerSchema('SportLeagueEventOverviewListResponse', SportLeagueEventOverviewListResponseSchema);
registerSchema('SportEventFieldFeedRowDto', SportEventFieldFeedRowDtoSchema);
registerSchema('SportEventOverviewDto', SportEventOverviewDtoSchema);
registerSchema('SportEventOverviewResponse', SportEventOverviewResponseSchema);
registerSchema('SportLeagueParticipantOverviewDto', SportLeagueParticipantOverviewDtoSchema);
registerSchema('SportLeagueParticipantOverviewListResponse', SportLeagueParticipantOverviewListResponseSchema);
registerSchema('SportLeaguePositionProviderCodeDto', SportLeaguePositionProviderCodeDtoSchema);
registerSchema('SportLeaguePositionDto', SportLeaguePositionDtoSchema);
registerSchema('SportLeaguePositionListResponse', SportLeaguePositionListResponseSchema);
registerSchema('SlotProviderMappingDto', SlotProviderMappingDtoSchema);
registerSchema('SportLeagueSlotDefinitionDto', SportLeagueSlotDefinitionDtoSchema);
registerSchema('SportLeagueCompetitionDefinitionDto', SportLeagueCompetitionDefinitionDtoSchema);
registerSchema('SportLeaguePhaseDefinitionDto', SportLeaguePhaseDefinitionDtoSchema);
registerSchema('SportLeagueStructureResponse', SportLeagueStructureResponseSchema);
registerSchema('SportLeagueSeasonProviderMappingDto', SportLeagueSeasonProviderMappingDtoSchema);
registerSchema('SlotWindowDto', SlotWindowDtoSchema);
registerSchema('SportLeagueSeasonSlotDto', SportLeagueSeasonSlotDtoSchema);
registerSchema('SportLeagueSeasonCompetitionSlotDto', SportLeagueSeasonCompetitionSlotDtoSchema);
registerSchema('CreateTestSlotRequest', CreateTestSlotRequestSchema);
registerSchema('SportLeagueSeasonSlotResponse', SportLeagueSeasonSlotResponseSchema);
registerSchema('SportLeagueSeasonCompetitionDto', SportLeagueSeasonCompetitionDtoSchema);
registerSchema('SportLeagueSeasonPhaseDto', SportLeagueSeasonPhaseDtoSchema);
registerSchema('SportLeagueSeasonDto', SportLeagueSeasonDtoSchema);
registerSchema('SportLeagueSeasonListResponse', SportLeagueSeasonListResponseSchema);
registerSchema('SportLeagueParticipantRankingsRequest', SportLeagueParticipantRankingsRequestSchema);
registerSchema('SportLeagueRankingUploadRequest', SportLeagueRankingUploadRequestSchema);
registerSchema('UploadRowResolutionDto', UploadRowResolutionDtoSchema);
registerSchema('SportLeagueRankingUploadPreviewResponse', SportLeagueRankingUploadPreviewResponseSchema);
