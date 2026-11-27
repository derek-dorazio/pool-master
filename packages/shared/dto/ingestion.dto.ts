/**
 * Ingestion DTOs (#205) — providers, sync submissions and their history, competitors a
 * provider could not match, and the provider catalog browse.
 * Every operation is root-admin; `admin` is the permission, `ingestion` is what they administer.
 */
import { z } from 'zod';
import {
  IngestionJobStatus,
  JobTrigger,
  PROVIDER_LEAGUE_MINUTES_RANGE,
  PROVIDER_POLL_MINUTES_RANGE,
  PROVIDER_REQUESTS_PER_MINUTE_RANGE,
  ProviderCode,
  ProviderHealthStatus,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ProviderWebhookEventSet,
  Sport,
} from '@poolmaster/shared/domain';
import { DateTimeSchema, EventSyncKindSchema, JsonObjectSchema } from './common.dto';
import { registerSchema } from './schema-registry';

const SportDtoSchema = z.enum(Sport);

export const EventSyncRequestSchema = z.object({
  kinds: z.array(EventSyncKindSchema).min(1).describe(
    'The sync kinds to run for the event, each once.',
  ),
}).describe('A manual event sync request.');
export type EventSyncRequest = z.infer<typeof EventSyncRequestSchema>;

// --- Providers ---

export const ProviderHealthStatusSchema = z.enum(ProviderHealthStatus);

const RequestsPerMinuteSchema = z.number().int().min(PROVIDER_REQUESTS_PER_MINUTE_RANGE.min).max(PROVIDER_REQUESTS_PER_MINUTE_RANGE.max);
const PollMinutesSchema = z.number().int().min(PROVIDER_POLL_MINUTES_RANGE.min).max(PROVIDER_POLL_MINUTES_RANGE.max);
const LeagueMinutesSchema = z.number().int().min(PROVIDER_LEAGUE_MINUTES_RANGE.min).max(PROVIDER_LEAGUE_MINUTES_RANGE.max);

export const ProviderLeagueDtoSchema = z.object({
  id: z.uuid().describe('The provider league.'),
  code: z.string().describe('The provider\'s own code for the league, as its API names it, e.g. "nfl".'),
  name: z.string().describe('The provider\'s own name for the league.'),
  sport: SportDtoSchema.describe('The sport the league plays.'),
  webhookEventSet: z.enum(ProviderWebhookEventSet).describe('Which of the provider\'s webhook events the league sends for its games.'),
  quietAfterMinutes: LeagueMinutesSchema.describe('How long a game may go between two of its notifications in normal play, in minutes; past it the live-score sweep warns that the webhook may have stopped.'),
  typicalGameMinutes: LeagueMinutesSchema.describe('How long one of its games usually takes from its scheduled start, in minutes: a start plus this is when a game with no scheduled end should have ended, for the overdue results check.'),
  isEnabled: z.boolean().describe('Whether the provider\'s adapter reads the league. A change takes effect when the server tasks next start.'),
}).describe('One of a provider\'s own leagues (#1997).');
export type ProviderLeagueDto = z.infer<typeof ProviderLeagueDtoSchema>;

export const ProviderSettingsDtoSchema = z.object({
  id: z.uuid().describe('The Provider row.'),
  code: z.enum(ProviderCode).describe('Which provider the row is; it picks the adapter.'),
  name: z.string().describe('The provider\'s display name.'),
  baseUrl: z.url().describe('Where the adapter calls the provider. Taken by each task within a minute.'),
  requestsPerMinute: RequestsPerMinuteSchema.describe('The provider plan\'s request limit a minute, which every sync service holds its calls to. Taken by each task within a minute.'),
  webhooksEnabled: z.boolean().describe('Whether the provider\'s webhook notifications are taken. They are only while its signing secret is set too (webhookSecretSet).'),
  webhookSecretSet: z.boolean().describe('Whether the provider\'s webhook signing secret is set in this environment (Secrets Manager). Read only.'),
  webhookPollMinutes: PollMinutesSchema.describe('How often a notified event\'s scores are polled anyway while it is in play, in minutes.'),
  webhookRoundPollMinutes: PollMinutesSchema.describe('How often a notified event played in rounds is polled while a round is under way, in minutes.'),
  hasPlayerStats: z.boolean().describe('Whether the provider plan includes player box scores.'),
  isEnabled: z.boolean().describe('Whether the provider is used at all. A change takes effect when the server tasks next start.'),
  leagues: z.array(ProviderLeagueDtoSchema).describe('The provider\'s own leagues, by code.'),
}).describe('A data provider\'s settings (#1997): its Provider row and its leagues. The API key and webhook secret are not here: they stay in Secrets Manager.');
export type ProviderSettingsDto = z.infer<typeof ProviderSettingsDtoSchema>;

export const ProviderSummaryDtoSchema = z.object({
  providerId: z.string().describe('The id the provider\'s events carry as their providerId.'),
  providerName: z.string().describe('Provider display name.'),
  status: ProviderHealthStatusSchema.nullable().describe('Health from the provider\'s sync runs submitted in the last hour (#1999): HEALTHY when none failed, DOWN when all did, DEGRADED when some did; null when none finished. No route calls the provider live.'),
  errorRate: z.number().nullable().describe('The share of the provider\'s sync runs of the last hour that failed, 0 to 1; null when none finished.'),
  lastEventAt: DateTimeSchema.nullable().describe('When one of the provider\'s events last changed; null when none is known.'),
  activeEventCount: z.number().int().describe('The provider\'s events that are scheduled or in progress.'),
  requestsPerMinute: z.number().int().min(1).nullable().describe('The request rate core-api holds its calls to the provider to, a minute: its Provider row\'s requestsPerMinute. Null when the provider is not paced.'),
  webhooksEnabled: z.boolean().describe('True when the provider\'s webhooks are on: switched on for it and its signing secret is set, so its notifications are accepted.'),
  syncedSportLeagueCount: z.number().int().min(0).describe('The active sport leagues whose selected provider mapping is to one of this provider\'s leagues.'),
  rateLimitedJobsLast24h: z.number().int().min(0).describe(
    'Background jobs for this provider whose latest try hit its rate limit in the last 24 hours: ended FAILED on it, or waiting to retry after it. '
    + 'A job belongs to the provider syncing its sport league, or the provider its event is linked to.',
  ),
  settings: ProviderSettingsDtoSchema.nullable().describe('The provider\'s row and leagues, which the Providers page edits; null for a provider running without a Provider row.'),
}).describe('A sports-data provider with its health from its sync runs, and its settings.');
export type ProviderSummaryDto = z.infer<typeof ProviderSummaryDtoSchema>;

export const UpdateProviderRequestSchema = z.object({
  baseUrl: z.url({ protocol: /^https$/ }).optional().describe('An https URL.'),
  requestsPerMinute: RequestsPerMinuteSchema.optional(),
  webhooksEnabled: z.boolean().optional().describe('true is refused with 422 PROVIDER_WEBHOOK_SECRET_MISSING while the provider\'s signing secret is not set in this environment.'),
  webhookPollMinutes: PollMinutesSchema.optional(),
  webhookRoundPollMinutes: PollMinutesSchema.optional(),
  hasPlayerStats: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one provider setting must be given.' })
  .describe('Changes to a provider\'s settings; omitted fields are left alone.');
export type UpdateProviderRequest = z.infer<typeof UpdateProviderRequestSchema>;

export const ProviderSettingsResponseSchema = z.object({
  provider: ProviderSettingsDtoSchema,
}).describe('A provider\'s settings as saved.');
export type ProviderSettingsResponse = z.infer<typeof ProviderSettingsResponseSchema>;

export const UpdateProviderLeagueRequestSchema = z.object({
  quietAfterMinutes: LeagueMinutesSchema.optional(),
  typicalGameMinutes: LeagueMinutesSchema.optional(),
  isEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one league setting must be given.' })
  .describe('Changes to one of a provider\'s leagues; omitted fields are left alone.');
export type UpdateProviderLeagueRequest = z.infer<typeof UpdateProviderLeagueRequestSchema>;

export const ProviderLeagueResponseSchema = z.object({
  league: ProviderLeagueDtoSchema,
}).describe('A provider league as saved.');
export type ProviderLeagueResponse = z.infer<typeof ProviderLeagueResponseSchema>;

const SettingRangeDtoSchema = z.object({
  min: z.number().int().describe('The smallest value the API takes.'),
  max: z.number().int().describe('The largest value the API takes.'),
}).describe('The whole numbers a provider setting may take, inclusive.');

export const ProviderSettingRangesDtoSchema = z.object({
  requestsPerMinute: SettingRangeDtoSchema.describe('A provider\'s requestsPerMinute.'),
  pollMinutes: SettingRangeDtoSchema.describe('A provider\'s webhookPollMinutes and webhookRoundPollMinutes.'),
  leagueMinutes: SettingRangeDtoSchema.describe('A provider league\'s quietAfterMinutes and typicalGameMinutes.'),
}).describe('The ranges the API and the database hold each provider setting to (#1997), so the Providers page checks a value before it saves without holding the ranges itself.');
export type ProviderSettingRangesDto = z.infer<typeof ProviderSettingRangesDtoSchema>;

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSummaryDtoSchema),
  settingRanges: ProviderSettingRangesDtoSchema,
}).describe('Every registered provider, and the ranges their settings may take.');
export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>;

// --- Sync runs ---

export const ProviderSyncRunStatusSchema = z.enum(ProviderSyncRunStatus);
export const ProviderSyncKindSchema = z.enum(ProviderSyncKind).describe('What a sync run syncs: a sport league\'s EVENTS, an event\'s FIELD, or an event\'s SCORES.');
export const JobTriggerSchema = z.enum(JobTrigger).describe('What started a job or sync run: a SCHEDULE, the provider\'s WEBHOOK, a person acting through a root ADMIN route (Sync now, Release) or a league\'s COMMISSIONER tools, or the SYSTEM (another job, or upkeep such as a stale board\'s rebuild). A person\'s trigger is the role the route requires, not their highest role. A sync run has its job\'s.');

export const ProviderSyncProviderPayloadDtoSchema = z.object({
  rawCaptured: z.boolean().describe('Whether raw provider response JSON was captured for this run.'),
  rawTruncated: z.boolean().describe('Whether the captured raw provider payload was truncated before storage.'),
  raw: z.unknown().optional().describe('Raw provider response JSON retained for debugging when capture is available.'),
}).loose().describe('Raw/debug provider payload captured for a provider sync run.');
export type ProviderSyncProviderPayloadDto = z.infer<typeof ProviderSyncProviderPayloadDtoSchema>;

export const IngestionErrorLogEntryDtoSchema = z.object({
  error: z.string().describe('Failure message the ingestion job recorded.'),
  at: z.iso.datetime().describe('When the failure was recorded.'),
}).describe('One ingestion job error-log entry.');
export type IngestionErrorLogEntryDto = z.infer<typeof IngestionErrorLogEntryDtoSchema>;

export const ProviderSyncJobPayloadDtoSchema = z.object({
  jobType: z.string().describe('Internal ingestion job type that executed this sync feed.'),
  providerId: z.string().describe('Provider that executed the ingestion job.'),
  sport: SportDtoSchema,
  eventExternalId: z.string().optional().describe('External event id for event-scoped jobs, when applicable.'),
  status: z.enum(IngestionJobStatus).describe('Internal ingestion job status.'),
  startedAt: z.iso.datetime().optional().describe('When the ingestion job started.'),
  completedAt: z.iso.datetime().optional().describe('When the ingestion job completed.'),
  recordsProcessed: z.number().int().min(0).describe('Canonical records processed by the ingestion job.'),
  errors: z.number().int().min(0).describe('Error count captured by the ingestion job.'),
  errorLog: z.array(IngestionErrorLogEntryDtoSchema).describe('Ingestion error-log entries for root-admin investigation.'),
}).describe('Serialized ingestion job details for a provider sync run.');
export type ProviderSyncJobPayloadDto = z.infer<typeof ProviderSyncJobPayloadDtoSchema>;

export const ProviderSyncWriteDispositionSchema = z.enum(['UNCHANGED', 'CREATED', 'UPDATED', 'DELETED']);
export type ProviderSyncWriteDisposition = z.infer<typeof ProviderSyncWriteDispositionSchema>;

export const ProviderSyncWriteDetailRowDtoSchema = z.object({
  id: z.string().describe('Stable row id for this normalized write diagnostic row.'),
  entityType: z.string().describe('Normalized PoolMaster entity type represented by this row.'),
  disposition: ProviderSyncWriteDispositionSchema.describe('Write effect for the normalized row.'),
  providerId: z.string().optional().describe('Provider id associated with this row, when applicable.'),
  externalId: z.string().optional().describe('Provider external id associated with this row, when applicable.'),
  participantExternalId: z.string().optional().describe('Provider participant id associated with this row, when applicable.'),
  internalId: z.string().optional().describe('PoolMaster internal id associated with this row, when known.'),
  name: z.string().optional().describe('Display name for the row, when known.'),
  // Open JSON on purpose: a row is a snapshot of whichever entity `entityType` names (an event,
  // a field row, a standing, a round), and each carries the provider's own open-ended metadata.
  // The diagnostics page only diffs and prints them; nothing reads a field out of one.
  before: JsonObjectSchema.optional().describe('Normalized before-state of the entity `entityType` names, for UPDATED or DELETED rows; shaped by that entity and shown only as a diff.'),
  after: JsonObjectSchema.optional().describe('Normalized after-state of the entity `entityType` names, for CREATED or UPDATED rows; shaped by that entity and shown only as a diff.'),
}).describe('Single normalized write diagnostic row for a provider sync run.');
export type ProviderSyncWriteDetailRowDto = z.infer<typeof ProviderSyncWriteDetailRowDtoSchema>;

export const ProviderSyncWriteSummaryDtoSchema = z.object({
  total: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  deleted: z.number().int().min(0),
}).describe('Aggregate normalized write-effect counts for a provider sync run.');
export type ProviderSyncWriteSummaryDto = z.infer<typeof ProviderSyncWriteSummaryDtoSchema>;

export const ProviderSyncWriteDiagnosticsDtoSchema = z.object({
  summary: ProviderSyncWriteSummaryDtoSchema,
  rows: z.array(ProviderSyncWriteDetailRowDtoSchema),
}).describe('Normalized write-effect diagnostics for a provider sync run. The summary counts every row the sync compared; `rows` keeps only those it created, updated or deleted, so an unchanged golf field stores no rows. Raw provider payload JSON is a separate debug payload.');
export type ProviderSyncWriteDiagnosticsDto = z.infer<typeof ProviderSyncWriteDiagnosticsDtoSchema>;

export const SyncRequestSourceSchema = z.enum(['SCHEDULED', 'MANUAL', 'WEBHOOK']).describe('Who asked for the sync: the scheduler, a root admin, or a provider\'s webhook saying something happened in the event (#1498).');
export type SyncRequestSource = z.infer<typeof SyncRequestSourceSchema>;

export const ProviderSyncFailurePayloadDtoSchema = z.object({
  error: z.object({
    name: z.string().optional().describe('The error\'s class name, when it was an Error.'),
    message: z.string(),
  }).describe('The error that failed the run.'),
}).describe('Why a sync run failed unexpectedly, before the ingestion job could report it.');
export type ProviderSyncFailurePayloadDto = z.infer<typeof ProviderSyncFailurePayloadDtoSchema>;

export const ProviderSyncRunDetailsDtoSchema = z.object({
  providerPayload: ProviderSyncProviderPayloadDtoSchema.optional().describe('Raw/debug provider payload captured for this run.'),
  jobPayload: ProviderSyncJobPayloadDtoSchema.optional().describe('Serialized ingestion job details after an ingestion job is available.'),
  writeDiagnostics: ProviderSyncWriteDiagnosticsDtoSchema.optional().describe('Normalized write-effect diagnostics for PoolMaster writes: every row counted, changed rows kept.'),
  failurePayload: ProviderSyncFailurePayloadDtoSchema.optional().describe('Present when the run failed unexpectedly.'),
}).loose().describe('A provider sync run\'s detailed diagnostics.');
export type ProviderSyncRunDetailsDto = z.infer<typeof ProviderSyncRunDetailsDtoSchema>;

export const ProviderSyncRunDtoSchema = z.object({
  id: z.string(),
  providerId: z.uuid().describe('The Provider the run read.'),
  providerName: z.string().describe('That Provider\'s name.'),
  sport: SportDtoSchema.nullable().describe('The run\'s sport, its sport league\'s; null for a run with no sport league.'),
  eventId: z.string().nullable().describe('The provider\'s id for the run\'s event, read through sportEventId; null for a whole-sport run and for a provider event linked to no event of ours.'),
  kind: ProviderSyncKindSchema,
  trigger: JobTriggerSchema,
  sportLeagueId: z.uuid().nullable().describe('The sport league an EVENTS run synced, or a FIELD or SCORES run\'s event\'s league, where known.'),
  sportEventId: z.uuid().nullable().describe('The PoolMaster event a FIELD or SCORES run synced, where known.'),
  backgroundJobId: z.uuid().nullable().describe('The background job that ran it (its Activity row); null when no job ran it.'),
  status: ProviderSyncRunStatusSchema,
  startedAt: DateTimeSchema.nullable(),
  completedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema.describe('When the run was submitted.'),
  summary: z.string().describe('One line for the sync history: what the run did, or why it failed.'),
  stats: z.record(z.string(), z.number()).describe('The run\'s numeric counts by name, for diagnostics; empty until it reports any.'),
  changedCount: z.number().int().min(0).nullable().describe('The rows the run created, updated or deleted; null until it completes, and for a failed run.'),
  errorCount: z.number().int().min(0).describe('The errors the run hit; a FAILED run has at least one. A problem the sync found is a sync finding, not part of the run.'),
}).describe('One sync against a provider: its kind, status and outcome.');
export type ProviderSyncRunDto = z.infer<typeof ProviderSyncRunDtoSchema>;

export const ProviderSyncRunDetailDtoSchema = ProviderSyncRunDtoSchema.extend({
  details: ProviderSyncRunDetailsDtoSchema.nullable().describe('The run\'s detailed diagnostics; null before the run starts and once they are cleared, 30 days after submission.'),
}).describe('One feed\'s sync against a provider, with its summary and its detailed diagnostics.');
export type ProviderSyncRunDetailDto = z.infer<typeof ProviderSyncRunDetailDtoSchema>;

export const LeagueEventsSyncRequestSchema = z.object({
  sportLeagueSeasonId: z.uuid().optional().describe('The one Season to sync (SportLeagueSeasonDto); omitted, the league\'s current Season and every later one, as the schedule syncs. 404 SPORT_LEAGUE_SEASON_NOT_FOUND for one that is not the league\'s.'),
}).describe('A root admin\'s Sync now on a sport league\'s events.');
export type LeagueEventsSyncRequest = z.infer<typeof LeagueEventsSyncRequestSchema>;

export const ProviderSyncRunListQuerySchema = z.object({
  providerId: z.uuid().optional().describe('Only the runs of this Provider.'),
  sport: SportDtoSchema.optional().describe('Only the runs of this sport\'s sport leagues. A run with no sport league is in no sport.'),
  status: ProviderSyncRunStatusSchema.optional(),
  from: DateTimeSchema.optional().describe('Earliest submission time to include. Defaults to 6 hours before `to`.'),
  to: DateTimeSchema.optional().describe('Latest submission time to include. Defaults to now.'),
}).describe('Filters over the sync-run history. A submission-time window bounds it; nothing pages it.');
export type ProviderSyncRunListQuery = z.infer<typeof ProviderSyncRunListQuerySchema>;

export const ProviderSyncRunListResponseSchema = z.object({
  syncRuns: z.array(ProviderSyncRunDtoSchema),
}).describe('Sync runs submitted inside the requested window, newest submission first, each with its summary only.');
export type ProviderSyncRunListResponse = z.infer<typeof ProviderSyncRunListResponseSchema>;

export const ProviderManualSyncSubmissionResponseSchema = z.object({
  sport: SportDtoSchema,
  eventId: z.string().describe('Provider event identifier the submitted runs sync.'),
  requestedKinds: z.array(EventSyncKindSchema).describe('The sync kinds the submission runs, each once.'),
  submittedAt: DateTimeSchema,
  syncRuns: z.array(ProviderSyncRunDtoSchema),
}).describe('A manual sync submission. The runs execute asynchronously after the request is accepted.');
export type ProviderManualSyncSubmissionResponse = z.infer<typeof ProviderManualSyncSubmissionResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('EventSyncRequest', EventSyncRequestSchema);
registerSchema('ProviderLeagueDto', ProviderLeagueDtoSchema);
registerSchema('ProviderSettingsDto', ProviderSettingsDtoSchema);
registerSchema('ProviderSummaryDto', ProviderSummaryDtoSchema);
registerSchema('UpdateProviderRequest', UpdateProviderRequestSchema);
registerSchema('ProviderSettingsResponse', ProviderSettingsResponseSchema);
registerSchema('UpdateProviderLeagueRequest', UpdateProviderLeagueRequestSchema);
registerSchema('ProviderLeagueResponse', ProviderLeagueResponseSchema);
registerSchema('ProviderSettingRangesDto', ProviderSettingRangesDtoSchema);
registerSchema('ProviderListResponse', ProviderListResponseSchema);
registerSchema('ProviderSyncRunDto', ProviderSyncRunDtoSchema);
registerSchema('ProviderSyncRunDetailDto', ProviderSyncRunDetailDtoSchema);
registerSchema('ProviderSyncRunListQuery', ProviderSyncRunListQuerySchema);
registerSchema('ProviderSyncRunListResponse', ProviderSyncRunListResponseSchema);
registerSchema('ProviderManualSyncSubmissionResponse', ProviderManualSyncSubmissionResponseSchema);
registerSchema('LeagueEventsSyncRequest', LeagueEventsSyncRequestSchema);
