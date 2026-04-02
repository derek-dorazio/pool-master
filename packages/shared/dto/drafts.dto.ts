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

export const DraftPickDtoSchema = z.object({
  pickNumber: z.number(),
  round: z.number(),
  entryId: z.string(),
  participantId: z.string(),
  isAutoPick: z.boolean(),
  pickedAt: z.string().datetime(),
});
export type DraftPickDto = z.infer<typeof DraftPickDtoSchema>;

export const DraftEntryDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  pickCount: z.number(),
});
export type DraftEntryDto = z.infer<typeof DraftEntryDtoSchema>;

export const DraftStateDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  status: z.string(),
  currentRound: z.number(),
  currentPick: z.number(),
  picks: z.array(DraftPickDtoSchema),
  entries: z.array(DraftEntryDtoSchema),
});
export type DraftStateDto = z.infer<typeof DraftStateDtoSchema>;

// --- Responses ---

export const DraftStateResponseSchema = z.object({
  draft: DraftStateDtoSchema,
});
export type DraftStateResponse = z.infer<typeof DraftStateResponseSchema>;

export const DraftPickResponseSchema = z.object({
  pick: DraftPickDtoSchema,
  draft: DraftStateDtoSchema,
});
export type DraftPickResponse = z.infer<typeof DraftPickResponseSchema>;
