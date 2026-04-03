import { z } from 'zod';
import {
  ContestType,
  Sport,
} from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const CreateTemplateRequestSchema = z.object({
  leagueId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  sport: z.enum([
    Sport.GOLF,
    Sport.NFL,
    Sport.NBA,
    Sport.F1,
    Sport.NASCAR,
    Sport.NCAA_BASKETBALL,
    Sport.NCAA_HOCKEY,
    Sport.NCAA_FOOTBALL,
    Sport.TENNIS,
    Sport.HORSE_RACING,
    Sport.SOCCER,
    Sport.NHL,
    Sport.MLB,
    Sport.UFC,
  ]),
  contestType: z.enum([ContestType.SINGLE_EVENT]),
  draftConfig: JsonObjectSchema.optional(),
  scoringConfig: JsonObjectSchema.optional(),
  payoutConfig: JsonObjectSchema.optional(),
  poolConfig: JsonObjectSchema.optional(),
  sharedWithTenant: z.boolean().optional(),
});
export type CreateTemplateRequest = z.infer<typeof CreateTemplateRequestSchema>;

export const UpdateTemplateRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  draftConfig: JsonObjectSchema.optional(),
  scoringConfig: JsonObjectSchema.optional(),
  payoutConfig: JsonObjectSchema.optional(),
  poolConfig: JsonObjectSchema.optional(),
  sharedWithTenant: z.boolean().optional(),
});
export type UpdateTemplateRequest = z.infer<typeof UpdateTemplateRequestSchema>;

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
