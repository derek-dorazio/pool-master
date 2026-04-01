import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';

export interface PlatformMetrics {
  activeTenants: { value: number; trend: number };
  totalUsers: { value: number; trend: number };
  activeContests: { value: number; trend: number };
  liveDrafts: { value: number; trend: number };
  notificationRate: { value: number; trend: number };
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

export interface UserResult {
  id: string;
  email: string;
  displayName: string;
  tenants: string[];
  lastLogin: string;
  status: 'Active' | 'Disabled' | 'Pending';
}

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

const mockMetrics: PlatformMetrics = {
  activeTenants: { value: 24, trend: 12 },
  totalUsers: { value: 1245, trend: 8 },
  activeContests: { value: 156, trend: 15 },
  liveDrafts: { value: 3, trend: -3 },
  notificationRate: { value: 98.5, trend: 0.5 },
};

const mockServices: ServiceHealth[] = [
  { name: 'API Gateway', status: 'green' },
  { name: 'Auth', status: 'green' },
  { name: 'Contest', status: 'green' },
  { name: 'Draft', status: 'green' },
  { name: 'Scoring', status: 'green' },
  { name: 'Notification', status: 'green' },
  { name: 'Ingestion', status: 'green' },
];

const mockAlerts: Alert[] = [
  { id: '1', severity: 'Critical', message: 'Scoring service latency spike detected (p99 > 2s)', timestamp: '2026-03-26T14:22:00Z' },
  { id: '2', severity: 'Warning', message: 'Notification queue depth exceeding threshold (1,200 pending)', timestamp: '2026-03-26T13:45:00Z' },
  { id: '3', severity: 'Info', message: 'Scheduled maintenance window starting at 02:00 UTC', timestamp: '2026-03-26T12:00:00Z' },
];

const mockAudit: AuditEntry[] = [
  { id: '1', adminName: 'Sarah Chen', action: 'tenant.suspend', description: 'Suspended tenant "BadActors Inc" for TOS violation', timestamp: '2026-03-26T14:15:00Z' },
  { id: '2', adminName: 'Mike Johnson', action: 'user.reset_password', description: 'Reset password for user john@example.com', timestamp: '2026-03-26T13:50:00Z' },
  { id: '3', adminName: 'Sarah Chen', action: 'flag.update', description: 'Enabled feature flag "live-scoring-v2" for all tenants', timestamp: '2026-03-26T12:30:00Z' },
  { id: '4', adminName: 'Alex Rivera', action: 'tenant.change_plan', description: 'Upgraded "Fantasy Kings" from Starter to Pro', timestamp: '2026-03-26T11:20:00Z' },
  { id: '5', adminName: 'Mike Johnson', action: 'user.merge', description: 'Merged duplicate accounts for dave@example.com', timestamp: '2026-03-26T10:05:00Z' },
];

const mockTenants: Tenant[] = [
  { id: 't1', name: 'Fantasy Kings', slug: 'fantasy-kings', plan: 'Pro', members: 148, leagues: 12, contests: 34, status: 'Active', lastActive: '2026-03-26T14:00:00Z', createdAt: '2025-06-15T00:00:00Z' },
  { id: 't2', name: 'Draft Masters', slug: 'draft-masters', plan: 'League+', members: 312, leagues: 28, contests: 89, status: 'Active', lastActive: '2026-03-26T13:45:00Z', createdAt: '2025-03-01T00:00:00Z' },
  { id: 't3', name: 'Office Pool Co', slug: 'office-pool', plan: 'Starter', members: 45, leagues: 3, contests: 8, status: 'Active', lastActive: '2026-03-25T20:00:00Z', createdAt: '2025-09-10T00:00:00Z' },
  { id: 't4', name: 'Sports Fanatics', slug: 'sports-fanatics', plan: 'Pro', members: 210, leagues: 18, contests: 52, status: 'Active', lastActive: '2026-03-26T12:00:00Z', createdAt: '2025-01-20T00:00:00Z' },
  { id: 't5', name: 'Bracket Busters', slug: 'bracket-busters', plan: 'Free', members: 12, leagues: 1, contests: 2, status: 'Trial', lastActive: '2026-03-24T10:00:00Z', createdAt: '2026-03-01T00:00:00Z' },
  { id: 't6', name: 'Pick Em League', slug: 'pick-em', plan: 'Starter', members: 67, leagues: 5, contests: 14, status: 'Active', lastActive: '2026-03-26T11:30:00Z', createdAt: '2025-08-05T00:00:00Z' },
  { id: 't7', name: 'BadActors Inc', slug: 'bad-actors', plan: 'Free', members: 3, leagues: 0, contests: 0, status: 'Suspended', lastActive: '2026-03-20T08:00:00Z', createdAt: '2026-02-15T00:00:00Z' },
  { id: 't8', name: 'College Picks', slug: 'college-picks', plan: 'League+', members: 450, leagues: 35, contests: 112, status: 'Active', lastActive: '2026-03-26T14:10:00Z', createdAt: '2024-11-01T00:00:00Z' },
];

const mockTenantDetail: TenantDetail = {
  id: 't1',
  name: 'Fantasy Kings',
  slug: 'fantasy-kings',
  plan: 'Pro',
  members: 148,
  leagues: 12,
  contests: 34,
  status: 'Active',
  lastActive: '2026-03-26T14:00:00Z',
  createdAt: '2025-06-15T00:00:00Z',
  usage: {
    leagues: { current: 12, limit: 25 },
    contests: { current: 34, limit: 100 },
    members: { current: 148, limit: 500 },
  },
  recentSignups: [
    { email: 'newuser1@example.com', date: '2026-03-25T10:00:00Z' },
    { email: 'newuser2@example.com', date: '2026-03-24T15:00:00Z' },
    { email: 'newuser3@example.com', date: '2026-03-23T09:00:00Z' },
  ],
  membersList: [
    { id: 'u1', email: 'alice@fantasykings.com', displayName: 'Alice Thompson', role: 'Owner', lastActive: '2026-03-26T14:00:00Z' },
    { id: 'u2', email: 'bob@fantasykings.com', displayName: 'Bob Martinez', role: 'Admin', lastActive: '2026-03-26T13:00:00Z' },
    { id: 'u3', email: 'carol@fantasykings.com', displayName: 'Carol Davis', role: 'Member', lastActive: '2026-03-25T20:00:00Z' },
    { id: 'u4', email: 'dave@fantasykings.com', displayName: 'Dave Wilson', role: 'Member', lastActive: '2026-03-25T18:00:00Z' },
    { id: 'u5', email: 'eve@fantasykings.com', displayName: 'Eve Johnson', role: 'Member', lastActive: '2026-03-24T12:00:00Z' },
    { id: 'u6', email: 'frank@fantasykings.com', displayName: 'Frank Lee', role: 'Member', lastActive: '2026-03-23T16:00:00Z' },
  ],
  leaguesList: [
    { id: 'l1', name: 'NFL Kings League', sport: 'NFL', members: 12, contests: 8 },
    { id: 'l2', name: 'NBA Dynasty', sport: 'NBA', members: 10, contests: 14 },
    { id: 'l3', name: 'March Madness Bracket', sport: 'NCAA', members: 24, contests: 3 },
  ],
  contestsList: [
    { id: 'c1', name: 'Week 12 NFL Pick Em', sport: 'NFL', type: 'Pick Em', status: 'Active', entries: 12 },
    { id: 'c2', name: 'NBA Daily Fantasy', sport: 'NBA', type: 'Daily Fantasy', status: 'Active', entries: 8 },
    { id: 'c3', name: 'March Madness 2026', sport: 'NCAA', type: 'Bracket', status: 'Upcoming', entries: 24 },
    { id: 'c4', name: 'Super Bowl Props', sport: 'NFL', type: 'Props', status: 'Completed', entries: 18 },
  ],
  activity: [
    { id: 'a1', timestamp: '2026-03-26T14:00:00Z', action: 'contest.created', description: 'Created contest "Week 13 NFL Pick Em"' },
    { id: 'a2', timestamp: '2026-03-25T10:00:00Z', action: 'member.joined', description: 'New member newuser1@example.com joined' },
    { id: 'a3', timestamp: '2026-03-24T15:00:00Z', action: 'league.created', description: 'Created league "Golf Masters Pool"' },
    { id: 'a4', timestamp: '2026-03-23T09:00:00Z', action: 'plan.upgraded', description: 'Plan upgraded from Starter to Pro' },
    { id: 'a5', timestamp: '2026-03-22T14:00:00Z', action: 'contest.completed', description: 'Contest "Super Bowl Props" completed scoring' },
  ],
};

const mockUserResults: UserResult[] = [
  { id: 'u1', email: 'alice@fantasykings.com', displayName: 'Alice Thompson', tenants: ['Fantasy Kings', 'Draft Masters'], lastLogin: '2026-03-26T14:00:00Z', status: 'Active' },
  { id: 'u2', email: 'bob@example.com', displayName: 'Bob Martinez', tenants: ['Fantasy Kings'], lastLogin: '2026-03-26T13:00:00Z', status: 'Active' },
  { id: 'u3', email: 'carol.davis@gmail.com', displayName: 'Carol Davis', tenants: ['Office Pool Co'], lastLogin: '2026-03-25T20:00:00Z', status: 'Active' },
  { id: 'u4', email: 'dave@sportsfanatics.com', displayName: 'Dave Wilson', tenants: ['Sports Fanatics', 'College Picks'], lastLogin: '2026-03-24T12:00:00Z', status: 'Disabled' },
  { id: 'u5', email: 'eve.johnson@test.com', displayName: 'Eve Johnson', tenants: ['Bracket Busters'], lastLogin: '2026-03-20T08:00:00Z', status: 'Pending' },
];

const mockUserDetail: UserDetail = {
  id: 'u1',
  email: 'alice@fantasykings.com',
  displayName: 'Alice Thompson',
  status: 'Active',
  authProvider: 'Google OAuth',
  createdAt: '2025-06-15T00:00:00Z',
  lastLogin: '2026-03-26T14:00:00Z',
  locale: 'en-US',
  tenantMemberships: [
    { tenantId: 't1', tenantName: 'Fantasy Kings', role: 'Owner' },
    { tenantId: 't2', tenantName: 'Draft Masters', role: 'Member' },
  ],
  leagueMemberships: [
    { leagueId: 'l1', leagueName: 'NFL Kings League', sport: 'NFL', role: 'Commissioner' },
    { leagueId: 'l2', leagueName: 'NBA Dynasty', sport: 'NBA', role: 'Member' },
    { leagueId: 'l5', leagueName: 'Draft Masters Weekly', sport: 'NFL', role: 'Member' },
  ],
  contests: [
    { id: 'c1', name: 'Week 12 NFL Pick Em', sport: 'NFL', status: 'Active', rank: 3 },
    { id: 'c2', name: 'NBA Daily Fantasy', sport: 'NBA', status: 'Active', rank: 1 },
    { id: 'c3', name: 'March Madness 2026', sport: 'NCAA', status: 'Upcoming', rank: 0 },
    { id: 'c4', name: 'Super Bowl Props', sport: 'NFL', status: 'Completed', rank: 5 },
  ],
  devices: [
    { id: 'd1', platform: 'iOS 17 / iPhone 15 Pro', lastActive: '2026-03-26T14:00:00Z', tokenStatus: 'Valid' },
    { id: 'd2', platform: 'Chrome 124 / macOS', lastActive: '2026-03-25T10:00:00Z', tokenStatus: 'Expired' },
  ],
  authEvents: [
    { id: 'ae1', type: 'login', timestamp: '2026-03-26T14:00:00Z', ip: '192.168.1.42', success: true },
    { id: 'ae2', type: 'login', timestamp: '2026-03-25T10:00:00Z', ip: '10.0.0.15', success: true },
    { id: 'ae3', type: 'logout', timestamp: '2026-03-24T22:00:00Z', ip: '192.168.1.42', success: true },
    { id: 'ae4', type: 'login', timestamp: '2026-03-24T08:00:00Z', ip: '203.0.113.50', success: false },
    { id: 'ae5', type: 'password_reset', timestamp: '2026-03-20T16:00:00Z', ip: '192.168.1.42', success: true },
  ],
};

export function useAdminMetrics() {
  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: async () => {
      try {
        const [metricsData, servicesData] = await Promise.all([
          adminApi.get<{ metrics: PlatformMetrics; alerts: Alert[]; audit: AuditEntry[] }>('/v1/admin/health/metrics'),
          adminApi.get<ServiceHealth[]>('/v1/admin/health/services'),
        ]);
        return {
          metrics: metricsData.metrics,
          services: servicesData,
          alerts: metricsData.alerts,
          audit: metricsData.audit,
        };
      } catch {
        return {
          metrics: mockMetrics,
          services: mockServices,
          alerts: mockAlerts,
          audit: mockAudit,
        };
      }
    },
  });
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

export function useTenantList(filters: TenantFilters) {
  return useQuery({
    queryKey: ['admin', 'tenants', filters],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (filters.search) params.set('search', filters.search);
        if (filters.plan && filters.plan !== 'All') params.set('plan', filters.plan);
        if (filters.status && filters.status !== 'All') params.set('status', filters.status);
        if (filters.page) params.set('page', String(filters.page));
        if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
        if (filters.sortBy) params.set('sortBy', filters.sortBy);
        if (filters.sortDir) params.set('sortDir', filters.sortDir);
        const query = params.toString();
        return await adminApi.get<{ items: Tenant[]; total: number; page: number; pageSize: number; totalPages: number }>(
          `/v1/admin/tenants${query ? `?${query}` : ''}`,
        );
      } catch {
        let filtered = [...mockTenants];
        if (filters.search) {
          const q = filters.search.toLowerCase();
          filtered = filtered.filter(
            (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
          );
        }
        if (filters.plan && filters.plan !== 'All') {
          filtered = filtered.filter((t) => t.plan === filters.plan);
        }
        if (filters.status && filters.status !== 'All') {
          filtered = filtered.filter((t) => t.status === filters.status);
        }
        if (filters.sortBy) {
          const dir = filters.sortDir === 'desc' ? -1 : 1;
          filtered.sort((a, b) => {
            const aVal = a[filters.sortBy as keyof Tenant];
            const bVal = b[filters.sortBy as keyof Tenant];
            if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
            return String(aVal).localeCompare(String(bVal)) * dir;
          });
        }
        const page = filters.page ?? 1;
        const pageSize = filters.pageSize ?? 10;
        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const items = filtered.slice(start, start + pageSize);
        return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
      }
    },
  });
}

export function useTenantDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => {
      try {
        return await adminApi.get<TenantDetail>(`/v1/admin/tenants/${id}`);
      } catch {
        return { ...mockTenantDetail, id: id ?? mockTenantDetail.id };
      }
    },
    enabled: !!id,
  });
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: ['admin', 'users', 'search', query],
    queryFn: async () => {
      try {
        return await adminApi.get<UserResult[]>(`/v1/admin/users?search=${encodeURIComponent(query)}`);
      } catch {
        return mockUserResults;
      }
    },
    enabled: query.length > 0,
  });
}

export function useUserDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: async () => {
      try {
        return await adminApi.get<UserDetail>(`/v1/admin/users/${id}`);
      } catch {
        return { ...mockUserDetail, id: id ?? mockUserDetail.id };
      }
    },
    enabled: !!id,
  });
}
