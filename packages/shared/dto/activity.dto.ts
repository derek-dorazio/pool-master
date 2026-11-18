/**
 * Activity DTOs (#1819): one grid over every background job (sync, email, settlement, release
 * and the rest), filtered by kind, status, sport league and event. Root admin only.
 */
import { z } from 'zod';
import { BackgroundJobKind, BackgroundJobStatus, BackgroundJobType } from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';
import { registerSchema } from './schema-registry';

export const BackgroundJobKindSchema = z.enum(BackgroundJobKind).describe('What a job is about: a provider SYNC, EMAIL to a league, contest SETTLEMENT, an event\'s RELEASE, or OTHER.');
export const BackgroundJobStatusSchema = z.enum(BackgroundJobStatus).describe('QUEUED waits for its run time, RUNNING is claimed, SUCCEEDED finished, FAILED will not run again.');
export const BackgroundJobTypeSchema = z.enum(BackgroundJobType).describe('The job\'s handler. Its kind follows from it.');

export const ActivityJobDtoSchema = z.object({
  id: z.uuid(),
  type: BackgroundJobTypeSchema,
  kind: BackgroundJobKindSchema,
  status: BackgroundJobStatusSchema,
  sportLeagueId: z.uuid().nullable().describe('The sport league a whole-league job is about, such as its events sync; null for a job on one event.'),
  sportEventId: z.uuid().nullable().describe('The event the job is about; null when it is about none.'),
  attempts: z.number().int().describe('Tries so far, counting one in progress.'),
  runAt: DateTimeSchema.describe('When it is or was due: first queued, or retried after a failed try.'),
  createdAt: DateTimeSchema.describe('When it was queued.'),
  completedAt: DateTimeSchema.nullable().describe('When it SUCCEEDED or FAILED.'),
  lastError: z.string().nullable().describe('The error of its last failed try.'),
  result: JsonObjectSchema.nullable().describe('What its handler reported it did, once SUCCEEDED; null when it reported nothing. An events sync reports its created, updated and skipped counts and its run.'),
  syncRunIds: z.array(z.uuid()).describe('The provider sync runs the job ran, oldest first; read each with getProviderSyncRun. Empty for a job that is not a sync, or before a sync starts.'),
}).describe('One background job on the Activity grid.');
export type ActivityJobDto = z.infer<typeof ActivityJobDtoSchema>;

export const ActivityListQuerySchema = z.object({
  kind: BackgroundJobKindSchema.optional(),
  status: BackgroundJobStatusSchema.optional(),
  sportLeagueId: z.uuid().optional().describe('The league\'s own jobs and the jobs on any of its events.'),
  sportEventId: z.uuid().optional(),
  from: DateTimeSchema.optional().describe('Earliest queue time to include. Defaults to 24 hours before `to`, or with a sportLeagueId or sportEventId, to 30 days before it: every job kept.'),
  to: DateTimeSchema.optional().describe('Latest queue time to include. Defaults to now.'),
}).describe('Filters over Activity. A queue-time window bounds it; nothing pages it.');
export type ActivityListQuery = z.infer<typeof ActivityListQuerySchema>;

export const ActivityListResponseSchema = z.object({
  jobs: z.array(ActivityJobDtoSchema),
}).describe('The jobs queued inside the window that match the filters, newest first.');
export type ActivityListResponse = z.infer<typeof ActivityListResponseSchema>;

export const ActivityJobResponseSchema = z.object({
  job: ActivityJobDtoSchema,
}).describe('One background job, as Activity shows it.');
export type ActivityJobResponse = z.infer<typeof ActivityJobResponseSchema>;

registerSchema('ActivityJobDto', ActivityJobDtoSchema);
registerSchema('ActivityListQuery', ActivityListQuerySchema);
registerSchema('ActivityListResponse', ActivityListResponseSchema);
registerSchema('ActivityJobResponse', ActivityJobResponseSchema);
