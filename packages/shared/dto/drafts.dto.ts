/**
 * Draft DTOs — request/response schemas for draft endpoints.
 */
import { z } from 'zod';

// --- Requests ---

export const StartDraftRequestSchema = z.object({
  entryIds: z.array(z.string()).min(2),
  rounds: z.number().int().min(1).max(30).optional(),
  timePerPickSeconds: z.number().int().min(10).max(86400).optional(),
  availableParticipantIds: z.array(z.string()).min(1).optional(),
  autoPickPolicy: z.enum(['QUEUE_THEN_BEST', 'BEST_AVAILABLE', 'RANDOM']).optional(),
});
export type StartDraftRequest = z.infer<typeof StartDraftRequestSchema>;

export const SubmitPickRequestSchema = z.object({
  entryId: z.string(),
  participantId: z.string(),
});
export type SubmitPickRequest = z.infer<typeof SubmitPickRequestSchema>;

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
  pickedAt: z.string().datetime(),
});
export type DraftPickHistoryDto = z.infer<typeof DraftPickHistoryDtoSchema>;

export const DraftEntryDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  isOnClock: z.boolean(),
});
export type DraftEntryDto = z.infer<typeof DraftEntryDtoSchema>;

export const DraftTierConfigDtoSchema = z.object({
  tierId: z.string(),
  tierName: z.string(),
  tierNumber: z.number(),
  picksFromTier: z.number(),
});
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
  tierConfig: z.array(DraftTierConfigDtoSchema).optional(),
});
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
  label: z.string().nullable(),
});
export type DraftPickEmEventDto = z.infer<typeof DraftPickEmEventDtoSchema>;

export const DraftBracketTeamDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.number().nullable(),
});
export type DraftBracketTeamDto = z.infer<typeof DraftBracketTeamDtoSchema>;

export const DraftBracketMatchupDtoSchema = z.object({
  id: z.string(),
  roundNumber: z.number(),
  matchNumber: z.number(),
  label: z.string().nullable(),
  isLocked: z.boolean(),
  topTeam: DraftBracketTeamDtoSchema.nullable(),
  bottomTeam: DraftBracketTeamDtoSchema.nullable(),
  winnerId: z.string().nullable(),
});
export type DraftBracketMatchupDto = z.infer<typeof DraftBracketMatchupDtoSchema>;

export const DraftStateDtoSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  selectionType: z.string(),
  isTurnBased: z.boolean(),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  contestConfiguration: DraftContestConfigurationDtoSchema.nullable().optional(),
  status: z.string(),
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
  bracketMatchups: z.array(DraftBracketMatchupDtoSchema).optional(),
});
export type DraftStateDto = z.infer<typeof DraftStateDtoSchema>;

// --- Responses ---

export const DraftStateResponseSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  selectionType: z.string(),
  isTurnBased: z.boolean(),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  contestConfiguration: DraftContestConfigurationDtoSchema.nullable().optional(),
  status: z.string(),
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
  bracketMatchups: z.array(DraftBracketMatchupDtoSchema).optional(),
});
export type DraftStateResponse = z.infer<typeof DraftStateResponseSchema>;

export const DraftPickResponseSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  selectionType: z.string(),
  isTurnBased: z.boolean(),
  isCommissioner: z.boolean().optional(),
  rosterSize: z.number(),
  contestConfiguration: DraftContestConfigurationDtoSchema.nullable().optional(),
  status: z.string(),
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
  bracketMatchups: z.array(DraftBracketMatchupDtoSchema).optional(),
});
export type DraftPickResponse = z.infer<typeof DraftPickResponseSchema>;
