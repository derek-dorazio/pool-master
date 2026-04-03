/**
 * Admin DTOs — request/response schemas for admin panel endpoints.
 */
import { z } from 'zod';
import { PaginatedSchema } from './common.dto';

// --- Response Sub-schemas ---

export const MetricValueDtoSchema = z.object({
  value: z.number(),
  trend: z.number(),
});
export type MetricValueDto = z.infer<typeof MetricValueDtoSchema>;

export const PlatformMetricsResponseSchema = z.object({
  activeTenants: MetricValueDtoSchema,
  totalUsers: MetricValueDtoSchema,
  activeContests: MetricValueDtoSchema,
  liveDrafts: MetricValueDtoSchema,
  notificationRate: MetricValueDtoSchema,
});
export type PlatformMetricsResponse = z.infer<typeof PlatformMetricsResponseSchema>;

export const TenantDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  members: z.number(),
  leagues: z.number(),
  contests: z.number(),
  status: z.string(),
  lastActive: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type TenantDto = z.infer<typeof TenantDtoSchema>;

export const TenantDetailDtoSchema = TenantDtoSchema.extend({
  usage: z.object({
    leagues: z.object({ current: z.number(), limit: z.number() }),
    contests: z.object({ current: z.number(), limit: z.number() }),
    members: z.object({ current: z.number(), limit: z.number() }),
  }),
  recentSignups: z.array(z.object({
    email: z.string(),
    date: z.string().datetime(),
  })),
  membersList: z.array(z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    role: z.string(),
    lastActive: z.string().datetime(),
  })),
  leaguesList: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sport: z.string(),
    members: z.number(),
    contests: z.number(),
  })),
  contestsList: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sport: z.string(),
    type: z.string(),
    status: z.string(),
    entries: z.number(),
  })),
  activity: z.array(z.object({
    id: z.string(),
    timestamp: z.string().datetime(),
    action: z.string(),
    description: z.string(),
  })),
});
export type TenantDetailDto = z.infer<typeof TenantDetailDtoSchema>;

export const UserResultDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tenants: z.array(z.string()),
  lastLogin: z.string().datetime(),
  status: z.string(),
});
export type UserResultDto = z.infer<typeof UserResultDtoSchema>;

export const UserDetailDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  status: z.string(),
  authProvider: z.string(),
  createdAt: z.string().datetime(),
  lastLogin: z.string().datetime(),
  locale: z.string(),
  tenantMemberships: z.array(z.object({
    tenantId: z.string(),
    tenantName: z.string(),
    role: z.string(),
  })),
  leagueMemberships: z.array(z.object({
    leagueId: z.string(),
    leagueName: z.string(),
    sport: z.string(),
    role: z.string(),
  })),
  contests: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sport: z.string(),
    status: z.string(),
    rank: z.number(),
  })),
  devices: z.array(z.object({
    id: z.string(),
    platform: z.string(),
    lastActive: z.string().datetime(),
    tokenStatus: z.string(),
  })),
  authEvents: z.array(z.object({
    id: z.string(),
    type: z.string(),
    timestamp: z.string().datetime(),
    ip: z.string(),
    success: z.boolean(),
  })),
});
export type UserDetailDto = z.infer<typeof UserDetailDtoSchema>;

export const FeatureFlagDtoSchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  rolloutPct: z.number(),
  overridesCount: z.number(),
  owner: z.string(),
  lastUpdated: z.string(),
});
export type FeatureFlagDto = z.infer<typeof FeatureFlagDtoSchema>;

export const AnnouncementDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  type: z.string(),
  severity: z.string(),
  target: z.string(),
  status: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  dismissable: z.boolean(),
  linkUrl: z.string().optional(),
  linkText: z.string().optional(),
});
export type AnnouncementDto = z.infer<typeof AnnouncementDtoSchema>;

export const TenantListItemDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  planTier: z.string(),
  memberCount: z.number(),
  contestCount: z.number(),
  leagueCount: z.number(),
  status: z.enum(['active', 'suspended', 'trial']),
  lastActiveAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type TenantListItemDto = z.infer<typeof TenantListItemDtoSchema>;

export const TenantListResponseSchema = PaginatedSchema(TenantListItemDtoSchema);
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;

export const TenantRecentMemberDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  createdAt: z.string().datetime(),
});
export type TenantRecentMemberDto = z.infer<typeof TenantRecentMemberDtoSchema>;

export const TenantDetailResponseSchema = z.object({
  tenant: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    planTier: z.string(),
    settings: z.record(z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  memberCount: z.number(),
  leagueCount: z.number(),
  contestCount: z.number(),
  activeContestCount: z.number(),
  status: z.enum(['active', 'suspended', 'trial']),
  lastActiveAt: z.string().datetime().optional(),
  recentMembers: z.array(TenantRecentMemberDtoSchema),
});
export type TenantDetailResponse = z.infer<typeof TenantDetailResponseSchema>;

export const UserTenantMembershipDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
});
export type UserTenantMembershipDto = z.infer<typeof UserTenantMembershipDtoSchema>;

export const UserListItemDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  tenants: z.array(UserTenantMembershipDtoSchema),
  lastLoginAt: z.string().datetime().optional(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string().datetime(),
});
export type UserListItemDto = z.infer<typeof UserListItemDtoSchema>;

export const UserListResponseSchema = PaginatedSchema(UserListItemDtoSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const UserTenantDetailDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  joinedAt: z.string().datetime(),
});
export type UserTenantDetailDto = z.infer<typeof UserTenantDetailDtoSchema>;

export const UserLeagueDetailDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport: z.string(),
  role: z.string(),
  tenantName: z.string(),
});
export type UserLeagueDetailDto = z.infer<typeof UserLeagueDetailDtoSchema>;

export const UserContestDetailDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sport: z.string(),
  status: z.string(),
  rank: z.number().optional(),
});
export type UserContestDetailDto = z.infer<typeof UserContestDetailDtoSchema>;

export const UserDeviceDtoSchema = z.object({
  id: z.string(),
  platform: z.string(),
  lastActiveAt: z.string().datetime(),
  tokenStatus: z.string(),
});
export type UserDeviceDto = z.infer<typeof UserDeviceDtoSchema>;

export const UserAuthEventDtoSchema = z.object({
  type: z.string(),
  timestamp: z.string().datetime(),
  ipAddress: z.string().optional(),
  success: z.boolean(),
});
export type UserAuthEventDto = z.infer<typeof UserAuthEventDtoSchema>;

export const UserDetailResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  authProvider: z.string().optional(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().optional(),
  tenants: z.array(UserTenantDetailDtoSchema),
  leagues: z.array(UserLeagueDetailDtoSchema),
  activeContests: z.array(UserContestDetailDtoSchema),
  devices: z.array(UserDeviceDtoSchema),
  recentAuthEvents: z.array(UserAuthEventDtoSchema),
});
export type UserDetailResponse = z.infer<typeof UserDetailResponseSchema>;

export const AdminServiceDependencyDtoSchema = z.object({
  name: z.string(),
  status: z.enum(['UP', 'DOWN']),
  latencyMs: z.number(),
});
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
});
export type AdminServiceHealthDto = z.infer<typeof AdminServiceHealthDtoSchema>;

export const ServiceHealthListResponseSchema = z.object({
  services: z.array(AdminServiceHealthDtoSchema),
});
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
  redis: z.object({
    status: z.enum(['UP', 'DEGRADED', 'DOWN']),
    memoryUsedGb: z.number(),
    memoryMaxGb: z.number(),
    keyCount: z.number(),
    hitRatePercent: z.number(),
    connectedClients: z.number(),
    evictedKeysLast24h: z.number(),
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
  checkedAt: z.string().datetime(),
});
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
  checkedAt: z.string().datetime(),
});
export type BusinessMetricsResponse = z.infer<typeof BusinessMetricsResponseSchema>;

export const ErrorLogEntryDtoSchema = z.object({
  id: z.string(),
  service: z.string(),
  severity: z.enum(['ERROR', 'CRITICAL', 'WARNING']),
  message: z.string(),
  errorType: z.string(),
  requestId: z.string(),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  stackTrace: z.string(),
  metadata: z.record(z.unknown()),
  occurredAt: z.string().datetime(),
});
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
});
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
});
export type AlertRuleDto = z.infer<typeof AlertRuleDtoSchema>;

export const AlertRulesResponseSchema = z.object({
  rules: z.array(AlertRuleDtoSchema),
});
export type AlertRulesResponse = z.infer<typeof AlertRulesResponseSchema>;

export const AuditEntryDtoSchema = z.object({
  id: z.string(),
  adminUserEmail: z.string(),
  adminUserName: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  description: z.string(),
  reason: z.string().optional(),
  ipAddress: z.string().optional(),
  createdAt: z.string().datetime(),
  hasStateChanges: z.boolean(),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDtoSchema>;

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEntryDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

export const AuditEntryResponseSchema = z.object({
  entry: AuditEntryDtoSchema,
});
export type AuditEntryResponse = z.infer<typeof AuditEntryResponseSchema>;
