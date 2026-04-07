import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const ConsentRecordDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  consentType: z.string(),
  granted: z.boolean(),
  version: z.string(),
  minimumAgeThreshold: z.number().int().nullable().optional(),
  ageAffirmed: z.boolean().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: DateTimeSchema,
});

export const ConsentHistoryResponseSchema = z.object({
  consents: z.array(ConsentRecordDtoSchema),
});

export const ConsentRecordRequestSchema = z.object({
  consentType: z.string(),
  granted: z.boolean(),
  version: z.string(),
  minimumAgeThreshold: z.number().int().min(13).max(18).nullable().optional(),
  ageAffirmed: z.boolean().nullable().optional(),
});

