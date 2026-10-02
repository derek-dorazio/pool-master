# Plan 146 — Path-Filtered CI Jobs

**Tracking issue:** #300

## Purpose

A PR run is green in 7m17s, and almost all of that is spent running tests against code the PR did not touch. This plan records how to skip those jobs without weakening the merge signal, and documents the one mechanism choice that is a correctness requirement rather than a preference.

Measured on #299's PR run, after #294's job split:

| Cumulative from push | Job finishing |
|---|---|
| 0m58s | `all-contract-gates` |
| 2m22s | `service-lint-typecheck` |
| 2m58s | `poolmaster-browser-e2e-local` |
| 3m16s | `service-unit-tests` |
| 3m32s | `poolmaster-unit-tests` |
| 4m29s | `service-functional-api-tests` |
| **7m17s** | **`service-integration-tests`** |

Of the eleven PRs merged on 2026-10-02, most touched only `docs/`, `rules/`, `plans/`, `scripts/` or `.github/`. Every one paid for 142 integration tests against unchanged service code.

This is complementary to #295 (sharding integration), not an alternative. Sharding lowers the floor for PRs that *do* touch the service tier; filtering removes the floor entirely for PRs that do not. Both are worth doing, and filtering is the larger win for the common case.

## Governing principles

- `rules/workflow-rules.md` §3 — branch and merge discipline; the required-checks list is the enforcement point, not convention.
- `rules/review-triggers.md` §1 — anything a scanner can decide stays mechanical. Which paths a PR touched is mechanical; whether those paths can affect a suite is a judgement encoded once, in the filter.
- `docs/CI-AND-QUALITY-GATES.md` — the gate inventory and job graph; must be updated in the same slice.

## The decision that matters: job-level `if:`, never workflow-level `paths`

**Do not add `paths:` or `paths-ignore:` under `on.pull_request`.**

A workflow filtered out at the trigger level does not run, so GitHub creates **no check run** for its jobs. A branch-protection required check with no check run is not "passed" — it reports *Expected — Waiting for status to be reported*, and the pull request can never merge. The result is the exact opposite of the goal: the PRs meant to merge fastest become the only ones that cannot merge at all.

A job skipped by a job-level `if:` **does** produce a check run, with conclusion `skipped`, and branch protection treats a skipped required check as satisfied.

So the shape is:

```
all-contract-gates          always runs (the floor)
changes                     always runs, outputs booleans per area
service-*-tests             if: not a PR, or changes.outputs.service == 'true'
poolmaster-*                if: not a PR, or changes.outputs.client == 'true'
deploy-*                    unchanged — main-only, and main never filters
```

This asymmetry is deliberate and load-bearing: **filtering applies to pull requests only.** A push to `main` runs every suite regardless of paths, because main's run is what gates `deploy-publish-images`. Filtering on main would mean deploying code whose tests never ran — which is the failure #281 existed to end, reintroduced through a different door.

A second consequence of `needs:` semantics reinforces this: a job that `needs:` a skipped job is itself skipped by default. Since `deploy-publish-images` needs all three suite jobs, any filtering on main would silently skip the deploy rather than fail it. Keeping the filter PR-only avoids having to reason about that at all.

## The filter must fail toward running

The cost of running a suite unnecessarily is a few minutes. The cost of skipping one that was needed is a defect reaching `main` with a green check beside it. These are not symmetric, so every ambiguous path runs everything.

Paths that must trigger the **service** suites:

- `packages/core-api/**`, `packages/shared/**`, `packages/mock-contest-feed-provider/**`
- `packages/core-api/prisma/**` — schema and migrations
- `tests/unit/**`, `tests/integration/**`, `tests/functional/**`, `tests/support/**`, `tests/tsconfig.json`
- any jest config: `tests/jest.config.js`, `tests/integration/jest.config.js`
- `package.json`, `package-lock.json` — a dependency change can break any suite
- `.github/workflows/**` — a workflow change must prove itself against the full set
- `scripts/**` — the coverage and runner scripts the suites execute

Paths that must trigger the **client** suites: `clients/**`, plus everything in the service list that the client consumes (`packages/shared/**`, the generated SDK, `package.json`). `poolmaster-browser-e2e-local` runs the whole stack, so it needs the **union** — core-api included. It is not a client-only job despite its name.

Everything else — `docs/`, `rules/`, `plans/`, `requirements/`, `tech-specs/`, `AGENTS.md`, `CLAUDE.md`, `*.md` at the root — triggers nothing beyond `all-contract-gates`, which always runs and already covers the rule scanners, the contract freshness check and the plan-reference scanner that documentation changes can actually break.

## Why `all-contract-gates` stays unconditional

It is the floor, and it is cheap (0m58s). It runs `rules:check`, `api:check`, `api:validate` and `test:scripts` — the checks that a docs-only or scripts-only PR *can* fail. A plan-citation scanner finding is exactly the kind of thing a `docs/` change breaks, so filtering it out would remove the one gate that matters for the PRs this plan speeds up.

Worth stating plainly, because it invites a wrong inference: `all-contract-gates` green does **not** mean the code is sound. It runs no lint, no typecheck and no application tests. It is not a merge signal on its own for any PR that touches code.

## Open questions

- **Detection mechanism.** `dorny/paths-filter` is the conventional choice and handles the base-ref comparison correctly for both PR and push events. A hand-rolled `git diff --name-only origin/${{ github.base_ref }}...HEAD` step avoids a third-party action but has to get the merge-base right and handles the first push to a new branch poorly. Prefer the action unless adding a dependency on it is objectionable.
- **Whether `service-lint-typecheck` should be filtered at all.** It is 1m21s and catches the single most common failure — code that does not compile. The saving is small and the risk of mis-filtering it is the same as any other job. Leaning toward leaving it unconditional alongside `all-contract-gates`, which also gives every PR a "it compiles" floor at 2m22s.
- **Required-checks list.** Whether the suites are currently in branch protection's required list at all is unverified. If they are not, filtering changes nothing about mergeability and the whole plan reduces to saving runner minutes — still worth it, but the framing changes. Check before building.

## Verification this plan asks for

The claim that matters is about branch protection, and it cannot be verified by reading the workflow. The slice must show, on a real PR:

1. A docs-only PR where the service suite checks appear as `skipped` **and** the PR is reported mergeable.
2. A `packages/core-api/**` PR where every suite runs.
3. A `main` push where every suite runs regardless of the paths in that commit.

Point 1 is the one that catches the workflow-level-`paths` mistake, and it has to be observed on a PR rather than argued from the YAML.
