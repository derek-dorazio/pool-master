# PoolMaster — Admin / Platform Operations Dashboard Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

The admin dashboard is the internal tooling surface for the PoolMaster team to operate the platform. Without it, debugging production issues, supporting tenants, managing sports data, and running operational tasks all require direct database access — which is dangerous and slow. This plan defines tenant management, user management, contest operations, sports data monitoring, feature flags, platform health, audit logging, and support tools.

---

## 1. Authentication & Access Control

The admin dashboard uses a separate authentication system from the public app.

### Admin Auth

```typescript
interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  permissions: AdminPermission[];
  sso_provider_id?: string;            // internal SSO (Okta, Google Workspace)
  mfa_enabled: boolean;
  last_login_at: Date;
  is_active: boolean;
  created_at: Date;
}

type AdminRole = 'SUPER_ADMIN' | 'OPERATIONS' | 'SUPPORT' | 'DATA_OPS' | 'VIEWER';

type AdminPermission =
  // Tenant operations
  | 'tenant.view' | 'tenant.edit' | 'tenant.suspend' | 'tenant.delete' | 'tenant.impersonate'
  // User operations
  | 'user.view' | 'user.edit' | 'user.reset_password' | 'user.force_logout' | 'user.merge'
  // Contest operations
  | 'contest.view' | 'contest.override' | 'contest.recalculate' | 'contest.close'
  // Sports data
  | 'sportsdata.view' | 'sportsdata.configure' | 'sportsdata.re_ingest'
  // Feature flags
  | 'flags.view' | 'flags.edit'
  // Platform
  | 'platform.health' | 'platform.announcements' | 'platform.migrations'
  // Audit
  | 'audit.view';
```

### Role Permission Matrix

| Permission | Super Admin | Operations | Support | Data Ops | Viewer |
|---|---|---|---|---|---|
| tenant.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| tenant.edit | ✓ | ✓ | ✓ | | |
| tenant.suspend | ✓ | ✓ | | | |
| tenant.delete | ✓ | | | | |
| tenant.impersonate | ✓ | | ✓ | | |
| user.view | ✓ | ✓ | ✓ | | ✓ |
| user.edit | ✓ | | ✓ | | |
| user.merge | ✓ | | ✓ | | |
| contest.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| contest.override | ✓ | ✓ | | | |
| contest.recalculate | ✓ | ✓ | | ✓ | |
| sportsdata.view | ✓ | ✓ | | ✓ | ✓ |
| sportsdata.configure | ✓ | ✓ | | ✓ | |
| sportsdata.re_ingest | ✓ | | | ✓ | |
| flags.view | ✓ | ✓ | ✓ | | ✓ |
| flags.edit | ✓ | ✓ | | | |
| platform.health | ✓ | ✓ | | ✓ | ✓ |
| platform.announcements | ✓ | ✓ | | | |
| platform.migrations | ✓ | | | ✓ | |
| audit.view | ✓ | ✓ | ✓ | | |

---

## 2. Tenant Management

### Tenant List View

```
┌──────────────────────────────────────────────────────────────────────┐
│ Tenants                                           [Search] [Filter] │
├────────────┬──────────┬──────────┬──────────┬────────┬─────────────┤
│ Name       │ Plan     │ Members  │ Contests │ Status │ Last Active │
├────────────┼──────────┼──────────┼──────────┼────────┼─────────────┤
│ Tiger's Co │ Pro      │ 45       │ 12       │ Active │ 2 min ago   │
│ Golf Crew  │ Starter  │ 18       │ 3        │ Active │ 1 hour ago  │
│ Acme Corp  │ League+  │ 120      │ 28       │ Active │ 5 min ago   │
│ Test Org   │ Free     │ 4        │ 0        │ Trial  │ 3 days ago  │
└────────────┴──────────┴──────────┴──────────┴────────┴─────────────┘
```

### Tenant Detail View

```typescript
interface TenantAdminView {
  // Basic info
  tenant: Tenant;
  subscription: TenantSubscription;
  usage: UsageSummary;

  // Members
  total_members: number;
  admin_users: User[];                 // tenant admins
  recent_signups: User[];

  // Activity
  leagues: LeagueSummary[];
  active_contests: ContestSummary[];
  recent_activity: ActivityLog[];

  // Billing
  invoices: Invoice[];
  mrr_contribution: number;
  lifetime_value: number;

  // Health
  error_rate_last_24h: number;
  notification_failures: number;
  last_support_ticket?: Date;
}
```

### Tenant Actions

```typescript
interface TenantActions {
  // Plan management
  upgradePlan(tenantId: string, planId: string, reason: string): Promise<void>;
  downgradePlan(tenantId: string, planId: string, reason: string): Promise<void>;
  applyCredit(tenantId: string, amount: number, reason: string): Promise<void>;
  extendTrial(tenantId: string, days: number, reason: string): Promise<void>;

  // Account status
  suspendTenant(tenantId: string, reason: string): Promise<void>;
  unsuspendTenant(tenantId: string, reason: string): Promise<void>;
  deleteTenant(tenantId: string, confirmation: string): Promise<void>;
  // Delete requires typing tenant name as confirmation — irreversible

  // Support
  impersonate(tenantId: string, adminUserId: string): Promise<ImpersonationSession>;
  // Creates a time-limited session where admin sees the app as the tenant admin
  // All actions during impersonation are logged in audit trail
  // Visual indicator shown to admin: "Impersonating: Tiger's Co"
}
```

---

## 3. User Management

### User Search

```
Search across all tenants by:
  - Email address (exact or partial)
  - Display name
  - User ID
  - Tenant name
```

### User Detail View

```typescript
interface UserAdminView {
  user: User;
  tenants: { tenant: Tenant; role: string; joined_at: Date }[];
  leagues: { league: League; role: string }[];
  active_contests: ContestSummary[];
  recent_activity: ActivityLog[];
  devices: DeviceRegistration[];
  notification_delivery: DeliveryStats;
  auth_events: AuthEvent[];            // logins, password resets, etc.
}
```

### User Actions

```typescript
interface UserActions {
  // Account
  resetPassword(userId: string): Promise<void>;         // sends reset email
  forceLogout(userId: string): Promise<void>;            // invalidate all sessions
  disableAccount(userId: string, reason: string): Promise<void>;
  enableAccount(userId: string): Promise<void>;

  // Merge duplicates
  mergeAccounts(primaryId: string, duplicateId: string): Promise<MergeResult>;
  // Transfers all memberships, teams, and history from duplicate to primary
  // Duplicate account is deactivated

  // Communication
  sendAdminEmail(userId: string, subject: string, body: string): Promise<void>;
}

interface MergeResult {
  primary_user_id: string;
  duplicate_user_id: string;
  leagues_transferred: number;
  teams_transferred: number;
  history_records_transferred: number;
  merged_at: Date;
}
```

---

## 4. Contest & Results Management

### Contest Browser

Browse any contest across any league and tenant.

```typescript
interface ContestAdminView {
  contest: Contest;
  league: League;
  tenant: Tenant;

  // Status
  current_standings: StandingsEntry[];
  draft_status: DraftStatus;

  // Data health
  scoring_data_freshness: ScoreFreshness;
  stat_events_count: number;
  corrections_applied: number;

  // Override history
  overrides: OverrideRecord[];
}
```

### Contest Admin Actions

```typescript
interface ContestAdminActions {
  // Close/reopen
  forceClose(contestId: string, reason: string): Promise<void>;
  reopen(contestId: string, reason: string): Promise<void>;

  // Scoring
  overrideResult(contestId: string, teamId: string, newScore: number, reason: string): Promise<void>;
  recalculateStandings(contestId: string): Promise<RecalculationResult>;
  recalculatePayouts(contestId: string): Promise<PayoutRecalculation>;

  // Data
  reIngestScoring(contestId: string, eventId: string): Promise<void>;
  // Re-fetches all stat data for the linked sporting event and reprocesses
}
```

---

## 5. Sports Data Provider Management

### Provider Dashboard

```
┌──────────────────────────────────────────────────────────────────────┐
│ Sports Data Providers                                                │
├────────────────┬──────────┬───────────┬──────────┬─────────────────┤
│ Provider       │ Status   │ Error Rate│ Latency  │ Last Event      │
├────────────────┼──────────┼───────────┼──────────┼─────────────────┤
│ SportsDataIO   │ HEALTHY  │ 0.2%      │ 245ms    │ 30 sec ago      │
│ Sportradar     │ HEALTHY  │ 0.1%      │ 180ms    │ 1 min ago       │
│ Equibase       │ DEGRADED │ 8.5%      │ 2100ms   │ 15 min ago      │
│ TheOddsAPI     │ HEALTHY  │ 0.0%      │ 120ms    │ 5 min ago       │
└────────────────┴──────────┴───────────┴──────────┴─────────────────┘
```

### Provider Configuration

```typescript
interface ProviderAdminConfig {
  provider_id: string;

  // Credentials
  api_key: string;                     // masked in UI, editable
  api_secret?: string;
  webhook_secret?: string;

  // Webhook configuration
  webhook_url: string;                 // our endpoint for this provider
  webhook_events: string[];            // which events the provider sends

  // Health thresholds
  degraded_error_rate: number;
  down_error_rate: number;
  max_latency_ms: number;

  // Cost
  monthly_budget_usd: number;
  current_month_spend_usd: number;
  budget_alert_threshold: number;
}
```

### Ingestion Monitoring

```typescript
interface IngestionDashboard {
  // Per sport, per provider
  sport_provider_status: {
    sport: Sport;
    provider_id: string;
    last_poll_at: Date;
    last_event_received_at: Date;
    events_today: number;
    errors_today: number;
    active_event_count: number;        // sporting events currently being tracked
    contests_depending: number;        // PoolMaster contests consuming this data
  }[];

  // Recent errors
  recent_errors: {
    provider_id: string;
    error_type: string;
    message: string;
    occurred_at: Date;
    event_id?: string;
  }[];

  // Ingestion jobs
  active_jobs: IngestionJob[];
  recent_completed_jobs: IngestionJob[];
}
```

### Provider Admin Actions

```typescript
interface ProviderAdminActions {
  // Re-ingest data for a specific event
  reIngestEvent(providerId: string, eventId: string): Promise<void>;

  // Manual health check
  runHealthCheck(providerId: string): Promise<ProviderHealthStatus>;

  // Participant ID mapping
  viewUnmappedParticipants(): Promise<UnmappedParticipant[]>;
  mapParticipant(externalId: string, internalId: string): Promise<void>;
  createAndMapParticipant(externalData: any, providerId: string): Promise<Participant>;

  // Force refresh
  refreshSchedules(sport: Sport): Promise<void>;
  refreshRankings(sport: Sport): Promise<void>;
  refreshParticipants(sport: Sport): Promise<void>;
}
```

---

## 6. Feature Flag Management

### Feature Flag Model

```typescript
interface FeatureFlag {
  id: string;
  key: string;                         // "live_draft_v2", "budget_pick_golf"
  name: string;                        // human-readable
  description: string;
  flag_type: 'BOOLEAN' | 'PERCENTAGE' | 'TENANT_LIST';

  // Global state
  enabled_globally: boolean;

  // Percentage rollout
  rollout_percentage?: number;         // 0-100, for gradual rollouts

  // Tenant-specific overrides
  tenant_overrides: {
    tenant_id: string;
    tenant_name: string;
    enabled: boolean;
    reason: string;
  }[];

  // Metadata
  owner: string;                       // team/person responsible
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

### Feature Flag Service

```typescript
interface FeatureFlagService {
  // Check if a flag is enabled for a tenant
  isEnabled(flagKey: string, tenantId: string): Promise<boolean>;

  // Admin CRUD
  listFlags(): Promise<FeatureFlag[]>;
  getFlag(flagKey: string): Promise<FeatureFlag>;
  createFlag(flag: CreateFlagInput): Promise<FeatureFlag>;
  updateFlag(flagKey: string, update: UpdateFlagInput): Promise<FeatureFlag>;
  deleteFlag(flagKey: string): Promise<void>;

  // Tenant overrides
  setTenantOverride(flagKey: string, tenantId: string, enabled: boolean, reason: string): Promise<void>;
  clearTenantOverride(flagKey: string, tenantId: string): Promise<void>;
}
```

### Flag Resolution Order

```
1. Check tenant-specific override → if exists, return override value
2. Check global enabled state → if disabled globally, return false
3. Check rollout percentage → hash(tenant_id + flag_key) % 100 < percentage
4. Return resolved value
```

---

## 7. Platform Health Dashboard

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Platform Health                                  Last 24 Hours   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Services         Status    Uptime    Error Rate    P95 Latency │
│  ──────────────  ────────  ────────  ──────────    ─────────── │
│  API Gateway      ● UP     99.99%    0.02%         45ms        │
│  Auth Service     ● UP     99.99%    0.01%         32ms        │
│  Contest Service  ● UP     99.98%    0.05%         68ms        │
│  Draft Service    ● UP     100%      0.00%         55ms        │
│  Scoring Engine   ● UP     99.97%    0.08%         120ms       │
│  Notification Svc ● UP     99.99%    0.03%         40ms        │
│  WebSocket Server ● UP     99.95%    0.10%         15ms        │
│                                                                  │
│  Infrastructure                                                  │
│  ──────────────  ────────  ────────────────────                 │
│  PostgreSQL       ● UP     CPU: 35%   Connections: 120/500      │
│  Redis            ● UP     Memory: 2.1GB/8GB   Keys: 450K      │
│  Message Bus      ● UP     Queue depth: 12   Lag: 0.5s         │
│  S3/CDN           ● UP     Bandwidth: 45 GB/day                │
│                                                                  │
│  Key Metrics                                                     │
│  ──────────────  ────────────────────────────────               │
│  Active users      1,245 (last 24h)                             │
│  WebSocket conns   342 (current)                                │
│  API requests      125K (last 24h)                              │
│  Notifications     8,450 sent / 8,320 delivered (98.5%)         │
│  Active contests   156                                          │
│  Live drafts       3 (in progress)                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Health Check Endpoints

```typescript
interface HealthCheck {
  service: string;
  status: 'UP' | 'DEGRADED' | 'DOWN';
  dependencies: {
    name: string;
    status: 'UP' | 'DOWN';
    latency_ms: number;
  }[];
  uptime_seconds: number;
  version: string;
  checked_at: Date;
}

// Each service exposes: GET /health
// Admin dashboard polls all services every 30 seconds
```

### Alerting Integration

```typescript
interface AlertConfig {
  // Service health
  service_down: { channels: ['SLACK', 'PAGERDUTY']; severity: 'P1' };
  service_degraded: { channels: ['SLACK']; severity: 'P2' };

  // Error rates
  error_rate_high: { threshold: 5; window_minutes: 5; channels: ['SLACK']; severity: 'P2' };
  error_rate_critical: { threshold: 20; window_minutes: 5; channels: ['SLACK', 'PAGERDUTY']; severity: 'P1' };

  // Infrastructure
  db_connections_high: { threshold_percent: 80; channels: ['SLACK']; severity: 'P3' };
  redis_memory_high: { threshold_percent: 85; channels: ['SLACK']; severity: 'P2' };
  queue_depth_high: { threshold: 1000; channels: ['SLACK']; severity: 'P2' };

  // Business
  scoring_stale: { threshold_minutes: 15; channels: ['SLACK']; severity: 'P2' };
  notification_failure_rate: { threshold_percent: 10; channels: ['SLACK']; severity: 'P2' };
}
```

---

## 8. Audit Log

Every admin action is logged with full context. The audit trail is immutable.

### Audit Schema

```typescript
interface AdminAuditEntry {
  id: string;
  admin_user_id: string;
  admin_user_email: string;
  action: string;                      // "tenant.suspend", "user.merge", "contest.recalculate"
  resource_type: string;               // "TENANT", "USER", "CONTEST", etc.
  resource_id: string;
  description: string;                 // "Suspended tenant 'Golf Crew' — reason: payment fraud"
  before_state?: Record<string, any>;
  after_state?: Record<string, any>;
  reason?: string;
  ip_address: string;
  user_agent: string;
  timestamp: Date;
}
```

### Audit Log Viewer

```
Filters:
  - Admin user
  - Action type
  - Resource type
  - Date range
  - Tenant (for scoped viewing)

Search:
  - Free text across description and reason fields

Export:
  - CSV export for compliance reporting
```

---

## 9. Global Announcements

Push a banner or notification to all active users platform-wide.

```typescript
interface GlobalAnnouncement {
  id: string;
  type: 'BANNER' | 'NOTIFICATION' | 'BOTH';

  // Content
  title: string;
  body: string;
  link_url?: string;
  link_text?: string;

  // Display
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  dismissable: boolean;

  // Targeting
  target: 'ALL_USERS' | 'ALL_TENANTS' | 'SPECIFIC_TENANTS';
  target_tenant_ids?: string[];

  // Scheduling
  starts_at: Date;
  ends_at?: Date;

  // Status
  is_active: boolean;
  created_by: string;
  created_at: Date;
}

// Examples:
// - "Scheduled maintenance tonight 2-4am UTC" (WARNING, banner, dismissable)
// - "New feature: Salary Cap drafts are now available!" (INFO, notification)
// - "Data provider outage affecting golf scores" (CRITICAL, banner, not dismissable)
```

---

## 10. Support Tools

### Tenant Investigation View

A consolidated view for support staff investigating a tenant issue.

```typescript
interface TenantInvestigation {
  tenant: TenantAdminView;

  // Recent errors for this tenant
  recent_errors: {
    service: string;
    error_type: string;
    message: string;
    stack_trace?: string;
    occurred_at: Date;
    request_id: string;
  }[];

  // Notification delivery failures
  notification_failures: {
    event_type: string;
    channel: string;
    failure_reason: string;
    user_id: string;
    occurred_at: Date;
  }[];

  // Recent API requests (sampled)
  recent_requests: {
    method: string;
    path: string;
    status_code: number;
    latency_ms: number;
    user_id?: string;
    occurred_at: Date;
  }[];

  // Active issues
  scoring_staleness: ScoreFreshness[];
  pending_corrections: number;
  failed_webhooks: number;
}
```

### Quick Actions (Support Shortcuts)

```
Common support scenarios with one-click solutions:
  ├── "User can't log in" → Reset password + check auth events
  ├── "Scores aren't updating" → Check provider health + re-ingest event
  ├── "Wrong draft pick" → View draft log + undo pick (if within window)
  ├── "Payment failed" → View Stripe status + apply credit if needed
  ├── "Can't create contest" → Check entitlements + usage limits
  └── "Missing notifications" → Check preferences + delivery log
```

---

## 11. Data Migration Tools

### Migration Runner

```typescript
interface MigrationTool {
  // List available migrations
  listMigrations(): Promise<Migration[]>;

  // Run a migration
  runMigration(migrationId: string, options: MigrationOptions): Promise<MigrationResult>;

  // Check status of a running migration
  getMigrationStatus(runId: string): Promise<MigrationRunStatus>;

  // Cancel a running migration
  cancelMigration(runId: string): Promise<void>;
}

interface MigrationOptions {
  dry_run: boolean;                    // simulate without writing
  batch_size: number;
  concurrency: number;
  tenant_ids?: string[];               // run for specific tenants only
  notify_on_complete: boolean;
}

interface MigrationRunStatus {
  run_id: string;
  migration_id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: {
    total_records: number;
    processed: number;
    succeeded: number;
    failed: number;
    percentage: number;
  };
  started_at: Date;
  estimated_completion?: Date;
  errors: { record_id: string; error: string }[];
}
```

### Common Migration Types

```
- Backfill analytics data for existing contests
- Re-compute history records and league records
- Re-calculate all budget pricing from current rankings
- Migrate data model changes (schema migrations)
- Re-index search data
- Clean up orphaned records
```

---

## 12. Database Schema (Admin-Specific Tables)

```sql
-- Admin users
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
  permissions VARCHAR(100)[] DEFAULT '{}',
  sso_provider_id VARCHAR(255),
  mfa_enabled BOOLEAN DEFAULT FALSE,
  mfa_secret VARCHAR(255),
  last_login_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin audit log (append-only, no updates or deletes)
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  admin_user_email VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feature flags
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  flag_type VARCHAR(20) NOT NULL DEFAULT 'BOOLEAN',
  enabled_globally BOOLEAN DEFAULT FALSE,
  rollout_percentage INTEGER,
  owner VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES admin_users(id)
);

-- Feature flag tenant overrides
CREATE TABLE feature_flag_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id UUID NOT NULL REFERENCES feature_flags(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  enabled BOOLEAN NOT NULL,
  reason VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES admin_users(id),
  UNIQUE(flag_id, tenant_id)
);

-- Global announcements
CREATE TABLE global_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL DEFAULT 'BANNER',
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  link_url TEXT,
  link_text VARCHAR(255),
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
  dismissable BOOLEAN DEFAULT TRUE,
  target VARCHAR(50) NOT NULL DEFAULT 'ALL_USERS',
  target_tenant_ids UUID[],
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Impersonation sessions
CREATE TABLE impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE
);

-- Migration runs
CREATE TABLE migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  options JSONB NOT NULL,
  progress JSONB DEFAULT '{}',
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  started_by UUID NOT NULL REFERENCES admin_users(id)
);

CREATE INDEX idx_admin_audit_log_time ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_log_resource ON admin_audit_log(resource_type, resource_id);
CREATE INDEX idx_admin_audit_log_admin ON admin_audit_log(admin_user_id, created_at DESC);
CREATE INDEX idx_feature_flags_key ON feature_flags(key);
CREATE INDEX idx_announcements_active ON global_announcements(is_active, starts_at, ends_at);
CREATE INDEX idx_migration_runs_status ON migration_runs(status);
```

---

## 13. Tech Stack

```
Frontend:   React + TypeScript (admin-specific SPA, separate from public app)
Backend:    Same Node.js + Express services, admin-scoped endpoints with admin auth middleware
UI Library: Tailwind CSS + Headless UI (or similar admin-focused component library)
Charting:   Recharts or similar for health graphs and metrics
Auth:       Internal SSO (Okta / Google Workspace) + MFA
API:        Same backend services, admin-scoped endpoints with admin auth middleware
Hosting:    Internal-only access (VPN or IP-restricted)
```

---

## 14. Implementation Phases

### Phase 1 — Foundation & Tenant Management
- Admin authentication (SSO integration)
- Admin role and permission model
- Tenant list, detail, and basic actions (view, edit plan, suspend)
- Admin audit log (all actions logged from day one)

### Phase 2 — User & Contest Operations
- User search and management
- Contest browser and detail view
- Scoring override and recalculation tools
- User merge tool

### Phase 3 — Sports Data & Feature Flags
- Provider health dashboard
- Ingestion monitoring view
- Provider configuration management
- Re-ingest tools
- Feature flag CRUD and tenant overrides

### Phase 4 — Platform Health & Monitoring
- Service health dashboard
- Infrastructure metrics display
- Alert configuration
- Error log viewer

### Phase 5 — Advanced Tooling
- Impersonation sessions
- Global announcements
- Migration runner with dry-run and progress tracking
- Support investigation view
- Quick action shortcuts
- Tenant data export tools

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 11-001 | 1 | `admin_users` table + migrations | Not Started | |
| 11-002 | 1 | Admin authentication (SSO integration — Okta/Google Workspace) | Not Started | |
| 11-003 | 1 | Admin role and permission model (SUPER_ADMIN → VIEWER) | Not Started | |
| 11-004 | 1 | Tenant list view (name, plan, members, contests, status, last active) | Not Started | |
| 11-005 | 1 | Tenant detail view (subscription, usage, leagues, activity) | Not Started | |
| 11-006 | 1 | Tenant actions (upgrade, downgrade, apply credit, suspend) | Not Started | |
| 11-007 | 1 | `admin_audit_log` table + all admin actions logged | Not Started | Immutable, from day one |
| 11-008 | 2 | User search across tenants (email, name, ID) | Not Started | |
| 11-009 | 2 | User detail view (tenants, leagues, contests, devices) | Not Started | |
| 11-010 | 2 | User actions (reset password, force logout, disable) | Not Started | |
| 11-011 | 2 | Contest browser (any contest, any league, any tenant) | Not Started | |
| 11-012 | 2 | Contest admin actions (force close, reopen, recalculate) | Not Started | |
| 11-013 | 2 | User merge tool (merge duplicates, transfer memberships) | Not Started | |
| 11-014 | 3 | Provider health dashboard (status, error rate, latency, last event) | Not Started | |
| 11-015 | 3 | Ingestion monitoring view (jobs, errors, throughput) | Not Started | |
| 11-016 | 3 | Provider configuration management (credentials, webhooks) | Not Started | |
| 11-017 | 3 | Re-ingest tools (trigger re-ingestion for specific event) | Not Started | |
| 11-018 | 3 | `feature_flags` table + CRUD | Not Started | |
| 11-019 | 3 | `feature_flag_overrides` table + tenant-specific overrides | Not Started | |
| 11-020 | 3 | Feature flag resolution service (override → global → rollout %) | Not Started | |
| 11-021 | 4 | Service health dashboard (all services, uptime, error rates, latency) | Not Started | |
| 11-022 | 4 | Infrastructure metrics display (DB, Redis, queues, S3/CDN) | Not Started | |
| 11-023 | 4 | Alert configuration (thresholds, channels — Slack, PagerDuty) | Not Started | |
| 11-024 | 4 | Error log viewer (recent errors, stack traces, request IDs) | Not Started | |
| 11-025 | 5 | `impersonation_sessions` table + impersonation flow | Not Started | |
| 11-026 | 5 | `global_announcements` table + banner/notification management | Not Started | |
| 11-027 | 5 | `migration_runs` table + migration runner (dry-run, progress) | Not Started | |
| 11-028 | 5 | Support investigation view (errors, notifications, API requests per tenant) | Not Started | |
| 11-029 | 5 | Quick action shortcuts (common support scenarios) | Not Started | |
| 11-030 | 5 | Tenant data export tools | Not Started | |

---

*Generated by Claude — PoolMaster Admin / Platform Operations Dashboard Plan v1.0*
