/**
 * Admin DTOs — request/response schemas for root-admin endpoints.
 */
import { z } from 'zod';
import { Sport, TeamIconKey as TeamIconKeyEnum, type TeamIconKey } from '@poolmaster/shared/domain';
import { JsonObjectSchema, PaginatedSchema } from './common.dto';
import { UserProfileDtoSchema } from './auth.dto';
import { IngestionFeedTypeSchema } from './ingestion.dto';

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
const TeamIconKeyValues = Object.values(TeamIconKeyEnum) as [TeamIconKey, ...TeamIconKey[]];
// --- Response Sub-schemas ---

export const MetricValueDtoSchema = z.object({
  value: z.number().describe('Current metric value.'),
  trend: z.number().describe('Relative metric change used for directional admin UI.'),
}).describe('Single top-line metric value with trend.');
export type MetricValueDto = z.infer<typeof MetricValueDtoSchema>;

export const PlatformMetricsResponseSchema = z.object({
  activeLeagues: MetricValueDtoSchema,
  totalUsers: MetricValueDtoSchema,
  activeContests: MetricValueDtoSchema,
  liveDrafts: MetricValueDtoSchema,
  notificationRate: MetricValueDtoSchema.describe('Notification throughput metric.'),
}).describe('Top-line platform metrics response.');
export type PlatformMetricsResponse = z.infer<typeof PlatformMetricsResponseSchema>;

export const UserListResponseSchema = PaginatedSchema(UserProfileDtoSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
export const UserViewerAuthorityDtoSchema = z.object({
  self: z.boolean().describe('Whether the current requester is viewing their own user account.'),
  rootAdmin: z.boolean().describe('Whether the current requester has root-admin authority on this account page.'),
  viewer: z.boolean().describe('Fallback viewer state when the requester is neither self nor root admin on this account page.'),
}).describe('Account-page authority flags emitted for the viewed user.');
export type UserViewerAuthorityDto = z.infer<typeof UserViewerAuthorityDtoSchema>;
export const UserDetailResponseSchema = UserProfileDtoSchema.extend({
  viewerAuthority: UserViewerAuthorityDtoSchema,
}).describe('Root-admin user-detail response.');
export type UserDetailResponse = z.infer<typeof UserDetailResponseSchema>;
export const SetUserRootAdminRequestSchema = z.object({
  isRootAdmin: z.boolean().describe('Whether the target user should hold the platform-level root-admin role after the change.'),
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log.'),
}).describe('Root-admin role-change request payload.');
export type SetUserRootAdminRequest = z.infer<typeof SetUserRootAdminRequestSchema>;
export const AdminResetUserPasswordRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log.'),
}).describe('Root-admin initiated password-reset request.');
export type AdminResetUserPasswordRequest = z.infer<typeof AdminResetUserPasswordRequestSchema>;
export const AdminResetUserPasswordResponseSchema = z.object({
  temporaryPassword: z.string().min(8).describe('Temporary password to relay to the user. Existing refresh sessions are revoked and the user should change this after signing in.'),
}).describe('Root-admin password-reset response.');
export type AdminResetUserPasswordResponse = z.infer<typeof AdminResetUserPasswordResponseSchema>;
export const AdminDeleteUserRequestSchema = z.object({
  email: z.string().email().describe('Exact target email confirmation required before permanently deleting the account.'),
  reason: z.string().trim().min(1).max(500).optional().describe('Optional human reason captured in the root-admin audit log.'),
}).describe('Root-admin delete-account confirmation payload.');
export type AdminDeleteUserRequest = z.infer<typeof AdminDeleteUserRequestSchema>;

export const AdminListLeaguesQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional case-insensitive league-name search for root-admin management surfaces.'),
  isActive: z
    .boolean()
    .optional()
    .describe('Optional active/inactive filter for root-admin league management surfaces.'),
}).describe('Root-admin league search query.');
export type AdminListLeaguesQuery = z.infer<typeof AdminListLeaguesQuerySchema>;

export const AdminTeamOwnerSummaryDtoSchema = z.object({
  userId: z.string().uuid(),
  firstName: z.string().optional().describe('First name for the active team owner.'),
  lastName: z.string().optional().describe('Last name for the active team owner.'),
}).describe('Thin owner summary row emitted for root-admin team management surfaces.');
export type AdminTeamOwnerSummaryDto = z.infer<typeof AdminTeamOwnerSummaryDtoSchema>;

export const AdminTeamSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  leagueId: z.string().uuid(),
  leagueCode: z.string().describe('Canonical league code for routing and filtering.'),
  leagueName: z.string().describe('Display name for the team’s parent league.'),
  name: z.string().describe('Team display name.'),
  iconKey: z.enum(TeamIconKeyValues).describe('Selected built-in team icon key from the curated PoolMaster team icon catalog.'),
  isActive: z.boolean().describe('Whether the team is currently active. This is the lifecycle source of truth for root-admin team management surfaces.'),
  ownerCount: z.number().int().describe('Count of active owners attached to the team.'),
  owners: z.array(AdminTeamOwnerSummaryDtoSchema).describe('Active owners attached to the team.'),
  createdAt: z.string().datetime().describe('When the team was created.'),
  updatedAt: z.string().datetime().describe('When the team was last updated.'),
}).describe('Cross-league team summary row for root-admin management surfaces.');
export type AdminTeamSummaryDto = z.infer<typeof AdminTeamSummaryDtoSchema>;

export const AdminListTeamsQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional case-insensitive team-name search for root-admin management surfaces.'),
  leagueCode: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional canonical league-code filter for cross-league team management.'),
  isActive: z
    .boolean()
    .optional()
    .describe('Optional active/inactive filter for root-admin team management surfaces.'),
}).describe('Root-admin team search query.');
export type AdminListTeamsQuery = z.infer<typeof AdminListTeamsQuerySchema>;

export const AdminTeamListResponseSchema = z.object({
  teams: z.array(AdminTeamSummaryDtoSchema),
}).describe('Cross-league team list response for root-admin management surfaces.');
export type AdminTeamListResponse = z.infer<typeof AdminTeamListResponseSchema>;

export const AdminServiceDependencyDtoSchema = z.object({
  name: z.string(),
  status: z.enum(['UP', 'DOWN']),
  latencyMs: z.number(),
}).describe('Dependency health row for an admin service-health response.');
export type AdminServiceDependencyDto = z.infer<typeof AdminServiceDependencyDtoSchema>;

export const AdminServiceHealthDtoSchema = z.object({
  name: z.string(),
  status: z.enum(['UP', 'DEGRADED', 'DOWN']),
  uptimePercent: z.number(),
  errorRatePercent: z.number(),
  p95LatencyMs: z.number(),
  version: z.string(),
  uptimeSeconds: z.number(),
  checkedAt: z.string().datetime(),
  dependencies: z.array(AdminServiceDependencyDtoSchema),
}).describe('Service-health summary used by admin health dashboards.');
export type AdminServiceHealthDto = z.infer<typeof AdminServiceHealthDtoSchema>;

export const ServiceHealthListResponseSchema = z.object({
  services: z.array(AdminServiceHealthDtoSchema),
}).describe('Admin service-health list response.');
export type ServiceHealthListResponse = z.infer<typeof ServiceHealthListResponseSchema>;

export const InfrastructureMetricsResponseSchema = z.object({
  postgres: z.object({
    status: z.enum(['UP', 'DEGRADED', 'DOWN']),
    cpuPercent: z.number(),
    connectionsCurrent: z.number(),
    connectionsMax: z.number(),
    diskUsageGb: z.number(),
    diskTotalGb: z.number(),
    replicationLagMs: z.number(),
    slowQueriesLast24h: z.number(),
  }),
  messageBus: z.object({
    status: z.enum(['UP', 'DEGRADED', 'DOWN']),
    queueDepth: z.number(),
    consumerLagSeconds: z.number(),
    messagesPerSecond: z.number(),
    deadLetterCount: z.number(),
  }),
  s3Cdn: z.object({
    status: z.enum(['UP', 'DEGRADED', 'DOWN']),
    bandwidthGbPerDay: z.number(),
    requestsLast24h: z.number(),
    errorRatePercent: z.number(),
    storageUsedGb: z.number(),
  }),
  checkedAt: z.string().datetime().describe('When the infrastructure metrics snapshot was captured.'),
}).describe('Infrastructure-metrics response for admin dashboards.');
export type InfrastructureMetricsResponse = z.infer<typeof InfrastructureMetricsResponseSchema>;

export const BusinessMetricsResponseSchema = z.object({
  activeUsersLast24h: z.number(),
  websocketConnectionsCurrent: z.number(),
  apiRequestsLast24h: z.number(),
  notificationsSent: z.number(),
  notificationsDelivered: z.number(),
  notificationDeliveryRatePercent: z.number(),
  activeContests: z.number(),
  liveDrafts: z.number(),
  checkedAt: z.string().datetime().describe('When the business metrics snapshot was captured.'),
}).describe('Business-metrics response for admin dashboards.');
export type BusinessMetricsResponse = z.infer<typeof BusinessMetricsResponseSchema>;

export const ProviderHealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'DOWN']);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const ProviderSummaryDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  status: ProviderHealthStatusSchema,
  errorRate: z.number(),
  latencyMs: z.number(),
  lastEventAt: z.string().datetime().nullable(),
  sportsCovered: z.array(SportSchema),
  activeEventCount: z.number(),
}).describe('Provider summary row used across admin ingestion tooling.');
export type ProviderSummaryDto = z.infer<typeof ProviderSummaryDtoSchema>;

export const ProviderHealthCheckDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  status: ProviderHealthStatusSchema,
  errorRate: z.number(),
  latencyMs: z.number(),
  checkedAt: z.string().datetime(),
  details: z.string(),
}).describe('Single provider health-check result.');
export type ProviderHealthCheckDto = z.infer<typeof ProviderHealthCheckDtoSchema>;

export const ProviderIngestionStatDtoSchema = z.object({
  sport: SportSchema,
  providerId: z.string(),
  lastPollAt: z.string().datetime().nullable(),
  lastEventReceivedAt: z.string().datetime().nullable(),
  eventsToday: z.number(),
  errorsToday: z.number(),
  activeEventCount: z.number(),
  contestsDepending: z.number(),
}).describe('Provider ingestion throughput and freshness summary.');
export type ProviderIngestionStatDto = z.infer<typeof ProviderIngestionStatDtoSchema>;

export const ProviderIngestionErrorDtoSchema = z.object({
  providerId: z.string(),
  errorType: z.string(),
  message: z.string(),
  occurredAt: z.string().datetime(),
  eventId: z.string().nullable().optional(),
}).describe('Recent ingestion error row for a provider.');
export type ProviderIngestionErrorDto = z.infer<typeof ProviderIngestionErrorDtoSchema>;

export const ProviderIngestionJobDtoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  sport: SportSchema,
  eventId: z.string().nullable(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  recordsProcessed: z.number(),
  errors: z.number(),
}).describe('Recent or active provider ingestion job.');
export type ProviderIngestionJobDto = z.infer<typeof ProviderIngestionJobDtoSchema>;

export const ProviderSyncRunStatusSchema = z.enum(['SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED']);
export type ProviderSyncRunStatus = z.infer<typeof ProviderSyncRunStatusSchema>;

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
  sport: SportSchema,
  eventExternalId: z.string().optional().describe('External event id for event-scoped jobs, when applicable.'),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).describe('Internal ingestion job status.'),
  startedAt: z.string().datetime().optional().describe('When the ingestion job started.'),
  completedAt: z.string().datetime().optional().describe('When the ingestion job completed.'),
  recordsProcessed: z.number().int().min(0).describe('Canonical records processed by the ingestion job.'),
  errors: z.number().int().min(0).describe('Error count captured by the ingestion job.'),
  errorLog: z.array(z.unknown()).describe('Raw ingestion error-log entries for root-admin investigation.'),
}).describe('Serialized ingestion job details for a provider sync run.');
export type ProviderSyncJobPayloadDto = z.infer<typeof ProviderSyncJobPayloadDtoSchema>;

export const ProviderSyncRunPayloadDtoSchema = z.object({
  runType: z.string().optional().describe('Sync run source, such as manual sport sync or manual event sync.'),
  requestedFeeds: z.array(IngestionFeedTypeSchema).optional().describe('Feeds requested by the root-admin action.'),
  requestedFeed: IngestionFeedTypeSchema.optional().describe('Single feed represented by this sync run row.'),
  requestPayload: JsonObjectSchema.optional().describe('Root-admin request context that submitted the sync run.'),
  providerPayload: ProviderSyncProviderPayloadDtoSchema.optional().describe('Raw/debug provider payload captured for this run.'),
  jobPayload: ProviderSyncJobPayloadDtoSchema.optional().describe('Serialized ingestion job details after an ingestion job is available.'),
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
  sport: SportSchema,
  eventId: z.string().nullable(),
  status: ProviderSyncRunStatusSchema,
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  payload: ProviderSyncRunPayloadDtoSchema.describe('Provider sync diagnostic payload with canonical stats plus raw provider/job drill-downs.'),
}).describe('Recent provider sync run with diagnostic operational details.');
export type ProviderSyncRunDto = z.infer<typeof ProviderSyncRunDtoSchema>;

export const ProviderSyncRunListResponseSchema = z.object({
  items: z.array(ProviderSyncRunDtoSchema),
}).describe('Recent provider sync runs returned for root-admin operational visibility.');
export type ProviderSyncRunListResponse = z.infer<typeof ProviderSyncRunListResponseSchema>;

export const ProviderManualSyncSubmissionResponseSchema = z.object({
  sport: SportSchema,
  eventId: z.string().nullable(),
  requestedFeeds: z.array(IngestionFeedTypeSchema),
  submittedAt: z.string().datetime(),
  syncRuns: z.array(ProviderSyncRunDtoSchema),
}).describe('Manual root-admin sync submission response. The sync runs asynchronously after the request is accepted.');
export type ProviderManualSyncSubmissionResponse = z.infer<typeof ProviderManualSyncSubmissionResponseSchema>;

export const ProviderUnmappedParticipantDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  externalId: z.string(),
  externalName: z.string(),
  sport: SportSchema,
}).describe('Provider participant record that has not yet been mapped to an internal participant.');
export type ProviderUnmappedParticipantDto = z.infer<typeof ProviderUnmappedParticipantDtoSchema>;

export const ProviderUnmappedParticipantListResponseSchema = z.array(ProviderUnmappedParticipantDtoSchema);
export type ProviderUnmappedParticipantListResponse = z.infer<typeof ProviderUnmappedParticipantListResponseSchema>;

export const ProviderDetailResponseSchema = ProviderSummaryDtoSchema.extend({
  recentHealthChecks: z.array(ProviderHealthCheckDtoSchema),
  ingestionStats: z.array(ProviderIngestionStatDtoSchema),
  recentErrors: z.array(ProviderIngestionErrorDtoSchema),
  recentJobs: z.array(ProviderIngestionJobDtoSchema),
  unmappedParticipants: z.array(ProviderUnmappedParticipantDtoSchema),
  mappedParticipantCount: z.number(),
}).describe('Expanded provider detail response.');
export type ProviderDetailResponse = z.infer<typeof ProviderDetailResponseSchema>;

export const ProviderListResponseSchema = z.object({
  items: z.array(ProviderSummaryDtoSchema),
}).describe('Provider-list response.');
export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>;

export const ProviderIngestionDashboardResponseSchema = z.object({
  sportProviderStatus: z.array(ProviderIngestionStatDtoSchema),
  recentErrors: z.array(ProviderIngestionErrorDtoSchema),
  activeJobs: z.array(ProviderIngestionJobDtoSchema),
  recentCompletedJobs: z.array(ProviderIngestionJobDtoSchema),
  throughputPerMinute: z.number(),
}).describe('Admin provider-ingestion dashboard response.');
export type ProviderIngestionDashboardResponse = z.infer<typeof ProviderIngestionDashboardResponseSchema>;

export const ErrorLogEntryDtoSchema = z.object({
  id: z.string(),
  service: z.string(),
  severity: z.enum(['ERROR', 'CRITICAL', 'WARNING']),
  message: z.string(),
  errorType: z.string(),
  requestId: z.string(),
  userId: z.string().optional(),
  stackTrace: z.string(),
  metadata: z.record(z.unknown()),
  occurredAt: z.string().datetime(),
}).describe('Error-log summary row.');
export type ErrorLogEntryDto = z.infer<typeof ErrorLogEntryDtoSchema>;

export const ErrorLogListResponseSchema = PaginatedSchema(ErrorLogEntryDtoSchema);
export type ErrorLogListResponse = z.infer<typeof ErrorLogListResponseSchema>;

export const ErrorLogDetailResponseSchema = ErrorLogEntryDtoSchema.extend({
  httpMethod: z.string().optional(),
  httpPath: z.string().optional(),
  httpStatusCode: z.number().optional(),
  headers: z.record(z.string()).optional(),
  requestBody: z.record(z.unknown()).optional(),
  responseTimeMs: z.number().optional(),
  hostName: z.string(),
  environment: z.string(),
}).describe('Expanded error-log detail response.');
export type ErrorLogDetailResponse = z.infer<typeof ErrorLogDetailResponseSchema>;

export const AlertRuleDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['SERVICE', 'ERROR_RATE', 'INFRASTRUCTURE', 'BUSINESS']),
  isEnabled: z.boolean(),
  isMuted: z.boolean(),
  mutedUntil: z.string().datetime().optional(),
  severity: z.enum(['P1', 'P2', 'P3']),
  channels: z.array(z.enum(['SLACK', 'PAGERDUTY', 'EMAIL'])),
  thresholds: z.record(z.number()),
  windowMinutes: z.number(),
  lastTriggeredAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).describe('Alert-rule configuration row used by admin monitoring surfaces.');
export type AlertRuleDto = z.infer<typeof AlertRuleDtoSchema>;

export const AlertRulesResponseSchema = z.object({
  rules: z.array(AlertRuleDtoSchema),
}).describe('Alert-rules response.');
export type AlertRulesResponse = z.infer<typeof AlertRulesResponseSchema>;

export const AuditEntryDtoSchema = z.object({
  id: z.string(),
  actorEmail: z.string(),
  actorName: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  description: z.string(),
  reason: z.string().optional(),
  ipAddress: z.string().optional(),
  createdAt: z.string().datetime(),
  hasStateChanges: z.boolean(),
}).describe('Admin audit-log entry.');
export type AuditEntryDto = z.infer<typeof AuditEntryDtoSchema>;

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEntryDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
}).describe('Admin audit-log list response.');
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

export const AuditEntryResponseSchema = z.object({
  entry: AuditEntryDtoSchema,
}).describe('Single admin audit-entry response.');
export type AuditEntryResponse = z.infer<typeof AuditEntryResponseSchema>;
