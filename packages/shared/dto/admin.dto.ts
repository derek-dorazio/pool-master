/**
 * Admin DTOs — request/response schemas for admin panel endpoints.
 */
import { z } from 'zod';

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
