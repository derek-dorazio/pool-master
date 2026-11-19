/**
 * Activity DTOs (#1819): one grid over every background job (sync, email, settlement, release
 * and the rest), filtered by kind, status, sport league and event. Root admin only.
 */
import { z } from 'zod';
import { BackgroundJobKind, BackgroundJobStatus, BackgroundJobType, JobErrorType } from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';
import { JobTriggerSchema } from './ingestion.dto';
import { registerSchema } from './schema-registry';

export const BackgroundJobKindSchema = z.enum(BackgroundJobKind).describe('What a job is about: a provider SYNC, EMAIL to a league, contest SETTLEMENT, an event\'s RELEASE, or OTHER.');
export const BackgroundJobStatusSchema = z.enum(BackgroundJobStatus).describe('QUEUED waits for its run time, RUNNING is claimed, SUCCEEDED finished, FAILED will not run again.');
export const BackgroundJobTypeSchema = z.enum(BackgroundJobType).describe('The job\'s handler. Its kind follows from it.');
export const JobErrorTypeSchema = z.enum(JobErrorType).describe('Why a job did not do its work: the provider RATE_LIMITED it, a request hit a TIMEOUT, the provider answered with a PROVIDER_ERROR, BAD_DATA came back or was given, a CHECK_FAILED (such as an event\'s ready checks before release), or OTHER.');

export const ActivityJobDtoSchema = z.object({
  id: z.uuid(),
  type: BackgroundJobTypeSchema,
  kind: BackgroundJobKindSchema,
  status: BackgroundJobStatusSchema,
  sportLeagueId: z.uuid().nullable().describe('The sport league a whole-league job is about, such as its events sync; null for a job on one event.'),
  sportEventId: z.uuid().nullable().describe('The event the job is about; null when it is about none.'),
  sportLeague: z.object({
    id: z.uuid(),
    name: z.string(),
  }).nullable().describe('The sport league the job is about, for display: its own league, or for a job on an event, the event\'s league. Null when it is about neither.'),
  sportEvent: z.object({
    id: z.uuid(),
    name: z.string(),
  }).nullable().describe('The event the job is about, for display; null when it is about none.'),
  attempts: z.number().int().describe('Tries so far, counting one in progress.'),
  runAt: DateTimeSchema.describe('When it is or was due: first queued, or retried after a failed try.'),
  createdAt: DateTimeSchema.describe('When it was queued.'),
  completedAt: DateTimeSchema.nullable().describe('When it SUCCEEDED or FAILED.'),
  lastError: z.string().nullable().describe('The error of its last failed try.'),
  trigger: JobTriggerSchema,
  startedBy: z.object({
    id: z.uuid(),
    displayName: z.string().describe('Their name, for display.'),
  }).nullable().describe('The person whose request started an ADMIN or COMMISSIONER job; null for any other trigger, or when that account was deleted.'),
  startedAt: DateTimeSchema.nullable().describe('When its latest try started; null until it is first claimed.'),
  durationSeconds: z.number().int().nonnegative().nullable().describe('How long its latest try took, in whole seconds, from startedAt to completedAt; null until it SUCCEEDED or FAILED.'),
  changedCount: z.number().int().nonnegative().nullable().describe('How many rows a SUCCEEDED job created or changed: events, field participants, contests settled, boards rebuilt, emails queued. Null until it succeeds.'),
  errorType: JobErrorTypeSchema.nullable().describe('Why it did not do its work: set with lastError on a failed try (kept while it waits to be retried, and once FAILED), and on a SUCCEEDED job that was held back, such as a release whose checks failed (CHECK_FAILED). Null otherwise.'),
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
