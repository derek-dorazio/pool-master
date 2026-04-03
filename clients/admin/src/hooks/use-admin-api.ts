import { useQuery } from '@tanstack/react-query';
import {
  client,
  adminGetBusinessMetrics,
  adminGetServiceHealth,
  adminGetAlertRules,
  adminListAuditLog,
  adminListTenants,
  adminGetTenantDetail,
  adminListUsers,
  adminGetUserDetail,
} from '@/lib/api';

export interface PlatformMetricCard {
  value: number;
  trend: number;
}

export interface PlatformMetrics {
  activeTenants: PlatformMetricCard;
  totalUsers: PlatformMetricCard;
  activeContests: PlatformMetricCard;
  liveDrafts: PlatformMetricCard;
  notificationRate: PlatformMetricCard;
}

export interface ServiceHealth {
  name: string;
  status: 'green' | 'yellow' | 'red';
}

export interface Alert {
  id: string;
  severity: 'Info' | 'Warning' | 'Critical';
  message: string;
  timestamp: string;
}

export interface AuditEntry {
  id: string;
  adminName: string;
  action: string;
  description: string;
  timestamp: string;
}

export interface TenantFilters {
  search?: string;
  plan?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export interface UserResult {
  id: string;
  email: string;
  displayName: string;
  tenants: { id: string; name: string; role: string }[];
  lastLoginAt?: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

const tenantPlanLabels: Record<string, 'Free' | 'Starter' | 'Pro' | 'League+'> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  league_plus: 'League+',
};

function toPlanLabel(planTier: string): 'Free' | 'Starter' | 'Pro' | 'League+' {
  return tenantPlanLabels[planTier.toLowerCase()] ?? 'Free';
}

function toStatusLabel(status: 'active' | 'suspended' | 'trial'): 'Active' | 'Suspended' | 'Trial' {
  if (status === 'suspended') return 'Suspended';
  if (status === 'trial') return 'Trial';
  return 'Active';
}

function toServiceColor(status: 'UP' | 'DEGRADED' | 'DOWN'): 'green' | 'yellow' | 'red' {
  if (status === 'DOWN') return 'red';
  if (status === 'DEGRADED') return 'yellow';
  return 'green';
}

function toAlertSeverity(severity: 'P1' | 'P2' | 'P3'): 'Info' | 'Warning' | 'Critical' {
  if (severity === 'P1') return 'Critical';
  if (severity === 'P2') return 'Warning';
  return 'Info';
}

function normalizeTenantSort(sortBy?: string): string | undefined {
  switch (sortBy) {
    case 'name':
      return 'name';
    case 'members':
      return 'members';
    case 'lastActive':
      return 'lastActive';
    case 'created':
      return 'created';
    default:
      return undefined;
  }
}

export function useAdminMetrics() {
  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: async () => {
      const [metricsRes, servicesRes, alertsRes, auditRes, tenantRes] = await Promise.all([
        adminGetBusinessMetrics({ client }),
        adminGetServiceHealth({ client }),
        adminGetAlertRules({ client }),
        adminListAuditLog({ client, query: { page: '1', pageSize: '5' } }),
        adminListTenants({ client, query: { page: 1, pageSize: 1 } }),
      ]);

      const metrics: PlatformMetrics = {
        activeTenants: { value: tenantRes.data?.total ?? 0, trend: 0 },
        totalUsers: { value: metricsRes.data?.activeUsersLast24h ?? 0, trend: 0 },
        activeContests: { value: metricsRes.data?.activeContests ?? 0, trend: 0 },
        liveDrafts: { value: metricsRes.data?.liveDrafts ?? 0, trend: 0 },
        notificationRate: { value: Math.round(metricsRes.data?.notificationDeliveryRatePercent ?? 0), trend: 0 },
      };

      return {
        metrics,
        services: (servicesRes.data?.services ?? []).map((service) => ({
          name: service.name,
          status: toServiceColor(service.status),
        })),
        alerts: (alertsRes.data?.rules ?? []).slice(0, 5).map((rule) => ({
          id: rule.id,
          severity: toAlertSeverity(rule.severity),
          message: rule.description || rule.name,
          timestamp: rule.lastTriggeredAt ?? rule.updatedAt,
        })),
        audit: (auditRes.data?.items ?? []).map((entry) => ({
          id: entry.id,
          adminName: entry.adminUserName,
          action: entry.action,
          description: entry.description,
          timestamp: entry.createdAt,
        })),
      };
    },
  });
}

export function useTenantList(filters: TenantFilters) {
  return useQuery({
    queryKey: ['admin', 'tenants', filters],
    queryFn: async () => {
      const query: Record<string, string | number> = {};
      if (filters.search) query.search = filters.search;
      if (filters.plan && filters.plan !== 'All') query.planTier = filters.plan.toLowerCase().replace('+', '_plus');
      if (filters.status && filters.status !== 'All') query.status = filters.status.toLowerCase();
      if (filters.page) query.page = filters.page;
      if (filters.pageSize) query.pageSize = filters.pageSize;
      const sortBy = normalizeTenantSort(filters.sortBy);
      if (sortBy) query.sortBy = sortBy;
      if (filters.sortDir) query.sortDir = filters.sortDir;

      const { data } = await adminListTenants({ client, query });
      if (!data) return data;

      return {
        ...data,
        items: data.items.map((item) => ({
          ...item,
          plan: toPlanLabel(item.planTier),
          members: item.memberCount,
          leagues: item.leagueCount,
          contests: item.contestCount,
          status: toStatusLabel(item.status),
          lastActive: item.lastActiveAt ?? item.createdAt,
        })),
      };
    },
  });
}

export function useTenantDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => {
      const { data } = await adminGetTenantDetail({ client, path: { tenantId: id! } });
      if (!data) return data;

      return {
        ...data,
        name: data.tenant.name,
        slug: data.tenant.slug,
        plan: toPlanLabel(data.tenant.planTier),
        createdAt: data.tenant.createdAt,
        updatedAt: data.tenant.updatedAt,
        statusLabel: toStatusLabel(data.status),
        lastActive: data.lastActiveAt ?? data.tenant.updatedAt,
      };
    },
    enabled: !!id,
  });
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: ['admin', 'users', 'search', query],
    queryFn: async () => {
      const { data } = await adminListUsers({ client, query: { search: query, page: 1, pageSize: 25 } });
      return data;
    },
    enabled: query.length > 0,
  });
}

export function useUserDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: async () => {
      const { data } = await adminGetUserDetail({ client, path: { userId: id! } });
      return data;
    },
    enabled: !!id,
  });
}
