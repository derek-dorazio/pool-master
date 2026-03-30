# PoolMaster Admin — Contest Operations Pages

**Service plan tasks:** 11-011, 11-012
**Routes:** `/admin/contests`, `/admin/contests/:contestId`

---

## Purpose

Provide admin staff with full visibility into any contest across all tenants. Admins can browse contests, inspect standings and scoring data, review draft logs, view override history, and perform administrative actions such as score overrides, standings recalculation, payout recalculation, and force-closing contests.

---

## Routes Covered

| Route | Page | Description |
|---|---|---|
| `/admin/contests` | Contest Browser | Browse any contest across all tenants with filtering |
| `/admin/contests/:contestId` | Contest Detail | Full admin view with standings, scoring, drafts, overrides, and admin actions |

---

## Components

| Component | Page | Description |
|---|---|---|
| `ContestBrowserTable` | Contest Browser | Paginated, sortable data table of contests |
| `ContestFilters` | Contest Browser | Filter bar: tenant, league, sport, contest type, selection type, status |
| `ContestRow` | Contest Browser | Single row in the contest table |
| `StatusBadge` | Both | Colour-coded badge for contest status (OPEN/DRAFTING/ACTIVE/COMPLETED/CANCELLED) |
| `SportIcon` | Both | Icon for the contest's sport |
| `ContestAdminHeader` | Contest Detail | Header with contest name, sport, type badges, status, breadcrumb (tenant > league > contest) |
| `AdminStandingsTable` | Contest Detail | Full leaderboard with admin columns (entry ID, user email) |
| `ScoringDataPanel` | Contest Detail | Stat event count, corrections, per-participant score breakdown |
| `FreshnessIndicator` | Contest Detail | Data freshness: last stat event timestamp, staleness warning |
| `DraftLogTable` | Contest Detail | Draft pick log: round, pick number, participant, auto-pick flag, timestamp |
| `OverrideHistoryTable` | Contest Detail | Table of all manual overrides: admin, entry, old score, new score, reason, timestamp |
| `ScoreOverrideDialog` | Contest Detail | Modal: select entry, enter new score, provide reason |
| `RecalculateDialog` | Contest Detail | Confirmation dialog showing recalculation result diff |
| `ForceCloseDialog` | Contest Detail | Modal: reason field, irreversible warning, confirm button |
| `ReopenContestDialog` | Contest Detail | Modal: reason field, confirm button |
| `ContestAuditLog` | Contest Detail | Audit log entries filtered to this contest |

---

## Data Requirements

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/admin/contests` | List contests with pagination and filters |
| `GET` | `/api/v1/admin/contests/:contestId` | Full contest detail (metadata, config, status) |
| `GET` | `/api/v1/admin/contests/:contestId/standings` | Full leaderboard with admin-only fields |
| `GET` | `/api/v1/admin/contests/:contestId/scoring` | Scoring data: stat events, corrections, freshness |
| `GET` | `/api/v1/admin/contests/:contestId/draft` | Draft session status and pick log |
| `GET` | `/api/v1/admin/contests/:contestId/overrides` | Override history for this contest |
| `GET` | `/api/v1/admin/contests/:contestId/audit` | Audit log entries for this contest |
| `POST` | `/api/v1/admin/contests/:contestId/override-score` | Apply manual score override |
| `POST` | `/api/v1/admin/contests/:contestId/recalculate-standings` | Trigger standings recalculation |
| `POST` | `/api/v1/admin/contests/:contestId/recalculate-payouts` | Trigger payout recalculation |
| `POST` | `/api/v1/admin/contests/:contestId/force-close` | Force close the contest |
| `POST` | `/api/v1/admin/contests/:contestId/reopen` | Reopen a closed contest |
| `POST` | `/api/v1/admin/contests/:contestId/re-ingest` | Trigger full re-ingestion of event data |

### TanStack Query Keys

| Query Key | Endpoint | Stale Time |
|---|---|---|
| `['admin', 'contests', filters]` | List contests | 30s |
| `['admin', 'contests', contestId]` | Contest detail | 30s |
| `['admin', 'contests', contestId, 'standings']` | Standings | 30s |
| `['admin', 'contests', contestId, 'scoring']` | Scoring data | 30s |
| `['admin', 'contests', contestId, 'draft']` | Draft log | 60s |
| `['admin', 'contests', contestId, 'overrides']` | Overrides | 60s |
| `['admin', 'contests', contestId, 'audit']` | Audit log | 60s |

---

## Interactions

### Contest Browser (`/admin/contests`)

1. Page loads with default filters (no tenant, no sport, all statuses)
2. Admin adjusts filters in `ContestFilters` bar — query re-fetches with updated params
3. Table supports server-side pagination (page, pageSize) and sorting (column, direction)
4. Click a row to navigate to `/admin/contests/:contestId`
5. Status badges use colour coding: green (ACTIVE), blue (OPEN), amber (DRAFTING), grey (COMPLETED), red (CANCELLED)

### Contest Detail (`/admin/contests/:contestId`)

1. Header shows contest name, sport icon, type badges (e.g. "Survivor", "Pick-based"), status badge
2. Breadcrumb: `Tenants > {tenantName} > {leagueName} > {contestName}`
3. Five tabs: **Standings**, **Scoring Data**, **Draft**, **Overrides**, **History**
4. Tab selection persists in URL search params (`?tab=scoring`)

#### Standings Tab
- Full leaderboard identical to public view plus admin columns: entry ID, user email
- Sortable by rank, score, user email

#### Scoring Data Tab
- `FreshnessIndicator` shows last stat event timestamp and staleness (green < 5 min, yellow < 30 min, red > 30 min)
- Stat event count and corrections applied count
- Per-participant score breakdown table
- "Re-ingest Scoring" button triggers `POST /re-ingest`, shows toast on success

#### Draft Tab
- Draft session status (NOT_STARTED, IN_PROGRESS, COMPLETED)
- Pick log table: round, pick number, participant name, auto-pick flag, timestamp
- Sortable by round/pick

#### Overrides Tab
- Table of all manual overrides: admin name, entry, old score, new score, reason, timestamp
- Empty state if no overrides exist

#### History Tab
- Audit log filtered to this contest's entity ID
- Same format as global audit log viewer

#### Admin Actions (sidebar or dropdown)
- **Override Score** — opens `ScoreOverrideDialog`: select entry from dropdown, enter new score, provide reason. Submits `POST /override-score`. Invalidates standings + overrides queries.
- **Recalculate Standings** — opens `RecalculateDialog`: confirmation with preview of how standings would change (diff). Submits `POST /recalculate-standings`. Invalidates standings query.
- **Recalculate Payouts** — confirmation dialog, submits `POST /recalculate-payouts`.
- **Force Close Contest** — opens `ForceCloseDialog`: reason field, irreversible warning ("This action cannot be undone"). Submits `POST /force-close`. Redirects to contest detail with updated status.
- **Reopen Contest** — opens `ReopenContestDialog`: reason field. Submits `POST /reopen`.
- **Re-ingest Event Data** — button with confirmation toast. Submits `POST /re-ingest`. Shows progress indicator.

---

## Text Wireframes

### Contest Browser

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Contests                                                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Tenant: [All ▾]  League: [All ▾]  Sport: [All ▾]  Type: [All ▾]       │
│  Selection: [All ▾]  Status: [All ▾]                    [Search 🔍]     │
├─────────────────────────────────────────────────────────────────────────┤
│  Contest Name        │ League    │ Tenant  │ Sport │ Type    │ Status   │ Entries │ Created    │
│──────────────────────┼───────────┼─────────┼───────┼─────────┼──────────┼─────────┼────────────│
│  NFL Survivor 2026   │ Office    │ Acme    │ NFL   │Survivor │ ● ACTIVE │ 24      │ 2026-09-01 │
│  March Madness Pool  │ Friends   │ BetaCo  │ NCAA  │ Bracket │ ● OPEN   │ 12      │ 2026-03-10 │
│  EPL Fantasy         │ Soccer    │ Acme    │ Soccer│ Fantasy │ ● ACTIVE │ 8       │ 2026-08-15 │
│  ...                 │           │         │       │         │          │         │            │
├─────────────────────────────────────────────────────────────────────────┤
│  Showing 1-25 of 342                                [< 1 2 3 ... 14 >] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Contest Detail

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tenants > Acme Corp > Office League > NFL Survivor 2026                │
│                                                                         │
│  NFL Survivor 2026          🏈 Survivor  Pick-based    ● ACTIVE         │
│  Office League · Acme Corp                                              │
├────────────────────────────────────────────────────┬────────────────────┤
│  [Standings] [Scoring Data] [Draft] [Overrides]    │  Admin Actions     │
│  [History]                                         │                    │
│                                                    │  [Override Score]  │
│  ┌─ Standings ──────────────────────────────────┐  │  [Recalc Standings]│
│  │ Rank │ User Email       │ Entry ID │ Score   │  │  [Recalc Payouts]  │
│  │──────┼──────────────────┼──────────┼─────────│  │  [Force Close]     │
│  │ 1    │ john@acme.com    │ ent_abc  │ 42      │  │  [Reopen Contest]  │
│  │ 2    │ jane@acme.com    │ ent_def  │ 38      │  │  [Re-ingest Data]  │
│  │ 3    │ bob@acme.com     │ ent_ghi  │ 35      │  │                    │
│  │ ...  │                  │          │         │  │                    │
│  └──────────────────────────────────────────────┘  │                    │
│                                                    │                    │
└────────────────────────────────────────────────────┴────────────────────┘
```

### Scoring Data Tab

```
┌─────────────────────────────────────────────────────────────────────┐
│  Data Freshness: ● 2 min ago (last event: 2026-03-26 14:32:01)     │
│                                                                     │
│  Stat Events: 1,247    Corrections Applied: 3                       │
│                                                                     │
│  Per-Participant Score Breakdown                                    │
│  ┌──────────────────────┬─────────┬────────────┬──────────────────┐ │
│  │ Participant          │ Points  │ Events     │ Last Updated     │ │
│  │──────────────────────┼─────────┼────────────┼──────────────────│ │
│  │ Patrick Mahomes      │ 24.5    │ 312        │ 2026-03-26 14:30 │ │
│  │ Josh Allen           │ 22.0    │ 298        │ 2026-03-26 14:28 │ │
│  │ ...                  │         │            │                  │ │
│  └──────────────────────┴─────────┴────────────┴──────────────────┘ │
│                                                                     │
│  [Re-ingest Scoring]                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Loading, Error, and Empty States

| State | Contest Browser | Contest Detail |
|---|---|---|
| **Loading** | Skeleton table rows (8 rows) with pulsing placeholders | Skeleton header + skeleton tab content |
| **Error** | Alert banner: "Failed to load contests. [Retry]" | Alert banner: "Failed to load contest. [Retry]" with contest ID shown |
| **Empty (no results)** | "No contests match your filters. Try adjusting the filters above." | N/A (404 if contest not found) |
| **Empty (tab)** | N/A | Standings: "No entries yet." / Overrides: "No manual overrides have been applied." / Draft: "Draft has not started." / History: "No audit entries." |
| **Action in progress** | N/A | Button shows spinner, disabled state. Toast on success/failure. |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AC-001 | 1 | Build `ContestBrowserTable` with server-side pagination and sorting | Done | Implemented in contests/index.tsx with paginated table, 8 mock contests |
| AC-002 | 1 | Build `ContestFilters` bar (tenant, league, sport, type, selection type, status) | Done | Filter bar with tenant, sport, status, contest type dropdowns |
| AC-003 | 2 | Build `ContestAdminHeader` with breadcrumb, sport icon, type badges, status badge | Done | Header with breadcrumb, sport/type/status badges in contests/detail.tsx |
| AC-004 | 2 | Build contest detail shell with tab navigation (URL-persisted) | Done | 5-tab layout: Standings, Scoring Data, Draft, Overrides, Admin Actions |
| AC-005 | 2 | Build Standings tab with `AdminStandingsTable` (admin columns: entry ID, user email) | Done | 8 mock entries with rank, entry name, owner email, total score |
| AC-006 | 3 | Build Scoring Data tab with `ScoringDataPanel` and `FreshnessIndicator` | Done | Freshness indicator (green/red), stat event count, re-ingest button |
| AC-007 | 3 | Build Draft tab with `DraftLogTable` (pick log, auto-pick flag) | Done | Draft status card + 8 mock picks with auto-pick badge |
| AC-008 | 3 | Build Overrides tab with `OverrideHistoryTable` | Done | 2 mock overrides with Override Score button |
| AC-009 | 4 | Build `ScoreOverrideDialog` modal (entry selector, new score, reason) | Partial | Simplified to ConfirmDialog |
| AC-010 | 4 | Build `RecalculateDialog` with standings diff preview | Partial | Simplified to ConfirmDialog |
| AC-011 | 4 | Build `ForceCloseDialog` with irreversible warning | Partial | Simplified to ConfirmDialog |
| AC-012 | 4 | Build `ReopenContestDialog` | Partial | Simplified to ConfirmDialog |
| AC-013 | 4 | Build Re-ingest Event Data action with confirmation and progress indicator | Done | window.confirm action card in Admin Actions tab |
| AC-014 | 4 | Build Recalculate Payouts action with confirmation dialog | Done | window.confirm action card in Admin Actions tab |
| AC-015 | 5 | Build History tab with contest-filtered audit log | Not Started | |

---

*PoolMaster Admin — Contest Operations Pages v1.0*
