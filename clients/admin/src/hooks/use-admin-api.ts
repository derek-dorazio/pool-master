import { useQuery } from '@tanstack/react-query';
import {
  client,
  adminGetBusinessMetrics,
  adminGetServiceHealth,
  adminListTenants,
  adminGetTenantDetail,
  adminListUsers,
  adminGetUserDetail,
} from '@/lib/api';

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface PlatformMetrics {
  activeTenants: { value: number; trend: number };
  totalUsers: { value: number; trend: number };
  activeContests: { value: number; trend: number };
  liveDrafts: { value: number; trend: number };
  notificationRate: { value: number; trend: number };
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface ServiceHealth {
  name: string;
  status: 'green' | 'yellow' | 'red';
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface Alert {
  id: string;
  severity: 'Info' | 'Warning' | 'Critical';
  message: string;
  timestamp: string;
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface AuditEntry {
  id: string;
  adminName: string;
  action: string;
  description: string;
  timestamp: string;
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'Free' | 'Starter' | 'Pro' | 'League+';
  members: number;
  leagues: number;
  contests: number;
  status: 'Active' | 'Suspended' | 'Trial';
  lastActive: string;
  createdAt: string;
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface TenantDetail extends Tenant {
  usage: {
    leagues: { current: number; limit: number };
    contests: { current: number; limit: number };
    members: { current: number; limit: number };
  };
  recentSignups: { email: string; date: string }[];
  membersList: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    lastActive: string;
  }[];
  leaguesList: {
    id: string;
    name: string;
    sport: string;
    members: number;
    contests: number;
  }[];
  contestsList: {
    id: string;
    name: string;
    sport: string;
    type: string;
    status: string;
    entries: number;
  }[];
  activity: {
    id: string;
    timestamp: string;
    action: string;
    description: string;
  }[];
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface UserResult {
  id: string;
  email: string;
  displayName: string;
  tenants: string[];
  lastLogin: string;
  status: 'Active' | 'Disabled' | 'Pending';
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface UserDetail {
  id: string;
  email: string;
  displayName: string;
  status: 'Active' | 'Disabled' | 'Pending';
  authProvider: string;
  createdAt: string;
  lastLogin: string;
  locale: string;
  tenantMemberships: {
    tenantId: string;
    tenantName: string;
    role: string;
  }[];
  leagueMemberships: {
    leagueId: string;
    leagueName: string;
    sport: string;
    role: string;
  }[];
  contests: {
    id: string;
    name: string;
    sport: string;
    status: string;
    rank: number;
  }[];
  devices: {
    id: string;
    platform: string;
    lastActive: string;
    tokenStatus: 'Valid' | 'Expired' | 'Revoked';
  }[];
  authEvents: {
    id: string;
    type: 'login' | 'logout' | 'password_reset';
    timestamp: string;
    ip: string;
    success: boolean;
  }[];
}

export function useAdminMetrics() {
  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: async () => {
      const [metricsRes, servicesRes] = await Promise.all([
        adminGetBusinessMetrics({ client }),
        adminGetServiceHealth({ client }),
      ]);
      // The generated types are minimal ({ success: true }) for many admin endpoints;
      // cast to the actual shapes the API returns until DTOs are fully wired.
      const metricsData = metricsRes.data as unknown as {
        metrics: PlatformMetrics;
        alerts: Alert[];
        audit: AuditEntry[];
      } | undefined;
      return {
        metrics: metricsData?.metrics,
        services: servicesRes.data as unknown as ServiceHealth[] | undefined,
        alerts: metricsData?.alerts,
        audit: metricsData?.audit,
      };
    },
  });
}

// TODO: migrate to @poolmaster/shared/dto when admin DTOs are created
export interface TenantFilters {
  search?: string;
  plan?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export function useTenantList(filters: TenantFilters) {
  return useQuery({
    queryKey: ['admin', 'tenants', filters],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (filters.search) query.search = filters.search;
      if (filters.plan && filters.plan !== 'All') query.plan = filters.plan;
      if (filters.status && filters.status !== 'All') query.status = filters.status;
      if (filters.page) query.page = String(filters.page);
      if (filters.pageSize) query.pageSize = String(filters.pageSize);
      if (filters.sortBy) query.sortBy = filters.sortBy;
      if (filters.sortDir) query.sortDir = filters.sortDir;
      const { data } = await adminListTenants({ client, query });
      return data;
    },
  });
}

export function useTenantDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => {
      const { data } = await adminGetTenantDetail({ client, path: { tenantId: id! } });
      return data;
    },
    enabled: !!id,
  });
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: ['admin', 'users', 'search', query],
    queryFn: async () => {
      const { data } = await adminListUsers({ client, query: { search: query } });
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
