/**
 * Participant DTOs — request/response schemas for participant endpoints.
 */
import { z } from 'zod';

// --- Response Sub-schemas ---

export const ParticipantDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport: z.string(),
  position: z.string().nullable().optional(),
  teamAffiliation: z.string().nullable().optional(),
  status: z.string(),
  photoUrl: z.string().nullable().optional(),
});
export type ParticipantDto = z.infer<typeof ParticipantDtoSchema>;

// --- Responses ---

export const ParticipantListResponseSchema = z.object({
  participants: z.array(ParticipantDtoSchema),
  total: z.number(),
});
export type ParticipantListResponse = z.infer<typeof ParticipantListResponseSchema>;

export const ContestPoolResponseSchema = z.object({
  pool: z.array(ParticipantDtoSchema),
  contestId: z.string(),
});
export type ContestPoolResponse = z.infer<typeof ContestPoolResponseSchema>;
