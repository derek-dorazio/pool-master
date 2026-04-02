/**
 * Config DTOs — request/response schemas for platform configuration endpoints.
 */
import { z } from 'zod';

// --- Response Sub-schemas ---

export const SportConfigDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  participantType: z.string(),
  seasons: z.array(z.string()),
});
export type SportConfigDto = z.infer<typeof SportConfigDtoSchema>;

// --- Responses ---

export const PlatformConfigResponseSchema = z.object({
  sports: z.array(SportConfigDtoSchema),
  features: z.record(z.boolean()),
});
export type PlatformConfigResponse = z.infer<typeof PlatformConfigResponseSchema>;
