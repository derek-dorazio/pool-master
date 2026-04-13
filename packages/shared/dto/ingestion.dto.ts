import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const IngestionProviderSummaryDtoSchema = z.object({
  providerId: z.string().describe('Stable ingestion-provider identifier.'),
  providerName: z.string().describe('Human-readable provider name.'),
  sportsCovered: z.array(z.string()).describe('Sports currently covered by the provider integration.'),
}).describe('Provider summary used by ingestion-management surfaces.');
export type IngestionProviderSummaryDto = z.infer<typeof IngestionProviderSummaryDtoSchema>;

export const IngestionProvidersResponseSchema = z.object({
  providers: z.array(IngestionProviderSummaryDtoSchema),
}).describe('List of configured ingestion providers.');
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
  providerId: z.string().describe('Provider that owns the ingestion job.'),
  sport: z.string().describe('Sport being synchronized.'),
  eventExternalId: z.string().optional().describe('Provider event identifier when the job targets a single event.'),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).describe('Current ingestion job lifecycle state.'),
  startedAt: DateTimeSchema.optional().describe('When the job began processing.'),
  completedAt: DateTimeSchema.optional().describe('When the job finished, if completed.'),
  recordsProcessed: z.number().describe('How many records the job successfully processed.'),
  errors: z.number().describe('How many processing errors occurred during the job.'),
  errorLog: z.array(JsonObjectSchema).describe('Opaque error payloads returned for diagnostics and admin tooling.'),
}).describe('Ingestion job execution record.');
export type IngestionJobRecordDto = z.infer<typeof IngestionJobRecordDtoSchema>;

export const IngestionJobResponseSchema = z.object({
  job: IngestionJobRecordDtoSchema,
}).describe('Single ingestion-job response.');
export type IngestionJobResponse = z.infer<typeof IngestionJobResponseSchema>;

export const IngestSportOddsResponseSchema = z.object({
  sport: z.string().describe('Sport whose odds payload was requested.'),
  eventsWithOdds: z.number().int().describe('How many events returned odds records.'),
  odds: z.array(JsonObjectSchema).describe('Provider-normalized odds payloads returned by the ingestion endpoint.'),
}).describe('Odds-ingestion response payload.');
export type IngestSportOddsResponse = z.infer<typeof IngestSportOddsResponseSchema>;
