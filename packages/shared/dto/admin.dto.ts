/**
 * Admin DTOs — request/response schemas for admin panel endpoints.
 */
import { z } from 'zod';
import { PaginatedSchema } from './common.dto';

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

export const UserLeagueMembershipSummaryDtoSchema = z.object({
  id: z.string().describe('League identifier.'),
  name: z.string().describe('League display name.'),
  role: z.string().describe('User role in the league.'),
}).describe('Compact league summary included in admin user lists.');
export type UserLeagueMembershipSummaryDto = z.infer<typeof UserLeagueMembershipSummaryDtoSchema>;

export const UserListItemDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  leagues: z.array(UserLeagueMembershipSummaryDtoSchema),
  lastLoginAt: z.string().datetime().optional(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string().datetime(),
}).describe('Admin user-list row.');
export type UserListItemDto = z.infer<typeof UserListItemDtoSchema>;

export const UserListResponseSchema = PaginatedSchema(UserListItemDtoSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const UserLeagueDetailDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  joinedAt: z.string().datetime().optional(),
}).describe('Expanded league detail embedded in admin user detail responses.');
export type UserLeagueDetailDto = z.infer<typeof UserLeagueDetailDtoSchema>;

export const UserContestDetailDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport: z.string(),
  status: z.string(),
  rank: z.number().optional(),
}).describe('Active contest detail embedded in admin user detail responses.');
export type UserContestDetailDto = z.infer<typeof UserContestDetailDtoSchema>;

export const UserDeviceDtoSchema = z.object({
  id: z.string(),
  platform: z.string(),
  lastActiveAt: z.string().datetime(),
  tokenStatus: z.string(),
}).describe('Known user device summary.');
export type UserDeviceDto = z.infer<typeof UserDeviceDtoSchema>;

export const UserAuthEventDtoSchema = z.object({
  type: z.string(),
  timestamp: z.string().datetime(),
  ipAddress: z.string().optional(),
  success: z.boolean(),
}).describe('Recent authentication event shown in admin user detail.');
export type UserAuthEventDto = z.infer<typeof UserAuthEventDtoSchema>;

export const UserDetailResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  authProvider: z.string().optional(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().optional(),
  leagues: z.array(UserLeagueDetailDtoSchema),
  activeContests: z.array(UserContestDetailDtoSchema),
  devices: z.array(UserDeviceDtoSchema),
  recentAuthEvents: z.array(UserAuthEventDtoSchema),
}).describe('Admin user-detail response.');
export type UserDetailResponse = z.infer<typeof UserDetailResponseSchema>;

export const MigrationRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type MigrationRunStatus = z.infer<typeof MigrationRunStatusSchema>;

export const MigrationRunProgressDtoSchema = z.object({
  totalRecords: z.number(),
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  percentage: z.number(),
}).describe('Migration run progress snapshot.');
export type MigrationRunProgressDto = z.infer<typeof MigrationRunProgressDtoSchema>;

export const MigrationRunErrorDtoSchema = z.object({
  recordId: z.string(),
  error: z.string(),
  timestamp: z.string().datetime(),
}).describe('Migration run error record.');
export type MigrationRunErrorDto = z.infer<typeof MigrationRunErrorDtoSchema>;

export const MigrationStartedByDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
}).describe('User that started a migration run.');
export type MigrationStartedByDto = z.infer<typeof MigrationStartedByDtoSchema>;

export const MigrationDefinitionDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  estimatedRecords: z.number(),
  lastRunAt: z.string().datetime().nullable(),
  lastRunStatus: MigrationRunStatusSchema.nullable(),
}).describe('Migration definition available in admin tooling.');
export type MigrationDefinitionDto = z.infer<typeof MigrationDefinitionDtoSchema>;

export const MigrationRunDtoSchema = z.object({
  id: z.string(),
  migrationId: z.string(),
  migrationName: z.string(),
  status: MigrationRunStatusSchema,
  dryRun: z.boolean(),
  progress: MigrationRunProgressDtoSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  startedBy: MigrationStartedByDtoSchema,
  errors: z.array(MigrationRunErrorDtoSchema),
}).describe('Migration run record returned by admin migration APIs.');
export type MigrationRunDto = z.infer<typeof MigrationRunDtoSchema>;

export const StartMigrationRunRequestSchema = z.object({
  migrationId: z.string().min(1),
  dryRun: z.boolean().optional(),
  batchSize: z.number().int().min(1).optional(),
}).describe('Request payload for starting an admin migration run.');
export type StartMigrationRunRequest = z.infer<typeof StartMigrationRunRequestSchema>;

export const MigrationListResponseSchema = z.object({
  available: z.array(MigrationDefinitionDtoSchema),
  activeRuns: z.array(MigrationRunDtoSchema),
  recentHistory: z.array(MigrationRunDtoSchema),
}).describe('Admin migration overview response.');
export type MigrationListResponse = z.infer<typeof MigrationListResponseSchema>;

export const MigrationRunResponseSchema = z.object({
  run: MigrationRunDtoSchema,
}).describe('Single migration-run response.');
export type MigrationRunResponse = z.infer<typeof MigrationRunResponseSchema>;

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
  sportsCovered: z.array(z.string()),
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
  sport: z.string(),
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
  sport: z.string(),
  eventId: z.string().nullable(),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  recordsProcessed: z.number(),
  errors: z.number(),
}).describe('Recent or active provider ingestion job.');
export type ProviderIngestionJobDto = z.infer<typeof ProviderIngestionJobDtoSchema>;

export const ProviderUnmappedParticipantDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  externalId: z.string(),
  externalName: z.string(),
  sport: z.string(),
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

export const ContestListItemDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  leagueName: z.string(),
  sport: z.string(),
  contestType: z.string(),
  selectionType: z.string(),
  status: z.string(),
  entryCount: z.number(),
  createdAt: z.string().datetime(),
}).describe('Admin contest-list row.');
export type ContestListItemDto = z.infer<typeof ContestListItemDtoSchema>;

export const AdminContestListResponseSchema = z.object({
  items: z.array(ContestListItemDtoSchema).describe('Contest page or slice returned by the API.'),
  total: z.number().describe('Total contests matching the admin query.'),
}).describe('Admin contest-list response.');
export type AdminContestListResponse = z.infer<typeof AdminContestListResponseSchema>;

export const ContestEntryStandingDtoSchema = z.object({
  entryId: z.string(),
  entryName: z.string(),
  ownerEmail: z.string(),
  standingsPosition: z.number(),
  totalScore: z.number(),
}).describe('Admin-facing standing row for a contest entry.');
export type ContestEntryStandingDto = z.infer<typeof ContestEntryStandingDtoSchema>;

export const ContestDraftStatusDtoSchema = z.object({
  status: z.string(),
  currentPick: z.number(),
  totalPicks: z.number(),
  startedAt: z.string().datetime().nullable().optional(),
}).describe('Current draft status snapshot for a contest.');
export type ContestDraftStatusDto = z.infer<typeof ContestDraftStatusDtoSchema>;

export const AdminDraftPickHistoryDtoSchema = z.object({
  round: z.number(),
  pick: z.number(),
  participant: z.string(),
  owner: z.string(),
  autoPicked: z.boolean(),
  time: z.string().datetime(),
}).describe('Draft pick-history row shown in admin contest detail.');
export type AdminDraftPickHistoryDto = z.infer<
  typeof AdminDraftPickHistoryDtoSchema
>;

export const ContestOverrideDtoSchema = z.object({
  id: z.string(),
  adminEmail: z.string(),
  entryId: z.string(),
  oldScore: z.number(),
  newScore: z.number(),
  reason: z.string(),
  createdAt: z.string().datetime(),
}).describe('Manual score override record.');
export type ContestOverrideDto = z.infer<typeof ContestOverrideDtoSchema>;

export const ContestRankChangeDtoSchema = z.object({
  entryId: z.string(),
  oldRank: z.number(),
  newRank: z.number(),
}).describe('Per-entry rank change returned from a contest recalculation.');
export type ContestRankChangeDto = z.infer<typeof ContestRankChangeDtoSchema>;

export const ContestRecalculationResultDtoSchema = z.object({
  contestId: z.string(),
  entriesAffected: z.number(),
  rankChanges: z.array(ContestRankChangeDtoSchema),
  recalculatedAt: z.string().datetime(),
}).describe('Contest recalculation result summary.');
export type ContestRecalculationResultDto = z.infer<typeof ContestRecalculationResultDtoSchema>;

export const ContestAdminDetailResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport: z.string(),
  contestType: z.string(),
  selectionType: z.string(),
  scoringEngine: z.string(),
  status: z.string(),
  leagueName: z.string(),
  leagueId: z.string(),
  entryCount: z.number(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  lockAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  standings: z.array(ContestEntryStandingDtoSchema),
  draftStatus: ContestDraftStatusDtoSchema.optional(),
  draftPickHistories: z.array(AdminDraftPickHistoryDtoSchema),
  scoringFreshness: z.object({
    lastStatEvent: z.string().datetime().nullable().optional(),
    isStale: z.boolean(),
    staleMinutes: z.number(),
  }),
  statEventCount: z.number(),
  correctionsApplied: z.number(),
  overrides: z.array(ContestOverrideDtoSchema),
}).describe('Expanded contest detail used by admin contest-management surfaces.');
export type ContestAdminDetailResponse = z.infer<typeof ContestAdminDetailResponseSchema>;

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
