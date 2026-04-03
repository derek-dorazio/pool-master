# PoolMaster Admin — Platform Health Dashboard

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

This plan covers the platform health dashboard, error log viewer, and alert configuration pages. These pages give operations staff real-time visibility into service status, infrastructure health, key business metrics, and error trends — enabling fast incident detection and response.

**Related service plan tasks:** 11-021, 11-022, 11-023, 11-024

**Related plans:**

- **11 — Admin Dashboard:** Platform health dashboard (section 7), alerting integration, error logging
- **01 — Architecture:** Service health endpoints, infrastructure topology
- **00 — Admin Sitemap:** Route structure and layout conventions

---

## Pages

### 1. Health Dashboard

**Route:** `/admin/health`

**Purpose:** Aggregated view of all service statuses, infrastructure metrics, and key business metrics. This is the primary operational monitoring page — the first place an admin looks during an incident. All data auto-refreshes every 30 seconds.

**Key Components:**

| Component | Description |
|---|---|
| **ServiceTable** | Table of all backend services with columns: Service Name, Status, Uptime %, Error Rate %, P95 Latency, Version. Rows are clickable to expand detail. |
| **ServiceRow** | Single service row within ServiceTable. Displays status dot (green/yellow/red), key metrics, and expandable detail panel. |
| **HealthStatusDot** | Colored circle indicator: green = UP, yellow = DEGRADED, red = DOWN. Used across all health displays. |
| **DependencyList** | Expandable panel within a ServiceRow showing the service's downstream dependencies, their statuses, and latency. Also shows last health check timestamp. |
| **InfraCard** | Card displaying a single infrastructure component (PostgreSQL, Redis, Message Bus, S3/CDN) with its key metric and status indicator. |
| **MetricStatCard** | Stat card for key business metrics: Active Users (24h), API Requests (24h), Notifications Sent/Delivered (rate%), Active Contests, Live Drafts. |

**Data Requirements:**

- `GET /api/v1/admin/health` — Aggregated health response combining services, infrastructure, and key metrics.
- `GET /api/v1/admin/health/services` — Detailed per-service health (status, uptime, error rate, latency, version, dependencies, last check).
- `GET /api/v1/admin/health/infrastructure` — Infrastructure metrics (PostgreSQL, Redis, Message Bus, S3/CDN).
- **Query keys:**
  - `['admin', 'health', 'aggregated']` — refetch interval: 30s
  - `['admin', 'health', 'services']` — refetch interval: 30s
  - `['admin', 'health', 'infrastructure']` — refetch interval: 30s

**User Interactions / Flows:**

1. Admin navigates to `/admin/health` -> sees three sections: Services, Infrastructure, Key Metrics.
2. Services section shows a table with all 7 services. Status dots indicate health at a glance.
3. Clicks a service row -> row expands to show dependencies, their statuses and latencies, and the last health check timestamp.
4. Infrastructure section shows 4 cards (PostgreSQL, Redis, Message Bus, S3/CDN) with key metrics and status indicators.
5. Key Metrics section shows stat cards for Active Users, API Requests, Notifications, Active Contests, Live Drafts.
6. All data auto-refreshes every 30 seconds. No manual refresh needed.
7. If any service or infrastructure component is DEGRADED or DOWN, it is visually highlighted.

**Wireframe:**

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
│  Ingestion Worker ● UP     99.95%    0.10%         15ms        │
│                                                                  │
│  ▼ Expanded: Scoring Engine                                      │
│    Dependencies:                                                 │
│      PostgreSQL    ● UP   12ms                                   │
│      Redis         ● UP   2ms                                    │
│      Message Bus   ● UP   5ms                                    │
│    Last health check: 15s ago   Version: v2.4.1                  │
│                                                                  │
│  Infrastructure                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐│
│  │ PostgreSQL  │ │ Redis       │ │ Message Bus │ │ S3/CDN     ││
│  │ ● UP        │ │ ● UP        │ │ ● UP        │ │ ● UP       ││
│  │ CPU: 35%    │ │ Mem: 2.1/8GB│ │ Depth: 12   │ │ BW: 45GB/d ││
│  │ Conn: 120/500│ │ Keys: 450K │ │ Lag: 0.5s   │ │            ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘│
│                                                                  │
│  Key Metrics                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌────────┐ ┌──────┐│
│  │ Active   │ │ API Req  │ │ Notifications│ │ Active │ │ Live ││
│  │ Users    │ │ (24h)    │ │ Sent / Deliv │ │Contests│ │Drafts││
│  │  1,245   │ │  125K    │ │ 8,450 / 8,320│ │  156   │ │  3   ││
│  │          │ │          │ │   (98.5%)    │ │        │ │      ││
│  └──────────┘ └──────────┘ └──────────────┘ └────────┘ └──────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton table rows for services (pulsing rectangles). Skeleton cards for infrastructure and key metrics. HealthStatusDots show gray with "Checking..." tooltip.
- **Service Fetch Error:** ServiceTable shows inline error banner: "Unable to load service health. Retrying..." with manual retry link. Infrastructure and Key Metrics sections load independently.
- **Infrastructure Fetch Error:** InfraCards show "Error loading" with retry icon. Other sections remain functional.
- **All Services UP:** Normal display, no special state.
- **Service DEGRADED:** Row highlighted with yellow background. Status dot yellow.
- **Service DOWN:** Row highlighted with red background. Status dot red. Row auto-expanded to show dependencies.
- **Partial Failure:** Each section loads independently. Failed sections show inline error with "Retry" link.

---

### 2. Error Log

**Route:** `/admin/health/errors`

**Purpose:** Filterable, searchable table of recent errors across all backend services. Provides full stack traces and request context for debugging production issues.

**Key Components:**

| Component | Description |
|---|---|
| **ErrorLogTable** | Paginated table of error entries. Columns: Timestamp, Service, Error Type, Message, Tenant (if scoped), Request ID. Rows are clickable to expand. |
| **ErrorRow** | Single error entry within the table. Shows truncated message. Click to expand. |
| **ErrorDetail** | Expandable detail panel within an ErrorRow showing full error message, request context (method, path, user ID, tenant ID), and stack trace. |
| **StackTraceViewer** | Monospace, syntax-highlighted stack trace display with line numbers. Collapsible frames. Copy-to-clipboard button. |
| **ErrorFilters** | Filter bar with: Service dropdown, Error Type dropdown, Severity dropdown (Error/Warning/Fatal), Date Range picker (from/to), Tenant dropdown. Also includes free-text search across message fields. |

**Data Requirements:**

- `GET /api/v1/admin/health/errors` — Paginated error log with filter query params: `service`, `errorType`, `severity`, `dateFrom`, `dateTo`, `tenantId`, `search`, `page`, `limit`.
- `GET /api/v1/admin/health/errors/:errorId` — Full error detail including stack trace and request context.
- `GET /api/v1/admin/health/errors/export` — CSV export of filtered error results.
- **Query keys:**
  - `['admin', 'health', 'errors', { filters }]`
  - `['admin', 'health', 'errors', errorId]`

**User Interactions / Flows:**

1. Admin navigates to `/admin/health/errors` -> sees filter bar and error table with most recent errors.
2. Applies filters (e.g., Service = "Scoring Engine", Severity = "Error", last 1 hour) -> table updates.
3. Clicks an error row -> row expands to show full message, request context, and stack trace.
4. Clicks "Copy Stack Trace" button in StackTraceViewer -> copies to clipboard.
5. Clicks "Export CSV" -> downloads filtered errors as CSV file.
6. Uses free-text search to find errors containing a specific request ID or error message.
7. Pagination: 50 errors per page by default.

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Error Log                                          [Export CSV]   │
├──────────────────────────────────────────────────────────────────┤
│ Service: [All ▾]  Type: [All ▾]  Severity: [All ▾]              │
│ Tenant: [All ▾]   From: [________]  To: [________]              │
│ Search: [____________________________________]                    │
├──────────┬──────────┬──────────┬────────────┬────────┬──────────┤
│ Time     │ Service  │ Type     │ Message    │ Tenant │ Req ID   │
├──────────┼──────────┼──────────┼────────────┼────────┼──────────┤
│ 2m ago   │ Scoring  │ Timeout  │ Provider...│ —      │ req_a1b2 │
│ 5m ago   │ Auth     │ 401      │ Invalid... │ Acme   │ req_c3d4 │
│ ▼ Expanded Detail:                                               │
│   Message: Provider timeout after 5000ms for event golf_masters  │
│   Service: scoring-engine  Severity: ERROR                       │
│   Method: POST  Path: /api/v1/scoring/ingest                     │
│   User: —  Tenant: —  Request ID: req_a1b2                      │
│   ┌── Stack Trace ──────────────────────── [Copy] ──┐            │
│   │ Error: Provider timeout after 5000ms             │            │
│   │   at ScoringProvider.fetch (provider.ts:142)     │            │
│   │   at IngestHandler.handle (ingest.ts:56)         │            │
│   │   at Router.dispatch (router.ts:88)              │            │
│   └─────────────────────────────────────────────────┘            │
│ 12m ago  │ Notif    │ Delivery │ Push fail..│ Golf   │ req_e5f6 │
├──────────┴──────────┴──────────┴────────────┴────────┴──────────┤
│ Page 1 of 18                    [< Prev] [Next >]  [50/page ▾]  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton rows in the error table. Filters remain interactive.
- **Fetch Error:** Inline error banner above table: "Unable to load error log. [Retry]"
- **No Errors (empty):** Table body replaced with "No errors found for the selected filters." with a green checkmark icon.
- **No Errors (no filters):** "No recent errors across all services. All clear." message.
- **Export Error:** Toast notification: "Failed to export CSV. Please try again."

---

### 3. Alert Configuration

**Route:** `/admin/health/alerts`

**Purpose:** View and manage alert rules that trigger notifications to Slack and PagerDuty when platform health thresholds are breached. Admins can edit thresholds, change notification channels, and mute/unmute alerts.

**Key Components:**

| Component | Description |
|---|---|
| **AlertRulesTable** | Table of all configured alert rules. Columns: Alert Name, Condition, Threshold, Window, Channels, Severity, Status (Active/Muted). |
| **AlertRow** | Single alert rule row. Shows severity badge, channel icons, and mute/active toggle. |
| **AlertEditDialog** | Modal dialog for editing an alert rule's threshold value, window, and notification channels. |
| **MuteDialog** | Modal dialog for muting an alert with duration selector: 1 hour, 4 hours, 24 hours, or indefinite. Shows reason text input. |
| **ChannelSelector** | Multi-select for notification channels: Slack, PagerDuty. Used within AlertEditDialog. |
| **SeverityBadge** | Colored badge: P1 = red, P2 = orange, P3 = yellow. Used in AlertRow. |

**Data Requirements:**

- `GET /api/v1/admin/health/alerts` — List of all alert rules with current configuration and status.
- `PUT /api/v1/admin/health/alerts/:alertId` — Update alert rule (threshold, window, channels).
- `POST /api/v1/admin/health/alerts/:alertId/mute` — Mute an alert with duration and reason.
- `POST /api/v1/admin/health/alerts/:alertId/unmute` — Unmute an alert.
- **Query keys:**
  - `['admin', 'health', 'alerts']`

**Pre-Configured Alert Rules:**

| Alert Name | Condition | Threshold | Window | Channels | Severity |
|---|---|---|---|---|---|
| Service Down | Service status = DOWN | — | Immediate | Slack + PagerDuty | P1 |
| Service Degraded | Service status = DEGRADED | — | Immediate | Slack | P2 |
| Error Rate High | Error rate exceeds threshold | >5% | 5 min | Slack | P2 |
| Error Rate Critical | Error rate exceeds threshold | >20% | 5 min | Slack + PagerDuty | P1 |
| DB Connections High | Connection pool usage exceeds threshold | >80% | Immediate | Slack | P3 |
| Redis Memory High | Redis memory usage exceeds threshold | >85% | Immediate | Slack | P2 |
| Queue Depth High | Message queue depth exceeds threshold | >1000 | Immediate | Slack | P2 |
| Scoring Stale | No scoring updates received | >15 min | — | Slack | P2 |
| Notification Failure Rate | Notification delivery failure rate | >10% | Immediate | Slack | P2 |

**User Interactions / Flows:**

1. Admin navigates to `/admin/health/alerts` -> sees table of all alert rules with current config and status.
2. Each row shows severity badge, channels (Slack icon, PagerDuty icon), and Active/Muted status.
3. Clicks "Edit" on an alert row -> AlertEditDialog opens with current threshold, window, and channels pre-filled.
4. Modifies threshold or channels -> clicks "Save" -> dialog closes, table updates. Change is audit-logged.
5. Clicks "Mute" on an alert row -> MuteDialog opens with duration options (1h, 4h, 24h, indefinite) and reason input.
6. Selects duration and enters reason -> clicks "Mute" -> alert status changes to "Muted (until X)". Mute is audit-logged.
7. Clicks "Unmute" on a muted alert -> confirmation prompt -> alert returns to Active. Unmute is audit-logged.

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Alert Configuration                                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Alert Name            Condition         Thresh  Window  Chan  Sev  Status │
│  ────────────────────  ────────────────  ──────  ──────  ────  ───  ────── │
│  Service Down          status = DOWN      —      Imm.    S+PD  P1  Active │
│  Service Degraded      status = DEGRADED  —      Imm.    S     P2  Active │
│  Error Rate High       error_rate > X     5%     5 min   S     P2  Active │
│  Error Rate Critical   error_rate > X     20%    5 min   S+PD  P1  Active │
│  DB Connections High   conn_pool > X      80%    Imm.    S     P3  Active │
│  Redis Memory High     redis_mem > X      85%    Imm.    S     P2  Muted  │
│  Queue Depth High      queue_depth > X    1000   Imm.    S     P2  Active │
│  Scoring Stale         no_update > X      15m    —       S     P2  Active │
│  Notif Failure Rate    fail_rate > X      10%    Imm.    S     P2  Active │
│                                                                  │
│  Row actions: [Edit] [Mute/Unmute]                               │
│                                                                  │
│  ┌── Edit Alert Dialog ──────────────────────────┐               │
│  │ Alert: Error Rate High                         │               │
│  │ Threshold: [5    ] %                           │               │
│  │ Window:    [5    ] minutes                     │               │
│  │ Channels:  [x] Slack  [ ] PagerDuty            │               │
│  │                       [Cancel] [Save Changes]  │               │
│  └────────────────────────────────────────────────┘               │
│                                                                  │
│  ┌── Mute Alert Dialog ──────────────────────────┐               │
│  │ Mute: Redis Memory High                        │               │
│  │ Duration: (o) 1h  ( ) 4h  ( ) 24h  ( ) Indef.  │               │
│  │ Reason: [_________________________________]     │               │
│  │                         [Cancel] [Mute Alert]  │               │
│  └────────────────────────────────────────────────┘               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton rows in the alert rules table.
- **Fetch Error:** Inline error banner: "Unable to load alert configuration. [Retry]"
- **Save Error:** Toast notification: "Failed to update alert. Please try again." Dialog remains open with values preserved.
- **Mute Error:** Toast notification: "Failed to mute alert. Please try again."
- **No Alerts:** Unlikely state (alerts are pre-configured), but would show "No alert rules configured."

---

## Cross-Cutting Concerns

- **RBAC:** Requires `platform.health` permission. Super Admin, Operations, Data Ops, and Viewer roles can view. Only Super Admin and Operations can edit alerts.
- **Polling:** All health data refreshes every 30 seconds. Polling is paused when the browser tab is not visible and resumes on focus.
- **Audit Logging:** Alert edits, mutes, and unmutes are logged in the admin audit trail.
- **Responsive:** Desktop-only, minimum width 1024px.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AH-001 | 1 | Build Health Dashboard page layout with three sections (Services, Infrastructure, Key Metrics) and 30s polling infrastructure | Done | Implemented in health/index.tsx with useHealthDashboard hook; this is UI/polling work, not a claim that the backend health store is fully durable |
| AH-002 | 1 | Build ServiceTable and ServiceRow components with status dots, metrics columns, and expandable detail | Done | Inline in health/index.tsx — service table renders contract-backed health data and status dots |
| AH-003 | 1 | Build InfraCard components for PostgreSQL, Redis, Message Bus, S3/CDN with key metrics and status indicators | Done | 4 infrastructure cards in health/index.tsx with icons and dual metrics |
| AH-004 | 1 | Build MetricStatCard components for Active Users, API Requests, Notifications, Active Contests, Live Drafts | Done | 5 key metric stat cards in health/index.tsx |
| AH-005 | 1 | Build DependencyList and HealthStatusDot shared components; wire up polling with TanStack Query refetchInterval | Done | Status dots implemented inline; polling via useHealthDashboard; "Last refreshed Xs ago" indicator |
| AH-006 | 2 | Build Error Log page with ErrorLogTable, ErrorRow, ErrorFilters (service, type, severity, date range, tenant, search) | Done | health/errors.tsx with filters and pagination; keep the wording scoped to current error-log contract coverage |
| AH-007 | 2 | Build ErrorDetail expandable panel and StackTraceViewer with syntax highlighting, line numbers, and copy-to-clipboard | Done | Click-to-expand rows with monospace stack traces in grey background |
| AH-008 | 3 | Build AlertRulesTable and AlertRow with SeverityBadge, ChannelSelector icons, and Active/Muted status display | Done | health/alerts.tsx with alert rules and status badges; this should not imply fully finalized alert persistence |
| AH-009 | 3 | Build AlertEditDialog (threshold, window, channels) and MuteDialog (duration selector, reason) with audit logging | Done | Alert edits/mutes are surfaced in the UI; note that the storage backend still needs truthfulness treatment elsewhere in the plan |
