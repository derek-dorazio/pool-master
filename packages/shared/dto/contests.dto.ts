/**
 * Contest DTOs — request/response schemas for contest endpoints.
 */
import { z } from 'zod';
import {
  ContestStatus,
  ContestType,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import { JsonObjectSchema } from './common.dto';
import { LeagueAuditEntryDtoSchema, type LeagueAuditEntryDto } from './leagues.dto';
import {
  GolfCategoryDefinitionSchema,
  GolfContestTierSchema,
  GolfFixedCutRuleSchema,
  GolfTiebreakerSchema,
} from './contest-management.dto';

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
  autoPickPolicy: z.string().optional(),
  tierConfig: z.array(TierDefinitionRequestSchema).optional(),
  tierAssignmentMethod: z.string().optional(),
  budget: z.number().optional(),
  pricingMethod: z.string().optional(),
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

export const CreateContestRequestSchema = z.object({
  name: z.string().min(1).max(100),
  eventId: z.string().optional(),
  contestType: z.enum([ContestType.SINGLE_EVENT]),
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
  ]),
  contestConfiguration: ContestCrudConfigurationRequestSchema.optional(),
  scoringEngine: z.enum([
    ScoringEngine.ADVANCEMENT,
    ScoringEngine.STAT_ACCUMULATION,
    ScoringEngine.STROKE_PLAY,
    ScoringEngine.POSITION,
    ScoringEngine.BRACKET,
    ScoringEngine.FIGHT_RESULT,
    ScoringEngine.CUMULATIVE,
  ]),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  lockAt: z.string().datetime().optional(),
  isExclusive: z.boolean().optional(),
  scoringStopsOnElimination: z.boolean().optional().describe('Whether eliminated entries stop accumulating score events.'),
}).describe('Request payload for creating a contest.');
export type CreateContestRequest = z.infer<typeof CreateContestRequestSchema>;

export const UpdateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  lockAt: z.string().datetime().optional(),
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

export const UndoContestDraftSelectionRequestSchema = z.object({
  pickId: z.string().describe('Draft pick to undo.'),
  reason: z.string().describe('Commissioner reason recorded for the undo action.'),
}).describe('Commissioner request payload for undoing a contest draft selection.');
export type UndoContestDraftSelectionRequest = z.infer<typeof UndoContestDraftSelectionRequestSchema>;

export const PauseContestDraftRequestSchema = z.object({
  reason: z.string().describe('Reason recorded for pausing the draft.'),
}).describe('Commissioner request payload for pausing a draft.');
export type PauseContestDraftRequest = z.infer<typeof PauseContestDraftRequestSchema>;

export const ExtendPickClockRequestSchema = z.object({
  additionalSeconds: z.number().int().min(1).describe('How many seconds to add to the current draft pick clock.'),
}).describe('Commissioner request payload for extending the current draft turn.');
export type ExtendPickClockRequest = z.infer<typeof ExtendPickClockRequestSchema>;

export const AdjustContestScoreRequestSchema = z.object({
  entryId: z.string().describe('Entry whose score should be adjusted.'),
  adjustment: z.number().describe('Positive or negative manual score adjustment.'),
  reason: z.string().describe('Reason recorded in audit history for the score adjustment.'),
}).describe('Admin or commissioner score-adjustment request.');
export type AdjustContestScoreRequest = z.infer<typeof AdjustContestScoreRequestSchema>;

export const ReopenContestRequestSchema = z.object({
  reason: z.string().describe('Reason recorded for reopening the contest.'),
}).describe('Request payload for reopening a closed contest.');
export type ReopenContestRequest = z.infer<typeof ReopenContestRequestSchema>;

export const CloseContestRequestSchema = z.object({
  reason: z.string().describe('Reason recorded for closing the contest.'),
}).describe('Request payload for force-closing a contest.');
export type CloseContestRequest = z.infer<typeof CloseContestRequestSchema>;

export const ExtendContestDeadlineRequestSchema = z.object({
  newEnd: z.string().datetime().describe('Replacement contest end timestamp.'),
  reason: z.string().describe('Reason recorded for the deadline extension.'),
}).describe('Request payload for extending a contest end time.');
export type ExtendContestDeadlineRequest = z.infer<typeof ExtendContestDeadlineRequestSchema>;

export const UpdateContestLockTimeRequestSchema = z.object({
  newLock: z.string().datetime().describe('Replacement contest lock timestamp.'),
  reason: z.string().describe('Reason recorded for changing the lock time.'),
}).describe('Request payload for updating a contest lock time.');
export type UpdateContestLockTimeRequest = z.infer<typeof UpdateContestLockTimeRequestSchema>;

// --- Response Sub-schemas ---

export const ContestSummaryDtoSchema = z.object({
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
  contestType: z.enum([ContestType.SINGLE_EVENT]),
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
  entryCount: z.number().optional().describe('Number of entries currently in the contest.'),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).describe('Contest list item used in contest indexes and league home summaries.');
export type ContestSummaryDto = z.infer<typeof ContestSummaryDtoSchema>;

export const ContestDetailDtoSchema = ContestSummaryDtoSchema.extend({
  lockAt: z.string().datetime().nullable().optional(),
  isExclusive: z.boolean().optional(),
  sport: z.string().nullable().optional(),
}).describe('Contest detail returned by contest detail endpoints.');
export type ContestDetailDto = z.infer<typeof ContestDetailDtoSchema>;

export const ContestEntryDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  squadId: z.string(),
  squadName: z.string(),
  entryNumber: z.number().int().min(1),
  name: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  tiebreakerValue: z.number().int().nullable().optional(),
  totalScore: z.number(),
  standingsPosition: z.number().nullable().optional(),
  isEliminated: z.boolean(),
  picksCount: z.number().int().min(0).describe('Number of roster picks currently saved on this entry. Always populated, even when picks are hidden from non-owners.'),
  createdAt: z.string().datetime().describe('When the contest entry was created.'),
  updatedAt: z.string().datetime().describe('When the contest entry was last updated.'),
}).describe('Contest entry summary.');
export type ContestEntryDto = z.infer<typeof ContestEntryDtoSchema>;

export const ContestEntryParticipantDetailDtoSchema = z.object({
  pickId: z.string(),
  sportEventParticipantId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  participantStatus: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  teamAffiliation: z.string().nullable().optional(),
  contestPoints: z.number().describe('Current points earned within the contest for this picked participant.'),
  pickedAt: z.string().datetime().describe('When the participant was added to the contest entry.'),
  latestPerformance: JsonObjectSchema.describe('Latest provider-backed performance snapshot available for the picked participant.'),
}).describe('Contest entry participant detail used by entry-detail and expanded leaderboard surfaces.');
export type ContestEntryParticipantDetailDto = z.infer<typeof ContestEntryParticipantDetailDtoSchema>;

export const ContestEntryDetailDtoSchema = ContestEntryDtoSchema.extend({
  participants: z.array(ContestEntryParticipantDetailDtoSchema).optional().describe('Current picked participants for the contest entry. Omitted when picks are hidden from non-owners (contest still in DRAFT or OPEN status and viewer is not the owning squad).'),
}).describe('Expanded contest entry detail.');
export type ContestEntryDetailDto = z.infer<typeof ContestEntryDetailDtoSchema>;

// --- Responses ---

const nullablePositiveIntSchema = z
  .number()
  .int()
  .min(1)
  .nullable()
  .optional()
  .describe('Maximum entries a Team may create. Null means unlimited.');

export const ContestConfigurationDetailDtoSchema = ContestCrudConfigurationRequestSchema.extend({
  mode: z.string().optional().describe('Optional typed configuration mode for golf-first managed contests.'),
  locksAt: z.string().datetime().nullable().optional().describe('Contest entry lock timestamp stored on the contest configuration record.'),
  maxEntriesPerSquad: nullablePositiveIntSchema,
  countedScores: z.number().int().optional().describe('How many roster scores count toward the entry total in managed golf contests.'),
  tierSource: z.string().optional().describe('Tier source used for managed golf contests.'),
  tierGeneration: z.object({
    defaultTierSize: z.number().int().min(1).describe('Default managed tier size used to seed tier generation.'),
  }).optional(),
  tiers: z.array(GolfContestTierSchema).optional().describe('Resolved managed-golf tier definitions when the contest stores typed tiered configuration.'),
  cutRule: GolfFixedCutRuleSchema.optional().describe('Managed-golf missed-cut scoring rule when the contest uses typed golf configuration.'),
  playoffHandling: z.string().optional().describe('Managed-golf playoff handling strategy.'),
  displayScoring: z.string().optional().describe('Managed-golf leaderboard display scoring mode.'),
  tiebreaker: GolfTiebreakerSchema.optional().describe('Managed-golf tiebreaker configuration.'),
  categories: z.array(GolfCategoryDefinitionSchema).optional().describe('Managed-golf category slot definitions when the contest uses category picks.'),
}).describe(
  'Typed contest configuration returned by contest detail endpoints. Use this shape for client-side entry-cap and contest-behavior decisions instead of treating contestConfiguration as an untyped blob.',
);
export type ContestConfigurationDetailDto = z.infer<typeof ContestConfigurationDetailDtoSchema>;

export const ContestResponseSchema = z.object({
  contest: ContestDetailDtoSchema,
  contestConfiguration: ContestConfigurationDetailDtoSchema.nullable().optional().describe(
    'Typed contest configuration payload used by contest detail, My Entries, and Manage Contest surfaces.',
  ),
}).describe('Single-contest response.');
export type ContestResponse = z.infer<typeof ContestResponseSchema>;

export const ContestListResponseSchema = z.object({
  contests: z.array(ContestSummaryDtoSchema),
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
  entry: ContestEntryDetailDtoSchema,
}).describe('Expanded contest-entry detail response.');
export type ContestEntryDetailResponse = z.infer<typeof ContestEntryDetailResponseSchema>;

export const ContestEntryListResponseSchema = z.object({
  contestId: z.string().describe('Contest whose entries are being returned.'),
  total: z.number().describe('Total number of entries in the contest.'),
  isJoined: z.boolean().describe('Whether the current user has at least one active entry in the contest.'),
  myEntryId: z.string().nullable().describe('Primary current-user entry when the contest allows a single active entry.'),
  myEntryIds: z.array(z.string()).optional().describe('All current-user entry identifiers when multiple entries are allowed.'),
  picksRevealed: z.boolean().describe('Whether participant picks are visible to non-owners on this contest. False when contest is still DRAFT or OPEN (pre-event-start). True once the contest has progressed past the joinable phase.'),
  entries: z.array(ContestEntryDetailDtoSchema).describe('Entries for the contest. Each entry includes participants[] when picksRevealed is true (or when the entry belongs to the requester regardless of contest status); otherwise participants is omitted.'),
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

export const ContestRecalculationResponseSchema = z.object({
  contestId: z.string().describe('Contest that was recalculated.'),
  teamsAffected: z.number().describe('How many entries were affected by the recalculation.'),
  standingsChanged: z.boolean().describe('Whether the recalculation changed at least one rank or score.'),
  changes: z.array(
    z.object({
      entryId: z.string(),
      oldRank: z.number(),
      newRank: z.number(),
      oldScore: z.number(),
      newScore: z.number(),
    }),
  ).describe('Per-entry changes produced by the recalculation.'),
}).describe('Contest recalculation result.');
export type ContestRecalculationResponse = z.infer<typeof ContestRecalculationResponseSchema>;

export const ContestStandingsRecalculationResponseSchema =
  ContestRecalculationResponseSchema;

// Per pool-master-rop.14.1: the audit-log entry shape is identical for league
// and contest scopes — both endpoints query the same `commissionerAuditLog`
// table via `AuditService` and emit the same `AuditLogEntry` interface. The
// previous duplication (this schema diverged from `LeagueAuditEntryDtoSchema`
// with `category: z.string()` and slightly different optionality) was a
// contract-drift hazard. Aliased to the canonical schema in `leagues.dto.ts`
// so both endpoints stay type-aligned and the same `mapLeagueAuditEntryToDto`
// mapper serves both route handlers.
export const ContestAuditLogEntryDtoSchema = LeagueAuditEntryDtoSchema;
export type ContestAuditLogEntryDto = LeagueAuditEntryDto;

export const ContestAuditLogResponseSchema = z.object({
  entries: z.array(ContestAuditLogEntryDtoSchema),
}).describe('Contest audit-log response.');
export type ContestAuditLogResponse = z.infer<typeof ContestAuditLogResponseSchema>;
