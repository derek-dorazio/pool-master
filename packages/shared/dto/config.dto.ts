/**
 * Config DTOs — request/response schemas for platform configuration endpoints.
 */
import { z } from 'zod';

// --- Response Sub-schemas ---

export const SportConfigDtoSchema = z.object({
  id: z.string().describe('Sport configuration identifier.'),
  name: z.string().describe('Canonical sport code or display name.'),
  participantType: z.string().describe('Whether the sport primarily uses individual or team participants.'),
  seasons: z.array(z.string()).describe('Available season identifiers currently known for the sport.'),
}).describe('Frontend-facing sport configuration record.');
export type SportConfigDto = z.infer<typeof SportConfigDtoSchema>;

// --- Responses ---

export const PlatformConfigResponseSchema = z.object({
  sports: z.array(SportConfigDtoSchema).describe('Supported sports and their basic configuration metadata.'),
  features: z.record(z.boolean()).describe('Boolean platform feature flags exposed to clients.'),
}).describe('Platform-configuration payload used to bootstrap app capabilities.');
export type PlatformConfigResponse = z.infer<typeof PlatformConfigResponseSchema>;
