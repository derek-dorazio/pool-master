import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const IngestionProviderSummaryDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  sportsCovered: z.array(z.string()),
});
export type IngestionProviderSummaryDto = z.infer<typeof IngestionProviderSummaryDtoSchema>;

export const IngestionProvidersResponseSchema = z.object({
  providers: z.array(IngestionProviderSummaryDtoSchema),
});
export type IngestionProvidersResponse = z.infer<typeof IngestionProvidersResponseSchema>;

export const IngestionJobRecordDtoSchema = z.object({
  jobType: z.enum([
    'SCHEDULE_SYNC',
    'PARTICIPANT_SYNC',
    'RANKING_SYNC',
    'LIVE_SCORES',
    'EVENT_RESULTS',
    'HEALTH_CHECK',
  ]),
  providerId: z.string(),
  sport: z.string(),
  eventExternalId: z.string().optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  startedAt: DateTimeSchema.optional(),
  completedAt: DateTimeSchema.optional(),
  recordsProcessed: z.number(),
  errors: z.number(),
  errorLog: z.array(JsonObjectSchema),
});
export type IngestionJobRecordDto = z.infer<typeof IngestionJobRecordDtoSchema>;

export const IngestionJobResponseSchema = z.object({
  job: IngestionJobRecordDtoSchema,
});
export type IngestionJobResponse = z.infer<typeof IngestionJobResponseSchema>;

export const IngestSportOddsResponseSchema = z.object({
  sport: z.string(),
  eventsWithOdds: z.number().int(),
  odds: z.array(JsonObjectSchema),
});
export type IngestSportOddsResponse = z.infer<typeof IngestSportOddsResponseSchema>;
