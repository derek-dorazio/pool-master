# Plan 81: Full-Stack Residual Cleanup

## Purpose

Run one deliberate cleanup lane across the active PoolMaster client, server,
shared contract, infrastructure, rules, and docs so the repo stops carrying
stale implementation targets, dead helper surfaces, and misleading historical
scaffolding as if they were still active.

This plan is intentionally broader than the completed backend drift cleanup.
It focuses on the remaining non-functional debt that still creates confusion,
maintenance drag, or false signals for future implementation agents.

---

## Audit Method

This inventory was built from pattern-based searches across the active repo for:

- stale split-frontend and split-service references
- canonical files that still advertise removed product surfaces
- orphaned source files with no consumers
- declaration-only or generated-looking artifacts inside live source trees
- simulated operational/admin capabilities with no current product/runtime need
- active rules/docs that still describe retired architecture
- product-copy mismatches in the rebuilt PoolMaster web app

Historical references inside archived plans or explicitly historical guides are
not automatically treated as cleanup defects. The focus is active guidance,
active infrastructure, and active runtime code.

---

## Findings By Pattern

### Pattern A: Dead Split-Service / Split-Frontend Infrastructure Still Exists

These files still describe or attempt to build the older multi-service backend
and retired web/admin frontends:

- `infrastructure/docker/docker-compose.yml`
  - references `draft-service`, `scoring-service`, `ingestion-worker`,
    `notification-service`
  - references missing Dockerfiles:
    - `infrastructure/docker/Dockerfile.draft-service`
    - `infrastructure/docker/Dockerfile.scoring-service`
    - `infrastructure/docker/Dockerfile.ingestion-worker`
    - `infrastructure/docker/Dockerfile.notification-service`
  - references retired frontend build targets `web` and `admin`
- `infrastructure/docker/Dockerfile.web`
  - still copies/builds `clients/web`
- `infrastructure/docker/Dockerfile.admin`
  - still copies/builds `clients/admin`

Related active code/comments still echo the old service split:

- `packages/core-api/src/index.ts`
  - comments still say “from draft-service”, “from scoring-service”,
    “from notification-service”, “from ingestion-worker”
- `packages/shared/events/draft.ts`
  - `sourceService: 'draft-service'`
- `packages/shared/events/scoring.ts`
  - `sourceService: 'ingestion-worker'`
  - `sourceService: 'scoring-service'`
- `packages/core-api/src/modules/ingestion/routes.ts`
  - header comment says extracted from `ingestion-worker/src/index.ts`

Notes:

- some event `sourceService` values may still be acceptable telemetry labels
  even if the deployable runtime is now one monolith, but they should be
  reviewed intentionally rather than left as accidental historical residue.

### Pattern B: Canonical Shared Surface Still Advertises Removed Product Areas

The strongest example is:

- `packages/shared/api-routes.ts`
  - header still says used by `clients/web` and `clients/admin`
  - `API_PREFIXES` still exports:
    - `BILLING`
    - `SOCIAL`
  - other prefixes may still reflect older route-grouping assumptions rather
    than the current active route topology

Related active guidance drift:

- `rules/architecture-rules.md`
  - still describes Core API responsibilities including `billing` and `search`
  - still shows `clients/web` and `clients/admin` in the project structure
  - still describes the active web stack as `shadcn/ui + Radix UI + TailwindCSS`
    and `Zustand`, which no longer matches the active PoolMaster app

### Pattern C: Orphaned Or Unused Active Source Files

Confirmed current example:

- `clients/poolmaster/src/routes/route-map.ts`
  - definition exists
  - no active consumers found

Needs confirmation rather than blind removal:

- `clients/poolmaster/src/features/app-shell/placeholder-page.tsx`
  - currently used by placeholder routes, so not dead on its own
- `clients/poolmaster/src/features/contests/contest-detail-page.tsx`
  - currently routed, so active
- `packages/core-api/src/modules/leagues/bulk-*`
  - still wired through leagues routes, so active even if not yet a UI focus
- `packages/core-api/src/modules/leagues/dashboard-*`
  - still wired through leagues routes and integration tests

### Pattern D: Declaration-Only / Generated-Looking Artifacts Inside Live Source

Confirmed active-source anomaly:

- `packages/core-api/src/modules/scoring/templates/*.d.ts`
  - declaration-only files inside `src/`
  - examples:
    - `packages/core-api/src/modules/scoring/templates/golf.d.ts`
    - `packages/core-api/src/modules/scoring/templates/registry.d.ts`
  - no active runtime imports of the template registry were found in the
    current first-pass scoring path

This needs a cleanup decision:

- remove if dead
- relocate if they are generated reference artifacts
- or replace with real source if they are meant to be active runtime inputs

### Pattern E: Simulated Root-Admin Tooling Still Present

Current strongest example:

- `packages/core-api/src/modules/admin/migration-service.ts`
  - hardcoded `AVAILABLE_MIGRATIONS` catalog includes:
    - `backfill-analytics`
    - `recompute-records`
    - `recalculate-pricing`
    - `reindex-search`

This looks like operational placeholder behavior rather than a truthful current
platform feature. It should be either:

- narrowed to real supported operations
- explicitly marked as future stub/admin prototype and moved out of active
  runtime
- or removed

### Pattern F: Shared Domain Catalog Still Broader Than Active Runtime

The shared enum/type catalog still retains several deferred first-pass values.

Examples in `packages/shared/domain/enums.ts`:

- `SelectionType`
  - `OPEN_SELECTION`
  - `PICK_EM`
  - `BRACKET_PICK_EM`
- `ScoringEngine`
  - `BRACKET`
  - `CUMULATIVE`
- `ContestType`
  - comments explicitly reference deferred catalog behavior

This may be acceptable if we intentionally want a future-facing catalog, but it
remains a cleanup candidate because it can still mislead product/UX planning
and contract work.

### Pattern G: Active Product Copy Still Reflects Superseded Decisions

Confirmed active UI mismatch:

- `clients/poolmaster/src/features/leagues/leagues-page.tsx`
  - welcome empty-state still says:
    - “Start by creating a private or public league.”
  - current product decision is private-only for v1

Potential follow-up copy review targets in the same file:

- inactive/reactivation wording should remain aligned with the deferred paid
  league plan
- league visibility display may eventually need narrowing if private-only
  remains the only supported league state at launch

### Pattern H: Active Docs Still Describe Retired Architecture Or Schema

Still active and still likely needing another cleanup pass:

- `rules/architecture-rules.md`
  - active guidance still stale in several sections
- `docs/DATABASE-SCHEMA.md`
  - still describes tenant billing/search-era structures as if they are part of
    the practical application ownership model
- `docs/DATABASE-SCHEMA-V2.md`
  - still carries broad search/billing/social historical context and may need a
    clearer split between active schema truth and deferred/historical notes

Historical docs that intentionally reference removed surfaces should stay
historical, but should be clearly labeled as such:

- `docs/HONEST-CONTRACT-REMEDIATION.md`
- `docs/AUTHENTICATION-AUTHORIZATION.md`

### Pattern I: Search / Billing / Social Residue Still Appears In Active Files

Not every instance is a defect, but these active-file references should be
reviewed intentionally:

- `packages/shared/api-routes.ts`
  - `BILLING`, `SOCIAL`
- `rules/architecture-rules.md`
  - active backend summary still mentions billing/search
- `packages/shared/events/notification.ts`
  - social notification types still exist
- `packages/shared/i18n/locales/en/notifications.json`
  - social strings still exist
- `packages/core-api/src/modules/admin/migration-service.ts`
  - `reindex-search`
- `packages/core-api/src/plugins/poll-config.ts`
  - comments still mention discovery/search polling
- `docs/DATABASE-SCHEMA.md`
  - discoverable league/contest projections
  - tenant subscription/billing tables
- `docs/DATABASE-SCHEMA-V2.md`
  - billing/social/search references

This pattern needs targeted judgment:

- participant/admin query “search” is legitimate and should stay
- removed product-surface references should be deleted or clearly marked
  historical/deferred

---

## What Looks Intentionally Active, Not Dead

These were reviewed and should not be treated as cleanup bugs by default:

- participant search APIs and repository search methods
- admin user/contest/audit filtering with search query params
- contest detail route and page
- leagues bulk/dashboard route families, because they are still wired
- placeholder page component, because it is actively used for known deferred
  routes

---

## Sequential Cleanup Slices

| Task | Status | Scope |
|---|---|---|
| 81-001 | Completed | Remove or modernize dead Docker/infrastructure targets (`docker-compose.yml`, `Dockerfile.web`, `Dockerfile.admin`) so local stack instructions only describe real runnable surfaces. |
| 81-002 | Completed | Clean `packages/shared/api-routes.ts` so canonical route constants and comments reflect only active route families and active frontend consumers. |
| 81-003 | Completed | Remove confirmed orphaned client source such as `clients/poolmaster/src/routes/route-map.ts`, and verify there are no hidden consumers before deletion. |
| 81-004 | Completed | Audit `packages/core-api/src/modules/scoring/templates/*.d.ts` and either remove, relocate, or replace them with truthful active-source artifacts. |
| 81-005 | Completed | Retired the fake root-admin migration runtime surface, removed its routes/contracts/generated artifacts, and cleaned the leftover error-mapping residue so active admin tooling only reflects real supported operations. |
| 81-006 | Completed | Kept the broader shared enum/catalog entries intentionally. `packages/shared/domain/enums.ts` already marks those values as deferred catalog entries, and the active runtime/UI now narrows supported first-pass modes at the route/product layer instead of pretending the broader domain catalog is the current UI surface. |
| 81-007 | Completed | Fixed active PoolMaster product-copy drift so the welcome/create-league surface reflects the private-only first-pass league model. |
| 81-008 | Completed | Refreshed active architecture/schema docs and rules so they describe the single PoolMaster app, monolithic backend modules, and root-admin/backend reality instead of retired split-web/admin or billing/search product framing. |
| 81-009 | Completed | Ran a final residue sweep, removed dead social/billing notification catalog entries and stale split-service comments, and confirmed the main remaining references are either historical docs/plans, legitimate participant/admin search usage, or intentionally stable event-source labels. |

---

## Recommended Execution Order

1. `81-001` infrastructure cleanup
2. `81-002` canonical route cleanup
3. `81-003` orphaned client source cleanup
4. `81-004` scoring template artifact cleanup
5. `81-005` admin migration tooling cleanup
6. `81-006` shared enum/catalog decision
7. `81-007` PoolMaster copy cleanup
8. `81-008` rules/docs refresh
9. `81-009` final residue audit

This order clears the strongest false signals first, then ends with docs/rules
and a final verification sweep.

---

## Acceptance Criteria

- no active infrastructure file points at removed clients or missing Dockerfiles
- canonical shared route constants no longer advertise removed product
  subsystems
- confirmed orphaned source files are removed
- declaration-only artifacts inside active source trees are either justified or
  gone
- root-admin tooling does not simulate large unsupported migration programs as
  if they were real runtime features
- shared catalogs either match the active runtime or are clearly split into
  active vs deferred definitions
- active PoolMaster UI copy reflects current product decisions
- active rules/docs describe the current architecture honestly
- final pattern search shows only intentional historical/deferred references
