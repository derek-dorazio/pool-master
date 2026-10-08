/**
 * Contest DTOs — request/response schemas for contest endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  AutoPickPolicy,
  ContestEntryStatus,
  ContestStatus,
  ContestFormat,
  ParticipantScoringDefinitionIdSchema,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import { ContestConfigurationRequestSchema } from './contest-management.dto';
import { SportEventParticipantDtoSchema } from './events.dto';

// --- Requests ---

export const TierDefinitionRequestSchema = z.object({
  tierId: z.string().describe('Stable tier identifier.'),
  tierName: z.string().describe('Tier label shown in commissioner and draft UI.'),
  tierNumber: z.number().int().describe('Tier order number.'),
  picksFromTier: z.number().int().describe('How many picks each entry must make from the tier.'),
  rankingRange: z.tuple([z.number(), z.number()]).optional().describe('Optional ranking range that produced the tier.'),
  priceRange: z.tuple([z.number(), z.number()]).optional().describe('Optional pricing range that produced the tier.'),
  maxParticipants: z.number().int().optional().describe('Optional cap on how many participants can live in the tier.'),
  participantIds: z.array(z.string()).describe('Participants assigned to the tier.'),
}).describe('Tier definition used in contest create and update flows.');

export const ContestCrudConfigurationRequestSchema = z.object({
  draftMode: z.string().optional(),
  rounds: z.number().int().optional(),
  timePerPickSeconds: z.number().int().optional(),
  autoPickPolicy: z.nativeEnum(AutoPickPolicy).optional(),
  tierConfig: z.array(TierDefinitionRequestSchema).optional(),
  budget: z.number().optional(),
  rosterSize: z.number().int().optional(),
  pickCount: z.number().int().optional(),
  picksPerPeriod: z.number().int().optional(),
  roundValues: z.array(z.number()).optional(),
  startRound: z.string().optional(),
  isExclusive: z.boolean().optional(),
  bestBallN: z.number().int().optional(),
  missedCutPenalty: z.number().optional(),
  captainSlot: z.boolean().optional(),
  captainMultiplier: z.number().optional(),
}).describe('Contest-configuration payload used by contest create and update endpoints.');

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
  selectionType: z.literal(SelectionType.TIERED).describe(
    'How an entry picks. Tiered only until another selection type has a typed configuration (budget #93, category #99); it must match the template\'s selection type when a template is named.',
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
  isExclusive: z.boolean().optional().describe('Whether the contest should continue to enforce exclusive picks.'),
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

export const ContestDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum([
    ContestStatus.DRAFT,
    ContestStatus.OPEN,
    ContestStatus.DRAFTING,
    ContestStatus.LOCKED,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
    ContestStatus.CANCELLED,
  ]),
  contestFormat: z.enum(Object.values(ContestFormat) as [string, ...string[]]),
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
    SelectionType.OPEN_SELECTION,
    SelectionType.PICK_EM,
    SelectionType.BRACKET_PICK_EM,
  ]),
  scoringEngine: z.enum([
    ScoringEngine.ADVANCEMENT,
    ScoringEngine.STAT_ACCUMULATION,
    ScoringEngine.STROKE_PLAY,
    ScoringEngine.POSITION,
    ScoringEngine.BRACKET,
    ScoringEngine.FIGHT_RESULT,
    ScoringEngine.CUMULATIVE,
  ]),
  leagueId: z.string(),
  sportEventId: z.string().nullable().optional(),
  sport: z.string().nullable().optional(),
  entryCount: z.number().optional().describe('Number of entries currently in the contest. Present on list reads, which count them; omitted on a single-contest read.'),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isExclusive: z.boolean().describe('Whether a participant may be picked by only one entry in the contest.'),
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
    'Per-format period: week (SURVIVOR), draft round (BRACKET), or omitted (ROSTER). Plans/117 §7.1.',
  ),
  slot: z.number().int().nullable().describe(
    'Per-format slot: matchup index (BRACKET), confidence rank (PICKEM_CONFIDENCE), predicted position (PREDICT_TOP_N), or omitted (ROSTER, SURVIVOR). Plans/117 §7.1.',
  ),
  tier: z.string().nullable().describe('Selection tier (tiered ROSTER); null otherwise.'),
  cost: z.number().nullable().describe('Budget cost (budget ROSTER); null otherwise.'),
  isAutoPicked: z.boolean().describe(
    'Whether this pick was auto-assigned rather than submitted by the entry. Always false for tiered and budget selection, which have no auto-pick.',
  ),
  draftRound: z.number().int().nullable().describe('Position of this pick within its entry\'s roster. Tiered: counted across tier quotas in tier order; budget: the entry\'s pick ordinal. Null when the pick was not recorded through contest selection.'),
  draftPickNumber: z.number().int().nullable().describe('Contest-wide order in which this pick was recorded, across all entries. Null when the pick was not recorded through contest selection.'),
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
}).describe('Contest entry participant detail. Picks remain pointers to event participants; Golf scoring data is returned by the Golf leaderboard endpoint.');
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
  isEliminated: z.boolean(),
  picksCount: z.number().int().min(0).describe('Number of roster picks currently saved on this entry. Always populated, even when picks are hidden from non-owners.'),
  createdAt: z.string().datetime().describe('When the contest entry was created.'),
  updatedAt: z.string().datetime().describe('When the contest entry was last updated.'),
  participants: z.array(ContestEntryParticipantDetailDtoSchema).optional().describe('The entry\'s picked participants. Omitted when picks are hidden from the viewer (the contest is still DRAFT or OPEN and the viewer is not the owning squad), and on the entry writes, which return the entry without them.'),
}).describe('A contest entry: the one shape every entry read and write returns (#248 collapsed the summary and detail variants, which differed by `participants`).');
export type ContestEntryDto = z.infer<typeof ContestEntryDtoSchema>;


/**
 * The contest leaderboard (#248). Cross-sport: an entry's standing and its picks are the same
 * objects in every sport, and the one sport-shaped value — golf's total against par — is the
 * entry standing's golf extension, as on `ContestEntryStanding` in persistence. The event's
 * field is published as the event's own canonical `SportEventParticipantDto` rows, not a second
 * leaderboard-shaped copy of them: round scores, standings and their golf extensions come from
 * there, and a client renders them through `PARTICIPANT_SCORING_DEFINITIONS[scoringDefinitionId]`.
 */
export const ScoredContestEntryPickDtoSchema = z.object({
  pickId: z.string().describe('ContestEntryPick row identifier.'),
  sportEventParticipantId: z.string().describe('The picked field row. Its scores are the matching entry of `participants`; a pick is a pointer, not a copy.'),
  pickedAt: z.string().datetime().describe('When this participant was picked.'),
  slot: z.number().int().nullable().describe('Optional roster slot from the pick row.'),
  isCounting: z.boolean().describe('Whether this pick currently counts toward the entry\'s total under the counting rule.'),
  isDropped: z.boolean().describe('Whether this scored pick is currently dropped because better picks fill the counting places.'),
}).describe('One pick on a contest entry, with whether it counts.');
export type ScoredContestEntryPickDto = z.infer<typeof ScoredContestEntryPickDtoSchema>;

export const ContestEntryGolfStandingDtoSchema = z.object({
  totalScoreToPar: z.number().int().nullable().describe('The entry\'s total against par: the sum of its counting picks\' event totals. Null until a pick is scored.'),
}).describe('Golf extension of a contest entry standing: the total its position was ranked from.');
export type ContestEntryGolfStandingDto = z.infer<typeof ContestEntryGolfStandingDtoSchema>;

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
  golf: ContestEntryGolfStandingDtoSchema.nullable().describe('Present for a golf contest; null otherwise.'),
  picks: z.array(ScoredContestEntryPickDtoSchema).describe('The entry\'s picks, counting picks first.'),
}).describe('One entry\'s standing in a contest leaderboard. The score lives in the sport\'s extension.');
export type ContestEntryStandingDto = z.infer<typeof ContestEntryStandingDtoSchema>;

export const ContestCountingRuleDtoSchema = z.object({
  type: z.literal('BEST_N_GOLFERS').describe('Sum the best N picks\' totals for each entry.'),
  count: z.number().int().min(1).describe('N: how many picks count toward each entry\'s total.'),
}).describe('How an entry\'s picks combine into its total.');
export type ContestCountingRuleDto = z.infer<typeof ContestCountingRuleDtoSchema>;

export const ContestLeaderboardResponseSchema = z.object({
  contestId: z.string().describe('Contest whose leaderboard was requested.'),
  sportEventId: z.string().describe('Sport event the contest runs on.'),
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

const nullablePositiveIntSchema = z
  .number()
  .int()
  .min(1)
  .nullable()
  .optional()
  .describe('Maximum entries a Team may create. Null means unlimited.');

export const ContestConfigurationDetailDtoSchema = ContestCrudConfigurationRequestSchema.extend({
  maxEntriesPerSquad: nullablePositiveIntSchema,
  picksPerTier: z.number().int().optional().describe("How many golfers an entry picks from each of the event's tiers in managed tiered golf contests."),
  countedScores: z.number().int().optional().describe('How many roster scores count toward the entry total in managed golf contests.'),
}).describe(
  'Typed contest configuration returned by contest detail endpoints. Use this shape for client-side entry-cap and contest-behavior decisions instead of treating contestConfiguration as an untyped blob.',
);
export type ContestConfigurationDetailDto = z.infer<typeof ContestConfigurationDetailDtoSchema>;

export const ContestResponseSchema = z.object({
  contest: ContestDtoSchema,
  contestConfiguration: ContestConfigurationDetailDtoSchema.nullable().optional().describe(
    'Typed contest configuration payload used by contest detail, My Entries, and Manage Contest surfaces.',
  ),
}).describe('Single-contest response.');
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

export const MyContestEntryResponseSchema = z.object({
  contestId: z.string().describe('Contest being queried.'),
  entry: ContestEntryDtoSchema.nullable().describe('Current user entry, or null when the user has not joined the contest.'),
}).describe('Current-user contest-entry response.');
export type MyContestEntryResponse = z.infer<typeof MyContestEntryResponseSchema>;

export const ContestEntryDeletionResponseSchema = z.object({
  contestId: z.string().describe('Contest from which the entry was removed.'),
  deleted: z.literal(true).describe('Confirms that the delete operation succeeded.'),
}).describe('Contest-entry deletion response.');
export type ContestEntryDeletionResponse = z.infer<typeof ContestEntryDeletionResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// Each name becomes `components.schemas.<name>` and an importable generated type.
// The frontend imports these; it must not re-derive a shape from a response map.
registerSchema('TierDefinitionRequest', TierDefinitionRequestSchema);
registerSchema('ContestCrudConfigurationRequest', ContestCrudConfigurationRequestSchema);
registerSchema('CreateContestRequest', CreateContestRequestSchema);
registerSchema('UpdateContestRequest', UpdateContestRequestSchema);
registerSchema('UpdateContestEntryRequest', UpdateContestEntryRequestSchema);
registerSchema('ContestDto', ContestDtoSchema);
registerSchema('ContestEntryDto', ContestEntryDtoSchema);
registerSchema('ContestEntryPickDto', ContestEntryPickDtoSchema);
registerSchema('ContestEntryParticipantDetailDto', ContestEntryParticipantDetailDtoSchema);
registerSchema('ParticipantScoringDefinitionId', ParticipantScoringDefinitionIdSchema);
registerSchema('ScoredContestEntryPickDto', ScoredContestEntryPickDtoSchema);
registerSchema('ContestEntryGolfStandingDto', ContestEntryGolfStandingDtoSchema);
registerSchema('ContestEntryStandingDto', ContestEntryStandingDtoSchema);
registerSchema('ContestCountingRuleDto', ContestCountingRuleDtoSchema);
registerSchema('ContestLeaderboardResponse', ContestLeaderboardResponseSchema);
registerSchema('ContestConfigurationDetailDto', ContestConfigurationDetailDtoSchema);
registerSchema('ContestResponse', ContestResponseSchema);
registerSchema('ContestListResponse', ContestListResponseSchema);
registerSchema('ContestEntryResponse', ContestEntryResponseSchema);
registerSchema('ContestEntryDetailResponse', ContestEntryDetailResponseSchema);
registerSchema('ContestEntryListResponse', ContestEntryListResponseSchema);
registerSchema('MyContestEntryResponse', MyContestEntryResponseSchema);
registerSchema('ContestEntryDeletionResponse', ContestEntryDeletionResponseSchema);
