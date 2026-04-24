# Plan 108 — Manage Hub Decomposition

## Purpose

Decompose the root-admin `/manage` page (currently a single 2,000+ line file with 7 stacked tiles) into a minimal hub homepage plus six sectioned sub-areas, each following the repo's single-purpose-page and list→Home patterns. This is the handoff artifact for the Fran frontend developer persona (and any agent touching root-admin surfaces).

Complements Plan 107 (webapp navigation reorganization) — that plan covers league-scope nav; this plan covers platform-scope `/manage`.

## Governing Principles (from memory)

Consult these feedback memories before touching `/manage`:

- **Single-purpose pages** (`feedback_page_decomposition.md`)
- **/manage hub structure** (`feedback_manage_hub_structure.md`) — six sections, each own route
- **List → Home authority-gated pattern** (`feedback_list_to_home_authority_pattern.md`) — list → canonical Home, authority toggles edit UI; this paradigm applies to rich daily-use entity pages, **not** to quick transactional admin lifecycle actions, which use modals
- **Team is the league-facing entity** (`feedback_team_is_league_facing_entity.md`) — root admin extends the Team authority hook to `commissioner` tier

## Hub Homepage — `/manage`

Minimal navigation landing. No tiles, no metrics, no data queries. Six section cards/links:

1. Leagues
2. Teams
3. Users
4. Content Configuration
5. Sync
6. Sync Configuration

Reached from the Account dropdown "Manage" link (visible only when `user.isRootAdmin`). Breadcrumbs from any `/manage/*` sub-page route back to this hub so users can switch sections without multiple clicks.

## Section Layout Summary

| Section | Route | Pages | Lifecycle surface |
|---|---|---|---|
| Leagues | `/manage/leagues` | list + search (rows link to League Home) | On League Home (no modal here) |
| Teams | `/manage/teams` | list + search (rows link to Team Home) | On Team Home (no modal here) |
| Users | `/manage/users` | list + search (rows link to `/users/:userId`) | On `/users/:userId` (no modal here) |
| Content Configuration | `/manage/content-configuration` | list + `/…/:templateKey` | N/A |
| Sync | `/manage/sync` | dashboard + `/run-sport-sync` + `/run-event-sync` | N/A |
| Sync Configuration | `/manage/sync-config` | list + `/poll-intervals` + `/ingestion-schedule` + `/sport-overrides` | N/A |

### Sub-nav pattern (minimal)

- Each section's landing page contains direct links/buttons to its sub-pages
- Breadcrumb at the top of every `/manage/*` page
- No secondary nav bar, no tabs — revisit once the UI is in use if it feels thin

## Detailed Per-Section Specs

### 1. Leagues — `/manage/leagues`

- Single list page with search
- Row renders: league name, status badge, league code, member count, active contest count, description
- **Row action:** click → navigate to `/league/:leagueCode` (the canonical League Home)
- **No modals on this admin list.** All league actions (edit identity, join code, invites, inactivate, delete) happen on League Home via authority-gated UI.
- Authority model: `useLeagueAuthority(leagueCode)` treats root admin as `commissioner` tier on any league. League Home renders full editing UI for root admin as a result.
- **Delete** lives on League Home as a root-admin-only section, visible only when `user.isRootAdmin && league.status === 'INACTIVE'`. Mirrors the Teams pattern exactly.

### 2. Teams — `/manage/teams`

- Single list page with cross-league search
- Row renders: team name, league, team code, owner(s), status
- **Row action:** click → navigate to `/league/:leagueCode/teams/:teamId` (the canonical Team Home)
- **No modals on this admin list.** All team actions (edit identity, invite/remove co-owners, inactivate, delete) happen on Team Home.
- Authority model: `useTeamAuthority(teamId)` treats root admin as `commissioner` tier on any team. Team Home renders the full editing UI for root admin as a result.
- **Delete**: lives on Team Home as a root-admin-only section, visible only when `user.isRootAdmin && team.status === 'INACTIVE'`. Second check `useIsRootAdmin()` gates this section alongside the authority hook.

### 3. Users — `/manage/users`

- Single list page with search
- Row renders: first/last name, email, username, root-admin status, account status (active/inactive)
- **Row action:** click → navigate to `/users/:userId` (the canonical User page — Plan 107 item G)
- **No modals on this admin list.** All admin actions (toggle root admin, reset password, inactivate, delete) live on `/users/:userId` as root-admin-authority modals, not as row actions here.
- Mirrors `/manage/leagues` and `/manage/teams` — search + link only.
- **Coordination with Plan 106:** The shipped backend `setRootAdmin` contract and existing `/manage` users panel are transitional implementation, not blockers. This plan replaces that current `/manage`-embedded panel with (a) a dedicated `/manage/users` search+link page and (b) the root-admin modal set on `/users/:userId` (owned by Plan 107 item G3).

### 4. Content Configuration — `/manage/content-configuration`

- **List page:** table of templates. Columns: template key, name, sport, contest type, config mode, active/default badges. Rows click through to the edit page.
- **Edit page:** `/manage/content-configuration/:templateKey`. Full edit form for a single template (name, sort order, description, active/default toggles, mode-specific config inputs). Single Save action. Breadcrumb back to the list.
- Today's per-template inline grid becomes one list + N edit pages.

### 5. Sync — `/manage/sync`

- **Dashboard (landing):** provider visibility (provider dropdown, sport dropdown, status dropdown, metrics cards, provider health badges) + sync history table. Filters drive the history table. Read-only.
- **Run Sport Sync page:** `/manage/sync/run-sport-sync`. Preset dropdown (prepare event data / refresh participants / refresh schedule / refresh rankings), sport dropdown, "Run sport sync" button, success/error payload display. Its own page so the preset choice and its implications can be explained clearly ("are you sure you want to trigger this now?").
- **Run Event Sync page:** `/manage/sync/run-event-sync`. Preset dropdown (refresh event participants / refresh live scores / refresh final results), sport dropdown, event ID input, "Run event sync" button, success/error payload display.
- The dashboard + history stay together on `/manage/sync` because they're tightly coupled ("see sync state" is one concern). Manual triggers split off so each operational action has its own framing.

### 6. Sync Configuration — `/manage/sync-config`

- **List page (landing):** three template cards/links:
  - Poll Intervals → `/manage/sync-config/poll-intervals`
  - Global Ingestion Schedule → `/manage/sync-config/ingestion-schedule`
  - Sport Ingestion Overrides → `/manage/sync-config/sport-overrides`
- **Each template page** owns its own edit form + Save/Reset actions.
- **Sport overrides page** keeps its sport selector — one page handles all sports via the selector (no route parameter per sport).

## Tile → Destination Mapping

Source file: `clients/poolmaster/src/features/root-admin/root-admin-page.tsx`

| Current tile | Source lines | Destination |
|---|---|---|
| Provider sync visibility | 1159–1269 | `/manage/sync` (dashboard — filters + metrics + health badges) |
| Poll intervals | 1282–1337 | `/manage/sync-config/poll-intervals` |
| Sport overrides | 1339–1418 | `/manage/sync-config/sport-overrides` |
| Global ingestion schedule | 1421–1507 | `/manage/sync-config/ingestion-schedule` |
| League lifecycle | 1510–1653 | SPLIT: list + search → `/manage/leagues`; per-league actions (inactivate/delete with code-confirmation) → **League Home** (Plan 107 item D). The admin list has no modals; root admin acts on League Home via authority hook. |
| Contest configuration defaults (grid) | 1655–1821 | `/manage/content-configuration` — list row per template; inline edit form → `/…/:templateKey` |
| Manual sport sync subsection | 1838–1898 | `/manage/sync/run-sport-sync` |
| Manual event sync subsection | 1901–1974 | `/manage/sync/run-event-sync` |
| Sync history table | 1985–2028 | `/manage/sync` (dashboard — bottom section under filters) |

## New Pages / Components Required (BUILD NEW)

- **A. Hub page** `/manage` — six section cards/links; minimal
- **B. Leagues list page** `/manage/leagues` — lift existing tile 5 search + list; rows link to League Home. Pure search + link; no modals, no inline lifecycle actions.
- **C. Root-admin delete section on League Home** — visible only when `user.isRootAdmin && league.status === 'INACTIVE'`. Delete confirmation wizard requiring exact league code match (pattern matches existing `/my-account` delete wizard and the Team Home delete section).
- **D. Teams list page** `/manage/teams` — entirely new: cross-league team search + results list with row-click routing to Team Home. Requires a backend team-search endpoint (see Contract Questions).
- **E. Root-admin delete section on Team Home** — visible only when `user.isRootAdmin && team.status === 'INACTIVE'`. Delete confirmation wizard (pattern matches existing `/my-account` delete wizard).
- **F. `useTeamAuthority` update** — hook returns `commissioner` for root admin on any team (extending existing owner/commissioner/viewer model). Parallel `useLeagueAuthority` hook (Plan 107 item I) powers League Home.
- **G. Users list page** `/manage/users` — search + link only. Rows navigate to `/users/:userId`. No modals, no row toggles. (H, I, J previously listed here have all moved to Plan 107 item G as authority-gated modals on `/users/:userId`.)
- **K. Content Configuration list page** `/manage/content-configuration` — lift tile 6 grid into a row list (template key / name / sport / status), click through to edit page.
- **L. Content Configuration edit page** `/manage/content-configuration/:templateKey` — lift tile 6 inline edit form into a dedicated page.
- **M. Sync dashboard page** `/manage/sync` — combine tile 1 (visibility) + tile 7 history table; minimal new markup.
- **N. Run Sport Sync page** `/manage/sync/run-sport-sync` — lift tile 7 sport sync subsection into a dedicated page with explanatory framing.
- **O. Run Event Sync page** `/manage/sync/run-event-sync` — lift tile 7 event sync subsection into a dedicated page.
- **P. Sync Configuration list page** `/manage/sync-config` — new; three cards linking to the three config pages.
- **Q. Sync Configuration sub-pages** — three pages (poll intervals / ingestion schedule / sport overrides) — lift existing forms directly.
- **R. `useIsRootAdmin` hook** (if not already present via `useAuth`) — used for gating the Team Home delete section and any other root-admin-only UI outside of Route guards.
- **S. Breadcrumb component** for `/manage/*` pages — lightweight, derived from the route path.

## Orphan Tiles (DELETE)

- None in the root-admin area. All seven tiles map to a destination. Delete only happens at the whole-file level: `root-admin-page.tsx` dissolves once all tiles have migrated.

## Open Questions / Product Decisions Needed

1. **Cross-league team search endpoint** — the Teams admin page assumes an admin-scoped search over all teams across leagues. Current SDK does not expose this (today's team listing is per-league). **Ask Brad.** If the endpoint is missing, this is a blocker for Teams section execution.
2. **Admin reset-password endpoint** — the new `/users/:userId` root-admin modal set assumes an admin-initiated reset-password action. Does the backend expose it yet, and does it send email to the user or generate a temporary password? **Ask Brad + Pam.**
4. **Team delete semantics** — confirm permanent delete of a team is supported at the backend level and not just inactivate. If delete doesn't exist, the root-admin delete section on Team Home deferred until backend lands. Same applies to **league delete** for the root-admin section on League Home.
5. **Impersonate-as-owner / impersonate-as-member** — explicitly out of scope; user confirmed "no further actions" beyond lifecycle + password reset. If ever added later, revisit this plan.
6. **Minimal hub vs eventual at-a-glance** — the hub is plain six links today. If usage patterns later show operators want a quick "X inactive leagues / Y failed syncs" summary, revisit. Not blocking.

## Backend / Contract Questions (route to Brad)

- **Cross-league team search** — new generated SDK operation needed (`adminListTeams` or similar) with search-by-name, league filter, and status filter. Must be root-admin gated.
- **Admin-initiated reset password** — new endpoint, triggered by root admin against a target user.
- **Hard-delete team endpoint** — confirm existence or add.
- **`Team.status` signal available on admin list** — required for row badges and for the Team Home root-admin delete gating.
- **Lifecycle modal state transitions** — confirm that once a league/team/user is inactive, a subsequent delete call is accepted; the "delete locked until inactive" UX depends on it.

## Coordination With Existing Plans

- **Plan 106 — Root Admin Elevation and `/manage` Entry**
  - Slice A (Manage link in Account dropdown, `/manage` routing when root admin) — **remains valid** and ships as originally scoped.
  - Slice B (backend `setRootAdmin` operation) — **already shipped** and remains the contract powering root-admin role changes.
  - Slice C (`root-admin-users-panel.tsx`) — **already shipped as transitional UI** inside `/manage`. This plan replaces that panel with the new decomposition target: `/manage/users` as search+link only, and authority-gated root-admin actions on `/users/:userId`.
- **Plan 101 — Root Admin Event Sync Surface**
  - Lives inside `/manage/sync`. Verify the existing implementation maps cleanly to the dashboard + manual-run page split described here.
- **Beads `pool-master-lyf`** (root-admin league search and lifecycle controls) — satisfied by Section 1 (Leagues).
- **Beads `pool-master-33l.11`** (root-admin management for contest config templates) — satisfied by Section 4 (Content Configuration).

## Out of Scope for This Plan

- Mobile-specific patterns for `/manage/*` surfaces (same as Plan 107 — revisit after desktop scaffold)
- Visual design refinement (typography, iconography, spacing)
- Impersonation, audit logs, additional per-user or per-team admin actions beyond the ones specified above
- Any league-scope UX — that's Plan 107

## Execution Phases (sketch)

Slicing will get concrete once backend contracts (Q1–Q6 above) are confirmed. Tentative order:

1. **Hub shell** — A (hub page) + S (breadcrumb) + route scaffolding. No functional regressions.
2. **Content Configuration** — K, L. Lowest backend-coordination risk; existing tile migrates cleanly.
3. **Sync + Sync Configuration** — M, N, O, P, Q. Mostly tile lift-outs; minimal new behavior.
4. **Leagues** — B, C. List + link page (no modal); delete section lands on League Home (coordinate with Plan 107 item D).
5. **Users** — G. List + link page only; the root-admin modals live on `/users/:userId` (Plan 107 G/G3). This is frontend decomposition/replacement work, not a backend-search blocker, because `adminListUsers` and `setRootAdmin` already exist.
6. **Teams** — D, E, F, R. Highest backend dependency (cross-league search); schedule after backend lands.

Each build item (A–S) should become its own Beads issue when execution starts.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 108-001 | 1 | Build `/manage` hub shell, breadcrumbs, and child-route scaffold | Done | `/manage` now renders the minimal hub, `/manage/legacy` preserves the stacked transitional surface, manage sub-pages share breadcrumbs through a common layout, and truthful scaffold routes exist for not-yet-extracted sections while dedicated pages land. Validated with the full required repo gate set before closeout. |
| 108-002 | 1 | Build Content Configuration list and per-template edit pages | Done | Added dedicated `/manage/content-configuration` list and `:templateKey` detail routes/pages, shared template-edit helpers, focused frontend coverage, and a transitional "Open dedicated page" affordance from the legacy `/manage` contest-configuration section. Validated with the full required repo gate set before closeout. |
| 108-003 | 2 | Build Sync dashboard plus dedicated Run Sport Sync and Run Event Sync pages | Not Started | Reuse existing backend/manual-trigger contracts; split operational actions off the read-only dashboard. |
| 108-004 | 2 | Build Sync Configuration landing page plus Poll Intervals, Ingestion Schedule, and Sport Overrides pages | Not Started | Mostly form lift-outs from the current root-admin page. |
| 108-005 | 3 | Build `/manage/leagues` search+link page and remove embedded league lifecycle controls from the old manage surface | Not Started | League lifecycle actions move to League Home under Plan 107 authority-gated panels. |
| 108-006 | 3 | Build `/manage/users` search+link page and replace the transitional embedded root-admin users panel | Not Started | Backend `adminListUsers` and `setRootAdmin` already exist; user actions move to `/users/:userId` under Plan 107. |
| 108-007 | 4 | Build `/manage/teams` search+link page once cross-league team search exists | Not Started | Blocked on backend `adminListTeams`/equivalent contract. |
| 108-008 | 4 | Add root-admin delete sections on League Home and Team Home | Not Started | Coordinates with Plan 107 League Home / Team Home authority work and any backend hard-delete semantics confirmation. |
| 108-009 | 5 | Dissolve `root-admin-page.tsx` and finish route/menu cleanup | Not Started | Remove the legacy stacked-tile page once all destination pages are live. |
| 108-010 | 6 | Run full validation, reconcile Beads, and close decomposition tracker items | Not Started | Final cleanup includes removing transitional manage UI and ensuring breadcrumbs/nav point only to the new pages. |
