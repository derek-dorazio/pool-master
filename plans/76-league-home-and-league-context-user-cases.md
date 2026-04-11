# Plan 76 Companion: League Home And League Context User Cases

## Purpose

Capture the product model for the new PoolMaster web app home experience so the
frontend is designed around league context from the start.

The core principle is:

- authenticated users do not land on a generic app dashboard
- authenticated users land in a league context when one exists
- the app shell is league-scoped by default
- bookmarked league home routes should be stable and shareable
- invite entry should use a dedicated public route:
  - `/invite/<inviteCode>`

This document should guide the route map, header design, onboarding flow,
league selector behavior, and invite entry flow before deeper webapp
implementation resumes.

## Guiding Principles

### Principle A: The authenticated home is league-scoped

The primary authenticated experience should be a league home page.

That means:

- the top-level landing after login should resolve into a league
- the main navigation should be scoped to the active league
- the main page body should be a league home surface, not a generic multi-league
  dashboard

### Principle B: League home routes should be bookmarkable

League home pages should have stable, user-facing routes with a short league
identifier.

Final route shape:

- `/league/<leagueCode>`

This enables:

- direct bookmarks
- email/deep-link routing into the correct league
- clearer mental models for multi-league users

### Principle C: Users can belong to multiple leagues with one account

Users may belong to more than one league, so the app shell must provide an
explicit league selector in the header/menu.

Switching leagues should:

- update the active league context
- update the route
- update league-scoped navigation and content
- preserve the sense that the user is now "inside" a different league home

### Principle D: First-time commissioners still use the same home surface

A newly registered commissioner with no leagues should still land on the normal
authenticated home route.

In that zero-league state, the page should show:

- a welcome message
- a create-league prompt
- no fake placeholder league content

The empty state is a data state of the same home experience, not a separate app
mode.

### Principle E: Invitees should land directly into the invited league

The invited-member flow should preserve league context from the invitation
itself.

That means:

- invite link identifies the target league
- invitee signs up or logs in
- backend adds/reactivates the membership
- app lands the user in that specific league home

This is different from commissioner self-registration, which begins with no
league context.

## Primary Actors

- Visitor
- Newly Registered Commissioner
- Existing League Member
- Existing Commissioner
- Invited Visitor
- Invited Existing User

## Core League Home Use Cases

### LH-001: Newly registered commissioner lands on authenticated home with no leagues

Actor:
- Newly Registered Commissioner

Goal:
- enter the product successfully even before a league exists

Flow:
1. Visitor opens the login/register page.
2. Visitor registers with first name, last name, email, password, and confirm password.
3. Backend creates the account and starts the session.
4. App routes to `/welcome`.
5. Because the user belongs to no leagues yet, the home page renders a welcome
   state with a create-league prompt.

Notes:
- this is still the normal authenticated home experience
- it is not a separate onboarding route

### LH-002: Commissioner creates the first league from the authenticated home

Actor:
- Newly Registered Commissioner

Goal:
- move from zero-league state into a real league home

Flow:
1. User lands on authenticated home with the zero-league welcome state.
2. User launches the create-league wizard from that page.
3. Backend creates the league and commissioner membership.
4. Backend returns the league code and active membership context.
5. App routes to `/league/<leagueCode>`.

Notes:
- create-league wizard details are handled in the separate wizard discovery plan

### LH-003: Returning user logs in and lands on a default league home

Actor:
- Existing League Member or Commissioner

Goal:
- re-enter the app in a sensible league context without extra friction

Flow:
1. User logs in without a bookmarked league route.
2. App resolves the default league context.
3. App routes to the selected league home.

Current default-resolution direction:
- use most-recent league from a cookie if present
- otherwise fall back to a deterministic league selection rule

Resolved decision:
- if there is no recent-league cookie, fall back to the most recently created
  league membership

### LH-004: User opens a bookmarked league home directly

Actor:
- Existing League Member or Commissioner

Goal:
- re-enter a specific league directly through a bookmark or deep link

Flow:
1. User opens `/league/<leagueCode>`.
2. App verifies session.
3. Backend verifies that the user belongs to the league.
4. App loads that league home and league-scoped navigation.

Notes:
- this should bypass default-league resolution

### LH-005: User switches leagues from the header selector

Actor:
- Existing League Member or Commissioner

Goal:
- move from one league home to another inside the same session

Flow:
1. User opens the header league selector.
2. Selector lists leagues the user belongs to.
3. User chooses another league.
4. App updates route to `/league/<leagueCode>`.
5. App persists that league as the latest active league for future default
   routing.

### LH-006: Invited visitor joins a league through an invite link

Actor:
- Invited Visitor

Goal:
- sign up and land directly inside the invited league

Flow:
1. Visitor opens `/invite/<inviteCode>` for a specific league.
2. App presents login/register in invite context.
3. Visitor registers.
4. Backend creates the account, validates the invite, and creates/reactivates
   `MEMBER` membership in the invited league.
5. App lands the user on `/league/<leagueCode>` for that invited league.

Notes:
- this is the primary member acquisition flow
- it should not first land the user on a generic no-league state

### LH-007: Invited existing user accepts a league invite

Actor:
- Invited Existing User

Goal:
- add another league to an existing account and land in that league context

Flow:
1. Existing user opens `/invite/<inviteCode>`.
2. User logs in if needed.
3. Backend validates invite and adds/reactivates league membership as `MEMBER`.
4. App lands the user on `/league/<leagueCode>` for that invited league.

### LH-008: User opens a league they no longer belong to

Actor:
- Former Member or Non-Member

Goal:
- handle invalid bookmarked league access safely

Flow:
1. User opens `/league/<leagueCode>`.
2. Backend determines the user has no active membership for that league.
3. App stays on that route and shows a clear “league is no longer active” state.
4. Header still exposes the standard navigation shell, including the league
   selector.
5. User can switch to another active league from the selector.

## Header And Shell Expectations

The authenticated shell should reserve space for:

- league selector in the header
- user profile/settings access
- logout access
- notification/help entry points
- league-scoped primary navigation

The main navigation below that should be scoped to the active league, including
future items like:

- home
- create contest
- contest list
- standings/history
- member/invite tools
- settings

Current planning direction:

- render the same header and league-selector component on all authenticated pages
- the league selector should always be visible, even when the user has zero or
  one active leagues
- selector contents are built from:
  - all active leagues
  - `+ Create League`
- selector rows should show:
  - league avatar/icon when available
  - league name
- the selector should switch league context immediately on click
- no special selector-only empty-state behavior is needed for `/welcome`; when a
  user has zero leagues, the selector simply shows no active leagues plus
  `+ Create League`

## Resolved Product Decisions

- League home route is `/league/<leagueCode>`.
- `leagueCode` is immutable after creation.
- `leagueCode` values are globally unique forever and should never be reused.
- Default authenticated landing resolution is:
  - recent-league cookie first, when valid
  - otherwise most recently created league membership
- `/welcome` is the authenticated zero-league route.
- Newly registered commissioners with no leagues land on `/welcome`.
- Once a user has at least one league, `/welcome` redirects to the resolved
  default `/league/<leagueCode>`.
- If an unauthenticated user opens a protected league route, successful login
  returns them to that intended `/league/<leagueCode>` route.
- Invite acceptance always lands on the invited league route and updates the
  recent-league cookie to that league.
- Invite flows are always league-scoped.
- Invite pre-auth experience should show league name, avatar, and welcome/invite
  messaging before login or registration.
- Existing invited users log in first, then see the league invite acceptance
  screen.
- New invited users register first, then see the league invite acceptance
  screen.
- Invite acceptance uses an explicit confirmation screen for both existing and
  new users.
- First invite version uses one primary CTA only:
  - `Join League`
- When a bookmarked league is inaccessible, the app stays on that route and
  shows a message that the league is no longer active; the user can use the
  header league selector to move to another active league.
- The header should include planning placeholders for:
  - league selector
  - profile
  - settings
  - logout
  - notifications
  - help

## Resolved Immediate-Scope Decisions

1. Invite pre-auth route uses the stable shape `/invite/<inviteCode>`.
2. Invite screen should show:
   - league avatar
   - league name
   - welcome/invite messaging
3. After invite acceptance, the app should transition directly into
   `/league/<leagueCode>` without an extra success page.
4. First-version selector ordering can stay simple as long as:
   - the current league is visibly marked active
   - the recent-league cookie updates on switch

## Deferred Questions

These remain intentionally open because they are not required to complete the
next implementation slices:

1. What additional routing rules do we want for future league subpages such as:
   - `/league/<leagueCode>/contests`
   - `/league/<leagueCode>/members`
   - `/league/<leagueCode>/settings`
2. How should the eventual league home page itself behave:
   - summary/dashboard
   - action hub
   - mixed overview

## Immediate Next Scope

The next webapp design/implementation phase should focus on completing these
flows before deeper league-home content design:

- self-registration
- zero-league `/welcome`
- create-league modal launch path
- league-scoped invite entry
- login/register-invite join flow
- invite acceptance

Current implementation status:

- self-registration is active
- zero-league `/welcome` is active
- create-league modal launch path is active from `/welcome` and the header
  league selector
- auth entry now preserves invite context and can open directly in register mode
  for invited new users
- invite route now presents explicit sign-in and create-account actions while
  preserving the target invite destination
- invite acceptance already routes directly into `/league/<leagueCode>` and now
  updates the recent-league cookie
- browser E2E now covers:
  - commissioner self-register -> create first league -> logout
  - invited new user register -> explicit join -> invited league home -> logout
  - existing multi-league user deep-link -> selector switch -> recent-league login resolution -> logout
- legacy `/join/<inviteCode>` now redirects into canonical `/invite/<inviteCode>`

## Suggested Browser E2E Flows

These are the three highest-signal browser E2E flows to add once the related UI
exists. They are intentionally product-driven and map to the new league-home
model rather than generic page-load checks.

### E2E-001: New commissioner self-registers and creates first league

Goal:
- prove the primary first-time commissioner journey from visitor to first league
  home

Flow:
1. Visitor opens `/`.
2. Visitor switches to register.
3. Visitor registers with first name, last name, email, password, and confirm
   password.
4. App lands on `/welcome`.
5. User launches the create-league wizard.
6. User creates a league.
7. App lands on `/league/<leagueCode>`.
8. Header league selector shows the new league as the active context.
9. User logs out.

Why this matters:
- this is the most important greenfield onboarding journey in the new app

### E2E-002: Invited new user registers, accepts invite, and lands in invited league

Goal:
- prove the primary member-acquisition flow for a brand-new user

Flow:
1. Test creates or obtains an invite link for a specific league.
2. Visitor opens the invite route.
3. Invite screen shows league avatar, league name, and invite messaging before
   auth.
4. Visitor registers.
5. App shows the invite acceptance screen for that same league.
6. Visitor clicks `Join League`.
7. App lands on `/league/<leagueCode>` for the invited league.
8. Header league selector includes that league and marks it active.
9. User logs out.

Why this matters:
- most members will enter through invitation, not by creating leagues

### E2E-003: Existing multi-league user uses bookmark and league selector correctly

Goal:
- prove bookmarkability and active-league switching for users in multiple
  leagues

Flow:
Precondition:
- reuse the commissioner from `E2E-001`
- that same commissioner creates a second league before this flow begins

Flow:
1. Existing authenticated user opens a bookmarked route such as
   `/league/<leagueCodeA>`.
2. App lands in league A.
3. User opens the header league selector.
4. User switches to league B.
5. App routes immediately to `/league/<leagueCodeB>`.
6. User logs out.
7. User logs back in without a bookmarked route.
8. App resolves back into the most recent league context according to the
   cookie/default-league rule.
9. User logs out.

Why this matters:
- this proves the core multi-league navigation model and the bookmark/default
  behavior together

## Relationship To Active Plans

- [plans/69-poolmaster-webapp-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/69-poolmaster-webapp-rebuild.md)
  should treat this as the route/home-context companion for the next webapp
  phase
- [plans/75-league-creation-wizard-discovery.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/75-league-creation-wizard-discovery.md)
  should treat this as the home-shell context that launches the create-league
  modal
