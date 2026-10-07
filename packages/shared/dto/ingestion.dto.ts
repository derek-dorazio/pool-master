/**
 * Ingestion DTOs (#205) — providers, sync submissions and their history, competitors a
 * provider could not match, the stale-event cleanup, and the provider catalog browse.
 * Every operation is root-admin; `admin` is the permission, `ingestion` is what they administer.
 */
import { z } from 'zod';
import { ProviderSyncRunStatus, Sport } from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';
import { EventStatusDtoSchema } from './events.dto';
import { registerSchema } from './schema-registry';

const SportDtoSchema = z.nativeEnum(Sport);

export const IngestionFeedTypeSchema = z.enum([
  'EVENTSCHEDULE',
  'EVENTPARTICIPANTS',
  'EVENTLIVESCORES',
  'EVENTRESULTS',
]).describe('Explicit ingestion feed type requested by the caller.');
export type IngestionFeedType = z.infer<typeof IngestionFeedTypeSchema>;

export const SportSyncRequestSchema = z.object({
  feeds: z.array(z.enum(['EVENTSCHEDULE'])).min(1).describe(
    'Feed types to run for a sport-level sync request. Event participant, live-score, result, and odds hydration are event-scoped and must use the event sync endpoint.',
  ),
  from: DateTimeSchema.optional().describe('Optional lower bound for sport-level event discovery.'),
  to: DateTimeSchema.optional().describe('Optional upper bound for sport-level event discovery.'),
}).describe('Feed-aware sport sync request.');
export type SportSyncRequest = z.infer<typeof SportSyncRequestSchema>;

export const MockEventStateSchema = z.enum([
  'open',
  'locked',
  'live',
  'completed',
  'golf-pre-live',
  'golf-r1-in-progress',
  'golf-r1-complete',
  'golf-r2-complete',
  'golf-correction',
  'golf-r4-complete-pending-final',
  'golf-playoff',
  'golf-completed',
  'golf-late-correction',
]).describe(
  'Mock-provider-only event state override for manual QA event syncs.',
);
export type MockEventState = z.infer<typeof MockEventStateSchema>;

export const EventSyncRequestSchema = z.object({
  feeds: z.array(z.enum(['EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'EVENTRESULTS'])).min(1).describe(
    'Feed types to run for a specific event sync request.',
  ),
  mockEventState: MockEventStateSchema.optional().describe(
    'Optional mock-provider-only event state override for manual QA event syncs.',
  ),
}).describe('Feed-aware event sync request.');
export type EventSyncRequest = z.infer<typeof EventSyncRequestSchema>;

// --- Providers ---

export const ProviderHealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'DOWN']);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const ProviderSummaryDtoSchema = z.object({
  providerId: z.string().describe('Registered provider identifier.'),
  providerName: z.string().describe('Provider display name.'),
  status: ProviderHealthStatusSchema.describe('Health from a live check made for this request.'),
  errorRate: z.number().describe('Provider-reported error rate over the last hour.'),
  latencyMs: z.number().describe('Provider-reported p95 latency.'),
  lastEventAt: DateTimeSchema.nullable().describe('When one of the provider\'s events last changed, else its last successful poll; null when neither is known.'),
  sportsCovered: z.array(SportDtoSchema).describe('Sports the provider covers that ingestion is scheduled for.'),
  activeEventCount: z.number().int().describe('The provider\'s events that are scheduled or in progress.'),
  supportsLiveSimulation: z.boolean().describe('True when the provider can play a linked event\'s live scoring forward on its own clock (startEventLiveSimulation). Only the QA mock feed can.'),
}).describe('A registered sports-data provider with its live health.');
export type ProviderSummaryDto = z.infer<typeof ProviderSummaryDtoSchema>;

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSummaryDtoSchema),
}).describe('Every registered provider.');
export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>;

// --- Sync runs ---

export const ProviderSyncRunStatusSchema = z.nativeEnum(ProviderSyncRunStatus);

export const ProviderSyncOutcomeSeveritySchema = z.enum(['SUCCESS', 'WARNING', 'ERROR']);
export type ProviderSyncOutcomeSeverity = z.infer<typeof ProviderSyncOutcomeSeveritySchema>;

export const ProviderSyncWarningDtoSchema = z.object({
  code: z.string().describe('Stable warning code emitted by the ingestion/sync layer.'),
  message: z.string().describe('Human-readable warning detail for root-admin investigation.'),
}).describe('Warning emitted for a provider sync run that completed but needs operator attention.');
export type ProviderSyncWarningDto = z.infer<typeof ProviderSyncWarningDtoSchema>;

export const ProviderSyncOutcomeDtoSchema = z.object({
  severity: ProviderSyncOutcomeSeveritySchema.describe('Admin-facing severity derived from run status, errors, and warnings.'),
  summary: z.string().describe('Human-readable root-admin summary of the sync outcome.'),
  warnings: z.array(ProviderSyncWarningDtoSchema).describe('Warnings that did not fail the run but should be visible to an operator.'),
  errors: z.number().int().min(0).describe('Count of errors captured for the run.'),
}).describe('Admin-facing outcome summary for a provider sync run.');
export type ProviderSyncOutcomeDto = z.infer<typeof ProviderSyncOutcomeDtoSchema>;

export const ProviderSyncProviderPayloadDtoSchema = z.object({
  operation: IngestionFeedTypeSchema.describe('Provider feed operation represented by this payload.'),
  rawCaptured: z.boolean().describe('Whether raw provider response JSON was captured for this run.'),
  rawTruncated: z.boolean().describe('Whether the captured raw provider payload was truncated before storage.'),
  raw: z.unknown().optional().describe('Raw provider response JSON retained for debugging when capture is available.'),
}).passthrough().describe('Raw/debug provider payload captured for a provider sync run.');
export type ProviderSyncProviderPayloadDto = z.infer<typeof ProviderSyncProviderPayloadDtoSchema>;

export const ProviderSyncJobPayloadDtoSchema = z.object({
  jobType: z.string().describe('Internal ingestion job type that executed this sync feed.'),
  providerId: z.string().describe('Provider that executed the ingestion job.'),
  sport: SportDtoSchema,
  eventExternalId: z.string().optional().describe('External event id for event-scoped jobs, when applicable.'),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).describe('Internal ingestion job status.'),
  startedAt: z.string().datetime().optional().describe('When the ingestion job started.'),
  completedAt: z.string().datetime().optional().describe('When the ingestion job completed.'),
  recordsProcessed: z.number().int().min(0).describe('Canonical records processed by the ingestion job.'),
  errors: z.number().int().min(0).describe('Error count captured by the ingestion job.'),
  errorLog: z.array(z.unknown()).describe('Raw ingestion error-log entries for root-admin investigation.'),
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
  before: z.unknown().optional().describe('Normalized before-state JSON for UPDATED or DELETED rows.'),
  after: z.unknown().optional().describe('Normalized after-state JSON for CREATED or UPDATED rows.'),
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
}).describe('Normalized write-effect diagnostics for a provider sync run. Field syncs intentionally retain one row per normalized event participant so an 80-player Golf field can be reviewed without diffing raw JSON; raw provider payload JSON remains a separate debug payload.');
export type ProviderSyncWriteDiagnosticsDto = z.infer<typeof ProviderSyncWriteDiagnosticsDtoSchema>;

export const ProviderSyncRunPayloadDtoSchema = z.object({
  runType: z.string().optional().describe('Sync run source, such as manual/scheduled sport sync or manual/scheduled event sync.'),
  requestedFeeds: z.array(IngestionFeedTypeSchema).optional().describe('Feeds represented by the originating manual or scheduled sync request.'),
  requestedFeed: IngestionFeedTypeSchema.optional().describe('Single feed represented by this sync run row.'),
  requestPayload: JsonObjectSchema.optional().describe('Normalized request context that submitted the sync run, including source and actor diagnostics. Sport-scope runs include requested/effective window fields; event-scope runs omit window fields by design.'),
  providerPayload: ProviderSyncProviderPayloadDtoSchema.optional().describe('Raw/debug provider payload captured for this run.'),
  jobPayload: ProviderSyncJobPayloadDtoSchema.optional().describe('Serialized ingestion job details after an ingestion job is available.'),
  writeDiagnostics: ProviderSyncWriteDiagnosticsDtoSchema.optional().describe('Normalized created/updated/deleted/unchanged row diagnostics for PoolMaster writes.'),
  outcome: ProviderSyncOutcomeDtoSchema.optional().describe('Admin-facing outcome and warning summary for the sync run.'),
  stats: z.record(z.number()).optional().describe('Canonical numeric sync stats used by admin diagnostics.'),
  recordsProcessed: z.number().optional().describe('Legacy top-level processed-record count retained for summary compatibility.'),
  errors: z.number().optional().describe('Legacy top-level error count retained for summary compatibility.'),
  detail: z.string().optional().describe('Legacy human-readable detail retained for summary compatibility.'),
}).passthrough().describe('Provider sync run diagnostic payload.');
export type ProviderSyncRunPayloadDto = z.infer<typeof ProviderSyncRunPayloadDtoSchema>;

export const ProviderSyncRunDtoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  sport: SportDtoSchema,
  eventId: z.string().nullable().describe('Provider event identifier when the run was narrowed to one event; null for a whole-sport run.'),
  status: ProviderSyncRunStatusSchema,
  startedAt: DateTimeSchema.nullable(),
  completedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema.describe('When the run was submitted.'),
  payload: ProviderSyncRunPayloadDtoSchema.describe('Provider sync diagnostic payload with canonical stats plus raw provider/job drill-downs.'),
}).describe('One feed\'s sync against a provider, with its diagnostics.');
export type ProviderSyncRunDto = z.infer<typeof ProviderSyncRunDtoSchema>;

export const ProviderSyncRunListQuerySchema = z.object({
  providerId: z.string().optional(),
  sport: SportDtoSchema.optional(),
  status: ProviderSyncRunStatusSchema.optional(),
  from: DateTimeSchema.optional().describe('Earliest submission time to include. Defaults to 6 hours before `to`.'),
  to: DateTimeSchema.optional().describe('Latest submission time to include. Defaults to now.'),
}).describe('Filters over the sync-run history. A submission-time window bounds it; nothing pages it.');
export type ProviderSyncRunListQuery = z.infer<typeof ProviderSyncRunListQuerySchema>;

export const ProviderSyncRunListResponseSchema = z.object({
  syncRuns: z.array(ProviderSyncRunDtoSchema),
}).describe('Sync runs submitted inside the requested window.');
export type ProviderSyncRunListResponse = z.infer<typeof ProviderSyncRunListResponseSchema>;

export const ProviderManualSyncSubmissionResponseSchema = z.object({
  sport: SportDtoSchema,
  eventId: z.string().nullable(),
  requestedFeeds: z.array(IngestionFeedTypeSchema),
  submittedAt: DateTimeSchema,
  syncRuns: z.array(ProviderSyncRunDtoSchema),
}).describe('A manual sync submission. The runs execute asynchronously after the request is accepted.');
export type ProviderManualSyncSubmissionResponse = z.infer<typeof ProviderManualSyncSubmissionResponseSchema>;

// --- Unmapped provider participants ---

export const UnmappedProviderParticipantDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  externalId: z.string().describe('The provider\'s identifier for the competitor.'),
  externalName: z.string().describe('The competitor\'s name as the provider reports it.'),
  sport: SportDtoSchema,
}).describe('A competitor a provider reports that no participant is mapped to — their synced data has nowhere to land until one is.');
export type UnmappedProviderParticipantDto = z.infer<typeof UnmappedProviderParticipantDtoSchema>;

export const UnmappedProviderParticipantListResponseSchema = z.object({
  participants: z.array(UnmappedProviderParticipantDtoSchema),
}).describe('Every unmapped competitor across the scheduled sports of every provider.');
export type UnmappedProviderParticipantListResponse = z.infer<typeof UnmappedProviderParticipantListResponseSchema>;

// --- Stale provider event cleanup ---

export const ProviderEventCleanupModeSchema = z.enum(['DRY_RUN', 'EXECUTE']);
export type ProviderEventCleanupMode = z.infer<typeof ProviderEventCleanupModeSchema>;

export const ProviderEventCleanupRequestSchema = z.object({
  mode: ProviderEventCleanupModeSchema.describe('DRY_RUN inventories stale event rows without deleting. EXECUTE deletes rows that are eligible and not contest-referenced.'),
}).describe('Stale provider event cleanup request.');
export type ProviderEventCleanupRequest = z.infer<typeof ProviderEventCleanupRequestSchema>;

export const ProviderEventCleanupGroupDtoSchema = z.object({
  key: z.string().describe('Grouping key, such as a sport, provider id, or status.'),
  eventCount: z.number().int().min(0).describe('Number of inventoried stale events in this group.'),
  deletableEventCount: z.number().int().min(0).describe('Number of events in this group eligible for deletion.'),
  deletedEventCount: z.number().int().min(0).describe('Number of events in this group deleted by this request. Zero for dry runs.'),
}).describe('Grouped stale event cleanup inventory counts.');
export type ProviderEventCleanupGroupDto = z.infer<typeof ProviderEventCleanupGroupDtoSchema>;

export const ProviderEventCleanupSummaryDtoSchema = z.object({
  inventoriedEventCount: z.number().int().min(0).describe('Total stale provider events inventoried by the cleanup rules.'),
  deletableEventCount: z.number().int().min(0).describe('Inventoried events eligible for deletion.'),
  blockedEventCount: z.number().int().min(0).describe('Inventoried events retained because contest or pick references protect them.'),
  deletedEventCount: z.number().int().min(0).describe('Events deleted by this request. Zero for dry runs.'),
  sportEventParticipantCount: z.number().int().min(0).describe('Event participant rows attached to inventoried stale events.'),
  valuationCount: z.number().int().min(0).describe('Event participant valuation rows attached to inventoried stale events.'),
  roundCount: z.number().int().min(0).describe('Per-round participant rows attached to inventoried stale events.'),
  pickCount: z.number().int().min(0).describe('Contest entry pick rows referencing inventoried stale event participants. These protect an event from deletion.'),
}).describe('Aggregate stale provider event cleanup summary.');
export type ProviderEventCleanupSummaryDto = z.infer<typeof ProviderEventCleanupSummaryDtoSchema>;

export const ProviderEventCleanupRowDtoSchema = z.object({
  id: z.string().uuid().describe('Internal SportEvent identifier.'),
  providerId: z.string().describe('Provider/source associated with the stale event row.'),
  externalId: z.string().describe('Provider-side event identifier.'),
  sport: z.string().describe('Persisted sport string associated with the event row. This allows cleanup to inventory legacy stale sports that are no longer active enum values.'),
  name: z.string().describe('Current persisted event name.'),
  status: z.string().describe('Current persisted event status.'),
  startDate: z.string().datetime().describe('Persisted event start date.'),
  endDate: z.string().datetime().nullable().describe('Persisted event end date, when known.'),
  staleReason: z.enum(['NON_GOLF_EVENT', 'PAST_GOLF_EVENT']).describe('Cleanup rule that selected this stale event for inventory.'),
  deletable: z.boolean().describe('Whether EXECUTE mode will delete this event.'),
  deleted: z.boolean().describe('Whether this request deleted this event. Always false for dry runs.'),
  blockedReasons: z.array(z.enum(['DIRECT_CONTEST_REFERENCE', 'CONTEST_ENTRY_PICK_REFERENCE'])).describe('Contest-related references that protect this event from deletion.'),
  directContestCount: z.number().int().min(0).describe('Number of Contest rows directly pointing at this event.'),
  sportEventParticipantCount: z.number().int().min(0).describe('Number of SportEventParticipant rows attached to this event.'),
  valuationCount: z.number().int().min(0).describe('Number of participants with a SportEventParticipantValuation (tier/price) row attached through this event.'),
  roundCount: z.number().int().min(0).describe('Number of per-round participant rows (SportEventParticipantRound) attached through this event.'),
  pickCount: z.number().int().min(0).describe('Number of ContestEntryPick rows referencing participants in this event.'),
}).describe('Single stale provider event cleanup inventory row.');
export type ProviderEventCleanupRowDto = z.infer<typeof ProviderEventCleanupRowDtoSchema>;

export const ProviderEventCleanupResponseSchema = z.object({
  mode: ProviderEventCleanupModeSchema.describe('Requested cleanup mode.'),
  executed: z.boolean().describe('Whether this request performed deletion.'),
  inventoriedAt: z.string().datetime().describe('When the inventory was computed.'),
  summary: ProviderEventCleanupSummaryDtoSchema,
  bySport: z.array(ProviderEventCleanupGroupDtoSchema).describe('Inventory grouped by event sport.'),
  byProvider: z.array(ProviderEventCleanupGroupDtoSchema).describe('Inventory grouped by provider id.'),
  byStatus: z.array(ProviderEventCleanupGroupDtoSchema).describe('Inventory grouped by persisted event status.'),
  events: z.array(ProviderEventCleanupRowDtoSchema).describe('Per-event cleanup inventory rows.'),
}).describe('Stale provider event cleanup result: the inventory, and what an EXECUTE deleted.');
export type ProviderEventCleanupResponse = z.infer<typeof ProviderEventCleanupResponseSchema>;

// --- Provider catalog browse (plans/124 §3.4/§4.4/§5.1) ---
//
// Lives in ingestion rather than golf because it is about a provider's catalog, not golf
// domain state — reusable when another sport needs tournament-creation browse or score-source
// linking. A plain filtered list: no scoring, no ranking.

export const ProviderEventDtoSchema = z.object({
  externalId: z.string().describe('The provider\'s identifier for the event.'),
  providerId: z.string(),
  sport: SportDtoSchema,
  name: z.string(),
  venue: z.string().nullable(),
  location: z.string().nullable(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.nullable(),
  status: EventStatusDtoSchema,
  rounds: z.number().int().nullable(),
  participantCount: z.number().int().nullable().describe('Field size the provider reports, when it reports one.'),
  fieldLocked: z.boolean().describe('Whether the provider has locked the field.'),
  metadata: JsonObjectSchema.describe('Provider-emitted event metadata, unnormalized.'),
}).describe('An event as a provider\'s live catalog reports it — not a persisted SportEvent. Creating a tournament from it, or linking one as its score source, is what persists it.');
export type ProviderEventDto = z.infer<typeof ProviderEventDtoSchema>;

export const ProviderCatalogEventListQuerySchema = z.object({
  sport: SportDtoSchema,
  sportLeagueId: z.string().optional().describe('Resolves to that league\'s matchKeyword and keeps events whose provider tour name equals it (ignoring case) or whose name contains it. A league with no matchKeyword contributes no filter.'),
  from: DateTimeSchema.optional().describe('Only events starting at or after this. Omit both from and to for every event the provider has; there is no default window around today.'),
  to: DateTimeSchema.optional().describe('Only events starting at or before this.'),
  search: z.string().optional(),
}).describe('Filters over a provider\'s live catalog.');
export type ProviderCatalogEventListQuery = z.infer<typeof ProviderCatalogEventListQuerySchema>;

export const ProviderCatalogEventListResponseSchema = z.object({
  events: z.array(ProviderEventDtoSchema),
}).describe('Live provider catalog browse results — serves both tournament-creation browse and score-source linking.');
export type ProviderCatalogEventListResponse = z.infer<typeof ProviderCatalogEventListResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('SportSyncRequest', SportSyncRequestSchema);
registerSchema('EventSyncRequest', EventSyncRequestSchema);
registerSchema('ProviderSummaryDto', ProviderSummaryDtoSchema);
registerSchema('ProviderListResponse', ProviderListResponseSchema);
registerSchema('ProviderSyncRunDto', ProviderSyncRunDtoSchema);
registerSchema('ProviderSyncRunListQuery', ProviderSyncRunListQuerySchema);
registerSchema('ProviderSyncRunListResponse', ProviderSyncRunListResponseSchema);
registerSchema('ProviderManualSyncSubmissionResponse', ProviderManualSyncSubmissionResponseSchema);
registerSchema('UnmappedProviderParticipantDto', UnmappedProviderParticipantDtoSchema);
registerSchema('UnmappedProviderParticipantListResponse', UnmappedProviderParticipantListResponseSchema);
registerSchema('ProviderEventCleanupRequest', ProviderEventCleanupRequestSchema);
registerSchema('ProviderEventCleanupRowDto', ProviderEventCleanupRowDtoSchema);
registerSchema('ProviderEventCleanupResponse', ProviderEventCleanupResponseSchema);
registerSchema('ProviderEventDto', ProviderEventDtoSchema);
registerSchema('ProviderCatalogEventListQuery', ProviderCatalogEventListQuerySchema);
registerSchema('ProviderCatalogEventListResponse', ProviderCatalogEventListResponseSchema);
