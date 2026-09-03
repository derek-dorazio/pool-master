# Browser E2E Suite — Evaluation, Reset, and Rebuild

**Beads epic:** `pool-master-303`

## Decision made

The existing suite depends on pre-existing, shared, mutated-in-place QA
data (a fixed league code, fixed fixture users) — that dependency is the
thing to eliminate, not patch around. Two phases:

- **Phase 1 (this plan implements it):** delete everything currently in
  `clients/poolmaster/e2e/` and replace it with the smallest possible test
  that reliably completes every run — no login, no seeded league, no shared
  mutable state of any kind.
- **Phase 2 (deferred, not designed here):** design a real e2e suite
  together later, once there's a clear view of what a real-browser test
  should uniquely cover that the rest of this repo's test layers don't
  already. This plan does not pre-decide that design — it's a placeholder
  slice/note, intentionally left thin.

## Purpose of the evaluation below

Before deleting anything, here's the evidence for *why* — real CI history,
not just a read of the code — so the reasoning survives after the old
suite is gone and isn't only "Derek's gut feeling was right."

## What the suite actually contains

6 spec files, ~24 lines average, plus shared fixture/setup machinery:

| File | What it checks |
|---|---|
| `auth.setup.ts` | Each of 3 fixture roles (root-admin/commissioner/member) can sign in, or self-registers if sign-in fails; saves Playwright storage state for reuse. |
| `authenticated-landing.e2e.ts` | Each role's landing surface renders a testid after `goto`. |
| `root-admin-navigation-smoke.e2e.ts` | Root admin can `goto` 7 `/manage/*` routes and see a testid on each. |
| `league-navigation-smoke.e2e.ts` | Commissioner/member can click through the primary nav menu and see a testid land. |
| `commissioner-league-setup.e2e.ts` | Commissioner can generate an invite link from the shared QA league. |
| `member-league-invite-acceptance.e2e.ts` | Member (already a member via fixture setup) can reach My Team. Despite the filename, it does not itself exercise invite *acceptance* — that happens inside the shared fixture (`ensureQALeague`), not as an observable, independently-failing test. |

**Every assertion in every spec is `expect(...).toBeVisible()` on a testid
after a `goto` or click.** None assert on data correctness, submitted-form
outcomes, or business logic. `poolmaster-e2e-helpers.ts` also exports
`createLeague` and `openCreateContestFlow` — neither is called from any spec
file. They're dead code, built for flows nothing currently exercises.

## What it costs — real CI evidence, not speculation

I pulled actual run history via `gh run list`/`gh run view` rather than
guessing:

- **Every one of the 8 most recent `main` CI runs (all from today) never
  actually ran the e2e suite at all** — `poolmaster-browser-e2e` was
  `skipped` in all 8, because it `needs: migrate-qa`, and `migrate-qa` has
  been failing or getting skipped upstream (the exact stuck-migration
  problem plan 129 addresses). Your sense that "it breaks often" has
  partly been measuring an unrelated infra problem wearing this suite's
  name — the job hasn't had a chance to pass *or* fail on its own merits
  recently.
- Going back further to runs where the job **did** actually execute, a
  16-run sample: **13 passed, 3 failed (~19% failure rate)**. That's a real,
  non-trivial number.
- I pulled the actual failure log for one of the three: it failed on
  `auth.setup.ts`'s commissioner sign-in with `Test timeout of 30000ms
  exceeded` on a `locator.fill` call — the login field didn't become
  interactable in 30 seconds. That's an environmental/timing flake, not a
  caught regression. (The other two failures' logs have already expired
  past GitHub's retention window, so I can't confirm their cause, but
  nothing in this suite's design gives me reason to expect they're
  different in kind.)

## Why it's fragile — architectural causes, not bad luck

- **Zero test isolation.** Every run reuses one fixed-code shared QA league
  (`qaLeagueSeed.code`) and 3 fixed fixture users, mutated in place across
  runs. `fixture-state.ts`'s `ensureQALeague` is ~130 lines of "detect the
  shared league is missing/conflicting/inactive and repair it" logic —
  create-or-look-up-or-delete-and-recreate, invite-or-verify-membership. This
  is inherently exposed to races and eventual-consistency gaps between runs,
  and it's *why* the config sets `workers: 1, fullyParallel: false` — the
  tests can't run concurrently without racing each other over shared state.
  That serialization is a symptom, not a separate problem.
- **Coupled to live deployment timing.** The CI job polls the real QA URL for
  up to 120 seconds (24 attempts × 5s) waiting for the HTML to reflect the
  new release before running anything. CDN propagation delay becomes e2e
  flakiness.
- **Coupled to an unrelated concern.** `needs: migrate-qa` means a schema
  migration failure — which has nothing to do with whether the UI renders —
  prevents the suite from running at all, with no distinct visibility that
  it didn't run vs. it passed.
- **No retries.** `retries: 0`. Playwright's own guidance for real
  network/browser e2e tests is to allow at least one retry in CI
  specifically because transient environment blips are expected; this
  config takes the harshest possible stance while also having the most
  exposure to exactly that kind of flake (shared remote state, real network,
  real deploy timing).

## What does it actually catch that nothing else does?

This matters for deciding how much investment is worth it. This repo already
has, at other layers:

- ~100 frontend component test files (React Testing Library + MSW), several
  hundred tests, asserting real interaction, validation, loading, and error
  states — strictly *deeper* per-page coverage than any assertion in the e2e
  suite, which only checks a testid is visible.
- FAPI functional tests exercising the real backend end-to-end through the
  generated SDK, with no provider/mock boundary — genuine integration
  coverage of business logic and data correctness.
- Contract-verification integration tests, and a full unit-test layer under
  both of those.

The e2e suite's only *unique* claim is "the actual production-built bundle,
served for real, in a real browser, against a real deployed backend, with
real cookies" — which is a legitimate thing to want, but the current suite
barely exercises it beyond page-load: no spec does a real form submission,
no spec checks a value came back correctly, no spec drives a multi-step flow
to a verifiable outcome. It pays the full fragility cost of "real
everything" for the assurance depth of a build smoke test.

## Phase 1 — delete everything, replace with a minimal ping

### Delete (all git-tracked, no `.auth/*.json` to worry about — those are
local Playwright storage-state artifacts, never committed)

```
clients/poolmaster/e2e/auth-state.ts
clients/poolmaster/e2e/auth.setup.ts
clients/poolmaster/e2e/authenticated-landing.e2e.ts
clients/poolmaster/e2e/commissioner-league-setup.e2e.ts
clients/poolmaster/e2e/fixture-state.ts
clients/poolmaster/e2e/fixtures.ts
clients/poolmaster/e2e/league-navigation-smoke.e2e.ts
clients/poolmaster/e2e/member-league-invite-acceptance.e2e.ts
clients/poolmaster/e2e/poolmaster-e2e-helpers.ts
clients/poolmaster/e2e/qa-users.ts
clients/poolmaster/e2e/root-admin-navigation-smoke.e2e.ts
```

This removes every dependency on pre-existing data: no fixed league code,
no fixture users, no shared mutable state, no repair-on-detect logic.

### Add — one spec, zero data dependency

`clients/poolmaster/e2e/ping.e2e.ts`: navigate to `/` and assert the
unauthenticated landing shell renders — the login form's identifier field
(`auth-login-identifier`, the same testid the old `auth.setup.ts` already
proved reliable) is visible. No login, no registration, no league, nothing
seeded. If the deployed bundle boots and routes to the sign-in screen, this
passes; if it doesn't, this is the one thing worth knowing.

### Update `playwright.config.ts`

- Remove the `auth setup` project entirely (`testMatch: /.*\.setup\.ts/`) —
  there's no setup file left.
- Remove `dependencies: ['auth setup']` from the `chromium` project — nothing
  to depend on anymore.
- `fullyParallel: true` — no shared state left to race over. Harmless with
  one test today, correct going into phase 2.
- `retries: 1` (CI only, matching Playwright's own guidance for real-network
  e2e) — directly serves "reliably complete each time": a transient blip on
  one attempt no longer fails the whole job.

### Update `.github/workflows/ci.yml`

- The `poolmaster-browser-e2e` job's summary step currently says "Journeys:
  stable role auth setup, reusable QA league repair, commissioner/member/
  root-admin route smoke" — update to something honest about the new scope
  (e.g. "Journeys: minimal deploy-reachability ping").
- Change `needs: migrate-qa` to `needs: publish-images` (the same thing
  `migrate-qa` itself depends on). The ping test doesn't touch the database
  at all — there's no reason an unrelated schema-migration failure should
  prevent "does the app boot" from ever getting a chance to run. This is a
  direct fix to the exact problem this evaluation found (all 8 of today's
  runs skipped the job for this reason) and belongs in phase 1, not deferred.
- The deploy-verification curl-polling step (waits up to 120s for the CDN to
  reflect the new release) stays as-is — it's a real, separate concern
  (confirming the *new* build is what's being tested) and isn't part of what
  lives in `e2e/`, so it's out of this phase's scope.

### Verification for phase 1

- `cd clients/poolmaster && npx playwright test` locally against a real
  running dev server (or QA) — confirm the single ping test passes.
- Confirm `npm run test:poolmaster:browser-e2e` / `:list` (root `package.json`
  aliases) still resolve correctly with only one spec file present.
- Push and watch the actual `poolmaster-browser-e2e` CI job run to
  completion (not skipped) at least once — this is the real proof, given
  the job hasn't gotten a chance to prove anything for a while.

## Phase 2 — design a real suite together (not designed here)

Deliberately thin. Once phase 1 is live and QA is in a saner state (plan
`pool-master-bwl`'s reset lands), come back and decide together, informed by
actually watching the ping test run cleanly for a while:

- What does a real browser/deployed-build test need to uniquely prove that
  the existing RTL component suite and FAPI functional suite structurally
  can't?
- If it needs real data (a league, a contest, a draft), how does it get that
  data without reintroducing shared mutable fixtures — per-run creation via
  the app's own real APIs (registration, league creation) is the leading
  candidate, informed by this evaluation's finding that `buildE2EUser`/
  `buildLeagueSeed`-style per-run fixtures were already half-built and never
  wired up.
- Scope: one critical golden-path journey per role, or broader coverage?

No slices are cut for this yet — the Beads epic gets a single placeholder
child for phase 2 so the intent isn't lost, with no acceptance criteria
until that design conversation happens.
