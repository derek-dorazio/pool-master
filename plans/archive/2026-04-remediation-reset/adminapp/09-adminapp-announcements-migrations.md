# PoolMaster Admin — Announcements & Migrations

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

This plan covers global announcements (create and manage platform-wide banners and notifications), the migration runner (execute and monitor data migrations), and the support investigation view (consolidated debugging tools for tenant issues). These are advanced operational tools used by the platform team.

**Related service plan tasks:** 11-025, 11-026, 11-027, 11-028, 11-029, 11-030

**Related plans:**

- **11 — Admin Dashboard:** Global announcements (section 9), data migration tools (section 11), support tools (section 10), impersonation (section 2)
- **01 — Architecture:** Migration infrastructure, notification delivery
- **00 — Admin Sitemap:** Route structure and layout conventions

---

## Pages

### 1. Global Announcements

**Route:** `/admin/announcements`

**Purpose:** View and manage platform-wide announcements that appear as banners, push notifications, or both to targeted users. Used for maintenance windows, feature launches, outage communications, and other platform-wide messages.

**Key Components:**

| Component | Description |
|---|---|
| **AnnouncementTable** | Table of all announcements. Columns: Title, Type (Banner/Notification/Both), Severity (Info/Warning/Critical), Target, Status (Active/Scheduled/Expired), Starts At, Ends At. Sorted by created date (newest first). |
| **AnnouncementRow** | Single announcement row with SeverityBadge, TargetBadge, and StatusToggle. |
| **SeverityBadge** | Colored badge: Info = blue, Warning = amber, Critical = red. |
| **TargetBadge** | Badge showing target audience: "All Users", "All Tenants", or "3 Tenants" (with tooltip listing tenant names). |
| **StatusToggle** | Toggle switch to activate/deactivate an announcement. Deactivating a live announcement immediately removes it. |

**Data Requirements:**

- `GET /api/v1/admin/announcements` — Paginated list of announcements with filter params: `status`, `severity`, `type`.
- `DELETE /api/v1/admin/announcements/:id` — Soft-delete an announcement.
- `PATCH /api/v1/admin/announcements/:id` — Update announcement status (activate/deactivate).
- **Query keys:**
  - `['admin', 'announcements', { filters }]`

**User Interactions / Flows:**

1. Admin navigates to `/admin/announcements` -> sees table of all announcements with status indicators.
2. Active announcements show a green "Active" badge. Scheduled announcements show a blue "Scheduled" badge with start time. Expired announcements show a gray "Expired" badge.
3. Clicks StatusToggle on an active announcement -> confirmation dialog -> deactivates immediately.
4. Clicks "Create Announcement" button -> navigates to `/admin/announcements/create`.

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Announcements                            [Create Announcement]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Title              Type    Severity  Target      Status   Dates │
│  ────────────────  ──────  ────────  ──────────  ───────  ───── │
│  Maintenance 3/28  Banner  Warning   All Users   Active   3/26- │
│  Salary Cap Live!  Notif   Info      All Users   Sched.   4/01  │
│  Golf Data Outage  Both    Critical  All Tenants Active   3/25- │
│  New Season Start  Banner  Info      3 Tenants   Expired  3/15  │
│                                                                  │
│  Row actions: [Toggle Active] [Edit] [Delete]                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton rows in the announcement table.
- **Fetch Error:** Inline error banner: "Unable to load announcements. [Retry]"
- **No Announcements:** "No announcements have been created. Use 'Create Announcement' to publish your first one."
- **Toggle Error:** Toast notification: "Failed to update announcement status. Please try again."

---

### 2. Create Announcement

**Route:** `/admin/announcements/create`

**Purpose:** Form to compose and publish a new platform-wide announcement with type, severity, targeting, and scheduling options. Includes a live preview panel showing how the announcement will appear to users.

**Key Components:**

| Component | Description |
|---|---|
| **AnnouncementForm** | Full creation form with all fields: Type, Title, Body, Link URL/Text, Severity, Dismissable toggle, Target, Schedule (Starts At, Ends At). Validates required fields before submission. |
| **AnnouncementPreview** | Live preview panel showing how the banner and/or notification will appear to end users. Updates in real-time as the form is filled. |
| **TenantMultiSelect** | Searchable multi-select dropdown for choosing specific tenants when Target = "Specific Tenants". Shows tenant name and member count. |
| **SeveritySelector** | Radio group with color indicators: Info (blue), Warning (amber), Critical (red). Shows a brief description of when to use each severity level. |

**Data Requirements:**

- `POST /api/v1/admin/announcements` — Create a new announcement. Body: `{ type, title, body, linkUrl, linkText, severity, dismissable, target, targetTenantIds, startsAt, endsAt }`.
- `GET /api/v1/admin/tenants?search=X&limit=20` — Tenant search for TenantMultiSelect (reuses existing tenant list endpoint).
- **Query keys:**
  - `['admin', 'tenants', { search }]` — for tenant multi-select

**User Interactions / Flows:**

1. Admin navigates to `/admin/announcements/create` -> sees form on the left, preview on the right.
2. Selects Type: Banner / Notification / Both.
3. Enters Title and Body text. Preview updates in real-time.
4. Optionally adds Link URL and Link Text (e.g., "Learn More" linking to a status page).
5. Selects Severity: Info / Warning / Critical. Preview updates color scheme.
6. Toggles Dismissable on/off. Preview shows/hides dismiss button.
7. Selects Target:
   - "All Users" -> no further input needed.
   - "All Tenants" -> no further input needed.
   - "Specific Tenants" -> TenantMultiSelect appears. Admin searches and selects tenants.
8. Sets Starts At (datetime picker). Optionally sets Ends At.
9. Clicks "Publish":
   - If Severity = Critical -> confirmation dialog: "This will send a critical alert to [target]. Are you sure?"
   - On confirm -> announcement is created and admin is redirected to `/admin/announcements`.
10. All announcement creation is audit-logged.

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Create Announcement                                [Cancel]      │
├────────────────────────────┬─────────────────────────────────────┤
│ Form                       │ Preview                             │
│                            │                                     │
│ Type:                      │ ┌─ Banner Preview ───────────────┐  │
│ (o) Banner  ( ) Notif.     │ │ [!] Maintenance scheduled for  │  │
│ ( ) Both                   │ │     March 28, 2-4am UTC.       │  │
│                            │ │     [Learn More]          [X]  │  │
│ Title:                     │ └────────────────────────────────┘  │
│ [Maintenance scheduled_]   │                                     │
│                            │ ┌─ Notification Preview ─────────┐  │
│ Body:                      │ │ Maintenance scheduled for      │  │
│ [Systems will be           │ │ March 28, 2-4am UTC.           │  │
│  unavailable for routine   │ │ Systems will be unavailable... │  │
│  maintenance.__________]   │ └────────────────────────────────┘  │
│                            │                                     │
│ Link URL: [https://___]    │                                     │
│ Link Text: [Learn More]    │                                     │
│                            │                                     │
│ Severity:                  │                                     │
│ ( ) Info  (o) Warning      │                                     │
│ ( ) Critical               │                                     │
│                            │                                     │
│ Dismissable: [ON]          │                                     │
│                            │                                     │
│ Target:                    │                                     │
│ (o) All Users              │                                     │
│ ( ) All Tenants            │                                     │
│ ( ) Specific Tenants       │                                     │
│                            │                                     │
│ Starts At: [2026-03-28 02:00] │                                  │
│ Ends At:   [2026-03-28 04:00] │                                  │
│                            │                                     │
│            [Publish]       │                                     │
├────────────────────────────┴─────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Form renders immediately (no data dependency except tenant search). TenantMultiSelect shows "Loading tenants..." while fetching.
- **Validation Error:** Inline field errors: "Title is required", "Body is required", "Start date is required". Submit button disabled until required fields are filled.
- **Submit Error:** Toast notification: "Failed to create announcement. Please try again." Form values preserved.
- **Tenant Search Error:** TenantMultiSelect shows: "Unable to search tenants. [Retry]"

---

### 3. Migration Runner

**Route:** `/admin/migrations`

**Purpose:** View available data migrations, trigger new migration runs, and monitor active and recently completed runs. Supports dry-run mode, batch size configuration, and tenant-scoped execution.

**Key Components:**

| Component | Description |
|---|---|
| **MigrationTable** | Table of available migrations. Columns: Migration ID, Description, Last Run (timestamp + status), Status. |
| **MigrationRunCard** | Card showing a running migration with progress bar, processed/total count, success/fail counts, and estimated completion time. |
| **ProgressBar** | Visual progress bar with percentage, animated fill, and color coding (green = normal, yellow = has failures, red = failed). |
| **RunMigrationDialog** | Modal for configuring and starting a migration run. Options: Dry Run toggle, Batch Size input, Concurrency input, Tenant Filter (multi-select). |

**Data Requirements:**

- `GET /api/v1/admin/migrations` — List available migrations with last run info.
- `POST /api/v1/admin/migrations/:migrationId/run` — Start a migration run. Body: `{ dryRun, batchSize, concurrency, tenantIds }`.
- `GET /api/v1/admin/migrations/runs` — List active and recent migration runs.
- `GET /api/v1/admin/migrations/runs/:runId` — Detailed run status (used by detail page).
- **Query keys:**
  - `['admin', 'migrations']`
  - `['admin', 'migrations', 'runs']` — refetch interval: 5s (while active runs exist)

**User Interactions / Flows:**

1. Admin navigates to `/admin/migrations` -> sees three sections: Available Migrations, Active Runs, Recent History.
2. Available Migrations table shows each migration with its last run time and result.
3. Clicks "Run Migration" on a migration row -> RunMigrationDialog opens with defaults: Dry Run = ON, Batch Size = 100, Concurrency = 1.
4. Configures options:
   - Toggles Dry Run off for a real run.
   - Adjusts batch size and concurrency.
   - Optionally selects specific tenants to run the migration for.
5. Clicks "Run" -> migration starts, dialog closes, card appears in Active Runs section.
6. Active Runs section shows MigrationRunCards with live progress (polled every 5 seconds).
7. Clicks a run card -> navigates to `/admin/migrations/:runId` for detailed view.
8. Recent History shows completed/failed/cancelled runs with summary stats.

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Migration Runner                                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Available Migrations                                            │
│  ┌────────────────────────────┬──────────────────┬─────────────┐ │
│  │ Migration                  │ Last Run         │ Status      │ │
│  ├────────────────────────────┼──────────────────┼─────────────┤ │
│  │ Backfill analytics data    │ 3 days ago (OK)  │ [Run]       │ │
│  │ Re-compute history records │ Never            │ [Run]       │ │
│  │ Re-index search data       │ 1 week ago (OK)  │ [Run]       │ │
│  │ Clean orphaned records     │ 2 days ago (FAIL)│ [Run]       │ │
│  └────────────────────────────┴──────────────────┴─────────────┘ │
│                                                                  │
│  Active Runs                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Re-index search data              Started by: jsmith         │ │
│  │ ████████████░░░░░░░░░░░░ 52%      12,400 / 23,800           │ │
│  │ Success: 12,380  Failed: 20       ETA: ~8 minutes            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Recent History                                                  │
│  ┌────────────────────────┬────────┬───────────┬───────────────┐ │
│  │ Migration              │ Status │ Records   │ Completed     │ │
│  ├────────────────────────┼────────┼───────────┼───────────────┤ │
│  │ Backfill analytics     │ OK     │ 45,200    │ 3 days ago    │ │
│  │ Clean orphaned records │ FAILED │ 1,200/8K  │ 2 days ago    │ │
│  └────────────────────────┴────────┴───────────┴───────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton rows in migration table. Skeleton cards in active runs section.
- **Fetch Error:** Inline error banner: "Unable to load migrations. [Retry]"
- **No Active Runs:** "No migrations currently running."
- **No History:** "No migration runs have been executed yet."
- **Run Start Error:** Toast notification: "Failed to start migration. Please try again." Dialog remains open.
- **Polling Error:** Active run card shows "Status unavailable" with retry link. Does not clear existing progress data.

---

### 4. Migration Detail

**Route:** `/admin/migrations/:runId`

**Purpose:** Detailed view of a specific migration run with real-time progress tracking, success/failure breakdown, error log for failed records, and the ability to cancel a running migration.

**Key Components:**

| Component | Description |
|---|---|
| **MigrationProgress** | Header section showing migration name, status badge (Running/Completed/Failed/Cancelled), started by, started at, and a large progress bar with processed/total count and success/fail breakdown. |
| **MigrationErrorLog** | Table of failed records within the migration run. Columns: Record ID, Error Message. Paginated if there are many failures. |
| **CancelButton** | Button to cancel a running migration. Shows confirmation dialog. Only visible when status = RUNNING. |

**Data Requirements:**

- `GET /api/v1/admin/migrations/runs/:runId` — Full run detail with progress, errors, timing.
- `POST /api/v1/admin/migrations/runs/:runId/cancel` — Cancel a running migration.
- **Query keys:**
  - `['admin', 'migrations', 'runs', runId]` — refetch interval: 5s (while status = RUNNING)

**User Interactions / Flows:**

1. Admin navigates to `/admin/migrations/:runId` -> sees migration header, progress bar, and error log.
2. If the migration is running, progress bar animates and updates every 5 seconds. Estimated completion time is shown.
3. Error log table shows any records that failed processing with their IDs and error messages.
4. Clicks "Cancel Migration" (only available if running) -> confirmation dialog: "Are you sure you want to cancel this migration? Records already processed will not be rolled back." -> On confirm, migration is cancelled.
5. When migration completes, polling stops and a summary banner appears: "Migration completed: X succeeded, Y failed."

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Back to Migrations                                             │
│                                                                  │
│ Re-index search data                        [Cancel Migration]   │
│ Status: RUNNING   Started by: jsmith   Started: 10 min ago       │
│                                                                  │
│ ████████████████████░░░░░░░░░░ 67%                               │
│ Processed: 15,946 / 23,800                                       │
│ Succeeded: 15,920   Failed: 26                                   │
│ Estimated completion: ~5 minutes                                 │
│                                                                  │
│ Error Log (26 failures)                                          │
│ ┌──────────────┬────────────────────────────────────────────────┐ │
│ │ Record ID    │ Error                                          │ │
│ ├──────────────┼────────────────────────────────────────────────┤ │
│ │ rec_a1b2c3d4 │ Index mapping failed: field 'score' is null   │ │
│ │ rec_e5f6g7h8 │ Index mapping failed: field 'score' is null   │ │
│ │ rec_i9j0k1l2 │ Timeout: record processing exceeded 30s       │ │
│ └──────────────┴────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton progress bar and skeleton rows in error log. Header shows migration name immediately.
- **Fetch Error:** Inline error: "Unable to load migration status. [Retry]"
- **No Errors:** Error log section shows: "No failures recorded." with a green checkmark.
- **Cancel Error:** Toast notification: "Failed to cancel migration. Please try again."
- **Migration Not Found:** Full-page message: "Migration run not found." with "Back to Migrations" link.

---

### 5. Support Investigation View

**Embedded in:** Tenant detail page (`/admin/tenants/:tenantId`)

**Purpose:** Consolidated debugging view for support staff investigating a tenant issue. Brings together recent errors, notification failures, sampled API requests, scoring staleness, and quick action shortcuts — all scoped to a single tenant.

**Key Components:**

| Component | Description |
|---|---|
| **InvestigationPanel** | Container panel within the tenant detail page. Tabbed or accordion layout with sections for errors, notifications, requests, scoring, and quick actions. |
| **ErrorList** | Recent errors for this tenant. Shows timestamp, service, error type, and message. Links to full error in `/admin/health/errors`. |
| **NotificationFailureList** | Recent notification delivery failures for this tenant. Shows event type, channel, failure reason, user, and timestamp. |
| **RequestSampleTable** | Sampled recent API requests for this tenant. Columns: Method, Path, Status Code, Latency, User, Timestamp. |
| **QuickActionShortcuts** | Grid of common support scenario buttons that trigger guided workflows. |

**Data Requirements:**

- `GET /api/v1/admin/tenants/:tenantId/investigation` — Aggregated investigation data: recent errors, notification failures, request samples, scoring staleness.
- **Query keys:**
  - `['admin', 'tenants', tenantId, 'investigation']`

**Quick Action Shortcuts:**

| Shortcut | Label | Action |
|---|---|---|
| 1 | "User can't log in" | Opens user search pre-filtered to this tenant. Shows reset password button + recent auth events for the user. |
| 2 | "Scores aren't updating" | Checks provider health for sports linked to this tenant's active contests. Offers re-ingest button. |
| 3 | "Wrong draft pick" | Opens draft log for the tenant's most recent draft. Shows undo pick button (if within undo window). |
| 4 | "Can't create contest" | Checks tenant entitlements (plan limits, active contest count vs. max). Shows upgrade option. |
| 5 | "Missing notifications" | Opens notification preferences for the reported user. Shows delivery log with failure reasons. |

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Investigation — Tiger's Co                                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Quick Actions                                                   │
│  [User can't log in] [Scores not updating] [Wrong draft pick]    │
│  [Can't create contest] [Missing notifications]                  │
│                                                                  │
│  Recent Errors (last 24h)                            [View All]  │
│  ┌──────────┬──────────┬─────────────────────────────────────┐   │
│  │ 15m ago  │ Scoring  │ Provider timeout for event #1234    │   │
│  │ 2h ago   │ Auth     │ Token refresh failed for user #567  │   │
│  └──────────┴──────────┴─────────────────────────────────────┘   │
│                                                                  │
│  Notification Failures (last 24h)                    [View All]  │
│  ┌──────────┬──────────┬────────────┬────────────────────────┐   │
│  │ 30m ago  │ Push     │ score.upd  │ Device token expired   │   │
│  │ 3h ago   │ Email    │ draft.rem  │ Bounce: invalid addr   │   │
│  └──────────┴──────────┴────────────┴────────────────────────┘   │
│                                                                  │
│  Recent API Requests (sampled)                                   │
│  ┌──────┬────────────────────────┬──────┬────────┬──────────┐   │
│  │ POST │ /api/v1/drafts/pick    │ 200  │ 145ms  │ 5m ago   │   │
│  │ GET  │ /api/v1/contests/123   │ 200  │ 32ms   │ 8m ago   │   │
│  │ POST │ /api/v1/scoring/sync   │ 504  │ 5001ms │ 15m ago  │   │
│  └──────┴────────────────────────┴──────┴────────┴──────────┘   │
│                                                                  │
│  Scoring Staleness                                               │
│  NFL Week 12: Fresh (2m ago)   Golf Masters: STALE (18m ago!)    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton rows in each section. Quick action buttons render immediately.
- **Fetch Error:** Inline error per section: "Unable to load [section name]. [Retry]". Other sections load independently.
- **No Errors:** "No errors in the last 24 hours for this tenant." with green checkmark.
- **No Notification Failures:** "All notifications delivered successfully in the last 24 hours."
- **No Request Samples:** "No API requests sampled for this tenant in the last 24 hours."
- **Scoring Fresh:** All scoring entries show green "Fresh" badge with timestamp.

---

## Cross-Cutting Concerns

- **RBAC:**
  - Announcements: Requires `platform.announcements` permission. Super Admin and Operations roles.
  - Migrations: Requires `platform.migrations` permission. Super Admin and Data Ops roles.
  - Support Investigation: Requires `tenant.view` permission. Visible to Super Admin, Operations, Support, Data Ops, and Viewer roles. Quick actions require additional permissions (e.g., `user.reset_password`, `sportsdata.re_ingest`).
- **Audit Logging:** All announcement creation/modification, migration starts/cancellations, and quick action executions are logged in the admin audit trail.
- **Impersonation:** Impersonation session management (creating, ending, and viewing active sessions) is tracked via the `impersonation_sessions` table and logged in the audit trail.
- **Responsive:** Desktop-only, minimum width 1024px.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AAN-001 | 1 | Build AnnouncementTable with AnnouncementRow, SeverityBadge, TargetBadge, and StatusToggle (activate/deactivate) | Done | announcements/index.tsx with 4 mock announcements, type/severity/status badges, activate/deactivate toggle |
| AAN-002 | 1 | Build AnnouncementForm with type/severity/target selectors, TenantMultiSelect, datetime pickers, and validation | Done | announcements/create.tsx with full form: type, title, body, link, severity, dismissable, target, datetime pickers |
| AAN-003 | 1 | Build AnnouncementPreview with real-time banner and notification rendering, severity color coding, and dismiss button | Done | Live preview card with coloured top bar (blue/yellow/red), dismiss X, link rendering |
| AAN-004 | 2 | Build MigrationTable with available migrations list, last run info, and "Run" button per row | Done | migrations/index.tsx with 4 available migrations table showing name, description, last run, status |
| AAN-005 | 2 | Build RunMigrationDialog with dry run toggle, batch size, concurrency, and tenant filter multi-select | Not Started | Run Migration button exists; dialog form deferred |
| AAN-006 | 2 | Build Migration Detail page with MigrationProgress (progress bar, success/fail counts, ETA) and 5s polling | Done | migrations/detail.tsx with large progress bar, stats row, estimated completion |
| AAN-007 | 2 | Build MigrationErrorLog table (record ID, error message) and CancelButton with confirmation dialog | Done | Error log table and destructive Cancel Migration button implemented |
| AAN-008 | 3 | Build InvestigationPanel with ErrorList, NotificationFailureList, RequestSampleTable, and scoring staleness display | Not Started | |
| AAN-009 | 3 | Build QuickActionShortcuts with 5 guided workflows (login, scores, draft, contest, notifications) | Not Started | |
| AAN-010 | 3 | Build impersonation session management: create session, visual indicator, end session, active session list with audit logging | Not Started | |
