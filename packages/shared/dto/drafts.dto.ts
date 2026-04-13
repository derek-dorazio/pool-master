/**
 * Draft DTOs — request/response schemas for draft endpoints.
 */
import { z } from 'zod';
import { DraftStatus, SelectionType } from '../domain/enums';

// --- Requests ---

export const StartDraftRequestSchema = z.object({
  entryIds: z.array(z.string()).min(2).describe('Entries that should participate in the draft.'),
  rounds: z.number().int().min(1).max(30).optional().describe('Optional total number of draft rounds.'),
  timePerPickSeconds: z.number().int().min(10).max(86400).optional().describe('Seconds allowed per turn in a turn-based draft.'),
  availableParticipantIds: z.array(z.string()).min(1).optional().describe('Optional participant pool restriction for the draft.'),
  autoPickPolicy: z.enum(['QUEUE_THEN_BEST', 'BEST_AVAILABLE', 'RANDOM']).optional().describe('Fallback policy used when the clock expires.'),
}).describe('Request payload for starting a draft.');
export type StartDraftRequest = z.infer<typeof StartDraftRequestSchema>;

export const SubmitPickRequestSchema = z.object({
  entryId: z.string().describe('Entry making the pick.'),
  participantId: z.string().describe('Participant being selected.'),
}).describe('Request payload for submitting a draft pick.');
export type SubmitPickRequest = z.infer<typeof SubmitPickRequestSchema>;

export const ExtendCurrentTurnRequestSchema = z.object({
  additionalSeconds: z.number().int().min(1).max(3600).describe('How many seconds to add to the current draft turn.'),
}).describe('Commissioner request payload for extending the active draft turn.');
export type ExtendCurrentTurnRequest = z.infer<typeof ExtendCurrentTurnRequestSchema>;

// --- Response Sub-schemas ---

export const DraftPickHistoryDtoSchema = z.object({
  pickNumber: z.number(),
  round: z.number(),
  pickInRound: z.number(),
  entryId: z.string(),
  entryName: z.string(),
  participantId: z.string().nullable(),
  participantName: z.string().nullable(),
  position: z.string().optional(),
  team: z.string().optional(),
  price: z.number().optional(),
  tierId: z.string().optional(),
  tierName: z.string().optional(),
  autoPicked: z.boolean(),
  isSkipped: z.boolean().optional(),
  pickedAt: z.string().datetime().describe('When the pick was made or skipped.'),
}).describe('Historical draft pick row shown in draft-room history.');
export type DraftPickHistoryDto = z.infer<typeof DraftPickHistoryDtoSchema>;

export const DraftEntryDtoSchema = z.object({
  id: z.string().describe('Entry identifier.'),
  userId: z.string().describe('User that owns the entry.'),
  name: z.string().describe('Entry display name.'),
  isOnClock: z.boolean().describe('Whether the entry currently has the active turn.'),
}).describe('Draft entry summary.');
export type DraftEntryDto = z.infer<typeof DraftEntryDtoSchema>;

export const DraftTierConfigDtoSchema = z.object({
  tierId: z.string(),
  tierName: z.string(),
  tierNumber: z.number(),
  picksFromTier: z.number(),
}).describe('Tier definition displayed within a draft room.');
export type DraftTierConfigDto = z.infer<typeof DraftTierConfigDtoSchema>;

export const DraftContestConfigurationDtoSchema = z.object({
  isExclusive: z.boolean(),
  rounds: z.number().optional(),
  pickCount: z.number().optional(),
  rosterSize: z.number().optional(),
  budget: z.number().optional(),
  pricingMethod: z.string().optional(),
  timePerPickSeconds: z.number().optional(),
  picksPerPeriod: z.number().optional(),
  roundValues: z.array(z.number()).optional(),
  startRound: z.string().optional(),
  tierConfig: z.array(DraftTierConfigDtoSchema).optional().describe('Tier configuration when the contest uses tiered selection.'),
}).describe('Contest-configuration subset required by draft-room clients.');
export type DraftContestConfigurationDto = z.infer<typeof DraftContestConfigurationDtoSchema>;

export const DraftPickEmEventDtoSchema = z.object({
  id: z.string(),
  eventId: z.string().nullable(),
  period: z.number(),
  matchupIndex: z.number(),
  homeParticipantId: z.string().nullable(),
  homeParticipantName: z.string().nullable(),
  awayParticipantId: z.string().nullable(),
  awayParticipantName: z.string().nullable(),
  eventTime: z.string().datetime().nullable(),
  deadline: z.string().datetime().nullable(),
  isLocked: z.boolean(),
  myPickParticipantId: z.string().nullable(),
  confidenceWeight: z.number().nullable(),
  label: z.string().nullable().describe('Optional label used for compact pick-em presentation.'),
}).describe('Pick-em event row surfaced in draft-style pick flows.');
export type DraftPickEmEventDto = z.infer<typeof DraftPickEmEventDtoSchema>;

export const DraftBracketTeamDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number().nullable(),
}).describe('Minimal team identity used in bracket pick-em draft payloads.');
export type DraftBracketTeamDto = z.infer<typeof DraftBracketTeamDtoSchema>;

export const DraftBracketMatchupDtoSchema = z.object({
  id: z.string(),
  roundNumber: z.number(),
  matchNumber: z.number(),
  label: z.string().nullable(),
  isLocked: z.boolean(),
  topTeam: DraftBracketTeamDtoSchema.nullable(),
  bottomTeam: DraftBracketTeamDtoSchema.nullable(),
  winnerId: z.string().nullable().describe('Winning team identifier when the matchup has been decided.'),
}).describe('Bracket matchup returned to bracket-style pick clients.');
export type DraftBracketMatchupDto = z.infer<typeof DraftBracketMatchupDtoSchema>;

export const DraftStateDtoSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
    SelectionType.OPEN_SELECTION,
    SelectionType.PICK_EM,
    SelectionType.BRACKET_PICK_EM,
  ]),
  isTurnBased: z.boolean(),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  contestConfiguration: DraftContestConfigurationDtoSchema.nullable().optional(),
  status: z.enum([
    DraftStatus.PENDING,
    DraftStatus.LIVE,
    DraftStatus.PAUSED,
    DraftStatus.COMPLETE,
  ]),
  currentPickNumber: z.number(),
  currentRound: z.number(),
  totalPicks: z.number(),
  totalRounds: z.number(),
  currentEntryId: z.string().nullable(),
  currentEntryName: z.string().nullable(),
  myEntryId: z.string().nullable(),
  isMyPick: z.boolean(),
  timePerPickSeconds: z.number(),
  currentTurnStartedAt: z.string().datetime().nullable(),
  availableParticipantIds: z.array(z.string()),
  draftPickHistories: z.array(DraftPickHistoryDtoSchema),
  entries: z.array(DraftEntryDtoSchema),
  pickEmEvents: z.array(DraftPickEmEventDtoSchema).optional(),
  bracketMatchups: z.array(DraftBracketMatchupDtoSchema).optional().describe('Bracket pick data when the contest uses a bracket selection mode.'),
}).describe('Canonical draft state shape used internally and by some draft responses.');
export type DraftStateDto = z.infer<typeof DraftStateDtoSchema>;

// --- Responses ---

export const DraftStateResponseSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
    SelectionType.OPEN_SELECTION,
    SelectionType.PICK_EM,
    SelectionType.BRACKET_PICK_EM,
  ]),
  isTurnBased: z.boolean(),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  contestConfiguration: DraftContestConfigurationDtoSchema.nullable().optional(),
  status: z.enum([
    DraftStatus.PENDING,
    DraftStatus.LIVE,
    DraftStatus.PAUSED,
    DraftStatus.COMPLETE,
  ]),
  currentPickNumber: z.number(),
  currentRound: z.number(),
  totalPicks: z.number(),
  totalRounds: z.number(),
  currentEntryId: z.string().nullable(),
  currentEntryName: z.string().nullable(),
  myEntryId: z.string().nullable(),
  isMyPick: z.boolean(),
  timePerPickSeconds: z.number(),
  currentTurnStartedAt: z.string().datetime().nullable(),
  entries: z.array(DraftEntryDtoSchema),
  draftPickHistories: z.array(DraftPickHistoryDtoSchema),
  availableParticipantIds: z.array(z.string()),
  isComplete: z.boolean(),
  pickEmEvents: z.array(DraftPickEmEventDtoSchema).optional(),
  bracketMatchups: z.array(DraftBracketMatchupDtoSchema).optional().describe('Bracket pick data when relevant to the draft.'),
}).describe('Draft-state response.');
export type DraftStateResponse = z.infer<typeof DraftStateResponseSchema>;

export const DraftPickResponseSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
    SelectionType.OPEN_SELECTION,
    SelectionType.PICK_EM,
    SelectionType.BRACKET_PICK_EM,
  ]),
  isTurnBased: z.boolean(),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  contestConfiguration: DraftContestConfigurationDtoSchema.nullable().optional(),
  status: z.enum([
    DraftStatus.PENDING,
    DraftStatus.LIVE,
    DraftStatus.PAUSED,
    DraftStatus.COMPLETE,
  ]),
  currentPickNumber: z.number(),
  currentRound: z.number(),
  totalPicks: z.number(),
  totalRounds: z.number(),
  currentEntryId: z.string().nullable(),
  currentEntryName: z.string().nullable(),
  myEntryId: z.string().nullable(),
  isMyPick: z.boolean(),
  timePerPickSeconds: z.number(),
  currentTurnStartedAt: z.string().datetime().nullable(),
  entries: z.array(DraftEntryDtoSchema),
  draftPickHistories: z.array(DraftPickHistoryDtoSchema),
  availableParticipantIds: z.array(z.string()),
  isComplete: z.boolean(),
  pickEmEvents: z.array(DraftPickEmEventDtoSchema).optional(),
  bracketMatchups: z.array(DraftBracketMatchupDtoSchema).optional().describe('Bracket pick data when relevant to the draft.'),
}).describe('Draft response returned immediately after a pick mutation.');
export type DraftPickResponse = z.infer<typeof DraftPickResponseSchema>;
