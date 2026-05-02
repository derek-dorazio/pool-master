# Plan 105: Test Data Hygiene and Reusable QA Browser Fixtures

**Beads epic:** `pool-master-xw5` — see `bd show pool-master-xw5` for live slice state, child stories, and status. This plan is the narrative companion; task tracking lives in Beads.

## Objective

Stop both QA and local Postgres from accumulating avoidable automated-test
residue by:

- replacing per-run browser-created users/leagues with reusable QA fixtures
- hardening local functional/integration cleanup and reset behavior
- using real lifecycle cleanup flows for manual QA cleanup where they already
  exist

## Dependencies

- [86-e2e-stabilization-and-cleanup-reset.md](./86-e2e-stabilization-and-cleanup-reset.md)
- [83-league-lifecycle-execution.md](./83-league-lifecycle-execution.md)
- [85-user-account-lifecycle-execution.md](./85-user-account-lifecycle-execution.md)
- Browser E2E strategy in this plan. The prior
  `plans/testing/browser-e2e-high-value.md` companion has been folded into this
  active plan so the lane has one narrative source of truth.

## Confirmed Current State

- Browser E2E currently creates unique users and league codes on each run in
  `clients/poolmaster/e2e/`, which causes permanent QA residue.
- Local functional and integration suites currently use best-effort cleanup
  against a shared Postgres database rather than per-test transaction rollback.
- League delete with contest/member cascade cleanup already exists under
  [83-league-lifecycle-execution.md](./83-league-lifecycle-execution.md).
- Self-account inactivate/delete already exists under
  [85-user-account-lifecycle-execution.md](./85-user-account-lifecycle-execution.md).
- Draft contest delete and member entry delete already exist, so shared-league
  cleanup does not need to wait on new contest/entry delete features.
- Root-admin delete-any-user is not a blocker for this lane. Reusable fixture
  users should greatly reduce the need for manual user cleanup; add a separate
  follow-up only if residue still proves operationally painful after the shared
  fixture strategy lands.

## Locked Decisions

1. Browser E2E should stop creating new durable QA users and leagues on every
   run.
2. The primary deployed browser fixture should be one reusable
   `QA-TEST-LEAGUE`.
3. Browser tests may repair prerequisite state if it is missing:
   - log in with stable commissioner/member QA accounts
   - create `QA-TEST-LEAGUE` only if it does not exist
   - restore expected member access only if it is missing
4. Local test hygiene should be improved in the local harness, not deferred to
   manual database cleanup.
5. Manual QA cleanup should prefer real product/admin lifecycle flows over
   ad hoc SQL whenever those flows already exist.

## Desired End State

- CI browser E2E uses stable QA fixture accounts plus one self-healing shared
  QA league.
- The shared QA league can host high-value commissioner/member flows without
  unbounded growth of leagues, contests, entries, and invitations.
- Local `poolmaster_test` runs have an authoritative cleanup/reset path and do
  not depend on heuristic leftovers disappearing by chance.
- Existing delete flows become part of real QA operations and therefore get
  truthful manual regression usage.
- Browser E2E coverage touches the app's major page families through stable
  page/component contracts rather than brittle copy, CSS, or per-run test data.

## Browser E2E Strategy

The refactored webapp now has shared page templates, stable page roots, and
domain-specific component test ids. The browser suite should use those as its
navigation and readiness contract while keeping detailed business-rule proof at
lower layers.

### Guiding Principles

- E2E proves that real browser wiring works across routes, auth, roles, API
  state, and major workflows. It does not re-test every service rule already
  covered by unit, integration, contract, or functional API tests.
- Tests use Playwright's web-first assertions and auto-waiting locators. Avoid
  sleeps, DOM traversal, XPath, CSS implementation selectors, and assertions on
  decorative copy.
- Prefer `getByRole`, `getByLabel`, and `getByText` for user actions where the
  accessible name is the stable product contract. Prefer `getByTestId` for page
  roots, dynamic rows, generated entity controls, modals, grids, and workflow
  state markers.
- Each spec starts from a known role and fixture state. Tests can repair missing
  prerequisite state, but should not create unbounded users, leagues, contests,
  invitations, or entries.
- Use UI for the user behavior under test. Use API/setup helpers for expensive
  or unrelated prerequisite state.
- Keep the PR smoke lane small and deterministic. Run broader browser coverage
  as a post-deploy or scheduled lane once the fixture harness is in place.

### Stable App Contracts

The current app already exposes the right kind of anchors for browser tests:

- Shell and navigation: `league-selector-toggle`,
  `league-selector-option-<leagueCode>`, `app-menu-my-team-trigger`,
  `app-menu-league-trigger`, `app-menu-*`.
- Auth and onboarding: `auth-login-*`, `auth-register-*`,
  `authenticated-landing`, `welcome-create-league`, `create-league-*`.
- League and team pages: `league-home`, `league-contests-page`,
  `league-contest-history-page`, `teams-page`, `my-team-page`,
  `my-team-history-page`.
- Contest pages: `create-contest-page`, `manage-contests-page`,
  `contest-board`, `contest-entry-*`, `league-contest-*`.
- Root admin pages: `root-admin-manage-hub-page`,
  `root-admin-manage-users-page`, `root-admin-manage-leagues-page`,
  `root-admin-manage-teams-page`, `root-admin-sync-dashboard-page`,
  `root-admin-run-sport-sync-page`, `root-admin-run-event-sync-page`,
  `root-admin-sync-config-page`, and content-configuration pages.

These are the preferred e2e readiness assertions. If a major page does not have
a stable page root or a critical action lacks an accessible role/label/test id,
add the missing selector as a product-observability improvement before writing a
fragile test.

### Test Harness Shape

Use a dedicated Playwright fixture layer under `clients/poolmaster/e2e/`:

- `fixtures.ts` extends Playwright's base test with role-aware fixtures:
  `commissionerPage`, `memberPage`, `rootAdminPage`, `qaLeague`,
  `qaContest`, and `qaEntry`.
- `auth.setup.ts` signs in stable QA accounts once and writes storage state
  files for commissioner, member, and root-admin browser contexts.
- `pages/` contains page objects for high-use surfaces such as
  `AuthPage`, `AppShell`, `LeagueDetailsPage`, `TeamDetailsPage`,
  `LeagueContestsPage`, `ContestBoardPage`, `ContestEntryPage`, and
  `RootAdminManagePage`.
- `fixture-state.ts` owns idempotent fixture repair: find or create the shared
  QA league, verify commissioner/member access, prepare a deterministic draft
  contest, and prepare or reset the member entry required by a spec. The
  product league code is `QATESTLEAGUE` because league codes are alphanumeric;
  the display name can remain `QA-TEST-LEAGUE`.
- `selectors.ts` may centralize dynamic test-id builders such as
  `leagueSelectorOption(leagueCode)` or `contestEntryParticipant(id)` when the
  id pattern is shared by multiple specs.

Page objects should be thin. They should expose user-level operations such as
`openLeagueMenu()`, `gotoLeagueDetails()`, `createEntry()`, or
`filterGridColumn()`, not reimplement business logic.

### Suite Partitioning

Use separate projects or npm scripts for different confidence/cost profiles:

- **Smoke:** runs on every PR/deploy gate. Proves auth state loads, the app
  shell renders, and major role routes are reachable.
- **Workflow:** runs after deploy or on demand. Exercises create contest,
  contest board, entry selection/update, invite acceptance, and lifecycle
  workflows against prepared state.
- **Operational/admin:** runs after deploy or on demand. Exercises root-admin
  manage grids, sync dashboard/manual sync pages, sync config pages, and content
  configuration surfaces.
- **Visual/responsive spot check:** optional targeted screenshots for auth
  shell and one authenticated shell page on desktop and mobile viewports. This
  should not replace functional assertions.

The current three-test deployed suite should be split after the fixture harness
lands. Registration remains valuable, but most tests should use saved auth
state and stable fixture accounts rather than registering fresh users.

### Coverage Map

The first durable browser coverage set should touch:

- Public/auth: sign in with stable accounts, registration smoke, invite route
  handoff.
- App shell: league selector, My Team menu, League menu, account menu, disabled
  navigation when no league is active.
- League: details page, invite members modal, teams/owners page, active
  contests page, contest history page.
- Team: team details page, change-name modal, change-icon modal, owners action
  surface, lifecycle action availability.
- Contest: create contest with fixture event, manage contest tier editor,
  contest board, create entry, update entry picks, tiebreaker, my entries
  filter, history route.
- Account: profile page, edit profile/email, change username, preferences, and
  password modal presence. Deep account lifecycle/delete behavior can stay
  lower-layer unless a browser regression recurs.
- Root admin: manage hub, users/leagues/teams grids with column filters,
  root-admin user detail navigation, sync dashboard, run sport sync, run event
  sync, sync config, content configuration list/detail.

### What Not To Put In E2E

- Exhaustive validation for every field error.
- Exhaustive scoring math.
- Provider feed parsing or event lifecycle status math.
- Every permission edge case.
- Every modal variant where shared component/unit coverage already proves the
  interaction.

Those belong in unit, integration, contract, functional API, or frontend
component tests. Browser E2E should cover one representative positive and one
representative negative/guarded path for major user journeys.

## Execution Direction

### 1. Reusable QA Browser Fixtures

This is the `pool-master-xw5.2` slice and should land before broadening E2E
coverage.

#### Fixture Accounts

Extend the existing QA bootstrap so the deployed QA environment has stable
browser accounts:

- root admin fixture: used only for operational/admin browser coverage
- commissioner fixture: owns `QA-TEST-LEAGUE`
- member fixture: belongs to `QA-TEST-LEAGUE` and owns/uses a deterministic QA
  team

For this pre-production phase, fixture credentials are committed in JSON so CI,
QA, and local setup all use one visible source of truth. Keep the implementation
centralized so the same account definitions can later be overridden by CI
secrets or environment configuration without redesigning the browser harness.
The bootstrap path should be idempotent: if accounts exist, verify/update
required attributes; if missing, create them. Tests should fail with a clear
setup error when required fixture accounts cannot sign in or be repaired.

#### Saved Auth State

Replace most per-spec registration with Playwright auth setup:

- `auth.setup.ts` signs in each stable role.
- Storage state files are written under an ignored e2e auth directory.
- Playwright projects depend on the setup project and load the right
  `storageState` for commissioner, member, or root-admin specs.
- Registration remains a small standalone smoke test, not the setup path for
  every workflow.

#### Shared QA League Repair

Introduce a self-healing helper for `QA-TEST-LEAGUE`:

- find the league by stable code
- create it if absent
- verify the commissioner fixture is commissioner
- verify the member fixture is a league member
- repair member/team state if missing
- return stable identifiers needed by specs, such as league code, league id,
  commissioner team id, and member team id

Use generated SDK/API setup helpers for repair when the UI behavior is not the
thing being tested. Use UI only when the specific spec is testing the UI flow,
such as invite acceptance.

#### Shared-League Artifact Policy

The shared league must not become the new residue source.

- Use deterministic names/codes for e2e-created objects, such as
  `E2E Draft Contest` or `E2E Member Entry`.
- Before a spec, delete or reset stale draft artifacts that the spec owns.
- If an object cannot be truthfully deleted/reset through existing API or UI,
  keep it out of browser scope until the missing cleanup behavior is added.
- Do not create a new league per run except in the one registration/create
  league smoke that explicitly tests that workflow.

#### Minimum Slice Output

`pool-master-xw5.2` should produce:

- role-aware Playwright fixtures
- saved-auth setup for stable commissioner/member/root-admin accounts
- shared QA league repair helper
- replacement of random identity helpers in existing e2e specs where the spec
  does not intentionally test registration
- one smoke spec that proves commissioner/member/root-admin authenticated route
  access using saved state
- documented environment variables/secrets needed to run the browser harness

#### Validation For The Slice

The slice should pass:

- focused Playwright harness tests against QA or a configured local target
- `npm run test:poolmaster:browser-e2e` or its replacement smoke script
- `npm run test:poolmaster:unit`
- `npm run lint`
- `npx turbo typecheck --force`

If browser setup cannot repair fixture state, the failure should identify which
fixture account, league, membership, team, or cleanup capability is missing.

### 2. Shared-League Artifact Control

- Do not let the shared league become the new clutter source.
- Reuse or clean up subordinate artifacts inside the shared league:
  - delete/replace draft contests with deterministic E2E names
  - delete/recreate the member entry when the flow requires a fresh state
  - prefer idempotent "prepare fixture state" helpers before each spec over
    permanently accumulating one-off contest rows
- If a truthful cleanup flow does not exist for some subordinate object, keep
  the browser scope away from that object until an ownership/cleanup story is
  added.

### 3. Local Backend Test Hygiene

- Harden functional cleanup so it no longer depends only on user email prefixes
  and happy-path `afterAll` execution.
- Harden integration cleanup so it no longer relies on narrow name patterns or
  partial provider-id assumptions.
- Treat `poolmaster_test` as disposable and document the supported reset flow
  when residue remains after an interrupted run.
- Prefer one authoritative reset/cleanup entry point for local DB-backed
  testing so developers can recover quickly when the local database gets dirty.

### 4. Manual QA Cleanup Operations

- Use existing league delete with cascade cleanup as the main manual tool for
  occasional QA league reset.
- Keep reusable fixture users durable by default; use self-account
  inactivate/delete only for occasional test-user reset, not as the normal
  browser cleanup strategy.
- After the shared-fixture browser lane lands, remove existing QA residue using
  the real lifecycle flows where practical.
- If old QA residue still requires deleting arbitrary dormant users as a
  root-admin operation, create a separate follow-up lane rather than expanding
  this plan mid-slice.

## Acceptance Criteria

- Browser E2E no longer creates unbounded new QA users and leagues on every
  deploy-gate run.
- Shared QA browser fixtures are self-healing enough that a missing league can
  be recreated truthfully without manual pre-seeding.
- Local functional/integration runs leave the test DB clean enough for repeated
  developer use, with a documented reset path for interrupted runs.
- Manual QA cleanup can be performed through existing real lifecycle flows
  rather than bespoke SQL for normal operation.
