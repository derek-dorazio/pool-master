# PoolMaster Admin — Tenant Management Pages

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

This plan covers the tenant list, tenant detail, and tenant action flows for the admin dashboard. These pages enable operations and support staff to browse all tenants on the platform, inspect their usage and health, manage subscriptions, and perform administrative actions like suspension, plan changes, and impersonation.

**Related service plan tasks:** 11-004, 11-005, 11-006, 11-025

**Related plans:**

- **11 — Admin Dashboard:** Tenant management, impersonation, admin actions
- **07 — Billing:** Plan tiers, subscription management, credits
- **01 — Architecture:** Multi-tenant data isolation, tenant lifecycle
- **00 — Admin Sitemap:** Route structure and layout conventions

---

## Pages

### 1. Tenant List

**Route:** `/admin/tenants`

**Purpose:** Provides a searchable, filterable, sortable table of all tenants on the platform. Serves as the primary entry point for tenant investigation and management. Supports bulk export for reporting.

**Key Components:**

| Component | Description |
|---|---|
| **TenantTable** | Full-width data table with sortable columns: Name, Plan, Members, Leagues, Contests, Status, Last Active. Supports click-to-sort on any column header. Rows are clickable (navigate to tenant detail). |
| **TenantFilters** | Filter bar above the table. Dropdowns for: Plan Tier (Free/Starter/Pro/League+), Status (Active/Suspended/Trial), Date Range (created or last active). Filters are reflected in URL query params for shareability. |
| **TenantRow** | Single table row rendering tenant data. Includes StatusBadge and PlanBadge inline. |
| **StatusBadge** | Colored badge: green "Active", yellow "Trial", red "Suspended". |
| **PlanBadge** | Outlined badge with plan tier name and color coding (Free = gray, Starter = blue, Pro = purple, League+ = gold). |
| **PaginationBar** | Table footer with page navigation and rows-per-page selector (25/50/100). Shows total count. |
| **BulkActions** | Toolbar with "Export CSV" button. Exports current filtered result set. |

**Data Requirements:**

- `GET /api/v1/admin/tenants` — Paginated tenant list with query params: `search`, `plan`, `status`, `dateFrom`, `dateTo`, `sortBy`, `sortDir`, `page`, `pageSize`.
- **Query keys:** `['admin', 'tenants', { search, plan, status, dateFrom, dateTo, sortBy, sortDir, page, pageSize }]`
- `GET /api/v1/admin/tenants/export` — Triggers CSV export of current filter set. Returns download URL.
- Response shape: `{ data: Tenant[], total: number, page: number, pageSize: number }`

**User Interactions / Flows:**

1. Admin navigates to `/admin/tenants` -> sees full tenant table with default sort (Last Active, descending).
2. Types in search bar -> table filters in real-time (debounced 300ms) by tenant name or slug.
3. Selects filter dropdowns -> table updates immediately, URL query params update for bookmark/share.
4. Clicks column header -> toggles sort direction for that column.
5. Clicks a tenant row -> navigates to `/admin/tenants/:tenantId`.
6. Changes rows-per-page -> table re-fetches with new page size.
7. Clicks "Export CSV" -> downloads CSV of current filtered results.

**Wireframe:**

```
+----------------------------------------------------------+
| PoolMaster Admin   [Health: ●]           [Admin Name ▾]  |
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Tenants                        [Export CSV]  |
|          |                                               |
|          |  [Search tenants...        ]                  |
|          |  Plan: [All ▾]  Status: [All ▾]  Date: [Any ▾]|
|          |                                               |
|          |  +--------------------------------------------+|
|          |  | Name ▾    Plan   Members Leagues Contests  ||
|          |  |           Tier                    Status   ||
|          |  |--------------------------------------------|
|          |  | Acme Corp  Pro    45      3       12       ||
|          |  |                                  Active    ||
|          |  |--------------------------------------------|
|          |  | Beta LLC   Free   8       1       2        ||
|          |  |                                  Trial     ||
|          |  |--------------------------------------------|
|          |  | Gamma Inc  Lgue+  120     8       34       ||
|          |  |                                  Active    ||
|          |  |--------------------------------------------|
|          |  | Delta Co   Start  15      2       5        ||
|          |  |                                  Suspended ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  Showing 1-25 of 142    [25▾] [< 1 2 3 ... >]|
|          |                                               |
+----------+-----------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton table with 10 pulsing rows and gray header. Filter bar is interactive immediately.
- **Error:** Inline error banner above table: "Failed to load tenants. [Retry]". Filters remain visible.
- **Empty (no results):** Table body shows "No tenants match your filters." with a "Clear filters" link.
- **Empty (no tenants):** Table body shows "No tenants on the platform yet." (unlikely in production).

---

### 2. Tenant Detail

**Route:** `/admin/tenants/:tenantId`

**Purpose:** Comprehensive view of a single tenant's configuration, usage, members, leagues, contests, billing, activity, and health. Also provides an action sidebar for administrative operations (plan changes, suspension, impersonation, etc.).

**Key Components:**

| Component | Description |
|---|---|
| **TenantHeader** | Top section: tenant name (large), PlanBadge, StatusBadge, created date, tenant ID (copyable). Breadcrumb: Tenants > {Tenant Name}. |
| **TenantTabs** | Tab bar with 7 tabs: Overview, Members, Leagues, Contests, Billing, Activity, Health. Active tab state reflected in URL hash. |
| **UsageCard** | Card showing resource usage against plan limits. Three progress bars: Leagues (X of Y), Contests (X of Y), Members (X of Y). Bars turn yellow at 80%, red at 95%. |
| **InfoCard** | Key-value display: name, slug, plan, created date, last active, primary contact email. |
| **RecentSignups** | Mini table: last 5 users who joined this tenant, with email, display name, and join date. |
| **MemberTable** | Paginated table of all tenant members: Email, Display Name, Role (Owner/Admin/Member), Last Active. Click row -> user detail. |
| **LeagueTable** | Table of leagues within this tenant: League Name, Members, Contests, Created, Status. |
| **ContestTable** | Table of contests: Contest Name, Sport, Type, Status, Entries, Created. Click row -> contest detail. |
| **BillingCard** | Plan details, current MRR contribution, lifetime value, next invoice date. Placeholder for Stripe integration. |
| **InvoiceTable** | List of past invoices: Date, Amount, Status (Paid/Pending/Failed). |
| **ActivityLog** | Scrollable list of recent activity scoped to this tenant: timestamp, actor, action, resource. |
| **HealthCard** | Tenant-scoped health metrics: error rate (24h), notification failure rate, average API latency. Mini charts (sparklines). |
| **ActionModal** | Generic modal wrapper used by all action dialogs. Handles confirm/cancel pattern. |
| **PlanChangeDialog** | Modal: select new plan from dropdown, reason textarea (required), confirm button. |
| **SuspendDialog** | Modal: reason textarea (required), warning about impact, confirm button. |
| **DeleteConfirmDialog** | Destructive modal: type tenant name to confirm, reason textarea, red "Delete" button. |
| **CreditDialog** | Modal: amount input, reason textarea, confirm button. |
| **ExtendTrialDialog** | Modal: days input (number), reason textarea, confirm button. |
| **ImpersonationLauncher** | Button that opens a confirmation modal, then launches impersonation session (opens public app in new tab with impersonation token). Yellow banner appears in admin app. |

**Data Requirements:**

- `GET /api/v1/admin/tenants/:id` — Full tenant detail with overview, usage stats, recent signups.
- `GET /api/v1/admin/tenants/:id/members?page&pageSize` — Paginated member list.
- `GET /api/v1/admin/tenants/:id/leagues` — All leagues for this tenant.
- `GET /api/v1/admin/tenants/:id/contests?page&pageSize` — Paginated contest list.
- `GET /api/v1/admin/tenants/:id/billing` — Billing summary, invoices, MRR.
- `GET /api/v1/admin/tenants/:id/activity?limit=50` — Recent activity log.
- `GET /api/v1/admin/tenants/:id/health` — Error rate, notification failures, latency.
- `PUT /api/v1/admin/tenants/:id/plan` — Change tenant plan (body: `{ plan, reason }`).
- `POST /api/v1/admin/tenants/:id/suspend` — Suspend tenant (body: `{ reason }`).
- `POST /api/v1/admin/tenants/:id/unsuspend` — Unsuspend tenant.
- `POST /api/v1/admin/tenants/:id/credit` — Apply credit (body: `{ amount, reason }`).
- `POST /api/v1/admin/tenants/:id/extend-trial` — Extend trial (body: `{ days, reason }`).
- `DELETE /api/v1/admin/tenants/:id` — Delete tenant (body: `{ confirmation, reason }`).
- `POST /api/v1/admin/tenants/:id/impersonate` — Start impersonation session (returns impersonation token).
- **Query keys:**
  - `['admin', 'tenants', tenantId]` — tenant overview
  - `['admin', 'tenants', tenantId, 'members', { page, pageSize }]`
  - `['admin', 'tenants', tenantId, 'leagues']`
  - `['admin', 'tenants', tenantId, 'contests', { page, pageSize }]`
  - `['admin', 'tenants', tenantId, 'billing']`
  - `['admin', 'tenants', tenantId, 'activity']`
  - `['admin', 'tenants', tenantId, 'health']`

**User Interactions / Flows:**

1. Admin arrives at tenant detail -> sees header with tenant name, plan, status, and Overview tab active.
2. Overview tab shows InfoCard, UsageCard, and RecentSignups.
3. Clicks "Members" tab -> MemberTable loads with paginated member list.
4. Clicks a member row -> navigates to `/admin/users/:userId`.
5. Clicks "Leagues" tab -> LeagueTable loads.
6. Clicks "Contests" tab -> ContestTable loads. Clicks a contest -> navigates to `/admin/contests/:contestId`.
7. Clicks "Billing" tab -> BillingCard and InvoiceTable load.
8. Clicks "Activity" tab -> ActivityLog loads with recent tenant-scoped events.
9. Clicks "Health" tab -> HealthCard loads with error rate, notification failures, latency sparklines.
10. **Change Plan:** Clicks "Change Plan" action -> PlanChangeDialog opens -> selects plan, enters reason -> confirms -> plan updated, toast notification, invalidate tenant query.
11. **Suspend:** Clicks "Suspend Tenant" -> SuspendDialog opens -> enters reason -> confirms -> tenant suspended, StatusBadge updates.
12. **Unsuspend:** Clicks "Unsuspend Tenant" -> confirmation modal -> tenant unsuspended.
13. **Apply Credit:** Clicks "Apply Credit" -> CreditDialog opens -> enters amount and reason -> confirms -> credit applied, toast.
14. **Extend Trial:** Clicks "Extend Trial" -> ExtendTrialDialog opens -> enters days and reason -> confirms -> trial extended, toast.
15. **Delete Tenant:** Clicks "Delete Tenant" -> DeleteConfirmDialog opens -> types tenant name to confirm, enters reason -> clicks red "Delete" button -> tenant deleted, redirect to `/admin/tenants`.
16. **Impersonate:** Clicks "Impersonate" -> ImpersonationLauncher confirmation modal -> confirms -> new tab opens with public app as that tenant. Yellow "Impersonating: {tenant}" banner appears in admin app header.

**Wireframe:**

```
+----------------------------------------------------------+
| PoolMaster Admin   [Health: ●]           [Admin Name ▾]  |
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |  Tenants > Acme Corp                          |
|          |                                               |
|          |  Acme Corp          [Pro] [Active]             |
|          |  Created: Jan 15, 2025    ID: ten_abc123 [copy]|
|          |                                               |
|          |  [Overview] [Members] [Leagues] [Contests]    |
|          |  [Billing] [Activity] [Health]                 |
|          |                                               |
|          |  +--- Overview Tab ---------------------------+|
|          |  |                                            ||
|          |  | Tenant Info          | Usage               ||
|          |  | Name: Acme Corp      | Leagues:  3/10  ███ ||
|          |  | Slug: acme-corp      | Contests: 12/50 ██  ||
|          |  | Plan: Pro            | Members:  45/100 ██ ||
|          |  | Last Active: 2h ago  |                     ||
|          |  |                      |                     ||
|          |  | Recent Signups       |                     ||
|          |  | jane@acme.com  Mar 1 |                     ||
|          |  | bob@acme.com   Feb 28|                     ||
|          |  +--------------------------------------------+|
|          |                                               |
|          |  Actions ▾                                    |
|          |  +--------------------+                       |
|          |  | Change Plan        |                       |
|          |  | Suspend Tenant     |                       |
|          |  | Apply Credit       |                       |
|          |  | Extend Trial       |                       |
|          |  | Impersonate        |                       |
|          |  | Delete Tenant      |                       |
|          |  +--------------------+                       |
|          |                                               |
+----------+-----------------------------------------------+
```

**Loading / Error / Empty States:**

- **Loading (Detail):** Skeleton header (name, badges), skeleton tab content area. Tabs are visible but non-interactive until data loads.
- **Loading (Tabs):** Each tab loads independently. Switching to a new tab shows skeleton content for that tab while fetching.
- **Error (Detail):** Full-page error: "Failed to load tenant. [Retry] [Back to Tenants]".
- **Error (Tab):** Inline error within tab content area: "Failed to load {tab name}. [Retry]". Other tabs remain functional.
- **Tenant Not Found:** "Tenant not found" page with "Back to Tenants" link.
- **Empty Members:** "No members in this tenant."
- **Empty Leagues:** "No leagues created yet."
- **Empty Contests:** "No contests found."
- **Empty Activity:** "No recent activity for this tenant."
- **Empty Invoices:** "No invoices yet." (with note about billing integration status)
- **Action Error:** Toast notification: "Failed to {action}. Please try again." Modal remains open for retry.
- **Action Success:** Toast notification: "{Action} completed successfully." Modal closes, relevant data refetches.

---

## Cross-Cutting Concerns

- **RBAC:** Tenant list is visible to all admin roles. Edit/suspend/delete actions are gated by permissions (`tenant.edit`, `tenant.suspend`, `tenant.delete`). Impersonation requires `tenant.impersonate`. Action buttons are hidden (not just disabled) for admins without the required permission.
- **Audit Logging:** All mutating actions (plan change, suspend, unsuspend, credit, extend trial, delete, impersonate) are automatically logged to the admin audit trail with admin ID, timestamp, reason, and before/after state.
- **Impersonation Safety:** Impersonation sessions have a 1-hour timeout. All actions taken during impersonation are tagged with `impersonated_by: adminId` in the audit log. A yellow banner in the admin app persists until the session ends.
- **URL State:** Filters, sort order, pagination, and active tab are all reflected in URL params/hash for deep linking and shareability.
- **Optimistic Updates:** Suspend/unsuspend toggle uses optimistic updates with rollback on failure. Plan changes and deletions wait for server confirmation.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AT-001 | 1 | Build TenantTable with TenantRow, StatusBadge, PlanBadge, sortable columns, and pagination | Done | |
| AT-002 | 1 | Build TenantFilters with plan tier, status, and date range dropdowns; URL param sync | Done | |
| AT-003 | 2 | Build TenantHeader and TenantTabs shell with URL hash routing for tab state | Done | |
| AT-004 | 2 | Build Overview tab: InfoCard, UsageCard with progress bars, RecentSignups mini-table | Done | |
| AT-005 | 2 | Build Members tab: MemberTable with pagination and click-through to user detail | Done | |
| AT-006 | 2 | Build Leagues and Contests tabs: LeagueTable, ContestTable with click-through navigation | Done | |
| AT-007 | 3 | Build Billing tab: BillingCard, InvoiceTable (with Stripe placeholder) | Done | |
| AT-008 | 3 | Build Activity tab (ActivityLog) and Health tab (HealthCard with sparklines) | Done | |
| AT-009 | 3 | Build action modals: PlanChangeDialog, SuspendDialog, CreditDialog, ExtendTrialDialog, DeleteConfirmDialog | Partial | Action confirmations use ConfirmDialog; full modal forms deferred |
| AT-010 | 3 | Build ImpersonationLauncher with confirmation modal, token handling, and impersonation banner | Not Started | Impersonation UI not implemented |
