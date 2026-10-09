/**
 * Selection DTOs — request/response schemas for the selection endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { ContestEntryStatus, SelectionStatus, SelectionType } from '../domain/enums';

// --- Requests ---

export const SelectionStateQuerySchema = z.object({
  entryId: z.string().optional().describe('Specific contest entry to view within roster-based selection flows.'),
}).describe('Optional query parameters for loading selection state.');
export type SelectionStateQuery = z.infer<typeof SelectionStateQuerySchema>;

export const SubmitPickRequestSchema = z.object({
  entryId: z.string().describe('Entry making the pick.'),
  participantId: z.string().describe('Participant being selected.'),
}).describe('Request payload for submitting a pick.');
export type SubmitPickRequest = z.infer<typeof SubmitPickRequestSchema>;

// --- Response Sub-schemas ---

export const PickHistoryDtoSchema = z.object({
  pickNumber: z.number(),
  round: z.number(),
  pickInRound: z.number(),
  entryId: z.string(),
  entryName: z.string(),
  participantId: z.string().nullable(),
  participantName: z.string().nullable(),
  role: z.string().optional(),
  team: z.string().optional(),
  price: z.number().optional(),
  tierId: z.string().optional(),
  tierName: z.string().optional(),
  autoPicked: z.boolean(),
  isSkipped: z.boolean().optional(),
  pickedAt: z.string().datetime().describe('When the pick was made or skipped.'),
}).describe('Historical pick row shown in selection-room history.');
export type PickHistoryDto = z.infer<typeof PickHistoryDtoSchema>;

export const SelectionEntryDtoSchema = z.object({
  id: z.string().describe('Entry identifier.'),
  userId: z.string().describe('User that owns the entry.'),
  name: z.string().describe('Entry display name.'),
  isOnClock: z.boolean().describe('Whether the entry currently has the active turn.'),
  status: z.nativeEnum(ContestEntryStatus).describe('DRAFT until the owner submits a complete lineup; SUBMITTED once they have. A pick change that leaves the lineup short sends it back to DRAFT (#481).'),
}).describe('Entry summary shown in the selection room.');
export type SelectionEntryDto = z.infer<typeof SelectionEntryDtoSchema>;

export const SelectionTierConfigDtoSchema = z.object({
  tierId: z.string(),
  tierName: z.string(),
  tierNumber: z.number(),
  picksFromTier: z.number(),
}).describe('Tier definition displayed within a selection room.');
export type SelectionTierConfigDto = z.infer<typeof SelectionTierConfigDtoSchema>;

export const SelectionParticipantDtoSchema = z.object({
  sportEventParticipantId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  role: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  ranking: z.number().nullable().optional(),
  orderIndex: z.number().nullable().optional(),
  isAvailable: z.boolean(),
  unavailableReason: z.string().nullable().optional(),
  isSelected: z.boolean().optional().describe('Whether the currently selected entry has this participant selected.'),
}).describe('Selectable participant row used by roster-based entry builders.');
export type SelectionParticipantDto = z.infer<typeof SelectionParticipantDtoSchema>;

export const SelectionGroupDtoSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupNumber: z.number(),
  picksFromGroup: z.number(),
  selectedParticipantIds: z.array(z.string()).describe('Selections currently saved on the selected entry for this group.'),
  participants: z.array(SelectionParticipantDtoSchema).describe('Selectable participants shown inside the group.'),
}).describe('Contest-specific selection group used by tiered or budget-style entry builders.');
export type SelectionGroupDto = z.infer<typeof SelectionGroupDtoSchema>;

export const SelectionContestConfigurationDtoSchema = z.object({
  isExclusive: z.boolean(),
  rounds: z.number().optional(),
  pickCount: z.number().optional(),
  rosterSize: z.number().optional(),
  budget: z.number().optional(),
  timePerPickSeconds: z.number().optional(),
  picksPerPeriod: z.number().optional(),
  roundValues: z.array(z.number()).optional(),
  startRound: z.string().optional(),
  tierConfig: z.array(SelectionTierConfigDtoSchema).optional().describe('Tier configuration when the contest uses tiered selection.'),
}).describe('Contest-configuration subset required by selection-room clients.');
export type SelectionContestConfigurationDto = z.infer<typeof SelectionContestConfigurationDtoSchema>;

export const SelectionPickEmEventDtoSchema = z.object({
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
}).describe('Pick-em event row surfaced in selection flows.');
export type SelectionPickEmEventDto = z.infer<typeof SelectionPickEmEventDtoSchema>;

export const SelectionBracketTeamDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number().nullable(),
}).describe('Minimal team identity used in bracket pick-em selection payloads.');
export type SelectionBracketTeamDto = z.infer<typeof SelectionBracketTeamDtoSchema>;

export const SelectionBracketMatchupDtoSchema = z.object({
  id: z.string(),
  roundNumber: z.number(),
  matchNumber: z.number(),
  label: z.string().nullable(),
  isLocked: z.boolean(),
  topTeam: SelectionBracketTeamDtoSchema.nullable(),
  bottomTeam: SelectionBracketTeamDtoSchema.nullable(),
  winnerId: z.string().nullable().describe('Winning team identifier when the matchup has been decided.'),
}).describe('Bracket matchup returned to bracket-style pick clients.');
export type SelectionBracketMatchupDto = z.infer<typeof SelectionBracketMatchupDtoSchema>;

// --- Responses ---

export const SelectionStateResponseSchema = z.object({
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
  contestConfiguration: SelectionContestConfigurationDtoSchema.nullable().optional(),
  status: z.enum([
    SelectionStatus.PENDING,
    SelectionStatus.LIVE,
    SelectionStatus.PAUSED,
    SelectionStatus.COMPLETE,
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
  entries: z.array(SelectionEntryDtoSchema),
  pickHistories: z.array(PickHistoryDtoSchema),
  availableParticipantIds: z.array(z.string()),
  selectedEntryId: z.string().nullable().optional(),
  selectedEntryName: z.string().nullable().optional(),
  tiebreakerValue: z.number().nullable().optional(),
  selectionGroups: z.array(SelectionGroupDtoSchema).optional(),
  isComplete: z.boolean(),
  pickEmEvents: z.array(SelectionPickEmEventDtoSchema).optional(),
  bracketMatchups: z.array(SelectionBracketMatchupDtoSchema).optional().describe('Bracket pick data when relevant to the selection.'),
}).describe('Selection-state response.');
export type SelectionStateResponse = z.infer<typeof SelectionStateResponseSchema>;

export const SelectionPickResponseSchema = z.object({
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
  contestConfiguration: SelectionContestConfigurationDtoSchema.nullable().optional(),
  status: z.enum([
    SelectionStatus.PENDING,
    SelectionStatus.LIVE,
    SelectionStatus.PAUSED,
    SelectionStatus.COMPLETE,
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
  entries: z.array(SelectionEntryDtoSchema),
  pickHistories: z.array(PickHistoryDtoSchema),
  availableParticipantIds: z.array(z.string()),
  selectedEntryId: z.string().nullable().optional(),
  selectedEntryName: z.string().nullable().optional(),
  tiebreakerValue: z.number().nullable().optional(),
  selectionGroups: z.array(SelectionGroupDtoSchema).optional(),
  isComplete: z.boolean(),
  pickEmEvents: z.array(SelectionPickEmEventDtoSchema).optional(),
  bracketMatchups: z.array(SelectionBracketMatchupDtoSchema).optional().describe('Bracket pick data when relevant to the selection.'),
}).describe('Selection response returned immediately after a pick mutation.');
export type SelectionPickResponse = z.infer<typeof SelectionPickResponseSchema>;

registerSchema('SelectionStateQuery', SelectionStateQuerySchema);
registerSchema('SubmitPickRequest', SubmitPickRequestSchema);
registerSchema('SelectionStateResponse', SelectionStateResponseSchema);
registerSchema('SelectionPickResponse', SelectionPickResponseSchema);
