import { z } from 'zod';
import { Sport } from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

const SportSchema = z.enum([
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
]);

export const IngestionProviderSummaryDtoSchema = z.object({
  providerId: z.string().describe('Stable ingestion-provider identifier.'),
  providerName: z.string().describe('Human-readable provider name.'),
  sportsCovered: z.array(SportSchema).describe('Sports currently covered by the provider integration.'),
}).describe('Provider summary used by ingestion-management surfaces.');
export type IngestionProviderSummaryDto = z.infer<typeof IngestionProviderSummaryDtoSchema>;

export const IngestionFeedTypeSchema = z.enum([
  'EVENTSCHEDULE',
  'EVENTPARTICIPANTS',
  'PARTICIPANTRANKINGS',
  'EVENTLIVESCORES',
  'EVENTRESULTS',
]).describe('Explicit ingestion feed type requested by the caller.');
export type IngestionFeedType = z.infer<typeof IngestionFeedTypeSchema>;

export const IngestionProvidersResponseSchema = z.object({
  providers: z.array(IngestionProviderSummaryDtoSchema),
}).describe('List of configured ingestion providers.');
export type IngestionProvidersResponse = z.infer<typeof IngestionProvidersResponseSchema>;

export const IngestionJobRecordDtoSchema = z.object({
  jobType: z.enum([
    'EVENT_SCHEDULE_SYNC',
    'EVENT_PARTICIPANTS_SYNC',
    'PARTICIPANT_RANKINGS_SYNC',
    'EVENT_LIVE_SCORES_SYNC',
    'EVENT_RESULTS_SYNC',
    'HEALTH_CHECK',
  ]),
  providerId: z.string().describe('Provider that owns the ingestion job.'),
  sport: SportSchema.describe('Sport being synchronized.'),
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

export const IngestionJobsResponseSchema = z.object({
  jobs: z.array(IngestionJobRecordDtoSchema),
}).describe('Multiple ingestion jobs returned for a feed-aware sync request.');
export type IngestionJobsResponse = z.infer<typeof IngestionJobsResponseSchema>;

export const SportSyncRequestSchema = z.object({
  feeds: z.array(z.enum(['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'])).min(1).describe(
    'Feed types to run for a sport-level sync request.',
  ),
  from: DateTimeSchema.optional().describe('Optional lower bound for sport-level event discovery.'),
  to: DateTimeSchema.optional().describe('Optional upper bound for sport-level event discovery.'),
}).describe('Feed-aware sport sync request.');
export type SportSyncRequest = z.infer<typeof SportSyncRequestSchema>;

export const EventSyncRequestSchema = z.object({
  feeds: z.array(z.enum(['EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'EVENTRESULTS'])).min(1).describe(
    'Feed types to run for a specific event sync request.',
  ),
}).describe('Feed-aware event sync request.');
export type EventSyncRequest = z.infer<typeof EventSyncRequestSchema>;

export const IngestSportOddsResponseSchema = z.object({
  sport: SportSchema.describe('Sport whose odds payload was requested.'),
  eventsWithOdds: z.number().int().describe('How many events returned odds records.'),
  odds: z.array(JsonObjectSchema).describe('Provider-normalized odds payloads returned by the ingestion endpoint.'),
}).describe('Odds-ingestion response payload.');
export type IngestSportOddsResponse = z.infer<typeof IngestSportOddsResponseSchema>;
