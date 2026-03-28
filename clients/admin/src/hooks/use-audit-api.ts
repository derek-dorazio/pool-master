import { useQuery, keepPreviousData } from '@tanstack/react-query';

export interface AuditEntry {
  id: string;
  timestamp: string;
  admin: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
}

export interface AuditFilters {
  admin: string;
  action: string;
  resourceType: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  page: number;
}

const MOCK_ENTRIES: AuditEntry[] = [
  {
    id: 'aud-001',
    timestamp: '2026-03-26T14:30:00Z',
    admin: 'sarah.chen@poolmaster.io',
    action: 'tenant.suspend',
    resourceType: 'TENANT',
    resourceId: 'tnt_abc123',
    description: 'Suspended tenant "Bad Actors LLC" for ToS violation',
    reason: 'Multiple reports of fraudulent contest entries and bot usage',
    beforeState: { status: 'active', suspendedAt: null },
    afterState: { status: 'suspended', suspendedAt: '2026-03-26T14:30:00Z' },
    ipAddress: '10.0.1.50',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-002',
    timestamp: '2026-03-26T13:15:00Z',
    admin: 'mike.johnson@poolmaster.io',
    action: 'user.merge',
    resourceType: 'USER',
    resourceId: 'usr_def456',
    description: 'Merged duplicate user accounts usr_def456 and usr_ghi789',
    reason: 'User reported duplicate accounts created during OAuth migration',
    beforeState: { primaryId: 'usr_def456', secondaryId: 'usr_ghi789', merged: false },
    afterState: { primaryId: 'usr_def456', secondaryId: 'usr_ghi789', merged: true, mergedAt: '2026-03-26T13:15:00Z' },
    ipAddress: '10.0.1.51',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'aud-003',
    timestamp: '2026-03-26T12:45:00Z',
    admin: 'sarah.chen@poolmaster.io',
    action: 'contest.recalculate',
    resourceType: 'CONTEST',
    resourceId: 'cst_jkl012',
    description: 'Recalculated scores for NFL Week 12 Survivor Pool',
    reason: 'Provider data correction for postponed game scores',
    beforeState: { lastScoredAt: '2026-03-25T23:00:00Z', totalEntries: 450 },
    afterState: { lastScoredAt: '2026-03-26T12:45:00Z', totalEntries: 450, recalculated: true },
    ipAddress: '10.0.1.50',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-004',
    timestamp: '2026-03-26T11:30:00Z',
    admin: 'mike.johnson@poolmaster.io',
    action: 'flags.edit',
    resourceType: 'FLAG',
    resourceId: 'flag_mno345',
    description: 'Enabled feature flag "live-draft-chat" for all tenants',
    beforeState: { key: 'live-draft-chat', enabled: false, rolloutPercentage: 0 },
    afterState: { key: 'live-draft-chat', enabled: true, rolloutPercentage: 100 },
    ipAddress: '10.0.1.51',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'aud-005',
    timestamp: '2026-03-26T10:00:00Z',
    admin: 'admin@poolmaster.io',
    action: 'announcement.create',
    resourceType: 'ANNOUNCEMENT',
    resourceId: 'ann_pqr678',
    description: 'Created maintenance announcement for scheduled downtime',
    beforeState: undefined,
    afterState: { title: 'Scheduled Maintenance', severity: 'warning', status: 'scheduled' },
    ipAddress: '10.0.1.52',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-006',
    timestamp: '2026-03-25T16:20:00Z',
    admin: 'sarah.chen@poolmaster.io',
    action: 'tenant.update',
    resourceType: 'TENANT',
    resourceId: 'tnt_stu901',
    description: 'Updated tenant "Fantasy League Pro" subscription to Enterprise tier',
    reason: 'Approved upgrade request from sales team',
    beforeState: { plan: 'professional', maxUsers: 500 },
    afterState: { plan: 'enterprise', maxUsers: 5000 },
    ipAddress: '10.0.1.50',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-007',
    timestamp: '2026-03-25T14:10:00Z',
    admin: 'mike.johnson@poolmaster.io',
    action: 'user.ban',
    resourceType: 'USER',
    resourceId: 'usr_vwx234',
    description: 'Banned user "cheater99" for automated entry submission',
    reason: 'Detected bot patterns: 200+ entries in 5 minutes with identical picks',
    beforeState: { status: 'active', bannedAt: null },
    afterState: { status: 'banned', bannedAt: '2026-03-25T14:10:00Z' },
    ipAddress: '10.0.1.51',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'aud-008',
    timestamp: '2026-03-25T11:45:00Z',
    admin: 'admin@poolmaster.io',
    action: 'flags.edit',
    resourceType: 'FLAG',
    resourceId: 'flag_yza567',
    description: 'Disabled feature flag "experimental-scoring-v2" globally',
    reason: 'Rollback due to scoring accuracy regression in QA',
    beforeState: { key: 'experimental-scoring-v2', enabled: true, rolloutPercentage: 25 },
    afterState: { key: 'experimental-scoring-v2', enabled: false, rolloutPercentage: 0 },
    ipAddress: '10.0.1.52',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-009',
    timestamp: '2026-03-25T09:30:00Z',
    admin: 'sarah.chen@poolmaster.io',
    action: 'contest.cancel',
    resourceType: 'CONTEST',
    resourceId: 'cst_bcd890',
    description: 'Cancelled contest "March Madness Bracket Challenge" and refunded entries',
    reason: 'Insufficient entries to meet minimum threshold before lock time',
    beforeState: { status: 'open', entries: 3, minEntries: 10 },
    afterState: { status: 'cancelled', entries: 3, refunded: true },
    ipAddress: '10.0.1.50',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-010',
    timestamp: '2026-03-24T17:00:00Z',
    admin: 'mike.johnson@poolmaster.io',
    action: 'tenant.suspend',
    resourceType: 'TENANT',
    resourceId: 'tnt_efg123',
    description: 'Suspended tenant "QuickBets Inc" for payment failure',
    reason: 'Invoice overdue by 45 days, multiple payment reminders sent',
    beforeState: { status: 'active', paymentStatus: 'overdue' },
    afterState: { status: 'suspended', paymentStatus: 'overdue', suspendedAt: '2026-03-24T17:00:00Z' },
    ipAddress: '10.0.1.51',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'aud-011',
    timestamp: '2026-03-24T14:20:00Z',
    admin: 'admin@poolmaster.io',
    action: 'announcement.update',
    resourceType: 'ANNOUNCEMENT',
    resourceId: 'ann_hij456',
    description: 'Updated welcome banner with new onboarding link',
    beforeState: { title: 'Welcome to Ultimate Pool Manager!', linkUrl: '/getting-started' },
    afterState: { title: 'Welcome to Ultimate Pool Manager!', linkUrl: '/onboarding' },
    ipAddress: '10.0.1.52',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'aud-012',
    timestamp: '2026-03-24T10:05:00Z',
    admin: 'sarah.chen@poolmaster.io',
    action: 'contest.recalculate',
    resourceType: 'CONTEST',
    resourceId: 'cst_klm789',
    description: 'Recalculated scores for NBA Daily Fantasy after stat correction',
    reason: 'NBA issued official stat correction for player assists',
    beforeState: { lastScoredAt: '2026-03-24T01:00:00Z', totalEntries: 1200 },
    afterState: { lastScoredAt: '2026-03-24T10:05:00Z', totalEntries: 1200, recalculated: true },
    ipAddress: '10.0.1.50',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
];

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit-log', filters],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 200));
      let filtered = [...MOCK_ENTRIES];
      if (filters.admin && filters.admin !== 'All') {
        filtered = filtered.filter((e) => e.admin === filters.admin);
      }
      if (filters.action && filters.action !== 'All') {
        filtered = filtered.filter((e) => e.action === filters.action);
      }
      if (filters.resourceType && filters.resourceType !== 'All') {
        filtered = filtered.filter((e) => e.resourceType === filters.resourceType);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.description.toLowerCase().includes(q) ||
            (e.reason && e.reason.toLowerCase().includes(q)),
        );
      }
      const pageSize = 50;
      const start = (filters.page - 1) * pageSize;
      return {
        entries: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page: filters.page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      };
    },
    placeholderData: keepPreviousData,
  });
}
