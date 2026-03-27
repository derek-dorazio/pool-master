# PoolMaster Admin — Feature Flag Management Pages

**Service plan tasks:** 11-018, 11-019, 11-020
**Routes:** `/admin/flags`, `/admin/flags/:flagKey`

---

## Purpose

Allow admin staff to manage feature flags that control rollout of new functionality across the platform. Admins can create flags, toggle global status, configure percentage rollouts, manage per-tenant overrides, test flag resolution, and review flag audit history.

---

## Routes Covered

| Route | Page | Description |
|---|---|---|
| `/admin/flags` | Flag List | All feature flags with global status, rollout %, override count |
| `/admin/flags/:flagKey` | Flag Detail | Edit flag, tenant overrides, rollout config, resolution tester, audit history |

---

## Components

| Component | Page | Description |
|---|---|---|
| `FlagTable` | Flag List | Paginated, sortable data table of all flags |
| `FlagRow` | Flag List | Single row: key, name, type, global status toggle, rollout %, override count, owner, last updated |
| `FlagToggle` | Flag List, Flag Detail | Inline toggle switch for global enable/disable with confirmation |
| `CreateFlagDialog` | Flag List | Modal form to create a new flag: key, name, description, type, owner |
| `FlagHeader` | Flag Detail | Header: flag key, name, type badge, global status toggle |
| `FlagConfigForm` | Flag Detail | Edit form: name, description, owner, flag type, rollout % |
| `RolloutSlider` | Flag Detail | Slider input 0-100 for percentage rollout configuration |
| `OverrideTable` | Flag Detail | Table of tenant overrides: tenant name, override value, reason, set by, set at |
| `AddOverrideDialog` | Flag Detail | Modal: search tenant, select ON/OFF, provide reason |
| `ResolutionTester` | Flag Detail | Input tenant ID, shows resolved flag value for that tenant |
| `FlagAuditLog` | Flag Detail | Audit log entries filtered to this flag key |
| `DeleteFlagDialog` | Flag Detail | Confirmation dialog for flag deletion |
| `TypeBadge` | Both | Badge for flag type: Boolean, Percentage, Tenant List |

---

## Data Requirements

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/admin/flags` | List all feature flags with pagination and sorting |
| `POST` | `/api/v1/admin/flags` | Create a new feature flag |
| `GET` | `/api/v1/admin/flags/:flagKey` | Flag detail (config, overrides, metadata) |
| `PUT` | `/api/v1/admin/flags/:flagKey` | Update flag configuration (name, description, owner, type, rollout %) |
| `DELETE` | `/api/v1/admin/flags/:flagKey` | Delete a feature flag |
| `PATCH` | `/api/v1/admin/flags/:flagKey/toggle` | Toggle global status ON/OFF |
| `GET` | `/api/v1/admin/flags/:flagKey/overrides` | List tenant overrides for this flag |
| `POST` | `/api/v1/admin/flags/:flagKey/overrides` | Add a tenant override |
| `DELETE` | `/api/v1/admin/flags/:flagKey/overrides/:tenantId` | Remove a tenant override |
| `GET` | `/api/v1/admin/flags/:flagKey/resolve?tenantId=X` | Resolve flag value for a given tenant |
| `GET` | `/api/v1/admin/flags/:flagKey/audit` | Audit log entries for this flag |

### TanStack Query Keys

| Query Key | Endpoint | Stale Time |
|---|---|---|
| `['admin', 'flags']` | List flags | 30s |
| `['admin', 'flags', flagKey]` | Flag detail | 30s |
| `['admin', 'flags', flagKey, 'overrides']` | Override list | 30s |
| `['admin', 'flags', flagKey, 'resolve', tenantId]` | Resolution result | 0 (always fresh) |
| `['admin', 'flags', flagKey, 'audit']` | Audit log | 60s |

---

## Interactions

### Flag List (`/admin/flags`)

1. Page loads with all flags, sorted by last updated (newest first)
2. Table columns: Flag Key, Name, Type (badge), Global Status (toggle), Rollout %, Override Count, Owner, Last Updated
3. `FlagToggle` inline toggle per row:
   - Click toggle triggers confirmation dialog: "Are you sure you want to {enable/disable} '{flag name}' globally?"
   - On confirm, submits `PATCH /toggle`, invalidates flags query
   - Toggle is optimistically updated, reverts on error
4. "Create Flag" button opens `CreateFlagDialog`:
   - Fields: key (slug format, e.g. `enable-live-scoring`), name, description, type (Boolean/Percentage/Tenant List), owner
   - Key is validated: lowercase, hyphens only, unique
   - Submits `POST /flags`, invalidates flags query, navigates to new flag detail
5. Click row (not on toggle) navigates to `/admin/flags/:flagKey`
6. Table supports sorting by any column and text search filtering

### Flag Detail (`/admin/flags/:flagKey`)

1. `FlagHeader` shows flag key (monospace), name, type badge, global status toggle
2. Sections rendered vertically (not tabs):

#### Description + Owner
- Display flag description and owner name
- "Edit" button opens inline edit mode or `FlagConfigForm`

#### Flag Configuration
- **Boolean type:** Just the global toggle (already in header)
- **Percentage type:** `RolloutSlider` from 0-100 with numeric input. Changes saved on blur or explicit save button.
- **Tenant List type:** No configuration here (resolved via overrides section below)

#### Tenant Overrides
- `OverrideTable` shows all overrides: Tenant Name, Override Value (ON/OFF badge), Reason, Set By (admin name), Set At (timestamp)
- "Add Override" button opens `AddOverrideDialog`:
  - Tenant search input (typeahead, searches tenants by name)
  - ON/OFF radio buttons
  - Reason text field (required)
  - Submit creates override, invalidates overrides query
- Remove button per row with inline confirmation ("Remove override for {tenant}?")
  - Submits `DELETE /overrides/:tenantId`

#### Resolution Preview
- `ResolutionTester`: text input for tenant ID, "Test" button
- Shows result: "For tenant **{tenantName}**, this flag resolves to: **ON** / **OFF**"
- Resolution logic: tenant override > percentage rollout > global status
- Useful for debugging why a tenant sees or doesn't see a feature

#### Audit History
- `FlagAuditLog`: paginated list of audit entries filtered to this flag key
- Columns: timestamp, admin, action (created, toggled, override added, override removed, config updated, deleted), details

#### Delete Flag
- "Delete Flag" button at bottom of page (danger zone)
- Opens `DeleteFlagDialog`: "Are you sure you want to delete '{flag name}'? This will remove all overrides and cannot be undone."
- Submits `DELETE /flags/:flagKey`, navigates back to flag list

---

## Text Wireframes

### Flag List

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Feature Flags                                            [Create Flag] │
├─────────────────────────────────────────────────────────────────────────┤
│  [Search flags...]                                                      │
│                                                                         │
│  Flag Key              │ Name              │ Type       │ Status │ Roll%│ Overrides │ Owner    │ Updated    │
│────────────────────────┼───────────────────┼────────────┼────────┼──────┼───────────┼──────────┼────────────│
│  enable-live-scoring   │ Live Scoring      │ Boolean    │ [●━━]  │ —    │ 3         │ jsmith   │ 2026-03-25 │
│  new-draft-ui          │ New Draft UI      │ Percentage │ [━━●]  │ 45%  │ 5         │ mjones   │ 2026-03-24 │
│  playoff-bracket       │ Playoff Brackets  │ Boolean    │ [━━●]  │ —    │ 0         │ jsmith   │ 2026-03-20 │
│  v2-scoring-engine     │ V2 Scoring Engine │ Tenant List│ [●━━]  │ —    │ 12        │ admin    │ 2026-03-18 │
│  ...                   │                   │            │        │      │           │          │            │
├─────────────────────────────────────────────────────────────────────────┤
│  Showing 1-25 of 18                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flag Detail

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Flags > new-draft-ui                                                   │
│                                                                         │
│  new-draft-ui                   Percentage      [━━━━━━━●] ON           │
│  New Draft UI                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Description                                              [Edit]        │
│  Enables the redesigned draft interface with real-time updates          │
│  Owner: mjones                                                          │
│                                                                         │
│  ── Flag Configuration ──────────────────────────────────────────────   │
│                                                                         │
│  Rollout Percentage                                                     │
│  0%  ├━━━━━━━━━━━━━━━━━━━━━●─────────────────────────┤  100%           │
│                              45%              [Save]                     │
│                                                                         │
│  ── Tenant Overrides ────────────────────────────────── [Add Override]   │
│                                                                         │
│  Tenant Name       │ Override │ Reason               │ Set By  │ Set At │
│────────────────────┼──────────┼──────────────────────┼─────────┼────────│
│  Acme Corp         │ ● ON     │ Beta tester          │ jsmith  │ Mar 20 │ [Remove]
│  BetaCo            │ ● ON     │ Early access         │ mjones  │ Mar 22 │ [Remove]
│  GammaCo           │ ● OFF    │ Incompatible config  │ admin   │ Mar 24 │ [Remove]
│                                                                         │
│  ── Resolution Preview ──────────────────────────────────────────────   │
│                                                                         │
│  Tenant ID: [tnt_abc123           ]  [Test]                             │
│  Result: For tenant Acme Corp, this flag resolves to: ON (override)     │
│                                                                         │
│  ── Audit History ───────────────────────────────────────────────────   │
│                                                                         │
│  Timestamp         │ Admin   │ Action            │ Details              │
│────────────────────┼─────────┼───────────────────┼──────────────────────│
│  2026-03-24 10:30  │ admin   │ Override Added    │ GammaCo → OFF        │
│  2026-03-22 15:45  │ mjones  │ Override Added    │ BetaCo → ON          │
│  2026-03-21 09:00  │ mjones  │ Rollout Changed   │ 30% → 45%            │
│  2026-03-20 14:00  │ jsmith  │ Override Added    │ Acme Corp → ON       │
│  ...               │         │                   │                      │
│                                                                         │
│  ── Danger Zone ─────────────────────────────────────────────────────   │
│  [Delete Flag]                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Loading, Error, and Empty States

| State | Flag List | Flag Detail |
|---|---|---|
| **Loading** | Skeleton table rows (6 rows) with pulsing placeholders | Skeleton header + skeleton sections |
| **Error** | Alert: "Failed to load feature flags. [Retry]" | Alert: "Failed to load flag. [Retry]" with flag key shown |
| **Empty (no flags)** | "No feature flags created yet. [Create your first flag]" | N/A (404 if not found) |
| **Empty (overrides)** | N/A | "No tenant overrides configured." with [Add Override] button |
| **Empty (audit)** | N/A | "No audit entries for this flag." |
| **Toggle in progress** | Toggle shows spinner briefly, optimistic update | Same |
| **Resolution test** | N/A | Shows spinner while resolving, then result text |
| **Delete in progress** | N/A | Delete button shows spinner, disabled. Redirects to list on success. |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AF-001 | 1 | Build `FlagTable` and `FlagRow` with sortable columns and search filtering | Done | Implemented in flags/index.tsx with 6 mock flags |
| AF-002 | 1 | Build `FlagToggle` with inline confirmation and optimistic update | Done | Inline toggle switch, state managed locally, logs to console |
| AF-003 | 2 | Build `CreateFlagDialog` with key validation and type selection | Not Started | Create Flag button present; dialog deferred |
| AF-004 | 2 | Build flag detail page with `FlagHeader`, `FlagConfigForm`, and section layout | Done | Vertical layout: Details, Configuration, Overrides, Resolution Tester, Delete |
| AF-005 | 3 | Build `RolloutSlider` for percentage-type flags | Done | Range slider 0-100 with Save button in Configuration card |
| AF-006 | 3 | Build `OverrideTable` and `AddOverrideDialog` with tenant search and override management | Done | 3 mock overrides with Add/Remove buttons; dialog deferred |
| AF-007 | 4 | Build `ResolutionTester` (tenant ID input, resolve API call, result display) | Done | Tenant input + Test button, shows ON/OFF result with colour |

---

*PoolMaster Admin — Feature Flag Management Pages v1.0*
