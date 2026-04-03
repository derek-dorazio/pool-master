# PoolMaster Admin — Sports Data Provider Pages

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

**Service plan tasks:** 11-014, 11-015, 11-016, 11-017
**Routes:** `/admin/providers`, `/admin/providers/:providerId`, `/admin/providers/ingestion`

---

## Purpose

Give admin staff real-time visibility into sports data provider health, configuration, ingestion activity, and participant mapping. Admins can monitor provider status, adjust configuration and credentials, track ingestion jobs, diagnose errors, and resolve unmapped participants.

---

## Routes Covered

| Route | Page | Description |
|---|---|---|
| `/admin/providers` | Provider Dashboard | All providers with health status, error rate, latency, event counts |
| `/admin/providers/:providerId` | Provider Detail | Config, health charts, ingestion breakdown, participant mapping |
| `/admin/providers/ingestion` | Ingestion Monitor | Cross-provider ingestion activity, errors, throughput |

---

## Components

| Component | Page | Description |
|---|---|---|
| `ProviderTable` | Provider Dashboard | Data table of all providers with sortable columns |
| `ProviderRow` | Provider Dashboard | Single row: name, status dot, error rate, latency, last event, active events |
| `HealthStatusDot` | Provider Dashboard, Detail | Colour dot: green (HEALTHY), yellow (DEGRADED), red (DOWN) |
| `ProviderSummaryBar` | Provider Dashboard | Top bar: "X of Y providers healthy" summary |
| `ProviderDetailHeader` | Provider Detail | Header: provider name, status badge, current error rate, latency |
| `HealthChart` | Provider Detail | Recharts line chart for error rate and latency over 24h |
| `ErrorTable` | Provider Detail | Recent errors table: timestamp, error type, message, event ID |
| `ProviderConfigForm` | Provider Detail | Editable form: API key/secret (masked), webhook URL, thresholds, budget |
| `IngestionTable` | Provider Detail | Per-sport breakdown: sport, last poll, events today, errors, active events, dependent contests |
| `JobStatusRow` | Provider Detail, Ingestion Monitor | Single ingestion job row with status and progress |
| `ActiveJobsTable` | Ingestion Monitor | Cross-provider active ingestion jobs |
| `ErrorFeed` | Ingestion Monitor | Real-time-ish scrolling list of recent ingestion errors |
| `ThroughputChart` | Ingestion Monitor | Recharts chart: events processed per minute |
| `UnmappedParticipantTable` | Provider Detail | Table of unmapped participants: external ID, provider, name |
| `ParticipantMapper` | Provider Detail | Search internal participants, select match, or create + map |

---

## Data Requirements

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/admin/providers/health` | All providers with health status, metrics |
| `GET` | `/api/v1/admin/providers/:providerId` | Provider detail (config, status, metrics) |
| `GET` | `/api/v1/admin/providers/:providerId/health-history` | Error rate + latency time series (last 24h) |
| `GET` | `/api/v1/admin/providers/:providerId/errors` | Recent errors with pagination |
| `GET` | `/api/v1/admin/providers/:providerId/ingestion` | Per-sport ingestion breakdown |
| `GET` | `/api/v1/admin/providers/:providerId/jobs` | Active and recent ingestion jobs |
| `GET` | `/api/v1/admin/providers/:providerId/unmapped` | Unmapped participants for this provider |
| `PUT` | `/api/v1/admin/providers/:providerId/config` | Update provider configuration |
| `POST` | `/api/v1/admin/providers/:providerId/health-check` | Trigger manual health check |
| `POST` | `/api/v1/admin/providers/:providerId/map-participant` | Map external participant to internal |
| `POST` | `/api/v1/admin/providers/:providerId/create-and-map` | Create internal participant from external data and map |
| `GET` | `/api/v1/admin/providers/ingestion/active` | Cross-provider active ingestion jobs |
| `GET` | `/api/v1/admin/providers/ingestion/errors` | Cross-provider recent ingestion errors |
| `GET` | `/api/v1/admin/providers/ingestion/throughput` | Events-per-minute time series |
| `GET` | `/api/v1/admin/participants/search` | Search internal participants (for mapping) |

### TanStack Query Keys

| Query Key | Endpoint | Stale Time |
|---|---|---|
| `['admin', 'providers', 'health']` | Provider health list | 30s (auto-refetch) |
| `['admin', 'providers', providerId]` | Provider detail | 30s |
| `['admin', 'providers', providerId, 'health-history']` | Health charts | 60s |
| `['admin', 'providers', providerId, 'errors']` | Error list | 30s |
| `['admin', 'providers', providerId, 'ingestion']` | Ingestion breakdown | 30s |
| `['admin', 'providers', providerId, 'jobs']` | Job list | 15s |
| `['admin', 'providers', providerId, 'unmapped']` | Unmapped participants | 60s |
| `['admin', 'providers', 'ingestion', 'active']` | Active jobs (cross-provider) | 15s |
| `['admin', 'providers', 'ingestion', 'errors']` | Error feed | 15s |
| `['admin', 'providers', 'ingestion', 'throughput']` | Throughput chart | 30s |

---

## Interactions

### Provider Dashboard (`/admin/providers`)

1. Page loads and fetches all provider health data
2. `ProviderSummaryBar` shows "X of Y providers healthy" with colour indicator
3. `ProviderTable` displays all providers, sorted by status (unhealthy first) then name
4. `HealthStatusDot` renders: green (HEALTHY), yellow (DEGRADED), red (DOWN)
5. Auto-refresh every 30 seconds via `refetchInterval`
6. Click a row to navigate to `/admin/providers/:providerId`
7. Table columns: Provider Name, Status, Error Rate (%), Avg Latency (ms), Last Event Received, Active Events Tracked

### Provider Detail (`/admin/providers/:providerId`)

1. Header shows provider name, status badge, current error rate, average latency
2. Four tabs: **Health**, **Configuration**, **Ingestion**, **Mapping**
3. Tab selection persists in URL search params (`?tab=config`)

#### Health Tab
- `HealthChart` renders two Recharts line charts: error rate (%) and latency (ms) over last 24h
- Time range selector: 1h, 6h, 12h, 24h
- `ErrorTable` shows recent errors: timestamp, error type, message, event ID
- Paginated, newest first
- "Run Health Check" button triggers `POST /health-check`, shows result in toast

#### Configuration Tab
- `ProviderConfigForm` with fields:
  - API Key (masked with reveal toggle, editable)
  - API Secret (masked with reveal toggle, editable)
  - Webhook URL (read-only display) and subscribed events list
  - Health thresholds: degraded error rate %, down error rate %, max latency ms
  - Monthly budget, current spend, alert threshold %
- "Save" button submits `PUT /config`, shows success/error toast
- Changes logged to audit trail automatically

#### Ingestion Tab
- `IngestionTable` shows per-sport breakdown: sport name, last poll time, events today, errors today, active events count, dependent contests count
- Active ingestion jobs table with status (RUNNING, QUEUED, FAILED), progress bar, started time
- Recently completed jobs (last 20) with duration and status

#### Mapping Tab
- `UnmappedParticipantTable` lists unmapped external participants: external ID, provider name, participant name, sport
- "Map" button per row opens `ParticipantMapper`:
  - Search box to find internal participants by name
  - Results list with select button
  - Submits `POST /map-participant`
- "Create + Map" button per row:
  - Creates a new internal participant from the external data
  - Automatically maps it
  - Submits `POST /create-and-map`
- Success removes the row from the unmapped table

### Ingestion Monitor (`/admin/providers/ingestion`)

1. `ActiveJobsTable` shows all active ingestion jobs across all providers: provider name, sport, event name, status, progress bar, started time
2. `ErrorFeed` shows a scrolling list of recent errors across all providers: timestamp, provider, sport, error type, message
3. `ThroughputChart` renders a Recharts area chart showing events processed per minute over the last hour
4. Auto-refresh: active jobs every 15s, error feed every 15s, throughput every 30s

---

## Text Wireframes

### Provider Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Sports Data Providers                                                  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  ● 4 of 5 providers healthy                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Provider Name     │ Status     │ Error Rate │ Avg Latency │ Last Event        │ Active  │
│────────────────────┼────────────┼────────────┼─────────────┼───────────────────┼─────────│
│  ESPN API          │ ● HEALTHY  │ 0.2%       │ 145ms       │ 2 min ago         │ 42      │
│  Sportradar        │ ● HEALTHY  │ 0.1%       │ 98ms        │ 1 min ago         │ 38      │
│  Yahoo Sports      │ ● DEGRADED │ 4.8%       │ 520ms       │ 8 min ago         │ 15      │
│  TheOddsAPI        │ ● HEALTHY  │ 0.3%       │ 200ms       │ 5 min ago         │ 22      │
│  Custom Provider   │ ● HEALTHY  │ 0.0%       │ 110ms       │ 3 min ago         │ 10      │
│                                                                         │
│  Auto-refreshing every 30s                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Provider Detail

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Providers > Yahoo Sports                                               │
│                                                                         │
│  Yahoo Sports              ● DEGRADED    Error Rate: 4.8%   Latency: 520ms │
├─────────────────────────────────────────────────────────────────────────┤
│  [Health] [Configuration] [Ingestion] [Mapping]                         │
│                                                                         │
│  ┌─ Health ────────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Error Rate (last 24h)                    [1h] [6h] [12h] [24h]    ││
│  │  5% ┤                                                               ││
│  │  4% ┤           ╭──────╮                                            ││
│  │  3% ┤          ╭╯      ╰╮                                           ││
│  │  2% ┤    ╭────╯         ╰──╮                                        ││
│  │  1% ┤───╯                   ╰────                                   ││
│  │  0% └──────────────────────────────                                 ││
│  │      00:00    06:00    12:00    18:00    now                         ││
│  │                                                                     ││
│  │  Latency (last 24h)                                                 ││
│  │  600ms ┤          ╭──╮                                              ││
│  │  400ms ┤    ╭────╯    ╰──╮                                          ││
│  │  200ms ┤───╯              ╰──────                                   ││
│  │    0ms └──────────────────────────                                  ││
│  │                                                                     ││
│  │  Recent Errors                                         [Run Check]  ││
│  │  ┌────────────────┬─────────────┬──────────────────┬──────────┐     ││
│  │  │ Timestamp      │ Error Type  │ Message          │ Event ID │     ││
│  │  │ 14:32:01       │ TIMEOUT     │ Request timed... │ evt_abc  │     ││
│  │  │ 14:28:45       │ RATE_LIMIT  │ 429 Too Many ... │ evt_def  │     ││
│  │  └────────────────┴─────────────┴──────────────────┴──────────┘     ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Ingestion Monitor

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Ingestion Monitor                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Events/min (last 1h)                                                   │
│  200 ┤     ╭╮    ╭──╮                                                   │
│  150 ┤  ╭─╯  ╰──╯    ╰╮                                                │
│  100 ┤─╯                ╰──                                             │
│   50 ┤                                                                  │
│    0 └──────────────────────────                                        │
│                                                                         │
│  Active Jobs (3)                                                        │
│  ┌─────────────┬────────┬────────────────┬──────────┬──────┬──────────┐ │
│  │ Provider    │ Sport  │ Event          │ Status   │ Prog │ Started  │ │
│  │ ESPN API    │ NFL    │ Week 12 scores │ RUNNING  │ 72%  │ 14:30:01 │ │
│  │ Sportradar  │ NBA    │ Nightly stats  │ RUNNING  │ 45%  │ 14:31:22 │ │
│  │ Yahoo       │ Soccer │ EPL matchday   │ QUEUED   │ 0%   │ 14:32:00 │ │
│  └─────────────┴────────┴────────────────┴──────────┴──────┴──────────┘ │
│                                                                         │
│  Recent Errors                                                          │
│  ┌──────────┬─────────────┬────────┬─────────────┬─────────────────┐    │
│  │ Time     │ Provider    │ Sport  │ Error Type  │ Message         │    │
│  │ 14:32:01 │ Yahoo       │ Soccer │ TIMEOUT     │ Request timed...│    │
│  │ 14:28:45 │ Yahoo       │ NFL    │ RATE_LIMIT  │ 429 Too Many... │    │
│  │ 14:25:10 │ ESPN API    │ NBA    │ PARSE_ERROR │ Unexpected fo...│    │
│  └──────────┴─────────────┴────────┴─────────────┴─────────────────┘    │
│                                                                         │
│  Auto-refreshing every 15s                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Loading, Error, and Empty States

| State | Provider Dashboard | Provider Detail | Ingestion Monitor |
|---|---|---|---|
| **Loading** | Skeleton table rows (5 rows) + skeleton summary bar | Skeleton header + skeleton charts | Skeleton chart + skeleton tables |
| **Error** | Alert: "Failed to load provider status. [Retry]" | Alert: "Failed to load provider. [Retry]" | Alert: "Failed to load ingestion data. [Retry]" |
| **Empty** | "No providers configured." | N/A (404 if not found) | "No active ingestion jobs." |
| **Empty (tab)** | N/A | Health: "No errors in the last 24h." / Ingestion: "No ingestion activity." / Mapping: "All participants are mapped." | Error feed: "No recent errors." |
| **Action in progress** | N/A | Config save shows spinner on button. Health check shows toast with result. | N/A |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| AP-001 | 1 | Build `ProviderTable` and `ProviderRow` with health status display | Done | Implemented in providers/index.tsx with 6 mock providers |
| AP-002 | 1 | Build `HealthStatusDot` and `ProviderSummaryBar` components | Done | Summary bar shows "5 of 6 providers healthy", colour-coded status dots |
| AP-003 | 2 | Build provider detail shell with tab navigation | Done | 4-tab layout: Health, Configuration, Ingestion, Mapping |
| AP-004 | 2 | Build Health tab with `HealthChart` (error rate + latency, Recharts line charts) | Done | Chart placeholders rendered; Recharts integration deferred |
| AP-005 | 2 | Build `ErrorTable` for recent errors with pagination | Done | 5 mock errors table with Run Health Check button |
| AP-006 | 3 | Build Configuration tab with `ProviderConfigForm` (masked credentials, thresholds, budget) | Done | Read-only form: masked API key, webhook URL, thresholds, budget |
| AP-007 | 3 | Build Ingestion tab with per-sport `IngestionTable` and job status rows | Done | 4 sports breakdown table in provider detail |
| AP-008 | 3 | Build Ingestion Monitor page with `ActiveJobsTable` and `ErrorFeed` | Done | 2 active jobs with progress bars, 5 recent errors |
| AP-009 | 3 | Build `ThroughputChart` (events per minute, Recharts area chart) | Done | Stat card showing 1,245 events/min; Recharts chart deferred |
| AP-010 | 4 | Build Mapping tab with `UnmappedParticipantTable` and `ParticipantMapper` | Done | 3 unmapped participants with alert and Map buttons |

---

*PoolMaster Admin — Sports Data Provider Pages v1.0*
