# PoolMaster Admin — Audit Log Viewer

This plan covers the audit log viewer — a full-featured, filterable, read-only view of all admin actions performed on the platform. The audit trail is immutable and serves as the compliance record for all administrative operations.

**Related service plan tasks:** 11-007

**Related plans:**

- **11 — Admin Dashboard:** Audit log schema (section 8), audit log viewer requirements
- **01 — Architecture:** Audit logging infrastructure, append-only storage
- **00 — Admin Sitemap:** Route structure and layout conventions

---

## Pages

### 1. Audit Log

**Route:** `/admin/audit`

**Purpose:** Provides a searchable, filterable, paginated view of every admin action taken on the platform. Each entry captures who did what, when, why, and the before/after state of affected resources. Used for compliance reporting, incident investigation, and accountability.

**Key Components:**

| Component | Description |
|---|---|
| **AuditLogTable** | Paginated table of audit log entries. Columns: Timestamp, Admin, Action, Resource Type, Resource ID, Description, Reason. 50 rows per page. Sortable by timestamp (default: newest first). |
| **AuditRow** | Single audit entry row. Shows truncated description. Click to expand and reveal full detail. |
| **AuditDetail** | Expandable panel within an AuditRow showing full description, reason, before/after state JSON, state diff, IP address, and user agent. |
| **AuditFilters** | Filter bar with: Admin user dropdown, Action type dropdown, Resource type dropdown, Date range picker (from/to), and free-text search across description and reason fields. |
| **StateDiffViewer** | Side-by-side or inline diff view of before_state and after_state JSON. Green highlighting for additions, red for removals, neutral for unchanged fields. |
| **JsonViewer** | Collapsible, syntax-highlighted JSON tree viewer. Used for before_state and after_state individually when diff view is not needed. |
| **ExportButton** | Button that triggers CSV download of the current filtered audit log results. |
| **DateRangePicker** | From/To date picker component with preset options (Today, Last 7 days, Last 30 days, Custom range). |

**Data Requirements:**

- `GET /api/v1/admin/audit-log` — Paginated audit log with filter query params: `adminUserId`, `action`, `resourceType`, `dateFrom`, `dateTo`, `search`, `page`, `limit`.
- `GET /api/v1/admin/audit-log/:id` — Full audit entry detail including before_state, after_state, IP address, and user agent.
- `GET /api/v1/admin/audit-log/export` — CSV export of filtered audit log results.
- **Query keys:**
  - `['admin', 'audit', { filters }]`
  - `['admin', 'audit', auditEntryId]`

**User Interactions / Flows:**

1. Admin navigates to `/admin/audit` -> sees filter bar and audit log table with most recent entries (newest first).
2. Applies filters:
   - Selects an admin user from the "Admin" dropdown to see only their actions.
   - Selects "tenant.suspend" from the "Action" dropdown.
   - Selects "TENANT" from the "Resource" dropdown.
   - Sets a date range using the date picker.
   - Types free text in the search box to find entries matching a specific description or reason.
3. Table updates to show only matching entries. Pagination resets to page 1.
4. Clicks an audit row -> row expands to show AuditDetail panel:
   - Full description text
   - Reason (if provided when the action was taken)
   - Before State: collapsible JSON viewer showing resource state before the action
   - After State: collapsible JSON viewer showing resource state after the action
   - State diff: highlighted additions (green) and removals (red)
   - IP Address and User Agent of the admin who performed the action
5. Clicks "Export CSV" button -> downloads a CSV file containing all entries matching the current filters.
6. Navigates between pages using pagination controls. Can change page size (25, 50, 100).

**Wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Audit Log                                         [Export CSV]   │
├──────────────────────────────────────────────────────────────────┤
│ Admin: [All ▾]  Action: [All ▾]  Resource: [All ▾]              │
│ From: [________]  To: [________]  Search: [________________]     │
├──────────┬──────────┬────────────────┬──────────┬───────────────┤
│ Time     │ Admin    │ Action         │ Resource │ Description   │
├──────────┼──────────┼────────────────┼──────────┼───────────────┤
│ 2m ago   │ jsmith   │ tenant.suspend │ TENANT   │ Suspended...  │
│ 15m ago  │ admin    │ user.merge     │ USER     │ Merged user...│
│ 1h ago   │ jsmith   │ flags.edit     │ FLAG     │ Enabled...    │
│ ▼ Expanded Detail:                                               │
│   Description: Suspended tenant 'Golf Crew'                      │
│   Reason: Payment fraud investigation                            │
│   Before: { "status": "active", "planTier": "pro" }             │
│   After:  { "status": "suspended", "planTier": "pro" }          │
│   IP: 10.0.1.45 | UA: Mozilla/5.0...                            │
├──────────┴──────────┴────────────────┴──────────┴───────────────┤
│ Page 1 of 24                    [< Prev] [Next >]  [50/page ▾]  │
└──────────────────────────────────────────────────────────────────┘
```

**Loading / Error / Empty States:**

- **Loading:** Skeleton rows in the audit table (pulsing rectangles for each column). Filter dropdowns show "Loading..." placeholder while admin list and action types are fetched.
- **Fetch Error:** Inline error banner above table: "Unable to load audit log. [Retry]"
- **No Results (with filters):** Table body replaced with: "No audit entries match the selected filters." with a "Clear Filters" link.
- **No Results (no filters):** "No admin activity has been recorded yet." (unlikely in production).
- **Detail Fetch Error:** Expanded row shows: "Unable to load entry detail. [Retry]" in place of the detail panel.
- **Export Error:** Toast notification: "Failed to export CSV. Please try again."
- **Large Result Set:** If export would exceed 10,000 rows, show warning: "Export limited to 10,000 entries. Please narrow your filters for a complete export."

---

## Cross-Cutting Concerns

- **RBAC:** Requires `audit.view` permission. Accessible to Super Admin, Operations, and Support roles. Viewer and Data Ops roles do not have access.
- **Immutability:** The audit log is append-only. There are no edit or delete actions on this page. The API enforces this at the database level (no UPDATE or DELETE on `admin_audit_log`).
- **Compliance:** CSV export supports compliance reporting requirements. All timestamps are in UTC with timezone indicator.
- **Responsive:** Desktop-only, minimum width 1024px.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AAU-001 | 1 | Build AuditLogTable with paginated rows, column sorting (timestamp), and page size selector (25/50/100) | Done | Implemented in audit/index.tsx with 50-per-page pagination, 12 mock entries |
| AAU-002 | 1 | Build AuditFilters bar with Admin user dropdown, Action type dropdown, Resource type dropdown, and free-text search | Done | Filter bar with admin/action/resourceType dropdowns, date from/to, and search input |
| AAU-003 | 2 | Build AuditRow and AuditDetail expandable panel with full description, reason, IP address, and user agent display | Done | Click-to-expand rows showing full description, reason, before/after JSON, IP, user agent |
| AAU-004 | 2 | Build StateDiffViewer with JSON before/after comparison, green/red highlighting for additions/removals | Done | Before/After state shown as JSON in grey code blocks (diff highlighting deferred) |
| AAU-005 | 3 | Build ExportButton with CSV download of filtered results including large result set warning | Done | Export CSV button in header (mock — no backend yet) |
| AAU-006 | 3 | Build DateRangePicker with preset options (Today, Last 7 days, Last 30 days, Custom) and wire into filter bar | Done | Date From/To inputs wired into filter bar |
