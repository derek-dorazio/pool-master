# Browser E2E Suite — Evaluation & Redesign Options

**Beads epic:** not yet opened — this plan presents an evaluation and a
recommendation; opening the epic/slices waits on which direction you pick
(see "Decision needed" at the end).

## Purpose

You asked whether `clients/poolmaster/e2e/` earns its keep — it feels fragile
and low-value. This is an evidence-based evaluation (real CI history, not just
a read of the code) plus concrete redesign options, not just an opinion.

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

## Recommendation

Two honest options, not one foregone conclusion — this is a resourcing/risk
call as much as a technical one:

**Option A — Shrink to a true smoke test, cut the rest.** Given how deep the
FAPI + RTL coverage already is, keep exactly one thing this suite is uniquely
positioned to prove: *the deployed app boots and each role can authenticate
for real*. Delete the navigation-smoke specs (their assertions are strictly
subsumed by existing RTL component tests already run in CI as part of
`poolmaster-unit-tests`, per page, against every one of those same routes).
Keep `auth.setup.ts`'s 3 role logins as the entire suite. Lowest fragility
surface, lowest maintenance, honest about what a real-browser test is for.

**Option B — Fix the fragility, keep the coverage.** If you want to keep
real-browser navigation coverage (e.g., because it's caught something RTL
tests structurally can't, like a routing/bundling regression that only shows
up in the built artifact):
1. Replace the shared, mutated-in-place QA league/user fixtures with
   per-run, uniquely-named ones — `buildE2EUser`/`buildLeagueSeed` already
   exist in `poolmaster-e2e-helpers.ts` for exactly this and are already
   used nowhere. This deletes essentially all of `fixture-state.ts`'s repair
   logic, removes the `workers: 1`/serialization requirement, and removes
   the race/eventual-consistency exposure entirely — each run gets a clean
   slate instead of inheriting the last run's state.
2. Enable `fullyParallel: true` once fixtures are isolated.
3. Add `retries: 1` (CI-only, matching Playwright's own default guidance for
   networked e2e).
4. Decouple the deploy-readiness poll from the test run itself — make it a
   separate, clearly-labeled step/job so a slow CDN propagation reads as
   "deploy verification timed out," not "e2e failed."
5. Reconsider the `needs: migrate-qa` edge — the UI-smoke job doesn't need
   a successful schema migration to prove routes render; depend on
   `publish-images` directly (or whatever `migrate-qa` itself depends on)
   with its own "is the app actually reachable" check, so a migration issue
   and a UI issue produce distinguishable signals instead of one skipping
   silently for the other's reason.
6. Delete `createLeague`/`openCreateContestFlow` or wire them into an actual
   spec — dead helper code either way right now.
7. Give `member-league-invite-acceptance.e2e.ts` (or a new spec) an actual,
   independently-failing assertion of invite acceptance, rather than relying
   on it succeeding silently inside shared fixture setup.

My own lean is **Option A**. The fragility here isn't incidental — it's the
direct, structural cost of design choices (shared mutable remote state, no
retries, deploy-timing coupling) made to support test *depth* the suite
doesn't actually have. Option B is a real, well-scoped fix if the "real
browser, real deploy" assurance is worth preserving, but it's meaningfully
more work than Option A for coverage this repo's other test layers already
make mostly redundant.

## Decision needed before I open an epic

1. **Option A (shrink to auth-only smoke) or Option B (fix and keep
   navigation coverage)?**
2. If B: is per-run isolated fixtures (item 1) actually acceptable, given it
   means losing the "one fast, always-warm shared league" convenience for a
   slower-but-correct per-run setup?
3. Either way: should `poolmaster-browser-e2e`'s outcome ever gate anything
   downstream? I didn't find anything in `ci.yml` that currently depends on
   it — if nothing does, it may be worth treating explicitly as signal/
   telemetry rather than a merge gate, which changes how much retry/fragility
   engineering is actually worth doing here at all.

Once you pick a direction, I'll open the Beads epic with concrete slices —
this doc intentionally stops short of that so the epic reflects a decision
you've actually made, not one I assumed.
