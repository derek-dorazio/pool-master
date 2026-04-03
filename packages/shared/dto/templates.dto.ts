import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const ContestTemplateDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  createdBy: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sport: z.string(),
  contestType: z.string(),
  draftConfig: JsonObjectSchema,
  scoringConfig: JsonObjectSchema,
  payoutConfig: JsonObjectSchema,
  poolConfig: JsonObjectSchema,
  sharedWithTenant: z.boolean(),
  isPlatformTemplate: z.boolean(),
  timesUsed: z.number(),
  lastUsedAt: DateTimeSchema.nullable().optional(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const TemplateResponseSchema = z.object({
  template: ContestTemplateDtoSchema,
});

export const TemplateListResponseSchema = z.object({
  templates: z.array(ContestTemplateDtoSchema),
});
