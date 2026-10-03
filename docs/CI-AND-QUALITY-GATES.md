# CI Workflow and Quality Gates

This document describes the GitHub Actions workflow that runs on every push to
`main` and every pull request targeting `main`, and the eight quality gates
that fire inside the early `lint-typecheck` job. It also documents how to run
the same checks locally and how to remediate each failure mode.

The authoritative workflow file is `.github/workflows/ci.yml`.

## Trigger model

The workflow runs on:

- `push` to `main`
- `pull_request` targeting `main`

A concurrency group cancels superseded runs on the same ref. The deploy
stages (`deploy-publish-images`, `deploy-migrate-qa`, `deploy-qa`,
`poolmaster-browser-e2e`, `deploy-health-issue`) are gated to push events on
`main` only — they do not run for pull requests.

## Repository setup — branch protection

The CI gates only enforce discipline if `main` cannot be reached without going
through them. This section documents the GitHub branch-protection ruleset that
backs the workflow.

Without this configuration, direct pushes to `main` bypass every gate:
the rule-enforcement scanners, `api:check`, the review triggers marker, and
the test/build/coverage jobs. The `rules:check:pr-review-triggers` check
specifically becomes meaningless without enforced PR flow — though since #284
it is advisory, so it reports rather than blocks even when it does run.

### Where to configure

GitHub UI: `Settings → Rules → Rulesets → New ruleset`. The ruleset replaces
the older "Branch protection rules" UI; either works, but rulesets are the
forward path and the API shape this doc describes.

### Recommended ruleset configuration

```
Ruleset name:       protect-main
Target:             branch
Conditions:         ref_name include = ~DEFAULT_BRANCH
Enforcement:        active

Rules:
  ✓ Restrict deletions
  ✓ Block force pushes (non_fast_forward)
  ✓ Require a pull request before merging
      Required approving review count: 0   (raise per-team policy)
      Dismiss stale pull request approvals when new commits are pushed: on
      Required review thread resolution: on
      Allowed merge methods: squash only
  ✓ Require status checks to pass before merging
      Require branches to be up to date before merging: on
      Required status checks:
        - all-contract-gates
        - changes
        - service-lint-typecheck
        - service-unit-tests
        - service-integration-tests
        - service-functional-api-tests
        - poolmaster-unit-tests
        - service-build
        - service-mock-provider-build
        - poolmaster-build

Bypass list:
  - Repository admin: bypass mode "always"   (solo-work escape hatch)
    OR
  - (empty)                                  (strict — no exceptions)
```

The status check names must match the `name:` of each job in
`.github/workflows/ci.yml` exactly. If the workflow's job names change,
update the ruleset to match — otherwise the protection silently stops
gating the renamed check.

### The bypass-list decision

Two coherent positions:

- **Admin bypass allowed (`bypass_actors: [{ actor_type: RepositoryRole, actor_id: 5, bypass_mode: always }]`)** — repository admins can push directly to `main` for cleanup or emergency work. The PR flow remains the default and is enforced for every other actor and for the admin's own team-coordinated work. This is the recommended setting for solo-developer workflows where an escape hatch is occasionally useful.
- **Strict (`bypass_actors: []`, `current_user_can_bypass: "never"`)** — even repo admins must go through PRs. No exceptions. Aligns with the strictest reading of `rules/workflow-rules.md §6` ("Never push directly to main").

There is no wrong answer; pick the one that matches the team's working model.

### Verification via the GitHub API

After saving the ruleset, verify the configuration with:

```bash
gh api repos/<org>/<repo>/rulesets --jq '.[] | select(.name == "protect-main") | .id'
gh api repos/<org>/<repo>/rulesets/<ruleset-id> --jq '{
  enforcement,
  bypass_actors,
  current_user_can_bypass,
  strict_status_checks: (.rules[] | select(.type=="required_status_checks") | .parameters.strict_required_status_checks_policy),
  required_status_checks: (.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks | map(.context)),
  allowed_merge_methods: (.rules[] | select(.type=="pull_request") | .parameters.allowed_merge_methods)
}'
```

Expected output for the recommended configuration:

```json
{
  "enforcement": "active",
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
  "current_user_can_bypass": "always",
  "strict_status_checks": true,
  "required_status_checks": ["all-contract-gates", "changes", "service-lint-typecheck", "service-unit-tests", "service-integration-tests", "service-functional-api-tests", "poolmaster-unit-tests", "service-build", "service-mock-provider-build", "poolmaster-build"],
  "allowed_merge_methods": ["squash"]
}
```

If `bypass_actors` is empty and `current_user_can_bypass` is `"never"`, the
ruleset is configured strictly. If the `required_status_checks` list does
not include all ten job names, the gates are partially bypassed — fix
before treating the configuration as complete.

### Why the marker check matters here

`rules:check:pr-review-triggers` (step 3 below) reads the PR body for a
literal `<!-- review:triggers -->` marker and **warns** if missing (#284 — it
used to fail). If branch protection does not require PRs, a contributor can
bypass the marker by direct-pushing to `main`, in which case the check never
runs at all. Its value depends entirely on PR flow being enforced, and now
also on the warning being read.

## Job DAG

```mermaid
flowchart TD
  T[push to main / PR to main] --> CG[all-contract-gates]
  T --> CH[changes]

  CH --> LT
  CH --> SU
  CH --> SI
  CH --> SF
  CH --> PU
  CH --> PB
  CH --> EL
  CG --> LT[service-lint-typecheck]
  CG --> SU[service-unit-tests]
  CG --> SI[service-integration-tests]
  CG --> SF[service-functional-api-tests]
  CG --> PU[poolmaster-unit-tests]
  CG --> PB[poolmaster-build]
  CG --> EL[poolmaster-browser-e2e-local]
  LT --> SB[service-build]
  LT --> MB[service-mock-provider-build]

  SU --> PI[deploy-publish-images]
  SI --> PI
  SF --> PI
  LT --> PI
  PU --> PI
  SB --> PI
  MB --> PI
  PB --> PI

  PI --> MQ[deploy-migrate-qa]
  MQ --> DQ[deploy-qa]
  DQ --> E2E[poolmaster-browser-e2e]
  PI --> DH[deploy-health-issue]
  MQ --> DH
  DQ --> DH

  classDef gate fill:#fff4e6,stroke:#d97706,stroke-width:2px
  classDef test fill:#e6f7ff,stroke:#0369a1
  classDef deploy fill:#e6ffed,stroke:#15803d
  classDef report fill:#f3f4f6,stroke:#6b7280

  class CG,LT,CH gate
  class SU,SI,SF,PU,SB,MB,PB,EL test
  class PI,MQ,DQ,E2E deploy
  class DH report
```

`all-contract-gates` is the gate. Every other job depends on it, directly or
through `service-lint-typecheck`, so if it fails nothing else runs.

The three service test suites run as separate jobs in parallel, each with its own
Postgres where it needs one, and start as soon as `all-contract-gates` passes —
they do not wait on `service-lint-typecheck` (#294). Lint and typecheck still
block the deploy track, because `deploy-publish-images` needs
`service-lint-typecheck`.

Only `service-unit-tests` collects service coverage in this workflow, because only
the unit suite has a coverage threshold (#302). Integration and functional API run
without coverage. The merged service coverage report is a separate, on-demand
workflow, `coverage.yml`. See *Merged coverage and the
coverage.yml workflow* below.

### Path filtering: jobs a change cannot affect are skipped (#300)

`changes` always runs and classifies the pull request's changed files, via
`scripts/ci-changed-areas.mjs`. The code jobs carry a job-level `if:` on its
outputs, so a change that cannot affect a suite does not run it. A
documentation-only PR runs `all-contract-gates` and `changes` and nothing else.

| Output | Gates |
|---|---|
| `code` | `service-lint-typecheck`, `poolmaster-build`, `poolmaster-browser-e2e-local` (and so `service-build` / `service-mock-provider-build`, which need lint) |
| `service` | `service-unit-tests`, `service-integration-tests`, `service-functional-api-tests` |
| `client` | `poolmaster-unit-tests` |

Three properties hold this together, and each is load-bearing:

**Filtering is pull-request-only.** Every condition is
`github.event_name != 'pull_request' || …`, so a push to `main` runs the full set
regardless of paths. main's run gates `deploy-publish-images`; filtering there
would mean deploying code whose tests never ran.

**It is a job-level `if:`, never `on.pull_request.paths`.** A workflow filtered at
the trigger level produces no check run, and a required check with no check run
reports *Expected — waiting for status to be reported* and can never merge. A job
skipped by `if:` does produce a check run, with conclusion `skipped`, which
branch protection accepts. This matters here specifically because the suites are
in the required-status-checks list above.

**The classifier fails toward running.** An unclassified path, a changed
dependency, a workflow edit, a `scripts/` change, or an unreadable file list all
run everything. Running a suite needlessly costs minutes; skipping one that was
needed puts a defect on `main` with a green check beside it.

`packages/shared/**` sets **both** `service` and `client`, so a shared change runs
every suite. It is in both lists deliberately: the service imports shared directly
and the client consumes it through the generated SDK, so a change there can break
either tier.

**The reason is structural, not incidental.** `packages/shared` is the contract
barrier between the tiers — it is where the DTOs, the domain types and the
generated SDK live, which is the whole point of `architecture-rules.md` §2's
contract-first chain. A change at a boundary both sides depend on is exactly the
case where breadth is worth paying for, so the slower run is the intended
behaviour rather than a reluctant trade. Treat a proposal to narrow this as a
proposal to stop testing one side of the contract.

That was not the original behaviour. Shared was service-only when the filter
landed in #300, recorded at the time as a known narrowing on the grounds that
`api:check` still covers the contract unconditionally. #303 then changed
`packages/shared/domain` and its run skipped `poolmaster-unit-tests` — the first
PR that could hit the gap did hit it. Widened rather than re-documented, with a
regression test in `scripts/ci-changed-areas.test.mjs`.

The deploy track (`deploy-publish-images` → `deploy-migrate-qa` → `deploy-qa`
→ `poolmaster-browser-e2e`) is push-to-main-only and additionally requires all
the test and build jobs to pass. Migrations gate the rollout: nothing reaches
QA until `deploy-migrate-qa` succeeds, so a failed migration leaves the
previous release running rather than new code on an old schema.
`deploy-health-issue` keeps one open GitHub issue ("QA deploy is failing on
main") while any deploy job fails, and closes it on the next green deploy.

## The lint-typecheck job

This job runs five ordered steps after install. The order matters: cheaper,
broader gates run first so a violation surfaces with the smallest possible
runtime cost.

```mermaid
flowchart LR
  I[npm ci + prisma generate + build shared] --> R[npm run rules:check]
  R --> A[npm run api:check]
  A --> M[Review triggers (PRs only, advisory)]
  M --> L[npm run lint]
  L --> TC[npm run typecheck]
```

| Step | Command | Approximate cost | Blocking? |
|---|---|---|---|
| 1 | `npm run rules:check` | ~1-2s (regex scan) | Two sub-checks are blocking; four are warn-only |
| 2 | `npm run api:check` | ~20-30s (re-exports OpenAPI + regenerates SDK) | Yes |
| 3 | review triggers marker | <1s (single API call to GitHub) | No — warns only (PRs only) |
| 4 | `npm run lint` | ~10-20s | Yes |
| 5 | `npm run typecheck` | ~30-60s | Yes |

## The 8 gates

`npm run rules:check` is a sequential `&&` chain of seven sub-scripts.
`npm run api:check` is its own command. `npm run rules:check:pr-review-triggers`
is the eighth gate, run only on PRs. Together they are the eight quality
gates added by the rule-enforcement hardening epic (`pool-master-1y8`).

| # | Gate | Command | Mode | Baseline | What it catches | Source |
|---|---|---|---|---|---|---|
| 1 | ~~No mocked API boundary~~ | **migrated to ESLint** | blocking via `npm run lint` | 0 | `vi.mock` / `jest.mock` of `@/lib/api` or `@/lib/api-client`. Widened past the scanner, which matched `vi` only. | `eslint-rules/no-mocked-api.mjs` |
| 2 | Route discipline | `rules:check:route-discipline` | warn-only | 95 | The `service-rules.md §10` grep set: `prisma.*` calls in routes/handlers, inline `.map((`, `additionalProperties: true`, `SuccessSchema` on domain endpoints, inline JSON schemas | `scripts/check-route-discipline.mjs` |
| 3 | ~~Test-disable discipline~~ | **migrated to ESLint** | blocking via `npm run lint` | 0 | `.skip` / `.todo` / `xit` / `it.fails` / `describe.skip` / `pending()`, plus `*.skip.test.ts` files and `skipped/` dirs. The `SKIP: #NN` escape comment was **removed** — see below. | `eslint-rules/no-disabled-tests.mjs` |
| 4 | ~~Shared UI controls~~ | **migrated to ESLint** | blocking via `npm run lint` | 0 | Bare `<button>`, `<input>`, `<textarea>` in `features/**` outside `features/shared/ui/`. More precise than the scanner, which also flagged controls inside comments. | `eslint-rules/no-bare-ui-controls.mjs` |
| 2a | Route authorization | `rules:check:route-authorization` | **blocking** | clean | A route with a path parameter under a by-id mount (a prefix with no path parameter, e.g. `/api/v1/contests`) that declares no `preHandler`/`onRequest` hook and is not on `scripts/route-authorization-opt-outs.mjs` with a reason. Also fails a stale or reasonless opt-out. Added by #193. | `scripts/check-route-authorization.mjs` |
| 5 | Form/query mirror | `rules:check:form-query-mirror` | warn-only | 1 | `useEffect` whose deps reference a TanStack Query result and whose body calls a `setState` (the form-overwrite-on-refetch hazard) | `scripts/check-form-query-mirror.mjs` |
| 6 | Generated API freshness | `api:check` | **blocking** | clean | Re-exports OpenAPI to a tmp dir, regenerates the hey-api SDK, diffs against committed `packages/shared/generated/`. Fails if any file is stale. | `scripts/check-openapi-fresh.mjs` |
| — | Plan references | `rules:check:plan-references` | warn-only | clean | A `plans/NN` citation in `docs/`, `rules/`, `requirements/`, `tech-specs/`, `AGENTS.md` or `CLAUDE.md` whose plan is absent from the tree and which has no `git show <sha>^:plans/NN-…` retrieval command within three lines (#147; `workflow-rules.md §0` governing rule 2). Accepted ADRs are exempt. The hint's SHA is not verified — CI's shallow checkout cannot. | `scripts/check-plan-references.mjs` |
| (PR-only) | review triggers marker | `rules:check:pr-review-triggers` | advisory (warns; **was blocking** until #284) | clean | The PR body should contain the literal HTML comment `<!-- review:triggers -->`. Documents what the slice touched that warrants a closer read. A missing marker emits a warning annotation and the job still passes. Skipped on `push` events (no PR context). | `scripts/check-pr-review-triggers.mjs` |

> **Baselines rot.** The counts above were re-measured on 2026-09-23 and four of the six
> had drifted — three of them to zero, because backlogs were cleaned without the table
> being updated. Re-measure with `npm run rules:check` before reasoning about any of them;
> do not treat a number here as current.

The six warn-only gates print findings with file:line locations and a `WARN`
prefix. They exit 0 regardless of finding count, so they do not fail the
build today. Their counts are visible in every CI run and are tracked as the
"size of debt" for the parallel cleanup epics.

The blocking gates (`api:check` and the PR-only review-triggers marker) exit
non-zero on any finding and fail the lint-typecheck job, which blocks the rest
of CI and any PR merge. The migrated gates block through `npm run lint` in the
same job.

## Detail: the api:check freshness gate

This gate is the most invasive of the eight because it actually executes the
OpenAPI export and SDK generation pipeline rather than scanning source.

The flow:

1. Export OpenAPI to a temp file via
   `node --import tsx packages/core-api/scripts/export-openapi.ts`.
2. Generate a fresh hey-api client to a temp directory using
   `@hey-api/openapi-ts`.
3. Diff the temp output against the committed
   `packages/shared/generated/openapi.json` and
   `packages/shared/generated/hey-api/`.
4. Report any file that differs as stale and exit 1.

This gate closes a long-standing drift hole. Before it existed, route or DTO
changes could ship with a stale committed SDK; consumers would fall back to
hand-rolled types or runtime casts, and the rules requiring a contract-first
flow had no enforcement. The gate catches this drift the moment it lands in
CI.

When it fails, the fix is mechanical: run `npm run api:refresh` locally and
commit the regenerated artifacts.

## Detail: the test-disable gate

Migrated to `poolmaster/no-disabled-tests` (`eslint-rules/no-disabled-tests.mjs`)
and **changed in policy** at the same time. The old scanner did not ban skipped
tests; it banned undocumented ones, letting any skip through if a `SKIP: #NN`
comment sat within two lines above it.

That exemption was removed. Nothing ever reconciled a marker against the issue it
named, so a skip could outlive its tracking issue and stay green indefinitely —
and writing a comment was cheaper than fixing or deleting the test, which made the
marker the default resolution for anything that went red.

The forms now rejected unconditionally:

```
.skip(  .todo(  .fails(  .failing(  xit(  xtest(  xdescribe(  pending(
```

plus `it.skip.each(...)` chains, files named `*.skip.test.ts`, and anything under
a `skipped/` directory. There is no escape comment. The remediation is to fix the
test or delete it.

Migration cost was zero: the repo had no skipped tests when this landed, so the
ban locked in the existing state rather than demanding a cleanup.

## Detail: the review triggers check (advisory)

This check runs only on `pull_request` events. It calls
`gh pr view <PR_NUMBER> --json body --jq .body` and greps for the literal
HTML comment `<!-- review:triggers -->`. If the marker is missing, it emits a
GitHub warning annotation and **exits 0** — the job passes and the PR can
merge. It behaves the same way when it cannot read the PR body at all.

**It blocked until #284.** Two reasons it stopped. First, the check can only
confirm the marker is *present*; it cannot judge whether the disclosure is
accurate or complete, so a failure never meant the section was any good. Second,
and decisively, the step runs inside `all-contract-gates`, which every other job
in `ci.yml` declares in `needs:` — so a missing prose section did not cost one
check, it withheld all twelve downstream jobs. On #283 an 11-line Terraform
change got no lint, typecheck, or test verdict at all for that reason.

The marker remains presence-reported only: it shows the section exists, not that
its contents are accurate or complete. That is the honest limit of this check,
and the reason everything mechanically detectable stays a scanner instead.

The marker is pre-populated in `.github/pull_request_template.md` so PR
authors don't have to remember it. Removing the marker from a PR body
produces a warning, not a failure — but the section is still expected, and it is
read by the owner and by the review session.

The gate skips silently on `push` events (no `PR_NUMBER` in scope), so
direct pushes to `main` (e.g., admin-bypass cleanup work) do not trip it.
This is intentional: the marker is meaningful only in the PR review flow
that branch protection enforces.

## Local equivalents

Every CI gate runs locally with the same command CI uses. The common loops:

```bash
# Run all 7 rule scanners.
npm run rules:check

# Run a single scanner in isolation.
npm run lint   # poolmaster/no-mocked-api
npm run rules:check:route-discipline
# ...etc.

# Run the OpenAPI freshness check.
npm run api:check

# Fix a stale generated SDK.
npm run api:refresh

# Run lint and typecheck (the existing gates).
npm run lint
npm run typecheck
```

Each rule scanner accepts a `--warn-only` flag for local debugging when you
want to see findings without a non-zero exit. CI passes `--warn-only` to the
six warn-only scanners by default; the two blocking gates do not accept the
flag.

The shell wrappers under `scripts/check-*.sh` exist for environments that
cannot call `node` directly. They forward arguments to the corresponding
`.mjs` and are functionally identical.

The review-triggers gate (`rules:check:pr-review-triggers`) skips silently when
no `PR_NUMBER` is provided — it has no useful local invocation outside of
CI. To test it locally against a real PR:

```bash
PR_NUMBER=42 node scripts/check-pr-review-triggers.mjs
```

## Failure remediation

| Gate | Failure means | Fix |
|---|---|---|
| `poolmaster/no-mocked-api` via `npm run lint` (**block**) | A test added a module-level mock of the generated API. | Replace `vi.mock('@/lib/api', ...)` with MSW handlers under a shared test-handler module. See `rules/testing-rules.md §5` and the `pool-master-rop.4` cleanup defect. |
| `rules:check:route-discipline` (warn) | A route or handler file violates `service-rules.md §10`. | Pull `prisma.*` calls into a service. Move inline `.map((...))` shaping into `packages/core-api/src/mappers/<module>.mapper.ts`. Replace `additionalProperties: true` with `zodToJsonSchema(SomeSchema)`. |
| `rules:check:route-authorization` (**block**) | A by-id route authorizes nowhere a reader can see, or an opt-out entry is stale or has no reason. | Declare the gate as a `preHandler` (`requireMemberOfLeague`, `requireCommissionerForContest`, ...). If the route genuinely authorizes in its handler or service, add it to `scripts/route-authorization-opt-outs.mjs` with a one-line reason naming the function that does it. See `rules/service-rules.md` §3 *Route Authorization*. |
| `poolmaster/no-disabled-tests` via `npm run lint` (**block**) | A test was disabled. There is no exempting comment. | Either fix the test, or delete it and note the coverage gap in the slice's closing comment. |
| `poolmaster/no-bare-ui-controls` via `npm run lint` (**block**) | A new bare `<button>`, `<input>`, or `<textarea>` was introduced outside `features/shared/ui/`. | Use the shared `Button` / `FormField` / `Input` / `Textarea` components. See `rules/react-ui-rules.md §5A`. |
| `rules:check:form-query-mirror` (warn) | A `useEffect` reads from a query result and calls `setState`. | Refactor to seed form defaults at modal-open time using React Hook Form `defaultValues` plus a `key`-based reset, or pause the query while the modal is open. See `rules/react-ui-rules.md §5B`. |
| `api:check` (**block**) | The committed generated SDK is stale relative to the live route schemas. | Run `npm run api:refresh` and commit the regenerated `packages/shared/generated/openapi.json` and `packages/shared/generated/hey-api/` files. |
| `rules:check:plan-references` (warn) | A permanent doc cites a `plans/NN` file that is no longer in the tree, with no retrieval command near it. | Cite the content's permanent home instead; or, if the plan is cited as history, add `git show <sha>^:plans/NN-name.md` within three lines, finding `<sha>` with full history (`git log --all --diff-filter=D -- 'plans/NN-*'`). See `workflow-rules.md §0` governing rule 2. |
| `rules:check:pr-review-triggers` (warn, PRs only) | The PR body is missing the `<!-- review:triggers -->` marker. | Nothing is blocked (#284) — but edit the PR body to include the marker section anyway. The PR template pre-populates it. See `rules/workflow-rules.md §6` and `rules/review-triggers.md`. |

## Baseline counts and the ramp to fail-on-new

The six warn-only gates were intentionally landed in warn-only mode against
the existing baselines:

| Gate | Baseline at landing |
|---|---|
| No mocked API boundary | 30 |
| Route discipline | 112 |
| Test traceability | 777 |
| Unsafe casts | 38 |
| Shared UI controls | 52 |
| Form/query mirror | 19 |

Each of these baselines is the size of an existing debt class identified by
the 2026-05-02 cross-stack code review (`pool-master-rop`). The cleanup
epics under `pool-master-rop.68–.77` target these counts to zero.

Once a gate's count reaches zero (or near-zero) through cleanup, a follow-up
slice flips it from warn-only to fail-on-new, so new debt cannot land
without explicit acknowledgment. That conversion is tracked under the
rule-enforcement hardening epic (`pool-master-1y8`).

The two blocking gates (test-disable, now `poolmaster/no-disabled-tests`, and
`api:check`) had clean baselines at
landing and went straight to blocking, since they protect against debt
classes that should never be allowed to grow at all.

## Downstream jobs (unchanged by the rule-enforcement work)

For completeness, the workflow continues with these jobs after
lint-typecheck. Their behavior was not changed by the rule-enforcement
hardening epic.

- **Test suites** — `service-unit-tests`, `service-integration-tests`,
  `service-functional-api-tests`, `poolmaster-unit-tests`,
  `poolmaster-browser-e2e-local`, and
  `poolmaster-browser-e2e`. See *Test suites*
  below for each suite's purpose, runner, configuration, coverage
  policy, and CI mapping.
- **Merged coverage** — not in `ci.yml`. It is the separate `coverage.yml` workflow.
  See *Merged coverage and the coverage.yml workflow* below.
- **`service-build`** — backend service Docker build verification.
- **`mock-contest-feed-provider-build`** — mock provider Docker build
  verification.
- **`poolmaster-build`** — webapp build verification.
- **`deploy-publish-images`** (push to `main` only) — builds and pushes
  Docker images to ECR and registers ECS task definitions. Deploys nothing.
  Hands each task definition to later jobs as `family:revision`, never as an
  ARN: an ARN contains the masked AWS account id, and Actions silently drops
  any job output containing a masked value (#281).
- **`deploy-migrate-qa`** (push to `main` only) — runs the migration ECS task
  on the revision this run registered and prints its CloudWatch logs, pass or
  fail, via `scripts/ecs-task-wait-and-print-logs.mjs`. A missing task
  definition, missing network secrets, or a task ECS would not start fails the
  job; none of them is a skip.
- **`deploy-qa`** (push to `main` only) — rolls this run's task definitions out
  to the QA services and fails if either value is missing. It then asserts
  that the core-api service and its PRIMARY deployment are on that revision,
  requires `desiredCount >= 1` before waiting for stabilization (a zero-task
  service is trivially stable), waits (dumping diagnostics on failure), and
  asserts again that the rollout `COMPLETED` on that revision, so a
  circuit-breaker rollback fails the job. Then it syncs the webapp to S3 and
  invalidates CloudFront.
- **`deploy-health-issue`** (push to `main` only) — opens, comments on, or
  closes the "QA deploy is failing on main" issue from the deploy jobs'
  results.
- The `all-contract-gates` job also runs `npm run test:scripts`: the
  `node --test` suites for the deploy and migration scripts.

## Test suites

Five distinct test suites cover the codebase. Each has its own runner,
configuration, scope, and CI mapping. The suites are layered: unit
tests cover service logic in isolation, integration tests exercise
real database interactions, functional API tests verify the full
backend stack through the generated SDK, webapp unit tests cover React
components and hooks, and browser E2E tests verify the deployed
release.

### 1. Backend unit (`tests/unit/**/*.test.ts`)

- **Runner:** Jest with `ts-jest`.
- **Config:** [`tests/jest.config.js`](../tests/jest.config.js).
- **Environment:** Node (no DB, no Fastify server). Pure function tests against service classes, mappers, helpers, scoring math.
- **Test count today:** ~62 files.
- **Local commands:**
  - `npm run test:service:unit` (or `npm test`) — run the suite
  - `npm run test:coverage:service:unit` — run with coverage
- **CI job:** `service-unit-tests` (no database). Runs `npm run test:coverage:service:unit` with Jest's default Babel coverage provider; the coverage threshold below fails the job, and it is the only coverage gate in CI.
- **Required pre-push gate:** `npx jest --config tests/jest.config.js --forceExit` (per `AGENTS.md` Quality Gates).
- **Coverage policy:** **Threshold configured at the suite level** — `coverageThreshold.global` in `tests/jest.config.js`: 24% statements, 14.2% branches, 21.15% functions, 24.53% lines. These are floor values from the rule-enforcement epic baseline, not aspirational targets — they exist to prevent regression while real coverage targets are set per-feature.
- **Database:** none. Pure unit tests must not touch Postgres; if a test needs a DB, it belongs in the integration suite.

### 2. Backend integration (`tests/integration/**/*.integration.ts`)

- **Runner:** Jest with `ts-jest`.
- **Config:** [`tests/integration/jest.config.js`](../tests/integration/jest.config.js).
- **Environment:** Node + a real Postgres test database (`poolmaster_test`). Tests typically use Fastify's `app.inject` to drive routes end-to-end through Prisma into Postgres without an HTTP listener.
- **Test count today:** ~17 files.
- **Concurrency:** `maxWorkers: 1` (serial). Tests share a database; running in parallel would corrupt fixtures.
- **Test timeout:** 30s.
- **Local commands:**
  - `npm run test:service:integration` — run the suite (requires `DATABASE_URL` and a fresh DB)
  - `npm run test:service:integration:fresh` — reset DB then run
  - `npm run test:coverage:service:integration` — coverage variant
- **CI job:** `service-integration-tests` (its own Postgres service container). Runs `npm run test:service:integration` with no coverage (#302).
- **Required pre-push gate:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:service:integration`.
- **Coverage policy:** **No threshold** in `tests/integration/jest.config.js`, and no coverage in CI. Integration coverage is collected only for the merged report in `coverage.yml`.
- **Database setup:** `npm run db:test:reset` recreates the test DB; `npm run db:test:migrate` applies migrations. `db:test:recreate` is the canonical pre-run reset.

### 3. Backend functional API / FAPI (`tests/functional/**/*.functional.ts`)

- **Runner:** Jest with `ts-jest` (custom config).
- **Config:** [`tests/functional/jest.config.js`](../tests/functional/jest.config.js).
- **Environment:** Node + real Postgres + real Fastify server bound to a port + the **generated SDK from `@poolmaster/shared`** as the test client. Each test exercises a full user-facing flow through the SDK exactly the way the React app does.
- **Test count today:** ~10 files.
- **Concurrency:** `maxWorkers: 1` (serial); shared DB and shared port.
- **Test timeout:** 30s.
- **Setup hooks:** `globalSetup` (`tests/functional/global-setup.cjs`) starts the Fastify server; `globalTeardown` shuts it down. The custom runner `scripts/run-service-functional-api.mjs` orchestrates this.
- **Why this layer matters:** This is the only suite that runs the **full request → SDK → router → service → mapper → DTO → DB stack** and is therefore the load-bearing test for contract correctness. Routes, mappers, generated SDK, OpenAPI spec, and DTOs all have to be in sync for FAPI tests to pass — making it the de facto contract verification gate.
- **Local commands:**
  - `npm run test:service:functional-api` — run the suite (requires `DATABASE_URL`)
  - `npm run test:service:functional-api:fresh` — reset DB then run
  - `npm run test:coverage:service:functional-api` — coverage variant
- **CI job:** `service-functional-api-tests` (its own Postgres service container). Runs `npm run test:service:functional-api` with no coverage (#302).
- **Required pre-push gate:** `DATABASE_URL=... npm run test:service:functional-api` (per `AGENTS.md` Quality Gates).
- **Coverage policy:** No threshold, and no coverage in CI. FAPI coverage is collected only for the merged report in `coverage.yml`.

### 4. Webapp unit (`clients/poolmaster/src/**/*.test.{ts,tsx}`)

- **Runner:** Vitest with `@vitejs/plugin-react`.
- **Config:** [`clients/poolmaster/vitest.config.ts`](../clients/poolmaster/vitest.config.ts).
- **Environment:** jsdom. React Testing Library renders components; tests assert behavior via DOM queries and `data-testid` selectors.
- **Test count today:** ~92 files / ~283 tests.
- **Setup file:** `src/test-setup.ts` (jsdom polyfills, MSW setup if/when adopted, etc.).
- **Local commands:**
  - `npm run test:poolmaster:unit` — run the suite
  - `npm run test:coverage:poolmaster:unit` — run with coverage (v8 provider, lcov + json-summary reporters)
- **CI job:** `poolmaster-unit-tests` (uploads `coverage-webapp-unit` artifact).
- **Required pre-push gate:** `npm run test:poolmaster:unit` (per `AGENTS.md` Quality Gates).
- **Coverage policy:** **No threshold configured** in `vitest.config.ts`. Coverage is reported but not gated. (Flagged during the rop.19 review; future work to set per-feature thresholds will need to add a `coverage.thresholds` block.)
- **Known anti-pattern this suite has accumulated:** `vi.mock('@/lib/api')` at module level in 30+ tests — see `pool-master-rop.4`. The intent is for this suite to use **MSW** for HTTP boundary mocking instead of replacing the SDK; the migration is tracked in epic `pool-master-rop.71`.

### 5. Webapp browser E2E (`clients/poolmaster/e2e/**/*.e2e.ts`)

- **Runner:** Playwright (Chromium project).
- **Config:** [`clients/poolmaster/playwright.config.ts`](../clients/poolmaster/playwright.config.ts).
- **One spec set, selected by tag.** Specs that run against a deployed environment carry `{ tag: '@smoke' }`; everything else runs pre-merge only. Never two copies of a spec. A tagged spec must be safe against QA's persistent database by construction: run-unique names, teardown of every attempt, and assertions on the presence of what the run created — never the absence or count of what it did not, which passes on an empty local database and fails on QA forever.
  - `guards.e2e.ts` (`@smoke`) — the unauthenticated surface: protected member and root-admin routes redirect to sign-in, bad credentials surface `auth-server-error`, an unknown invite code surfaces `auth-invite-preview-error`, an unknown path renders `not-found-page`. No credentials, no data. Post-deploy, the not-found case also proves CloudFront's SPA rewrite.
  - `smoke.e2e.ts` (`@smoke`) — root admin signs in, reaches `/manage`, logs out. Creates no domain data.
  - `golden-journey.e2e.ts` — one `test()` per act in a serial file (`test.describe.configure({ mode: 'serial' })`), so the report names the failing act in the test title and the failing stage in its steps, act 1's ids reach the later acts through module state, and a failure skips the acts after it. Tags select tests, not steps, so acts 1–3 sit in a describe tagged `@smoke` and act 4 sits outside it, untagged — a test inside a tagged block cannot drop the tag. A retry re-runs the whole file in a fresh worker with a fresh run id.
    - Act 1 (`@smoke`): the root admin walks the manage list pages, then creates a run-named golf tour, six players and a tournament on that tour in its start year (released already, locking at its start, so it is contest-eligible), loads the six into the field and places one in each default tier.
    - Act 2 (`@smoke`): a fresh commissioner registers, creates a run-named league, creates a contest on act 1's tournament (roster 6, counted 4, one entry per team), confirms it on the board and the league's contest list, edits the league description, and generates the join URL.
    - Act 3 (`@smoke`): a fresh member opens the join URL signed out, registers through the invite, names a squad, picks an icon, accepts, builds an entry with one golfer from each of the six tiers plus the tiebreaker, and submits; then renames the entry, changes a preference and opens the league history page. The invite **link** is the only member-join flow that completes post-deploy: QA's SES has no inbox the suite can read.
    - Act 4 (untagged, pre-merge only): the root admin bulk-loads round-1 scores, moves the tournament to `IN_PROGRESS`, checks the member's picks are revealed on the board and scored on the golf leaderboard endpoint, and finds the new league and both new users in `/manage`. The transition activates the contest and sends its members the contest-started email, which is why it is not tagged.
    - Acts 1–3 **write to QA on every main push**. `afterAll` removes every attempt's data through the API with the admin token, in dependency order: the league (with its contest, entry, squads, memberships and invite link), the tournament (with field, rounds, scores and tiers), then the tour and players — inactivated, because neither has a delete operation — then both users. Each run therefore leaves one inactive tour, one `event_series` row and six inactive players behind, all named with the run id.
- **Credentials:** `POOLMASTER_E2E_ADMIN_PASSWORD` (required, no default — a missing value fails the spec immediately) and `POOLMASTER_E2E_ADMIN_IDENTIFIER` (defaults to the admin username). Users the suite registers get `@e2e.invalid` addresses.
- **Concurrency:** `fullyParallel: true`, except `golden-journey.e2e.ts`, whose acts run serially in one worker because each consumes the one before it. No spec shares data with another; every name a run creates carries a run id computed inside the test body.
- **Retries:** 1 in CI, 0 locally.
- **Artifacts on failure:** trace, screenshot, video, in both jobs. A trace records every `fill()` value and request and response body, so the config's `globalTeardown` (`e2e/redact-artifacts.ts`) scrubs usernames, email addresses, passwords and session tokens out of everything in `test-results/` before the HTML reporter copies it. It is a denylist: text is redacted, recognised media is kept, and anything else — or a trace it cannot rewrite — is deleted rather than kept. It cannot scrub pixels: screenshots, video and the trace's filmstrip still show what was typed into the identifier field (password fields render masked).
- **Local commands:**
  - `npm run test:poolmaster:browser-e2e` — run every spec
  - `npm run test:poolmaster:browser-e2e:smoke` — run only `@smoke`
  - `npm run test:poolmaster:browser-e2e:list` — list tests without running
- **Running against a local stack:** start Postgres, migrate, seed a root admin with `packages/core-api/scripts/bootstrap-users.mjs` (`FIXTURE_JSON` you compose), `npm run build:poolmaster`, start core-api on port 3000, then `npx vite preview` in `clients/poolmaster` — it serves the production build on port 4175 and proxies `/api` to core-api. Insert the `GOLF` row into `sports` (the journey reads it by name, and only provider ingestion creates it; the CI job's seed step has the statement). The contest configuration templates the contest form offers come from migrations, so they need no seed — and the form can create a contest without one. Set `POOLMASTER_E2E_BASE_URL=http://localhost:4175` plus the two admin variables. The `poolmaster-browser-e2e-local` job in `ci.yml` is the reference sequence.
- **CI jobs:**
  - `poolmaster-browser-e2e-local` — every PR and every main push. All specs against the local stack above on a throwaway Postgres; seeds its own admin with a password generated for the run, so it needs no secrets, no AWS and no deploy.
  - `poolmaster-browser-e2e` — push-to-main only, after `deploy-qa` succeeds. `@smoke` only, against the deployed QA frontend at `qa.ultimateofficepoolmanager.com`. Reads the `POOLMASTER_E2E_ADMIN_IDENTIFIER` and `POOLMASTER_E2E_ADMIN_PASSWORD` repository secrets.
- **Required pre-push gate:** none. E2E is a **CI-only** signal; per `AGENTS.md` Quality Gates, browser E2E falls under "CI-only follow-up signals" and isn't required pre-push.
- **Coverage policy:** N/A. E2E doesn't produce coverage artifacts.

### Merged coverage and the coverage.yml workflow

- **`.github/workflows/coverage.yml`** runs on demand only, from the Actions tab ("Run workflow", any branch). It runs `npm run test:coverage:service:merged`, writes per-suite and merged tables to the step summary, and uploads `coverage-service-report`, which includes the merged HTML report. It gates nothing. Use it to find where a suite needs more tests (#302).
- **`test:coverage:service:merged`** (`scripts/run-backend-coverage.mjs`) runs all three backend suites with coverage, one after another, then merges them into `coverage/service-merged/`. The workflow and a local run use the same command.
- **`scripts/merge-service-coverage.mjs`** is the merge on its own. It runs no tests: it takes the per-suite `coverage-final.json` files, merges whichever exist, and warns about any that are missing.
- **Why merged matters:** the same source file is often partly covered by a unit test (logic correctness) and partly by an integration test (real-DB behavior). Merging gives an honest count of "how much of this file is exercised by *any* test."
- **One coverage method within a merge (#296).** The FAPI server runs out of process under ts-node, so only V8 coverage can see it; the FAPI runner converts that coverage with `v8-to-istanbul` through each module's cached source map. For the merge to add up, the Jest suites must count the same way, so `run-backend-coverage.mjs` passes `--coverageProvider=v8` to unit and integration. Mixing Babel-instrumented statements with V8 per-line statements double-counts: the two maps share almost no locations, so the merge unions them. V8 counts per line, so comment and type-only lines inside an executed module count as covered, and merged percentages run higher than Babel's.
- **Why V8 is not the default.** On a 4-vCPU runner, V8 coverage took unit from 12s (no coverage) to 49s and integration from 168s to 403s; Babel took them to 19s and 174s. So `tests/jest.config.js` and `tests/integration/jest.config.js` leave the provider at Jest's default (Babel), and V8 is used only where a merge needs it (#302).

### Coverage thresholds — current state and roadmap

| Suite | Threshold today | Source of truth |
|---|---|---|
| Backend unit | 24% / 14.2% / 21.15% / 24.53% (stmts / branches / fns / lines) | `tests/jest.config.js` |
| Backend integration | none | — |
| Backend FAPI | none | — |
| Webapp unit | none | — |
| Webapp E2E | N/A | — |

The single configured threshold is intentionally a **regression floor**, not a target. It is measured with Babel statement counts, the method it was set against (#302). Real per-feature coverage targets are tracked in the rule-enforcement epic follow-ups; pages and modules touched by the q8h frontend rule hardening epic will gain explicit thresholds as part of that work. Until then, slice authors should aim for ≥ 80% statements on touched files but the suite-level gate stays at the floor.

## File reference

```
.github/workflows/ci.yml             — workflow definition
package.json                         — npm script wiring (rules:check chain, api:check)
scripts/rule-check-utils.mjs         — shared file-walk + reporting helpers
eslint-rules/no-mocked-api.mjs       — gate 1 (migrated from scripts/)
scripts/check-route-discipline.mjs   — gate 2
scripts/check-route-authorization.mjs — gate 2a, with its opt-out list in
                                        scripts/route-authorization-opt-outs.mjs
eslint-rules/no-disabled-tests.mjs — gate 3 (migrated from scripts/)
eslint-rules/no-bare-ui-controls.mjs — gate 4 (migrated from scripts/)
scripts/check-form-query-mirror.mjs  — gate 5
scripts/check-openapi-fresh.mjs      — gate 6
scripts/check-plan-references.mjs    — plan references (warn-only, #147)
scripts/check-pr-review-triggers.mjs    — review triggers gate (PRs only)
packages/core-api/scripts/export-openapi.ts — Fastify→OpenAPI export
                                              used by api:check and api:refresh
```

Each `.mjs` has a `.sh` shell wrapper alongside it for environments that
cannot invoke `node` directly. The wrappers are interchangeable.

## Related rules

- `rules/architecture-rules.md §2` — contract-first architecture (the basis
  for the `api:check` freshness gate)
- `rules/service-rules.md §10` — pre-commit self-review (the basis for the
  route-discipline gate)
- `rules/testing-rules.md §1A` — test self-documentation (the basis for the
  traceability gate)
- `rules/testing-rules.md §1B` — forbidden application-code patterns
- `rules/testing-rules.md §1C` — test-disable discipline (the basis for the
  test-disable gate)
- `rules/react-ui-rules.md §5A` — shared-component adoption (the basis for
  the shared-UI-controls gate)
- `rules/react-ui-rules.md §5B` — server-data form-state hazard (the basis
  for the form/query-mirror gate)
- `rules/react-ui-rules.md §7` — banned test patterns (the basis for the
  no-mocked-API gate)
- `plans/115-rule-enforcement-hardening.md` — full root-cause analysis and
  rationale for the gate rollout. **Deleted in commit `34ce656f`** (PR #3)
  per `workflow-rules.md §0` once epic `pool-master-1y8` closed at 25/25.
  Retrieve via `git show 34ce656f^:plans/115-rule-enforcement-hardening.md`
  if needed.
