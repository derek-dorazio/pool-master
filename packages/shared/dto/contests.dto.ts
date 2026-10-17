/**
 * Contest DTOs — request/response schemas for contest endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  ContestEntryStatus,
  ContestStatus,
  ContestFormat,
  ParticipantScoringDefinitionIdSchema,
  SelectionType,
  Sport,
} from '@poolmaster/shared/domain';
import { ContestConfigurationRequestSchema } from './contest-management.dto';
import { SportEventParticipantDtoSchema } from './events.dto';

// --- Requests ---

/** 400 error code when a create request names neither a template nor a configuration. */
export const CONTEST_CONFIGURATION_REQUIRED = 'CONTEST_CONFIGURATION_REQUIRED';

/**
 * One creation path with an optional first step (plans/145 slice 3, Q6b/Q9). A template seeds the
 * configuration and `configuration`, when also supplied, replaces it; a request with neither is
 * refused, because there is no platform default. OpenAPI cannot say "at least one of these two"
 * structurally, so the published shape has both optional and the rule lives in the refine below,
 * reported as CONTEST_CONFIGURATION_REQUIRED.
 */
export const CreateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).describe('Contest name shown to commissioners and members.'),
  sportEventId: z.string().uuid().describe('Sport event the contest is run on.'),
  contestFormat: z.literal(ContestFormat.ROSTER).describe(
    'First-pass contest creation supports roster contests only. Future contest formats remain cataloged in the domain validity matrix.',
  ),
  selectionType: z.nativeEnum(SelectionType).describe(
    'How an entry picks: the selection types with typed rules. It must match the template\'s selection type when a template is named, and the configuration\'s.',
  ),
  templateId: z.string().uuid().optional().describe('Template whose configuration seeds the contest. Optional: the first step of creation, not a second way to create.'),
  configuration: ContestConfigurationRequestSchema.optional().describe('The contest configuration. With a template, replaces the template\'s configuration; without one, is the configuration.'),
}).refine(
  (request) => request.templateId !== undefined || request.configuration !== undefined,
  { message: 'Name a template, supply a configuration, or both.', params: { code: CONTEST_CONFIGURATION_REQUIRED } },
).describe('Request payload for creating a contest.');
export type CreateContestRequest = z.infer<typeof CreateContestRequestSchema>;

export const UpdateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
}).describe('Patch payload for updating editable contest metadata.');
export type UpdateContestRequest = z.infer<typeof UpdateContestRequestSchema>;

export const UpdateContestEntryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional().describe('Unique entry name shown anywhere the team entry is listed.'),
  tiebreakerValue: z.number().int().nullable().optional().describe('Optional tiebreaker prediction saved on the contest entry.'),
}).refine((value) => value.name !== undefined || value.tiebreakerValue !== undefined, {
  message: 'At least one contest entry field must be provided.',
}).describe('Request payload for updating a contest entry while the contest is still joinable.');
export type UpdateContestEntryRequest = z.infer<typeof UpdateContestEntryRequestSchema>;

// --- Response Sub-schemas ---

export const ContestEventSummaryDtoSchema = z.object({
  name: z.string().describe('The sport event\'s name.'),
  startDate: z.string().datetime().describe('The sport event\'s scheduled start, which is also when entries close.'),
}).describe('The sport event a listed contest runs on: enough to name, sort and search it without reading the event.');
export type ContestEventSummaryDto = z.infer<typeof ContestEventSummaryDtoSchema>;

export const ContestDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum([
    ContestStatus.DRAFT,
    ContestStatus.OPEN,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
  ]),
  contestFormat: z.enum(Object.values(ContestFormat) as [string, ...string[]]),
  selectionType: z.nativeEnum(SelectionType),
  leagueId: z.string(),
  sportEventId: z.string().nullable().optional(),
  sport: z.nativeEnum(Sport).nullable().optional(),
  entryCount: z.number().optional().describe('Number of entries currently in the contest. Present on list reads, which count them; omitted on a single-contest read.'),
  sportEvent: ContestEventSummaryDtoSchema.nullable().optional().describe('The sport event\'s name and start. Present on list reads, null when the contest has no event; omitted on a single-contest read, whose page reads the event itself.'),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  drawnAt: z.string().datetime().nullable().optional().describe('When a random-draw contest\'s draw dealt its picks (#601). From then on its entries are closed, though it stays OPEN until its event starts. Null until then, and for every other selection type.'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).describe('A contest: the one shape every contest read returns (#248 collapsed the summary and detail variants, which differed by two fields).');
export type ContestDto = z.infer<typeof ContestDtoSchema>;

/**
 * Canonical raw-row DTO for ContestEntryPick. The persistence shape of a single
 * pick on a contest entry, unified across contest formats per plans/117 §4.3.
 * Optional metadata (period, slot, tier, cost) is populated based on the
 * parent Contest.contestFormat — see plans/117 §7.1 for the per-format mapping.
 *
 * `ContestEntryParticipantDetailDtoSchema` is the richer read shape used by
 * entry-detail and leaderboard surfaces (joins SportEventParticipant +
 * Participant for display names); this schema is the underlying pick row.
 */
export const ContestEntryPickDtoSchema = z.object({
  id: z.string().describe('Pick identifier.'),
  entryId: z.string().describe('Owning contest entry identifier.'),
  sportEventParticipantId: z.string().describe(
    'Per-event participant the pick refers to (Sport-event-participant row, not the canonical Participant).',
  ),
  contestFormat: z.enum(Object.values(ContestFormat) as [string, ...string[]]).describe(
    'Denormalized from parent Contest.contestFormat. Plans/117 §7.1 — enables per-format partial unique indexes that Postgres cannot predicate on joined parent columns.',
  ),
  period: z.number().int().nullable().describe(
    'Unused: no built contest format sets it, so it is always null. Removal is tracked in #632.',
  ),
  slot: z.number().int().nullable().describe(
    'Unused: no built contest format sets it, so it is always null; a lineup position is `lineupSlot`. Removal is tracked in #632.',
  ),
  tier: z.string().nullable().describe('Selection tier (tiered ROSTER); null otherwise.'),
  cost: z.number().nullable().describe('Budget cost (budget ROSTER); null otherwise.'),
  isAutoPicked: z.boolean().describe(
    'Whether this pick was auto-assigned rather than submitted by the entry. Always false for tiered and budget selection, which have no auto-pick.',
  ),
  lineupSlot: z.number().int().nullable().describe('Position of this pick within its entry\'s roster. Tiered: counted across tier quotas in tier order; budget: the entry\'s pick ordinal. Null when the pick was not recorded through contest selection.'),
  pickSequence: z.number().int().nullable().describe('Contest-wide order in which this pick was recorded, across all entries. Null when the pick was not recorded through contest selection.'),
  pickedAt: z.string().datetime().describe('When the pick was made (or auto-picked).'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).describe('Raw ContestEntryPick row used by persistence-aware surfaces.');
export type ContestEntryPickDto = z.infer<typeof ContestEntryPickDtoSchema>;

export const ContestEntryParticipantDetailDtoSchema = z.object({
  pickId: z.string(),
  sportEventParticipantId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  participantStatus: z.string().nullable().optional(),
  role: z.string().nullable().optional().describe('The participant\'s playing role, when known.'),
  teamAffiliation: z.string().nullable().optional(),
  pickedAt: z.string().datetime().describe('When the participant was added to the contest entry.'),
}).describe('Contest entry participant detail. Picks remain pointers to event participants; scores are returned by the contest leaderboard endpoint.');
export type ContestEntryParticipantDetailDto = z.infer<typeof ContestEntryParticipantDetailDtoSchema>;

export const ContestEntryDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  squadId: z.string(),
  squadName: z.string(),
  entryNumber: z.number().int().min(1),
  name: z.string(),
  status: z.nativeEnum(ContestEntryStatus).describe('DRAFT until the owner submits a complete lineup; only SUBMITTED entries count on the leaderboard, in standings and at settlement (#481).'),
  tiebreakerValue: z.number().int().nullable().optional(),
  picksCount: z.number().int().min(0).describe('Number of roster picks currently saved on this entry. Always populated, even when picks are hidden from non-owners.'),
  createdAt: z.string().datetime().describe('When the contest entry was created.'),
  updatedAt: z.string().datetime().describe('When the contest entry was last updated.'),
  participants: z.array(ContestEntryParticipantDetailDtoSchema).optional().describe('The entry\'s picked participants. Omitted when picks are hidden from the viewer (the contest is still DRAFT or OPEN and the viewer is not the owning squad), and on the entry writes, which return the entry without them.'),
}).describe('A contest entry: the one shape every entry read and write returns (#248 collapsed the summary and detail variants, which differed by `participants`).');
export type ContestEntryDto = z.infer<typeof ContestEntryDtoSchema>;


/**
 * The contest leaderboard (#248). Cross-sport: an entry's standing and its picks are the same
 * objects in every sport, and the sport-shaped value — golf's total against par, a race's
 * points — is the entry standing's scoring-family extension (`golf` or `race`), as on
 * `ContestEntryStanding` in persistence. The event's field is published as the event's own
 * canonical `SportEventParticipantDto` rows, not a second leaderboard-shaped copy of them: round
 * scores, race results, standings and their extensions come from there, and a client renders
 * them through `PARTICIPANT_SCORING_DEFINITIONS[scoringDefinitionId]`.
 */
export const ScoredContestEntryPickGolfDtoSchema = z.object({
  scoreToPar: z.number().int().nullable().describe('The golfer\'s score in this contest against par: their event total, with every round they did not play scored as 80 strokes (80 minus that round\'s par). Differs from the event standing\'s eventScoreToPar only when unplayedRoundNumbers is non-empty. Null while unscored.'),
  unplayedRoundNumbers: z.array(z.number().int().min(1)).describe('Rounds scored as 80 strokes because the golfer did not play them: cut, withdrawn, removed from the field, or no score once the field moved past the round. Empty when none.'),
}).describe('Golf extension of a scored pick: the golfer\'s contest score and the rounds in it scored as 80 strokes.');
export type ScoredContestEntryPickGolfDto = z.infer<typeof ScoredContestEntryPickGolfDtoSchema>;

export const ScoredContestEntryPickRaceDtoSchema = z.object({
  points: z.number().int().nullable().describe('The runner\'s points in this contest: the contest\'s points table at its finishing place (0 beyond the table), or its "did not finish" points when it did not finish, was disqualified, did not start or was scratched. Null until the race result is official.'),
}).describe('Finish-position extension of a scored pick: the runner\'s points from the contest\'s points table.');
export type ScoredContestEntryPickRaceDto = z.infer<typeof ScoredContestEntryPickRaceDtoSchema>;

export const ScoredContestEntryPickKnockoutDtoSchema = z.object({
  points: z.number().int().nullable().describe('The team\'s points in this contest: each round it won a match in scores that round\'s value, plus the upset bonus when the contest has one on. Null until the bracket has a result.'),
  wins: z.number().int().min(0).describe('Matches the team has won.'),
  upsetBonusPoints: z.number().int().min(0).describe('The part of the points that is upset bonus; 0 when the bonus is off.'),
  isAlive: z.boolean().describe('False once the team has lost a match.'),
}).describe('Head-to-head extension of a scored pick: the team\'s knockout points and how they came about.');
export type ScoredContestEntryPickKnockoutDto = z.infer<typeof ScoredContestEntryPickKnockoutDtoSchema>;

export const ScoredContestEntryPickDtoSchema = z.object({
  pickId: z.string().describe('ContestEntryPick row identifier.'),
  sportEventParticipantId: z.string().describe('The picked field row. Its scores are the matching entry of `participants`; a pick is a pointer, not a copy.'),
  pickedAt: z.string().datetime().describe('When this participant was picked.'),
  slot: z.number().int().nullable().describe('Optional roster slot from the pick row.'),
  isCounting: z.boolean().describe('Whether this pick currently counts toward the entry\'s total under the counting rule.'),
  isDropped: z.boolean().describe('Whether this scored pick is currently dropped because better picks fill the counting places.'),
  golf: ScoredContestEntryPickGolfDtoSchema.nullable().describe('Present for a golf contest; null otherwise.'),
  race: ScoredContestEntryPickRaceDtoSchema.nullable().describe('Present for a finish-position contest (a horse race); null otherwise.'),
  knockout: ScoredContestEntryPickKnockoutDtoSchema.nullable().describe('Present for a head-to-head contest (a basketball bracket); null otherwise.'),
}).describe('One pick on a contest entry, with whether it counts.');
export type ScoredContestEntryPickDto = z.infer<typeof ScoredContestEntryPickDtoSchema>;

export const ContestEntryStandingDtoSchema = z.object({
  entryId: z.string().describe('Contest entry identifier.'),
  entryName: z.string().describe('Entry display name.'),
  entryNumber: z.number().int().min(1).describe('Entry number, for squads allowed several entries.'),
  squadId: z.string().describe('Squad identifier.'),
  squadName: z.string().describe('Squad display name.'),
  status: z.nativeEnum(ContestEntryStatus).describe('Contest entry lifecycle status. Always SUBMITTED: only submitted entries are ranked.'),
  position: z.number().int().nullable().describe('The entry\'s rank in the contest, direction-free: 1 is best in every sport. Null while unscored.'),
  displayPosition: z.string().nullable().describe('Position as shown, "T" prefixed for a tie.'),
  countingPickLimit: z.number().int().min(0).describe('How many picks count toward the total under the counting rule: its N.'),
  scoredPickCount: z.number().int().min(0).describe('How many picks currently have an event standing.'),
  totalScore: z.number().int().nullable().describe('The entry\'s total, the sum of its counting picks\' contest scores, in the unit of the response\'s scoring definition (a golf to-par total, a race\'s points). Null until a pick is scored.'),
  picks: z.array(ScoredContestEntryPickDtoSchema).describe('The entry\'s picks, counting picks first.'),
}).describe('One entry\'s standing in a contest leaderboard. Each pick\'s score lives in its sport\'s block.');
export type ContestEntryStandingDto = z.infer<typeof ContestEntryStandingDtoSchema>;

export const ContestCountingRuleDtoSchema = z.object({
  type: z.literal('BEST_N').describe('Sum the best N picks\' totals for each entry.'),
  count: z.number().int().min(1).describe('N: how many picks count toward each entry\'s total.'),
}).describe('How an entry\'s picks combine into its total.');
export type ContestCountingRuleDto = z.infer<typeof ContestCountingRuleDtoSchema>;

export const ContestLeaderboardResponseSchema = z.object({
  contestId: z.string().describe('Contest whose leaderboard was requested.'),
  sportEventId: z.string().describe('Sport event the contest runs on.'),
  sport: z.nativeEnum(Sport).describe(
    'Sport of the event the contest runs on. A client resolves it through the shared sport registry to the scoring family and vocabulary it renders the leaderboard with.',
  ),
  scoringDefinitionId: ParticipantScoringDefinitionIdSchema.describe(
    'The participant scoring definition this leaderboard was ranked by. Positions are already ranked and direction-free; the id keys the client\'s own PARTICIPANT_SCORING_DEFINITIONS to render scores and rounds.',
  ),
  countingRule: ContestCountingRuleDtoSchema,
  participants: z.array(SportEventParticipantDtoSchema).describe('The event\'s field, as the event publishes it: in seed order, unseeded last. Picks point into it by sportEventParticipantId.'),
  entries: z.array(ContestEntryStandingDtoSchema).describe('Contest entries, best first.'),
  asOf: z.string().datetime().nullable().describe('Latest standing timestamp the leaderboard reflects, or null when there is none.'),
}).describe(
  'Member-facing contest leaderboard. Live, entry standings are computed from the event\'s standings; once the contest is COMPLETED they are the standings frozen at settlement.',
);
export type ContestLeaderboardResponse = z.infer<typeof ContestLeaderboardResponseSchema>;

// --- Responses ---

export const ContestResponseSchema = z.object({
  contest: ContestDtoSchema,
}).describe('Single-contest response. A contest\'s rules are on the contest-management read (commissioners) and the selection-state read (entries).');
export type ContestResponse = z.infer<typeof ContestResponseSchema>;

export const ContestListResponseSchema = z.object({
  contests: z.array(ContestDtoSchema),
}).describe('Contest-list response.');
export type ContestListResponse = z.infer<typeof ContestListResponseSchema>;

export const ContestEntryResponseSchema = z.object({
  contestId: z.string().describe('Contest that owns the entry.'),
  entry: ContestEntryDtoSchema,
}).describe('Single contest-entry response.');
export type ContestEntryResponse = z.infer<typeof ContestEntryResponseSchema>;

export const ContestEntryDetailResponseSchema = z.object({
  contestId: z.string().describe('Contest that owns the entry.'),
  picksRevealed: z.boolean().describe('Whether participant picks are visible to non-owners on this entry. False when contest is still DRAFT or OPEN (pre-event-start). True once the contest has progressed past the joinable phase.'),
  entry: ContestEntryDtoSchema,
}).describe('Expanded contest-entry detail response.');
export type ContestEntryDetailResponse = z.infer<typeof ContestEntryDetailResponseSchema>;

export const ContestEntryListResponseSchema = z.object({
  contestId: z.string().describe('Contest whose entries are being returned.'),
  total: z.number().describe('Total number of entries in the contest.'),
  isJoined: z.boolean().describe('Whether the current user has at least one active entry in the contest.'),
  myEntryId: z.string().nullable().describe('Primary current-user entry when the contest allows a single active entry.'),
  myEntryIds: z.array(z.string()).optional().describe('All current-user entry identifiers when multiple entries are allowed.'),
  picksRevealed: z.boolean().describe('Whether participant picks are visible to non-owners on this contest. False when contest is still DRAFT or OPEN (pre-event-start). True once the contest has progressed past the joinable phase.'),
  entries: z.array(ContestEntryDtoSchema).describe('Entries for the contest. Each entry includes participants[] when picksRevealed is true (or when the entry belongs to the requester regardless of contest status); otherwise participants is omitted.'),
}).describe('Contest-entry list response.');
export type ContestEntryListResponse = z.infer<typeof ContestEntryListResponseSchema>;

export const ContestEntryDeletionResponseSchema = z.object({
  contestId: z.string().describe('Contest from which the entry was removed.'),
  deleted: z.literal(true).describe('Confirms that the delete operation succeeded.'),
}).describe('Contest-entry deletion response.');
export type ContestEntryDeletionResponse = z.infer<typeof ContestEntryDeletionResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// Each name becomes `components.schemas.<name>` and an importable generated type.
// The frontend imports these; it must not re-derive a shape from a response map.
registerSchema('CreateContestRequest', CreateContestRequestSchema);
registerSchema('UpdateContestRequest', UpdateContestRequestSchema);
registerSchema('UpdateContestEntryRequest', UpdateContestEntryRequestSchema);
registerSchema('ContestEventSummaryDto', ContestEventSummaryDtoSchema);
registerSchema('ContestDto', ContestDtoSchema);
registerSchema('ContestEntryDto', ContestEntryDtoSchema);
registerSchema('ContestEntryPickDto', ContestEntryPickDtoSchema);
registerSchema('ContestEntryParticipantDetailDto', ContestEntryParticipantDetailDtoSchema);
registerSchema('ParticipantScoringDefinitionId', ParticipantScoringDefinitionIdSchema);
registerSchema('ScoredContestEntryPickGolfDto', ScoredContestEntryPickGolfDtoSchema);
registerSchema('ScoredContestEntryPickDto', ScoredContestEntryPickDtoSchema);
registerSchema('ContestEntryStandingDto', ContestEntryStandingDtoSchema);
registerSchema('ContestCountingRuleDto', ContestCountingRuleDtoSchema);
registerSchema('ContestLeaderboardResponse', ContestLeaderboardResponseSchema);
registerSchema('ContestResponse', ContestResponseSchema);
registerSchema('ContestListResponse', ContestListResponseSchema);
registerSchema('ContestEntryResponse', ContestEntryResponseSchema);
registerSchema('ContestEntryDetailResponse', ContestEntryDetailResponseSchema);
registerSchema('ContestEntryListResponse', ContestEntryListResponseSchema);
registerSchema('ContestEntryDeletionResponse', ContestEntryDeletionResponseSchema);
