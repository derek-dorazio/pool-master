# Plan 107 — Webapp Navigation Reorganization

## Purpose

Reorganize PoolMaster webapp navigation and page structure away from overgrown multi-tile "dashboard" pages toward smaller, single-purpose pages with clear MY vs LEAGUE scoping and a coherent commissioner admin surface. This plan is the handoff artifact for the Fran frontend developer persona (and any other agents touching these surfaces).

## Governing Principles (from memory)

Consult these feedback memories before touching nav or page layout:

- **Single-purpose pages** — default one page = one purpose, one save boundary, one or at most two tightly related containers. Multiple tiles are OK only when all tiles serve one concern grouped for scan-ability (e.g. Entries page = one tile per active contest — same concern, grouped).
- **MY vs LEAGUE scope** — inside a league, MY = the signed-in user's own team/entries/history (editable); LEAGUE = whole-league surfaces (mostly read-only for members).
- **No My Leagues page** — the league dropdown is the switcher. Landing is **Teams and Owners** at `/league/:leagueCode`.
- **Team is the league-facing entity; User is personal-facing** — league UI is team-centric; no "Members" page at league level.
- **List → Home with authority-gated editing** — list pages link to one canonical Home page per entity; Home toggles edit vs read-only UI via an authority hook (e.g. `useTeamAuthority(teamId)`), not via separate routes.
- **Daily-use vs commissioner admin** — daily-use surfaces (Team Home, Contest Home, lists) use authority-on-same-page; complex admin (Create Contest wizard, Manage Contest edit form) lives on its own commissioner-only pages inline in the LEAGUE menu.

## Consolidated Site Map

Every route in the reorganized webapp, flat. Authority column indicates who sees the route or its contents — in-page authority gating (e.g. commissioner-only sections on League Home) is *not* expressed here; see the detailed sections below for that.

### Pre-auth / invite flows

| Route | Page | Visibility |
|---|---|---|
| `/` | Auth home (login/register) | Unauthenticated |
| `/invite/:inviteCode` | Join league flow | Any (auth optional) |
| `/team-invite/:inviteCode` | Join team-owner flow | Any (auth optional) |
| `/join/:inviteCode` | Legacy redirect → `/invite/:inviteCode` | Any |

### Global (authenticated)

| Route | Page | Visibility |
|---|---|---|
| `/welcome` | Zero-league fallback | Regular users with 0 leagues (transitional/defensive — not a main-journey destination) |
| `/users/:userId` | Canonical **User page** (account-scope only; authority-gated modals for self + root admin; viewer = read-only identity) | All authenticated |
| `/my-account` *(alias)* | Redirect → `/users/:myId` | All authenticated |
| `/profile`, `/preferences`, `/password`, `/account` *(aliases)* | Redirect → `/users/:myId` | All authenticated |

### League scope (inside `/league/:leagueCode/*`)

| Route | Page | Visibility / Menu source |
|---|---|---|
| `/league/:leagueCode` | **League Home** (authority-gated) | all — League ▾ landing |
| `/league/:leagueCode/teams` | **Teams and Owners** | all — League ▾ |
| `/league/:leagueCode/teams/:teamId` | **Team Home** (authority-gated) | all — row click from Teams and Owners; My Team ▾ resolves to signed-in user's teamId |
| `/league/:leagueCode/entries` | **My Entries** | self — My Team ▾ |
| `/league/:leagueCode/history` | **My Contest History** *(placeholder)* | self — My Team ▾ |
| `/league/:leagueCode/contests` | **League Contests** list | all — League ▾ |
| `/league/:leagueCode/contests/:contestId` *(canonical; today `/contests/:contestId` still exists)* | **Contest Home** (state-transitioning) | all — row click from League Contests. During migration, keep `/contests/:contestId` only as a temporary compatibility redirect to this canonical route; remove the legacy route in the final cleanup slice. |
| `/contests/:contestId/entries/:entryId` | **Entry page** (authority-gated) | entry owner when unlocked — edit icon from My Entries; redirect target for self-click on Contest Home pre-event |
| `/league/:leagueCode/contests/new` | **Create Contest** wizard | commissioner — League ▾ |
| `/league/:leagueCode/contests/manage` | **Manage Contests** list | commissioner — League ▾ |
| `/league/:leagueCode/contests/:contestId/manage` | **Manage Contest** per-contest edit | commissioner — row click from Manage Contests |

### Root admin (`/manage/*`) — see Plan 108 for details

| Route | Page | Visibility |
|---|---|---|
| `/manage` | Hub (six section links) | Root admin |
| `/manage/leagues` | Leagues search + link | Root admin |
| `/manage/teams` | Teams search + link | Root admin |
| `/manage/users` | Users search + link | Root admin |
| `/manage/content-configuration` | Content Configuration list | Root admin |
| `/manage/content-configuration/:templateKey` | Template edit | Root admin |
| `/manage/sync` | Sync dashboard | Root admin |
| `/manage/sync/run-sport-sync` | Run Sport Sync | Root admin |
| `/manage/sync/run-event-sync` | Run Event Sync | Root admin |
| `/manage/sync-config` | Sync Configuration list | Root admin |
| `/manage/sync-config/poll-intervals` | Poll Intervals edit | Root admin |
| `/manage/sync-config/ingestion-schedule` | Ingestion Schedule edit | Root admin |
| `/manage/sync-config/sport-overrides` | Sport Overrides edit | Root admin |

### Post-auth landing resolution

| Condition | Destination |
|---|---|
| `isRootAdmin` | `/manage` (Plan 106 Slice A) |
| Regular user, has recent-league cookie (still a valid membership) | `/league/:leagueCode` (League Home) |
| Regular user, no recent-league cookie, `leagues.length > 0` | `/league/:mostRecentlyCreatedCode` (League Home) |
| Regular user, `leagues.length === 0` | `/welcome` — transitional/defensive only; regular users should always have ≥1 league (see invariant in `feedback_team_is_league_facing_entity.md`) |

### Deleted / collapsed routes

| Former route | Replacement |
|---|---|
| `/my-leagues` | League switcher dropdown in header; deleted |
| `/my-account`, `/profile`, `/preferences`, `/password`, `/account` *(as distinct pages)* | `/users/:myId` with authority-gated modals |
| `/league/:leagueCode/team` (old singular "my team") | `/league/:leagueCode/teams/:myTeamId` (canonical team URL) |
| `LeagueDetailPage` at `/league/:leagueCode` (old, multi-tile) | Split: League Home (landing) + Teams and Owners (child route) + per-section commissioner flows |

## Top Nav Scaffold (inside a league)

```
[League Switcher ▾]   My Team ▾   League ▾   [Account ▾]
```

Clicking a group label navigates to that group's landing page. Hover/secondary interaction reveals the full sub-item list.

### My Team ▾ (landing: My Team page)

| Item | Visibility | Route (proposed) | Page Purpose |
|---|---|---|---|
| **My Team** | all (authority-gated edit) | `/league/:leagueCode/teams/:teamId` (user's team resolved at the link) | Team info + owners — editable for team owners + commissioners; read-only for others |
| **Entries** | all | `/league/:leagueCode/entries` | Tiles per active contest; each tile shows contest name + list of your entries + **Create Entry** button + edit icon per row |
| **History** | all | `/league/:leagueCode/history` | Placeholder for now; future design = grid with client-side sort/filter grouped year/sport/contest |

### League ▾ (landing: League Home at `/league/:leagueCode`)

| Item | Visibility | Route | Page Purpose |
|---|---|---|---|
| **League Home** | all (authority-gated edit) | `/league/:leagueCode` | Canonical league page. Members: read-only identity + overview + "Leave league." When the league is inactive, members see a page-level banner "This league is not currently active." (Future: "Message commissioner" CTA attached to that banner — deferred until the messaging/notification system exists.) Commissioners: inline edit for league name/description/icon, join code display + regenerate, email invite flow, activate/inactivate. Root admin: same as commissioner, plus a root-admin-gated delete section when league is inactive. |
| **Teams and Owners** | all | `/league/:leagueCode/teams` | Table: linked Team Name / Icon / Owners (active owners + pending invite rows). Read-only — actions happen on Team Home. Current first-pass contract does not expose a separate team-code field, so the linked team name is the identifier until that contract exists. |
| **League Contests** | all | `/league/:leagueCode/contests` | List of open contests; each row → Contest Home |
| **Create Contest** | commissioner only | `/league/:leagueCode/contests/new` (exists) | Wizard owning immutable structural decisions (sport, event type, etc.) |
| **Manage Contests** | commissioner only | `/league/:leagueCode/contests/manage` → per-contest `/league/:leagueCode/contests/:contestId/manage` (exists) | List of contests → small edit form per contest for mutable `ContestConfiguration` subset. Route-ordering note: declare the specific `/contests/manage` list route before the dynamic `/contests/:contestId` route so React Router matches correctly. |

**League Settings is not a separate menu item** — its former contents (league identity, join code, activate/inactivate) are absorbed into League Home, gated by `useLeagueAuthority`. This mirrors the Team Home pattern exactly and gives root admins a single canonical page per league (reached from `/manage/leagues`) rather than a view page + edit page split.

### Per-entity Home pages (reached via list rows or directly)

| Entity | URL (canonical) | Authority model |
|---|---|---|
| League Home | `/league/:leagueCode` | `useLeagueAuthority` → `commissioner \| member`; commissioner edits identity/settings/lifecycle; member read-only. Root admin collapses into `commissioner` on any league. Root-admin-only delete section gated by `useIsRootAdmin()` + inactive status. |
| Team Home | `/league/:leagueCode/teams/:teamId` | `useTeamAuthority` → `owner \| commissioner \| viewer`; owner/commissioner edit, viewer read-only. Root admin collapses into `commissioner`. Root-admin-only delete section gated by `useIsRootAdmin()` + inactive status. |
| **User page** | `/users/:userId` | Backend-emitted `viewerAuthority` per request → `self \| root-admin \| viewer`. The User page is **account-scope only** — it never surfaces league-role actions. Commissioner-scope actions (promote/demote/remove owner) live on Teams and Owners / Team Home per their authority hooks, not here. Action buttons launch focused modals; set visible depends on authority. See Authority matrix below. |
| Contest Home | `/league/:leagueCode/contests/:contestId` (canonical; old `/contests/:contestId` may temporarily redirect during migration) | Pre-event: entries list (name + team only). **Self rows are clickable and navigate to My Team ▾ Entries** (nav shortcut to own management page). Other rows are not clickable for anyone (including commissioners/root admin) — competitive-integrity rule. Post-event: becomes leaderboard with per-entry expand/modal |
| Entry page | `/contests/:contestId/entries/:entryId` (exists) | Editable only by entry owner when unlocked; read-only otherwise |

### User page authority matrix

`/users/:userId` is a single canonical page with authority-gated action modals, **scoped to the user account only**. Backend enforces the authority rules; frontend reads `viewerAuthority` (or equivalent capability signal) from the response and renders the matching modal set. `viewerAuthority` is a set — a user who is both self and root admin sees both sets.

| Action (modal) | Self | Root admin | Viewer (default) |
|---|---|---|---|
| Edit Profile | ✅ | — | — |
| Edit Preferences | ✅ | — | — |
| Change Password | ✅ | — | — |
| Inactivate Account (platform, reversible) | ✅ | ✅ | — |
| Delete Account (platform, locked until inactive) | ✅ | ✅ | — |
| Toggle Root Admin | — | ✅ | — |
| Reset Password (admin-initiated) | — | ✅ | — |

**Hard rule:** commissioners never touch user accounts. All league-role actions (Remove Owner, Promote to Commissioner, Demote to Member) live on Teams and Owners / Team Home and are gated by `useLeagueAuthority` / `useTeamAuthority`. A commissioner clicking an owner name on Teams and Owners lands here as a `viewer` (read-only identity) — the commissioner's league-role actions stay on the league surface where they originated. See [League-role action map](#league-role-action-map) below.

### League-role action map

These actions do **not** live on `/users/:userId`. They are league-scoped and use the surfaces already agreed: Teams and Owners (per-row) and Team Home (per-team and per-owner inside the Owners section).

| Action | Authority | Home(s) | Notes |
|---|---|---|---|
| Remove Owner (from a team) | Team co-owner OR league commissioner OR root admin | Teams and Owners row action + Team Home Owners section (same modal in both places) | Only allowed when team has >1 owner. Backend enforces the minimum-one-owner rule. Attempting to remove the single owner is redirected to Inactivate Team instead. |
| Promote to Commissioner | Commissioner + root admin | Teams and Owners per-owner action | League role change; scoped to the current league. |
| Demote to Member | Commissioner + root admin | Teams and Owners per-owner action | League role change; scoped to the current league. |
| Inactivate Team | Team owner + commissioner + root admin | Team Home | Soft action. Inactivated team cannot create entries for future contests. **Owners of the inactivated team lose league access** (including history for this league). Data is preserved — remaining league members and the commissioner can still see the inactivated team's historical entries and contest results in history. Reversible. |
| Delete Team | Root admin only, team must be inactive | Team Home (root-admin-gated section) | Hard cascade delete — wipes the team's data from history. Intended for QA testing residue cleanup, not real-world team removal. Irreversible. |

The earlier "Remove Team" and "Remove from League" names collapse into these operations: the effect of "removing a user from the league" is achieved by removing them from each of their teams (Remove Owner) or inactivating their sole-owned team (Inactivate Team). There is **no** separate `removeTeam` or `removeFromLeague` backend operation.

**Discovery paths to `/users/:userId`:**
- From "My Profile" in the Account dropdown → `/users/:myId` (self authority)
- From Teams and Owners page → owner names are clickable → `/users/:ownerUserId`
- From Team Home Owners section → owner names are clickable → `/users/:ownerUserId`
- From `/manage/users` → row click → `/users/:userId` (root-admin authority)

### Account dropdown (global, top-right)

Collapsed flat list: **My Profile · Manage** *(root admin only)* **· Log out**

| Item | Route | Page Purpose |
|---|---|---|
| My Profile | `/users/:myId` | Canonical User page with authority-gated modal set. Self sees Edit Profile / Edit Preferences / Change Password / Inactivate Account / Delete Account as modals. |
| Manage | `/manage` (exists) | Root-admin hub (see Plan 108) |

Old routes `/my-account`, `/profile`, `/preferences`, `/password`, `/account` are no longer separate — all redirect/alias to `/users/:myId` for deep links.

## Tile → Destination Mapping

Each row maps an existing tile/section in the current codebase to its new home. "DELETE" = tile is orphan and goes away. "BUILD NEW" = the new nav requires a tile that doesn't exist yet.

### `clients/poolmaster/src/features/leagues/league-detail-page.tsx`

This page is being dissolved — its current multi-tile content is split across the new
canonical **League Home** at `/league/:leagueCode` and **Teams and Owners** at
`/league/:leagueCode/teams`.

| Tile | Source lines | Destination |
|---|---|---|
| League Header & Summary | 532–576 | **League Home** — identity + status + counts. Commissioner-editable fields (name, description, icon) inline on the same page via authority hook. |
| Members list (with promote/demote/remove actions) | 579–682 | DELETE — commissioner/root-admin league-role actions (Promote / Demote / Remove Owner) now live as per-owner row actions on **Teams and Owners** (`/league/:leagueCode/teams`) and on **Team Home** Owners section. The User page at `/users/:userId` is account-scope only; it does not carry these actions. |
| My Team link card | 684–701 | DELETE — users reach team via My Team ▾ nav or Teams and Owners row link |
| Teams (browse all) link card | 703–718 | DELETE — users reach via League ▾ → Teams and Owners |
| Membership Actions (Leave league) | 721–755 | **League Home** — member-visible section. Resolves former OPEN QUESTION §2. |
| Commissioner Invitations (link + email invite) | 767–856 | **League Home** — commissioner-gated join code + email invite section. Resolves former OPEN QUESTION §3. |
| Contests (active) | 858–1007 | SPLIT: contest list → **League Contests**; per-user entries → **My Team ▾ Entries**; Create Entry → **Entries** tile action |
| Completed Contest History | 1009–1063 | SPLIT: contest rows → **League Contests** (post-event = leaderboard); user's entry rows → **My Team ▾ History** (placeholder for now) |

### `clients/poolmaster/src/features/leagues/my-leagues-page.tsx`

Entire page is being deleted — league switcher dropdown is the only switcher.

| Tile | Source lines | Destination |
|---|---|---|
| League Directory Header | 214–223 | DELETE |
| League Cards grid (with Manage modal) | 225–311 | DELETE — content already on `welcome-page.tsx`; the "Manage league" modal is out of scope for this plan, audit separately if still in use |
| Review Focus placeholder text | 313–323 | DELETE |

### `clients/poolmaster/src/features/leagues/leagues-page.tsx` — `WelcomePage` export

Remains as the zero-league landing (`/welcome`). The file has three render states:

| State | Lines | Disposition |
|---|---|---|
| Loading / Error | 42–66 | KEEP — honest states |
| Zero-league welcome + Create-first-league CTA | 68–106 | KEEP — this is `/welcome` under the new nav |
| Auto-redirect to default league | 108–111 | KEEP — enforces the post-auth recent-league landing rule |
| Has-leagues + no-default-resolved fallback (grid of league cards + "Open league" links) | 113–167 | **DELETE** — contradicts the "league switcher dropdown is the only switcher" rule. Harden `resolveDefaultLeagueCode` so it always returns a league code when the user has ≥1 membership, making this branch unreachable. Remove the unreachable code. |

### `clients/poolmaster/src/features/leagues/leagues-page.tsx` — `MyLeaguesPage` export

`MyLeaguesPage` lives in the same file as `WelcomePage`. Its tiles are already marked DELETE below. The export and route (`/my-leagues`) should be removed entirely once the new landing behavior is live.

### `clients/poolmaster/src/features/teams/teams-page.tsx`

This page becomes (or is replaced by) **Teams and Owners** at `/league/:leagueCode/teams`. Once commissioner row actions land, each owner in the Owners column exposes a per-owner action menu authority-gated via `useLeagueAuthority`: **Remove Owner** (if team has >1 owner; co-owner of team or commissioner), **Promote to Commissioner** (commissioner / root admin), **Demote to Member** (commissioner / root admin). Same modals are reachable from Team Home's Owners section. The Team row itself carries the commissioner-only **Inactivate Team** action; **Delete Team** appears as a root-admin-only section on Team Home when the team is already inactive.

| Tile | Source lines | Destination |
|---|---|---|
| Page Header (back-link, my-team link) | 260–288 | REDUCE — remove navigation helpers; keep only page title |
| Pending Owner Invites | 290–340 | SPLIT: per-team pending-invites list → **Team Home** Owners section (already partially present at `my-team-page.tsx:916–1108`; confirm/extend with email + status icon + Cancel/Resend/Nudge actions gated to owner+commissioner authority). Read-only aggregated display → **Teams and Owners** Owners column (shows pending invite email + status icon as a row entry alongside active owners). No standalone "Pending Invites" tile. |
| Joined Teams list (current: full member list per team) | 342–410 | **Teams and Owners** — BUT reduced to spec columns: linked Name / Icon / Owners. Current squad-list contract does not expose a separate team code, so the first pass uses the linked team name as the canonical identifier. *MISMATCH §5: current tile expands each row with full active-member list; new spec hides members — users see the full team only by clicking through to Team Home* |

### `clients/poolmaster/src/features/teams/my-team-page.tsx`

This page becomes **Team Home** — canonical single-page for any team (authority-gated).

| Tile | Source lines | Destination |
|---|---|---|
| Team Header (name/icon/role/description) | 527–554 | STAY on Team Home |
| Team Details & Icon Selection (edit name + icon, save) | 567–654 | STAY on Team Home — authority-gated editable |
| Active Contest Entries (contest tiles + entries + Create Entry + rename) | 657–832 | MOVE to **My Team ▾ Entries** page. Team Home no longer carries entries; Entries page is the single source for entry management |
| Historical Contest Entries | 834–914 | MOVE to **My Team ▾ History** page (placeholder for now; data still fetches even if presentation is minimal) |
| Active Team Members (owners list, invite co-owner, replace owner, remove owner, revoke invites) | 916–1108 | STAY on Team Home — Owners section, authority-gated. Active owners + pending invites both shown here. Owner/commissioner (or root admin via `useLeagueAuthority`) sees the full management UI: invite co-owner, **Remove Owner** (only when team has >1 owner), cancel/resend/nudge pending invites, plus per-owner **Promote to Commissioner** / **Demote to Member** league-role actions (commissioner + root admin only). Viewer sees a read-only list showing active owner names and pending invite rows (email + status icon, no actions). Owner names are clickable links to `/users/:ownerUserId` for all authority tiers and always resolve to an account-scope view — league-role actions stay here on Team Home, not on the User page. |
| Team Lifecycle (inactivate team) | 1110–1128 | STAY on Team Home — authority: team owner + commissioner + root admin. **Inactivate Team is a soft action**: the inactivated team cannot create new contest entries, and its owners lose league access (they can no longer see the league including its history from this team), but all data is preserved — remaining league members and the commissioner can still see the inactivated team's historical entries/contest results in league history. Reversible by reactivation. **Delete Team** is a distinct hard action that lives as a root-admin-only section on Team Home, only visible when the team is already inactive. Delete cascades and wipes the team's data from history; it is intended for QA testing residue cleanup, not real-world team removal. |

### `clients/poolmaster/src/features/contests/contest-detail-page.tsx`

This page becomes **Contest Home** — pre-event entries list; post-event leaderboard.

| Tile | Source lines | Destination |
|---|---|---|
| Contest Header & Navigation (manage link, back) | 652–687 | STAY on Contest Home; "Manage contest" link gated to commissioner, routes to Manage Contest page |
| Contest Rules & Snapshot (immutable config display) | 690–710 | STAY on Contest Home (read-only, pre + post event) |
| Your Team Entries (list + create + rename + entry metadata) | 712–940 | MOVE to **My Team ▾ Entries** page. Contest Home no longer carries "Your" entries — it only shows the aggregate all-entries list |
| All Entries (leaderboard) | 944–1063 | STAY on Contest Home. Pre-event: self rows remain clickable but redirect to **My Team ▾ Entries** instead of the Entry detail page (nav shortcut; no info leak). Non-self rows are not clickable for anyone pre-event. BUILD NEW §B: post-event expand/modal for participant detail does not exist yet. |

### `clients/poolmaster/src/features/contests/create-contest-page.tsx`

STAY as **Create Contest** wizard (commissioner-only). No route/page movement. Wizard is a single unified form with mode-conditional sections (tiered vs category), not discrete sequential steps.

**Internal refactor candidate (not blocking):** the tier editor grid at lines 1369–1464 conflates a read-only tier summary with the advanced editor by disabling inputs when `showAdvanced=false`. Consider a future pass that renders a read-only tier list when `!showAdvanced` and swaps in the full editor when `showAdvanced`. Low priority; current UX is acceptable.

### `clients/poolmaster/src/features/contests/contest-entry-page.tsx`

STAY as the canonical **Entry page** (`/contests/:contestId/entries/:entryId`). No route/page movement. Authority: editable by entry owner when unlocked; read-only otherwise.

**Tiles on this page** (all stay in place):

| Tile | Source lines | Notes |
|---|---|---|
| Page header + navigation | 640–675 | Phase badge, back links |
| Progress metrics grid (Tier progress, Picks saved, Tiebreaker, Lock time) | 677–718 | Read-only context |
| Entry details tile (metadata + owner-edit form when self+editable) | 723–837 | **Internal refactor note:** mixes always-read-only metadata (6-cell grid) with entry-owner edit controls. Guards separate concerns correctly, but a future pass could split metadata (always-visible) from edit form (self+editable only) into distinct visual containers. Not blocking. |
| Selection progress summary | 839–889 | Read-only per-group completion |
| Lineup builder (editable tier panels when unlocked; `LockedSelectionGroup` read-only tables otherwise) | 892–994 | Reuses `SelectionParticipantCard` (142–206) and `LockedSelectionGroup` (209–273) components. Well-organized. |

### `clients/poolmaster/src/features/leagues/manage-league-modal.tsx`

The modal trigger point is already gone with the deleted `MyLeaguesPage`, and its contents now decompose into inline commissioner-authority sections on League Home. Physical file cleanup can happen in the later orphan-route/component cleanup slice once the remaining dead tests are removed.

| Current tab / section | Source lines | Destination on League Home (commissioner authority) |
|---|---|---|
| Overview sidebar (name/code/role/status/icon preview) | 296–311 | Merge into League Home page header (read-only identity band visible to everyone; replaces the need for a separate sidebar) |
| **Details tab — edit form** (name, description) | 336–455 *(edit fields only)* | **League identity panel** — editable name + description + Save |
| **Details tab — read-only metrics** (member count, active contests, status, created, code, homepage link) | 336–455 *(read-only fields)* | **League metrics panel** — separate from the edit form (split recommended by audit to avoid mixing edit and read-only on one tile) |
| **Icon tab** | 458–540 | **League branding panel** — icon selector + Save |
| **Settings tab** (join policy display, placeholder for future) | 543–564 | **League settings panel** — join policy read-only display; future expansion deferred |
| **Lifecycle tab — Inactivate section** | 576–621 | **League lifecycle — Inactivate/Reactivate** section (commissioner-authority) |
| **Lifecycle tab — Delete section** | 623–703 | **League lifecycle — Delete** section (root-admin-authority; appears only when `isRootAdmin && league.status === 'INACTIVE'`, per the Plan 108 Section 1 pattern) |

Component/file cleanup is deferred to the later orphan-route/component cleanup slice after the inline League Home panels are fully settled.

### `clients/poolmaster/src/features/account/my-account-page.tsx`

This page is being replaced by the canonical **User page** at `/users/:userId`. When self-viewing, the page displays read-only identity summary and action buttons that launch focused modals. Each current tile maps to one self-authority modal on the new page.

| Current tile | Source lines | New destination (modal on `/users/:myId`) |
|---|---|---|
| Account Summary (read-only identity fields) | 483–529 | Inline on the User page (identity band, not behind a modal — always visible for self) |
| Profile (first/last name edit) | 531–601 | **Edit Profile modal** |
| Preferences (timezone/locale/time/date format) | 603–712 | **Edit Preferences modal** |
| Password (current/new/confirm) | 714–811 | **Change Password modal** |
| Account availability (activate/inactivate) | 826–879 | **Inactivate Account / Reactivate Account modal** |
| Delete account (with confirmation wizard) | 881–997 | **Delete Account modal** (locked until inactive) |

## New Tiles / Pages Required (BUILD NEW)

These are called out by the new nav but don't exist in the code yet:

- **A. My Team ▾ Entries page** — consolidates "per-contest entries for this user" logic currently split between `my-team-page.tsx` (lines 657–832) and `contest-detail-page.tsx` (lines 712–940). One page, tile per active contest, each tile contains entries list + Create Entry button + edit icon.
- **B. Contest Home post-event leaderboard expand/modal** — current All Entries tile (`contest-detail-page.tsx:944–1063`) is a flat list. Post-event UX requires per-row expand or modal revealing participant selections.
- **C. Contest Home pre-event: disable click-through** — the current "Open entry" links on All Entries (for the current user only) must be removed/hidden pre-event per the competitive-integrity rule.
- **C1. Contest Home route migration + cleanup** — add the canonical `/league/:leagueCode/contests/:contestId` route, keep old `/contests/:contestId` only as a temporary compatibility redirect during migration, update touched navigation/tests to the canonical route, then remove the legacy route in the final cleanup slice. Do not leave permanent dual-route support behind.
- **D. League Home page** — new canonical page at `/league/:leagueCode` (replaces today's `LeagueDetailPage` content, which is being dissolved). Authority-gated via `useLeagueAuthority`: members see identity + status + overview + Leave league. When league is inactive, members see the "This league is not currently active" banner (future: Message commissioner CTA). Commissioners additionally see inline League details (name + description, editable + Save), League branding (icon selector + Save), Commissioner invitations (join-link regeneration + invite by email), and League lifecycle (Inactivate). Root admin collapses into commissioner tier and additionally gets a root-admin-gated permanent-delete section when the league is inactive (mirrors Team Home pattern). Contest and completed-history cards remain on League Home temporarily as truthful fallback sections until their dedicated routes land later in the plan. This page *replaces* both the previously planned separate League Settings page **and** the old `ManageLeagueModal` interaction.
- **E. Manage Contests list page** — new list page under League ▾ (commissioner-only). Rows link to the existing `/contests/:contestId/manage` page.
- **F. My Team ▾ History placeholder page** — new route, minimal page. Detailed design deferred (see Open Questions §7).
- **G. User page** `/users/:userId` — canonical **account-scope** page with authority-gated action modals. Replaces `/my-account` and the previously-planned decomposed `/profile`, `/preferences`, `/password`, `/account` pages. Reached from My Profile (Account dropdown, self), from Teams and Owners / Team Home (owner-name click, always landing as `viewer` authority), and from `/manage/users` (root admin). Does **not** carry league-role actions — those live on Teams and Owners / Team Home (see items L1–L2 below). Self-authority modal set: Edit Profile, Edit Preferences, Change Password, Inactivate Account, Delete Account (locked until inactive).
- **G1. `useUserAuthority(userId)` (or equivalent authority read)** — reads backend-emitted `viewerAuthority` signal from the user detail response. Signal shape: `{ self, rootAdmin, viewer }` — no commissioner tier on the User page. Frontend does not compute authority client-side; it displays the modal set that matches the backend authority signal. Multiple flags can be true simultaneously (e.g. self+rootAdmin); viewer is the fallback when no other flag applies.
- **G2. Root-admin account-scope modals on `/users/:userId`** — Toggle Root Admin, Reset Password, Inactivate Account, Delete Account (locked until inactive). Visible when authority includes `rootAdmin`. Replaces the Plan 108-era modals that were previously planned on `/manage/users` row actions.
- **G3. Clickable owner names** — a small shared "owner link" render component used on both the Teams and Owners table (Owners column) and the Team Home Owners section, routing to `/users/:ownerUserId`. Always lands on the account-scope User page; commissioners do not carry league authority into this click.
- **L1. Commissioner per-owner row action menu** — on both Teams and Owners (per-owner row in the Owners column) and Team Home (per-owner entry in the Owners section), expose the league-role action menu: **Remove Owner** (co-owner of the team + commissioner + root admin; only enabled when team has >1 owner; attempting to remove the single owner routes to Inactivate Team), **Promote to Commissioner** (commissioner + root admin), **Demote to Member** (commissioner + root admin). Same modal used from both surfaces. Authority comes from `useLeagueAuthority` + per-team co-owner check.
- **L2. Root-admin Delete Team section on Team Home** — already called out in Team Home tile destinations, re-listed here for completeness. Visible only when `user.isRootAdmin && team.status === 'INACTIVE'`. Hard cascade delete, intended for QA residue cleanup only. Paired with the pre-existing commissioner Inactivate Team action; Delete is additional, not a replacement.
- **H. `useTeamAuthority(teamId)` hook** — returns `owner \| commissioner \| viewer`. Powers Team Home's authority gating. Root admin collapses into `commissioner` tier on any team. Replaces scattered inline `leagueQuery.data?.role === 'COMMISSIONER'` checks.
- **I. `useLeagueAuthority(leagueCode)` hook** — returns `commissioner \| member`. Powers League Home's authority gating. Root admin collapses into `commissioner` tier on any league. Also usable for commissioner-gated nav items (Create Contest, Manage Contests visibility).
- **J. `useIsRootAdmin()` hook** — fine-grained check for root-admin-only sections on League Home and Team Home (permanent delete).

## Orphan Tiles (DELETE)

- `league-detail-page.tsx:684–701` — My Team link card (users reach team via nav)
- `league-detail-page.tsx:703–718` — Teams link card (users reach via nav)
- `MyLeaguesPage` export in `leagues-page.tsx` (entire component) — content handled by `WelcomePage` zero-league state + the league switcher dropdown
- `WelcomePage` fallback branch at `leagues-page.tsx:113–167` — unreachable under the new default-landing rule
- Old `/my-account` route (replace with alias/redirect to `/users/:myId`; no decomposed sub-routes needed)
- Old `/my-leagues` route
- `clients/poolmaster/src/features/leagues/manage-league-modal.tsx` — entire file; contents decomposed into the League Home commissioner panels (see item D)
- Header hash anchors `#league-contests`, `#league-history` in `app-shell.tsx:203–268` — no longer valid once `/league/:leagueCode` becomes Teams and Owners; nav should point to proper routes instead

## Open Questions / Product Calls Needed

1. ~~Member promote/demote/remove~~ — **RESOLVED** (revised): the three league-role actions are **Remove Owner**, **Promote to Commissioner**, and **Demote to Member**. They live as per-owner row actions on **Teams and Owners** (per-owner entry in the Owners column) and on **Team Home** (Owners section) — same modal in both places. Commissioners (and root admins via `useLeagueAuthority`) are the actors. `/users/:userId` does **not** carry these actions — it is account-scope only. The earlier "Remove from League" label collapses into per-team Remove Owner or Inactivate Team. See row 107-012 in the Action Plan and items L1–L2 in BUILD NEW. The old Members tile at `league-detail-page.tsx:579–682` is fully replaced by this flow and should be deleted.
2. ~~Leave league home~~ — **RESOLVED**: lives on League Home, member-visible section.
3. ~~Commissioner invitations scope~~ — **RESOLVED**: both the join link/code AND "Invite by email" live on League Home in a commissioner-gated section.
4. ~~Pending owner invites home~~ — **RESOLVED**: Team Home Owners section (primary, with Cancel/Resend/Nudge actions for owner+commissioner authority) + Teams and Owners Owners column (read-only aggregate with email + status icon). No standalone tile.
5. **Teams and Owners member-list detail** (`teams-page.tsx:342–410`) — current tile shows all active members inline per team; new spec is Owners-only column. Confirm that members (non-owners) are no longer surfaced at the league level, only at Team Home. **Confirm with product.**
6. ~~Contest Home pre-event click-through~~ — **RESOLVED**: pre-event, non-self rows are not clickable for anyone (including commissioners/root admin); self rows are clickable but navigate to **My Team ▾ Entries** (nav shortcut), not to the Entry detail page. Post-event: normal leaderboard with per-entry expand/modal.
7. **My Team ▾ History** — design deferred. When unblocked, pick layout (grid with sort/filter, grouped year/sport/contest/entry) and commit as a separate Beads issue.
8. ~~Entries page URL~~ — **RESOLVED**: `/league/:leagueCode/entries` (the My Team ▾ group implies "my"; matches the `/teams/:teamId` convention).
9. ~~League Contests URL~~ — **RESOLVED**: `/league/:leagueCode/contests`.
10. ~~Manage Contests list URL~~ — **RESOLVED**: `/league/:leagueCode/contests/manage` (list) → `/league/:leagueCode/contests/:contestId/manage` (per-contest edit, exists). Order specific routes before dynamic `:contestId` routes.
11. ~~"Message commissioner" CTA placement~~ — **RESOLVED**: scoped to League Home inactive-league state. Members see a page-level banner "This league is not currently active" when the league is inactive. The "Message commissioner" nudge CTA attaches to that banner and is deferred until the messaging/notification system exists. Not a general messaging feature.
12. ~~Post-auth default landing~~ — **RESOLVED**:
    - Regular user lands on `/league/:code` (League Home) — resolver order: recent-league cookie (if still valid membership) → otherwise most recently created league.
    - Root admin lands on `/manage` (existing Plan 106 Slice A).
    - `/welcome` zero-league state is a transitional/defensive fallback only — invariant: regular users must belong to ≥1 league (via invite / register-and-join / accepting invite); root admins are the sole exception.
    - Harden `resolveDefaultLeagueCode` so it always returns a code when `leagues.length > 0`; delete the unreachable fallback grid at `leagues-page.tsx:113–167` in the same slice.

## Backend / Contract Questions (route to Brad)

- **`ContestConfiguration` mutable vs immutable split** — the Manage Contest edit form renders only mutable fields; which subset is mutable post-creation? Exported generated type should make this explicit (either via field description, a separate `MutableContestConfiguration` shape, or an OpenAPI flag).
- **Per-contest entry limits** — the Entries page Create Entry button must disable at a contest's entry cap; surface the cap on the generated `Contest` or `ContestConfiguration` shape.
- **Entry creation route** — today we have `/contests/:contestId/entries/:entryId` for detail/edit. Creation flow (what route, what payload, what response) needs confirmation against the generated SDK before the Entries page ships.
- **Team authority** — confirm the current `league-detail` response carries enough information to compute `useTeamAuthority(teamId)` locally (owner team membership + league commissioner role). If not, a dedicated endpoint or field is needed.
- **User `viewerAuthority` signal** — the user detail endpoint (`getUser` or equivalent) must emit a `viewerAuthority` field indicating what the current requester can do on the account-scope User page: `{ self, rootAdmin, viewer }` as a set (flags, not single enum). No commissioner tier is needed on this endpoint — league-role actions live on league surfaces and use `useLeagueAuthority` / league-detail signals, not the user-detail endpoint. Frontend reads this directly rather than computing authority locally. Root-admin gating of the action endpoints (toggle root-admin, reset password, inactivate/delete account) must remain backend-enforced regardless.
- **Admin-initiated reset-password endpoint** — net-new operation `POST /api/v1/admin/users/{userId}/reset-password` (or equivalent) that generates a secure reset token or temporary credential for the admin to relay to the user. UX shape (temporary password to copy vs email link) is a product question; audit logging required.
- **Team `removeOwner` + team-owner authority** — Teams and Owners / Team Home row actions need a backend operation to remove an owner from a team (not the league). Confirm an op exists or add one. Needs to enforce the ">1 owner" constraint server-side (single-owner removal must be rejected or redirected to team inactivation). Also needs caller↔team-owner authority check.
- **Team `delete` semantics** — confirm a permanent team-delete endpoint exists for the root-admin-only Delete Team section on Team Home. Must cascade related data for QA cleanup use cases; should remain locked behind inactive state and root-admin authority. If not present, add.

## Bugs Consumed by This Plan

These open beads issues are directly relevant; resolving them is part of this reorg rather than parallel:

- `pool-master-dxd.1` — League selector shows leagues outside memberships (switcher is now the only switcher, so this must be tight)
- `pool-master-dxd.2` — League landing does not route to valid active league context (fully resolved by "landing = recent league's Teams and Owners" rule)
- `pool-master-dxd.3` — Invalid/unauthorized league route shows generic load error (Teams and Owners page must render honest access-state messages)
- `pool-master-dxd.4` — Accessible member league route fails with "We couldn't load this league" (depends on Teams and Owners implementation)

## Out of Scope for This Plan

- `/manage` root-admin hub IA — agreed sections (Leagues / Teams / Users / Content Configuration / Sync / Sync Templates) are captured in `feedback_manage_hub_structure.md` but the per-section tile mapping is a separate audit (next step).
- Mobile-specific nav patterns (hamburger menus, collapsed drawer, etc.) — the current header is flex-responsive; mobile IA is a follow-up concern once desktop scaffold is agreed.
- Visual design refinement (typography, iconography, spacing) — this plan is IA and page ownership only.

## Execution Phases (sketch)

Phase-level sequencing will get its own slicing once open questions §1–12 are answered and the `/manage` audit is complete. At that point each BUILD NEW item (A–I) should get its own Beads issue and be slotted into a sequenced execution plan.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 107-001 | 1 | Add route scaffold for canonical League Home, Teams and Owners, My Entries, My History, Manage Contests list, and canonical Contest Home migration path | Done | Added league-scope canonical path builders, honest scaffold pages for `entries`, `history`, `contests`, and `contests/manage`, a canonical team-home adapter route, and a temporary `/contests/:contestId` compatibility redirect into `/league/:leagueCode/contests/:contestId`. Validated with the full required repo gate set before closeout. |
| 107-002 | 1 | Rework post-auth landing and delete `/my-leagues` as a first-class destination | Done | Simplified `/welcome` to a zero-league fallback plus default-league redirect, converted `/my-leagues`, `/leagues`, and the top-level `/contests` entrypoint into compatibility redirects, and updated remaining in-app league-home links away from the deleted destination. Validated with the full required repo gate set before closeout. |
| 107-003 | 2 | Build Teams and Owners page from current teams-page tile content | Done | Reworked `/league/:leagueCode/teams` into the read-only Teams and Owners directory, removed the standalone pending-invites/manage affordances, linked team names directly to Team Home, and added owner-name links that resolve through a truthful temporary `/users/:userId` scaffold. Current squad-list contract does not expose a separate team-code field, so this first pass uses the linked team name as the identifier. Validated with the full required repo gate set before closeout. |
| 107-004 | 2 | Build League Home and dissolve `LeagueDetailPage` + `manage-league-modal` content into authority-gated panels | Done | Reworked League Home around inline commissioner/root-admin management panels, removed roster role-management from this page, kept member leave behavior and inactive-banner semantics on the canonical route, and retained contests/history as temporary fallback sections while later dedicated routes are still staged. Root-admin-only delete now lives on League Home for inactive leagues. Validated with the full required repo gate set before closeout. |
| 107-005 | 3 | Build canonical User page at `/users/:userId` with self-service modal set | Done | Moved self-service account actions onto the canonical `/users/:userId` route with dedicated profile, preferences, password, lifecycle, and delete dialogs; `/my-account` now redirects to `/users/:myId`; and non-self routes stay truthful placeholders until the additive cross-user detail/capabilities contract lands. Validated with the full required repo gate set before closeout. |
| 107-006 | 3 | Add root-admin account-scope action modals to `/users/:userId` | Not Started | Scope trimmed: User page is account-only. Root-admin modals: Toggle Root Admin, Reset Password (admin-initiated), Inactivate Account, Delete Account (locked until inactive). Consumes backend `viewerAuthority` + `adminResetPassword` contract from 107-B1. Commissioner promote/demote/remove-owner actions were moved out of this slice to row 107-012 per the account-vs-league-scope clarification. |
| 107-012 | 3 | Add commissioner per-owner row action menu on Teams and Owners and Team Home | Not Started | League-role actions (Remove Owner, Promote to Commissioner, Demote to Member) live on Teams and Owners (per-owner row in the Owners column) and on Team Home (Owners section); same modals from both surfaces. Authority: league commissioner + root admin (via `useLeagueAuthority`) for promote/demote; team co-owner OR league commissioner OR root admin for Remove Owner. Remove Owner is only enabled when the team has >1 owner; single-owner removal routes to Inactivate Team instead. |
| 107-007 | 4 | Build My Team Entries page and move entry-management affordances off Team Home and Contest Home | Done | Added the dedicated `/league/:leagueCode/entries` page, moved live entry creation/rename off Team Home and Contest Home, and left historical results on Team Home until 107-010 lands. Slice-local tests plus typecheck, eslint, repo jest, and functional API passed; `test:poolmaster:unit` remained red only because another in-progress `/manage/leagues` session had unrelated local WIP. |
| 107-008 | 4 | Complete Contest Home migration, pre-event click rules, and post-event leaderboard expansion behavior | Done | Contest Home now uses the canonical league-scoped route in touched tests/navigation, pre-event self rows link to My Entries while non-self rows stay read-only, and post-event leaderboard rows expand one-at-a-time to reveal lineup detail instead of using the old duplicate leaderboard panel. Slice-local tests plus typecheck passed; the only known red full-repo gate remains the separate in-progress `/manage/leagues` session. |
| 107-009 | 5 | Build Manage Contests list page and wire commissioner League-menu navigation | Done | `/league/:leagueCode/contests/manage` is now a real commissioner/root-admin page with active and historical contest sections, create/open/manage links, League Home handoff links, and commissioner-only app-shell navigation to the canonical list route. Per-contest manage remains the row destination, and the specific list route still sits ahead of dynamic `:contestId` matching. |
| 107-010 | 5 | Add My Team History placeholder and finish orphan-route/component cleanup | Done | Added the dedicated `/league/:leagueCode/history` page for completed/cancelled contests, moved Team Home history access to that canonical route, repointed lingering app-shell and contest/create-entry navigation away from hash anchors and deleted compatibility surfaces, and removed the temporary `/contests/:contestId` compatibility redirect now that touched navigation/tests are league-scoped. Validated with the full required repo gate set before closeout. |
| 107-011 | 6 | Run full validation, reconcile Beads, and close remaining plan drift | Not Started | Includes frontend, contract, and route cleanup verification for final merged IA. |
