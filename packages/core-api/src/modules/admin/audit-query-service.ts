/**
 * AuditQueryService — read-only query service for the admin audit log.
 *
 * Separated from AdminAuditService (write side) to keep read/write concerns clean.
 * Returns mock data until wired to Prisma and the admin_audit_log table.
 */

export interface AuditListQuery {
  adminUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditEntryView {
  id: string;
  adminUserEmail: string;
  adminUserName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  reason?: string;
  ipAddress?: string;
  createdAt: Date;
  hasStateChanges: boolean;
}

export interface AuditListResult {
  items: AuditEntryView[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Mock admin users for realistic audit entries. */
const MOCK_ADMINS = [
  { id: 'adm-001', email: 'sarah.chen@poolmaster.io', name: 'Sarah Chen' },
  { id: 'adm-002', email: 'mike.johnson@poolmaster.io', name: 'Mike Johnson' },
  { id: 'adm-003', email: 'alex.rivera@poolmaster.io', name: 'Alex Rivera' },
] as const;

/** Mock audit entries showing various admin actions. */
function buildMockEntries(): AuditEntryView[] {
  const now = new Date();
  const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * 3600_000);
  return [
    {
      id: 'aud-001',
      adminUserEmail: MOCK_ADMINS[0].email,
      adminUserName: MOCK_ADMINS[0].name,
      action: 'tenant.suspend',
      resourceType: 'TENANT',
      resourceId: 'tnt-golf-crew',
      description: "Suspended tenant 'Golf Crew' — payment fraud detected",
      reason: 'Multiple chargebacks filed against this tenant account',
      ipAddress: '10.0.1.42',
      createdAt: hoursAgo(1),
      hasStateChanges: true,
    },
    {
      id: 'aud-002',
      adminUserEmail: MOCK_ADMINS[1].email,
      adminUserName: MOCK_ADMINS[1].name,
      action: 'user.reset_password',
      resourceType: 'USER',
      resourceId: 'usr-8812',
      description: "Reset password for user 'jdoe@example.com' at user request",
      reason: 'Support ticket #4421 — user locked out after MFA device change',
      ipAddress: '10.0.1.55',
      createdAt: hoursAgo(3),
      hasStateChanges: false,
    },
    {
      id: 'aud-003',
      adminUserEmail: MOCK_ADMINS[0].email,
      adminUserName: MOCK_ADMINS[0].name,
      action: 'contest.recalculate',
      resourceType: 'CONTEST',
      resourceId: 'cst-nfl-wk12',
      description: "Recalculated standings for 'NFL Week 12 Survivor Pool' after stat correction",
      reason: 'ESPN issued stat correction for QB rushing yards',
      ipAddress: '10.0.1.42',
      createdAt: hoursAgo(6),
      hasStateChanges: true,
    },
    {
      id: 'aud-004',
      adminUserEmail: MOCK_ADMINS[2].email,
      adminUserName: MOCK_ADMINS[2].name,
      action: 'flags.edit',
      resourceType: 'FEATURE_FLAG',
      resourceId: 'flag-live-draft-v2',
      description: "Enabled feature flag 'live_draft_v2' globally (was 25% rollout)",
      reason: 'Successful beta — graduating to GA',
      ipAddress: '10.0.1.78',
      createdAt: hoursAgo(12),
      hasStateChanges: true,
    },
    {
      id: 'aud-005',
      adminUserEmail: MOCK_ADMINS[1].email,
      adminUserName: MOCK_ADMINS[1].name,
      action: 'tenant.upgrade_plan',
      resourceType: 'TENANT',
      resourceId: 'tnt-acme-corp',
      description: "Upgraded tenant 'Acme Corp' from Pro to League+ plan",
      reason: 'Enterprise contract signed — apply immediately',
      ipAddress: '10.0.1.55',
      createdAt: hoursAgo(18),
      hasStateChanges: true,
    },
    {
      id: 'aud-006',
      adminUserEmail: MOCK_ADMINS[0].email,
      adminUserName: MOCK_ADMINS[0].name,
      action: 'user.force_logout',
      resourceType: 'USER',
      resourceId: 'usr-2233',
      description: "Force-logged out user 'suspicious_actor@temp.com' from all sessions",
      reason: 'Suspicious API usage pattern detected — possible account compromise',
      ipAddress: '10.0.1.42',
      createdAt: hoursAgo(24),
      hasStateChanges: false,
    },
    {
      id: 'aud-007',
      adminUserEmail: MOCK_ADMINS[2].email,
      adminUserName: MOCK_ADMINS[2].name,
      action: 'sportsdata.re_ingest',
      resourceType: 'SPORTS_EVENT',
      resourceId: 'evt-masters-2026',
      description: "Re-ingested scoring data for 'The Masters 2026' from SportsDataIO",
      reason: 'Provider webhook missed Round 2 leaderboard update',
      ipAddress: '10.0.1.78',
      createdAt: hoursAgo(30),
      hasStateChanges: false,
    },
    {
      id: 'aud-008',
      adminUserEmail: MOCK_ADMINS[1].email,
      adminUserName: MOCK_ADMINS[1].name,
      action: 'contest.override',
      resourceType: 'CONTEST',
      resourceId: 'cst-nba-allstar',
      description: "Overrode score for team 'Slam Dunkers' in 'NBA All-Star Fantasy' (+5 pts)",
      reason: 'Commissioner appeal granted — missed stat not captured by provider',
      ipAddress: '10.0.1.55',
      createdAt: hoursAgo(48),
      hasStateChanges: true,
    },
    {
      id: 'aud-009',
      adminUserEmail: MOCK_ADMINS[0].email,
      adminUserName: MOCK_ADMINS[0].name,
      action: 'tenant.delete',
      resourceType: 'TENANT',
      resourceId: 'tnt-test-org-99',
      description: "Deleted test tenant 'QA Stress Test Org' and all associated data",
      reason: 'Cleanup of internal QA tenant after load testing cycle',
      ipAddress: '10.0.1.42',
      createdAt: hoursAgo(72),
      hasStateChanges: true,
    },
    {
      id: 'aud-010',
      adminUserEmail: MOCK_ADMINS[2].email,
      adminUserName: MOCK_ADMINS[2].name,
      action: 'platform.announcements',
      resourceType: 'ANNOUNCEMENT',
      resourceId: 'ann-maintenance-0326',
      description: "Created maintenance banner: 'Scheduled maintenance tonight 2-4am UTC'",
      reason: 'Database migration window for v2.3 schema changes',
      ipAddress: '10.0.1.78',
      createdAt: hoursAgo(96),
      hasStateChanges: false,
    },
  ];
}

/**
 * Applies query filters against mock data.
 * Will be replaced with Prisma WHERE clauses once wired to database.
 */
function applyFilters(entries: AuditEntryView[], query: AuditListQuery): AuditEntryView[] {
  let filtered = entries;
  if (query.adminUserId) {
    const adminId = query.adminUserId;
    const admin = MOCK_ADMINS.find((a) => a.id === adminId);
    if (admin) {
      filtered = filtered.filter((e) => e.adminUserEmail === admin.email);
    }
  }
  if (query.action) {
    filtered = filtered.filter((e) => e.action === query.action);
  }
  if (query.resourceType) {
    filtered = filtered.filter((e) => e.resourceType === query.resourceType);
  }
  if (query.resourceId) {
    filtered = filtered.filter((e) => e.resourceId === query.resourceId);
  }
  if (query.dateFrom) {
    const from = new Date(query.dateFrom);
    filtered = filtered.filter((e) => e.createdAt >= from);
  }
  if (query.dateTo) {
    const to = new Date(query.dateTo);
    filtered = filtered.filter((e) => e.createdAt <= to);
  }
  if (query.search) {
    const term = query.search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.description.toLowerCase().includes(term) ||
        (e.reason?.toLowerCase().includes(term) ?? false),
    );
  }
  return filtered;
}

/**
 * Queries audit log entries with filtering and pagination.
 *
 * Returns mock data for now. Will be wired to admin_audit_log table via Prisma.
 */
export async function queryAuditLog(query: AuditListQuery): Promise<AuditListResult> {
  const allEntries = buildMockEntries();
  const filtered = applyFilters(allEntries, query);
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  return { items, total: filtered.length, page, pageSize };
}

/**
 * Retrieves a single audit entry by ID, including full state change detail.
 *
 * Returns mock data for now. Will be wired to admin_audit_log table via Prisma.
 */
export async function getAuditEntryById(entryId: string): Promise<AuditEntryView | null> {
  const allEntries = buildMockEntries();
  return allEntries.find((e) => e.id === entryId) ?? null;
}

/**
 * Exports audit log entries as CSV for compliance reporting.
 *
 * Returns mock CSV for now. Will be wired to admin_audit_log table via Prisma.
 */
export async function exportAuditLogCsv(query: AuditListQuery): Promise<string> {
  const unlimitedQuery: AuditListQuery = { ...query, page: 1, pageSize: MAX_PAGE_SIZE };
  const result = await queryAuditLog(unlimitedQuery);
  const header = 'id,admin_email,admin_name,action,resource_type,resource_id,description,reason,ip_address,created_at,has_state_changes';
  const rows = result.items.map((e) =>
    [
      e.id,
      escapeCsvField(e.adminUserEmail),
      escapeCsvField(e.adminUserName),
      e.action,
      e.resourceType,
      e.resourceId,
      escapeCsvField(e.description),
      escapeCsvField(e.reason ?? ''),
      e.ipAddress ?? '',
      e.createdAt.toISOString(),
      String(e.hasStateChanges),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** Wraps a field in double-quotes and escapes internal quotes for CSV safety. */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
