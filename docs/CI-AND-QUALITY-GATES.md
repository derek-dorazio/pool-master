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

The concurrency group is `ci-${{ github.ref }}`, so runs on the same ref never
overlap: at most one run per group is in progress, and a newer run on the same
ref waits as `pending` until the in-flight one finishes.

**Cancellation of the superseded run is asymmetric, and deliberately so** —
`cancel-in-progress` is `${{ github.event_name == 'pull_request' }}`, so it is
on for pull requests and off for `main` (#328). On a pull request a new push
supersedes the old run and nobody is waiting on the old run's artifacts, so
cancelling saves a cycle. On `main` every run is a release: it publishes images,
migrates QA and rolls the release out. Cancelling that chain does not stop the
ECS task it was waiting on — it only stops watching — so what gets destroyed is
the deploy's own record of what happened, and `deploy-qa` cancelled after
`deploy-migrate-qa` is the one window where QA's schema is new and its running
image is old. So `main` runs queue instead, and its deploys serialise in merge
order rather than the newer merge killing the older one's rollout.

One run per group can be `pending`, so a third merge arriving while the first is
still deploying replaces the queued second one rather than lining up behind it.
Nothing in flight is lost and the replaced commit still ships in the run that
does go out — only that commit's own `main` verdict does not happen.

`qa-reset.yml` keeps an unconditional `cancel-in-progress: true`, which is
correct for the opposite reason: there, nothing in flight needs protecting. A
dispatch waiting on its environment approval has done no work yet, and the
hazard is that it stays approvable indefinitely, so a second dispatch must
disarm the first. See *Resetting the QA database* below.

The deploy stages (`deploy-publish-images`, `deploy-migrate-qa`, `deploy-qa`,
`poolmaster-browser-e2e`, `deploy-health-issue`) are gated to push events on
`main` only — they do not run for pull requests.

### Why the gated jobs carry `!cancelled()`

A path-filter job called `changes` classifies which areas a pull request touches,
and eight jobs read its outputs. Their conditions all begin with `!cancelled() &&
needs.all-contract-gates.result == 'success'`, which looks redundant and is not
(#350).

GitHub skips a job whose `needs:` did not succeed **unless** its `if` uses a
status check function. `changes` can be cancelled before it starts — twice on
2026-10-05 it waited 15 minutes without being assigned a runner while siblings in
the same run got one immediately — and without a status function that skipped all
eight gated jobs and, transitively, the entire deploy chain. The run reported
`failure` having tested nothing and deployed nothing, which reads like a test
failure rather than a pipeline that did not run.

On a push to `main` the path filter is never consulted: every condition
short-circuits on `github.event_name != 'pull_request'`, and
`ci-changed-areas.mjs` with no file list reports *"no file list; running
everything"*. So gating main on `changes` bought nothing. The explicit
`needs.all-contract-gates.result == 'success'` keeps the contract gates blocking,
so this is deliberately **not** `always()`.

### Job timeouts

Every job sets `timeout-minutes`. GitHub's default is six hours, and on 2026-10-06 a
pull request's `all-contract-gates` hung from 23:29 to 05:30, holding that PR's verdict
all night. Each limit is about three times the job's longest run across 80 recent runs,
with a ten-minute floor:

| Job | Usual | Limit |
|---|---|---|
| `changes`, `all-contract-gates`, `service-lint-typecheck`, `service-unit-tests`, `schema-migration-drift`, `service-build`, `service-mock-provider-build`, health-issue jobs | under 2 min | 10 |
| `poolmaster-unit-tests` | 2 min | 15 |
| `service-image-smoke` | not yet measured | 15 |
| `service-integration-tests (1/2)`, `(2/2)` shards, `service-functional-api-tests` | 2.5–4 min | 20 |
| `poolmaster-browser-e2e-local` | 4–9 min | 25 |
| `poolmaster-build` | 1–12 min | 30 |
| `deploy-publish-images` | 4–5 min | 20 |
| `deploy-migrate-qa` | 1.5 min (its ECS wait is capped at 10) | 30 |
| `deploy-qa` | 4–11 min (two ECS stability waits, up to 10 each) | 45 |
| `poolmaster-browser-e2e` | 1.5–3.5 min | 20 (its Playwright install may use 12) |

A timed-out job is cancelled, so the jobs that need it skip and the run fails rather than
hanging. The deploy limits are deliberately wide: stopping `deploy-qa` mid-rollout leaves
QA in the state the concurrency section above warns about. When a job's normal time grows,
raise its limit rather than removing it.

The Playwright Chromium install in both browser E2E jobs also has a step limit, because it
depends on Ubuntu's apt mirrors: on 2026-10-07 it hung four times and each hang used the
whole 25-minute job limit (#470). `scripts/ci-install-playwright-chromium.sh` gives apt
network timeouts and bounds each attempt at three minutes, retrying twice, against a usual
time of about 35 seconds, and the whole script stops after 11 minutes so it ends inside the
step's 12. `timeout` stops `npx` but not the `apt-get` it started under `sudo`, which keeps
the dpkg lock; before retrying, the script waits for that `apt-get` to finish (its downloads
still count), and stops it only when time is running out. Every step, including the
`dpkg --configure -a` repair, has its own limit, so the 11 minutes is a hard cap. The browser download is cached per
Playwright version, so only the system packages still come from the mirror.

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
        - schema-migration-drift
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
  "required_status_checks": ["all-contract-gates", "changes", "service-lint-typecheck", "service-unit-tests", "service-integration-tests", "service-functional-api-tests", "schema-migration-drift", "poolmaster-unit-tests", "service-build", "service-mock-provider-build", "poolmaster-build"],
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
  CH --> SD
  CG --> LT[service-lint-typecheck]
  CG --> SU[service-unit-tests]
  CG --> SI[service-integration-tests]
  CG --> SF[service-functional-api-tests]
  CG --> SD[schema-migration-drift]
  CG --> PU[poolmaster-unit-tests]
  CG --> PB[poolmaster-build]
  CG --> EL[poolmaster-browser-e2e-local]
  LT --> SB[service-build]
  LT --> MB[service-mock-provider-build]
  LT --> IS[service-image-smoke]

  SU --> PI[deploy-publish-images]
  SI --> PI
  SF --> PI
  LT --> PI
  PU --> PI
  SB --> PI
  IS --> PI
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
  class SD gate
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

`schema-migration-drift` is a gate rather than a suite, and it is deliberately its
own job (#340). It builds an empty database, applies the committed migration
history to it, and diffs the result against `prisma/schema.prisma`. Folded into one
of the suites, its failure would read as "the integration tests broke" when what it
actually means is that two committed artifacts disagree about the shape of the
database — a different problem with a different fix. It reuses the same
`postgres:16` service the suites use, needs no generated Prisma client, and the
whole history applies in about three seconds.

It is not in the `deploy-publish-images` dependency list. Drift does not break a
deploy: QA is built from the migrations, so it gets the real schema either way. What
drift breaks is anyone who *generates* from `schema.prisma` — above all a history
squash (#88) — which is why the gate blocks the pull request that would introduce it
rather than the deploy that would carry it.

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
| `service` | `service-unit-tests`, `service-integration-tests`, `service-functional-api-tests`, `schema-migration-drift` |
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
| 4 | `npm run lint` | ~17s for `lint:service` in CI before `tests/` entered its glob; the webapp's own `lint:webapp` is ~33s in `poolmaster-build` | Yes |
| 5 | `npm run typecheck` | ~9s (`typecheck:service`) + ~8s (`typecheck:tests`) + ~1s (`typecheck:e2e`) in CI | Yes |

Costs re-measured 2026-10-05 from CI run 1228 rather than estimated. Lint is
type-aware, so it is dominated by building the TypeScript program, not by the
number of rules: #345 Phase 0 added eleven more type-aware rules, the
`react-refresh` plugin and four more `import-x` rules without a measurable
change in wall clock, because the program was already being built.

Adding **files** is a different matter, and #345 Phase 2 PR 1 added 120 of them.
Measured locally, same machine, back to back: `npm run lint` went from **82.1s**
(mean of 2 runs) to **92.6s** (mean of 3), **+10.5s / +13%**. The whole of that
lands on `lint:service`, which is where `tests/**` was added; `lint:webapp` is
untouched. The cost is on the critical path: four jobs declare
`service-lint-typecheck` in `needs:` — `service-build`,
`service-mock-provider-build`, `deploy-publish-images` and
`main-ci-health-issue` — counted from `ci.yml` rather than carried over from
#345, which cites five on #160's older measurement. It is the price of the test
tree being linted at all; #345 Phase 0 records the incremental-program options
considered for clawing it back.

Note that `npm run lint` and `npm run typecheck` each build that program, in
separate processes. This is not deduplicable: ESLint's `projectService` builds
its program inside the ESLint process, and there is no way to hand it to a
separate `tsc`. See *What `npm run lint` enforces* below for what was measured
and declined.

## What `npm run lint` enforces, and over what

### Scope

`npm run lint` globs `packages/**/*.ts`, `tests/**/*.{ts,tsx}`,
`clients/poolmaster/src/**/*.{ts,tsx}` and the webapp's build-tool configs
`clients/poolmaster/*.config.ts`. It is ESLint alone: the last standalone
scanner, `scripts/check-feature-theme-tokens.mjs`, became
`poolmaster/no-raw-theme-colors` in #524. `lint:service` (which carries
`packages/` **and** `tests/`) and `lint:webapp` are the two halves, run by
different CI jobs — `npm run lint` itself is a local convenience and is not what
CI invokes, so a glob added to one and not the other is linted locally and not
in CI.

**There is one ESLint config.** `tests/` joined the glob in #345 Phase 2 PR 1,
and `eslint.tests.config.mjs` — a second flat config that ran the single
`poolmaster/no-disabled-tests` rule over `tests/` with a parser but no type
information, wired as `rules:check:test-disable` — was deleted with it. That
rule now reaches `tests/` through `eslint.config.js` like every other rule, with
type information it never had, so the separate `rules:check` entry would have
run a second ESLint over the same files to re-check what `lint` already blocks
on; it was dropped from the chain rather than kept as a duplicate.

The ordering mattered and is worth recording. The same rule set that reports
**0 findings** over the production scope reports **1476** across 64 of the 120
files in `tests/` — the same rules over different file sets. #345 adopted the zero-finding rule set first
(Phases 0 and 1, #348) so the cheapest win in the programme did not arrive
carrying the test tree's backlog, and only then widened the glob.

Widening it on day one is what makes the rest enforceable: the remaining backlog
lives as an **explicit exemption list** in `eslint.config.js`, scoped to
`tests/**`, and each later PR in #345 Phase 2 is defined by the lines it deletes
from that list. CI holds the line in between. The alternative — holding the glob
shut until the backlog cleared, or landing the rules at `warn` — would have
tracked the same debt in a document instead of in the build.

The list is one permanent carve-out and seven scheduled ones:

| Rule | Findings | Status |
|---|---:|---|
| `@typescript-eslint/unbound-method` | 185 | **Permanent.** `expect(obj.method).toHaveBeenCalled()` is an assertion idiom; the rule is about losing `this` in production code, and the method is never invoked unbound |
| `@typescript-eslint/require-await` | 181 | Temporary — #345 Phase 2 PR 2 |
| `@typescript-eslint/no-unsafe-call` | 27 | Temporary — #345 Phase 2 PR 2 |
| `@typescript-eslint/no-unsafe-return` | 43 | Temporary — #345 Phase 2 PR 2 |
| `@typescript-eslint/no-explicit-any` | 171 | Temporary — #345 Phase 2 PR 3 |
| `@typescript-eslint/no-unsafe-assignment` | 323 | Temporary — #345 Phase 2 PR 4 |
| `@typescript-eslint/no-unsafe-member-access` | 279 | Temporary — #345 Phase 2 PR 4 |
| `@typescript-eslint/no-unsafe-argument` | 201 | Temporary — #345 Phase 2 PR 4 |

Each entry in `eslint.config.js` names its owning PR; the reasoning for the
permanent one, and for `require-await` being scheduled rather than fixed in
PR 1, is written at the exemption itself rather than here.

Build-tool configs sit outside their package's `tsconfig.json` on purpose: the
webapp's `{vite,vitest,tailwind}.config.ts` run in Node, not the browser, and
the two `openapi-ts.config.ts` codegen configs must stay out of `dist`. Each
has its own program instead — `clients/poolmaster/tsconfig.node.json`,
`packages/shared/tsconfig.node.json` and
`packages/mock-contest-feed-provider/tsconfig.node.json`, with
`playwright.config.ts` in `tsconfig.e2e.json` — and each package's `typecheck`
script runs it. `projectService` only finds the nearest `tsconfig.json`, so
`eslint.config.js` names those programs with `parserOptions.project` for these
files; without that they are a hard parse error rather than a finding (#524).

### Type-aware rules

The parser is wired with `projectService: true` and
`tsconfigRootDir: import.meta.dirname`, which requires Node ≥ 20.11 for
`import.meta.dirname`. CI reads the Node version from `.nvmrc` (24.21.0, the
Active LTS line, since #138) and the Dockerfiles pin the same version, which
satisfies that requirement.

The base preset is `typescript-eslint`'s `strictTypeChecked` (#525). At its
own options it measured 1,254 findings; `eslint.config.js` records, rule by
rule, the overrides that made it adoptable. Two option changes removed most of
them: arrow shorthand is allowed to return a void call, and numbers are allowed
in template literals. Four rules are off. `return-await` is off because Fastify's
reply is thenable, and `no-dynamic-delete` is off because every finding is a real
dictionary. `no-non-null-assertion` (#549) and `no-unnecessary-condition` (#550)
are deferred to their own tickets. The comment beside each says why. Lint time is
unchanged (117 s against 116 s on `recommendedTypeChecked`).

Five more type-aware rules sit outside every preset and are listed individually,
from #345 Phase 0's survey of rules at 0 findings on default options.

### tsconfig strictness

`tsconfig.base.json` sets `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`noImplicitOverride`, `noUnusedLocals` and `noUnusedParameters` alongside
`strict`. `clients/poolmaster/tsconfig.json` and `tsconfig.e2e.json` do **not**
extend the base, so they repeat the five.

`noUnusedLocals`/`noUnusedParameters` largely duplicate
`@typescript-eslint/no-unused-vars`. Their value is reaching `tests/`, which tsc
sees via `tests/tsconfig.json` and ESLint does not: 14 of the 16
`noUnusedLocals` findings were there.

Two traps worth keeping recorded:

- `noUnusedParameters` does not honour the ESLint rule's `argsIgnorePattern`. It
  keys off a leading underscore as a built-in convention, which happens to agree
  with the configured `^_`.
- That underscore convention does **not** cover an unused constructor *parameter
  property* (`private readonly x`), which is TS6138 under `noUnusedLocals`.
  Dropping the modifier is the fix; renaming is not.

### Prettier is configured but is not a gate

`.prettierrc` and `.prettierignore` exist so that Prettier runs with this repo's
options rather than built-in defaults, and so that generated output is never
hand-formatted. Prettier does **not** run in CI, and `npm run format` has not
been run: it would rewrite 663 files under the committed config (791 with no
config at all, re-measured 2026-10-05 against #163's 1087). Whether to take that
sweep, and whether to add a `format:check` gate, are open decisions in #345
Phase 1 — not side effects of committing the config.

## The 8 gates

`npm run rules:check` is a sequential `&&` chain of seven sub-scripts.
`npm run api:check` is its own command. `npm run rules:check:pr-review-triggers`
is the eighth gate, run only on PRs. Together they are the eight quality
gates added by the rule-enforcement hardening epic (`pool-master-1y8`).

| # | Gate | Command | Mode | Baseline | What it catches | Source |
|---|---|---|---|---|---|---|
| 1 | ~~No mocked API boundary~~ | **migrated to ESLint** | blocking via `npm run lint` | 0 | `vi.mock` / `jest.mock` of `@/lib/api` or `@/lib/api-client`. Widened past the scanner, which matched `vi` only. | `eslint-rules/no-mocked-api.mjs` |
| 2 | Route discipline | `rules:check:route-discipline` | warn-only | 59 | The `service-rules.md §10` grep set: `prisma.*` calls in routes/handlers, inline `.map((`, `additionalProperties: true`, `SuccessResponse` on domain endpoints, inline JSON schemas | `scripts/check-route-discipline.mjs` |
| 3 | ~~Test-disable discipline~~ | **migrated to ESLint** | blocking via `npm run lint` | 0 | `.skip` / `.todo` / `xit` / `it.fails` / `describe.skip` / `pending()`, plus `*.skip.test.ts` files and `skipped/` dirs. The `SKIP: #NN` escape comment was **removed** — see below. | `eslint-rules/no-disabled-tests.mjs` |
| 4 | ~~Shared UI controls~~ | **migrated to ESLint** | blocking via `npm run lint` | 0 | Bare `<button>`, `<input>`, `<textarea>` in `features/**` outside `features/shared/ui/`. More precise than the scanner, which also flagged controls inside comments. | `eslint-rules/no-bare-ui-controls.mjs` |
| 2a | Route authorization | `rules:check:route-authorization` | **blocking** | clean | A route whose full path has a parameter, under any mount (by-id like `/api/v1/contests` or nested like `/api/v1/leagues/:id/squads`), that declares no `preHandler`/`onRequest` hook and is not on `scripts/route-authorization-opt-outs.mjs` with a reason. Also fails a stale or reasonless opt-out. Added by #193; nested mounts since #292. | `scripts/check-route-authorization.mjs` |
| 5 | Form/query mirror | `rules:check:form-query-mirror` | warn-only | 1 | `useEffect` whose deps reference a TanStack Query result and whose body calls a `setState` (the form-overwrite-on-refetch hazard) | `scripts/check-form-query-mirror.mjs` |
| 6 | Generated API freshness | `api:check` | **blocking** | clean | Re-exports OpenAPI to a tmp dir, regenerates the hey-api SDK, diffs against committed `packages/shared/generated/`. Fails if any file is stale. | `scripts/check-openapi-fresh.mjs` |
| — | Plan references | `rules:check:plan-references` | warn-only | clean | A `plans/NN` citation in `docs/`, `rules/`, `requirements/`, `tech-specs/`, `AGENTS.md`, `CLAUDE.md`, or any `README.md` under `packages/` or `clients/` whose plan is absent from the tree and which has no `git show <sha>^:plans/NN-…` retrieval command within three lines (#147; `workflow-rules.md §0` governing rule 2). Accepted ADRs are exempt. The two source roots are scanned by file name, not walked wholesale, so build output cannot enter scope (#334). The hint's SHA is not verified — CI's shallow checkout cannot. | `scripts/check-plan-references.mjs` |
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
and **changed in policy** at the same time. It blocks through `npm run lint`
over the whole of `tests/`, `packages/` and `clients/poolmaster/src/`. Until
#345 Phase 2 PR 1 the `tests/` third of that reached it only through a separate
config and a separate `rules:check:test-disable` entry, because `tests/` was not
in the lint glob; both are gone and the coverage is unchanged. The old scanner did not ban skipped
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

## Pre-commit hook (#526)

`git commit` runs ESLint on the **staged** files that fall inside `npm run lint`'s
scope, at `--max-warnings 0`. A commit with a lint error is refused before it
reaches CI. A one-file commit takes about 11 s, which is the cost of building
type information for the files it touches. The full type-aware run takes about
two minutes, which is why the hook lints staged files only.

Three things it deliberately does not do:

- **No typecheck.** A type error in a file you didn't touch can't be found from
  staged files alone, and a whole-repo typecheck is too slow for every commit.
  CI's `lint-typecheck` job is where typecheck is enforced.
- **No Prettier.** The formatting sweep has not been taken (see *Prettier is
  configured but is not a gate* above), so formatting staged files would rewrite
  whole files you only touched in one line.
- **No substitute for the push gates.** It catches lint early; the pre-push list
  in `rules/workflow-rules.md` §3 is still the bar before a push.

How it is wired: husky points git's `core.hooksPath` at `.husky/`, and
`.husky/pre-commit` runs `lint-staged`. The globs are in `lint-staged.config.mjs`
and must match the `lint` script's scope. `npm install` and `npm ci` install the
hook through the root `prepare` script. That script skips quietly where husky is
not installed (the `--omit=dev` image stage) and where there is no `.git` (a
Docker build). Cloud agent sessions run `npm ci` at start, so their commits run
the hook too. `lint-staged` is pinned to 16.x because 17 needs Node 22.22.1, which
is newer than the cloud image's Node.

## Local equivalents

Every CI gate runs locally with the same command CI uses. The common loops:

```bash
# Run every rule scanner (the list is the rules:check script in package.json).
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

# Check that schema.prisma still describes what the migrations build (#340).
# DATABASE_URL names the server only: the check creates and drops its own
# `poolmaster_schema_drift_check` database and never touches `poolmaster_test`.
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test \
  npm run db:drift:check
```

Local service tests run against the disposable `poolmaster_test` database. When an
interrupted run leaves residue, recreate it rather than hand-editing rows:

```bash
# Empty the disposable test database and re-apply every migration (no seed).
npm run db:test:reset

# Or recreate it as part of the run.
npm run test:service:functional-api:fresh
npm run test:service:integration:fresh
```

Both work from a human shell and an agent session alike: the reset does not call
`prisma migrate reset`, which Prisma refuses for an AI agent.

Some scanners accept a `--warn-only` flag for local debugging when you want to
see findings without a non-zero exit. Whether a scanner is warn-only in CI is
decided by its `rules:check:*` script in `package.json` — the script passes
`--warn-only` or it does not — so read it there rather than from a count here,
which drifted twice.

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
| `rules:check:route-authorization` (**block**) | A route with a path parameter authorizes nowhere a reader can see, or an opt-out entry is stale or has no reason. | Declare the gate as a `preHandler` (`requireMemberOfLeague`, `requireMemberOfSquad`, `requireCommissionerForContest`, ...). If the route genuinely authorizes in its handler or service, add it to `scripts/route-authorization-opt-outs.mjs` with a one-line reason naming the function that does it. See `rules/service-rules.md` §3 *Route Authorization*. |
| `poolmaster/no-unawaited-send-error` via `npm run lint` (**block**) | A backend `sendError(...)` is discarded (`void sendError(...)` or a bare statement), so a hook could let Fastify run the handler behind its refusal. | Write `await sendError(...)` or `return sendError(...)`. See `rules/service-rules.md` §3 *Route Authorization*. |
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
- **`service-mock-provider-build`** — mock contest feed provider lint,
  typecheck, `tsc` build and its own test suite (see *Test suites* §6).
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

## Resetting the QA database

`deploy-migrate-qa` gates the rollout, so a migration that refuses on QA data stops the
release and QA keeps serving the previous image. Prisma also records the failure and then
answers P3009 to every later deploy, so fixing the rows is not enough on its own — which is
how the Season collapse migration (#315) stopped QA deploys until the database was reset.

QA holds no data worth preserving — there is no staging or production database, and the
deployed journey creates and tears down everything it needs on every push — so a reset is
usually faster than any targeted repair:

1. **Actions -> Reset QA database -> Run workflow**, and type `reset qa` to confirm.
2. **Approve the deployment** when it pauses on the `qa-reset` environment.
3. The job prints the container's log: the rows destroyed, and a verification that the
   migration history came back clean.
4. **Re-run the latest `main` run's failed jobs**, so `deploy-qa` rolls the release out.
5. Optionally, **Actions -> Seed QA golf data -> Run workflow** to load the 2026 tournaments
   for manual league and contest testing (`docs/EVENT-SETUP-PROCEDURES.md`, *Seeded 2026
   tournaments*). A reset leaves none.

The reset wipes every row, re-applies every migration — which restores the reference data,
the GOLF `sports` row and the contest config templates — and runs `bootstrap-users.mjs` for
the root admin. `rules/architecture-rules.md` §6 says which data lives where and why.

A dispatch waiting for approval stays approvable, so the workflow takes
`concurrency: cancel-in-progress` — a second dispatch cancels the older one rather than
leaving a wipe armed behind a stale notification.

A reset is the recovery path for every refused migration. `run-migrations.mjs` still carries a
registry for per-migration repair scripts, but it is empty: the three that existed were deleted
in #91, once QA could be reset instead of repaired a failure at a time. Nothing is registered,
so a failure the file cannot repair fails the migrate job loudly, and the reset above is the
answer.

## Test suites

Six distinct test suites cover the codebase. Each has its own runner,
configuration, scope, and CI mapping. The suites are layered: unit
tests cover service logic in isolation, integration tests exercise
real database interactions, functional API tests verify the full
backend stack through the generated SDK, webapp unit tests cover React
components and hooks, browser E2E tests verify the deployed
release, and the mock contest feed provider has its own suite.

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
- **Coverage policy:** **Threshold configured at the suite level** — `coverageThreshold.global` in `tests/jest.config.js`: 65% statements, 60.5% branches, 62% functions, 65% lines. These are regression floors, not aspirational targets, set in #298 about 3 points under the lower of two measurements: Babel (this job) 71.3 / 63.75 / 65.45 / 71.07, and V8 (the merged report, which reuses this config) 67.95 / 83.04 / 79.03 / 67.95.
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
- **CI job:** two shards, `service-integration-tests (1/2)` and `(2/2)`, each with its own Postgres service container, run `npm run test:integration -- --shard=k/2` with no coverage (#302, #295). Jest shards by file, so every integration file must pass whichever other files share its shard (§9A isolation). A small `service-integration-tests` job turns the two shard results into the one verdict branch protection and `deploy-publish-images` depend on; it skips when the shards skip.
- **Reproduce one shard locally:** `npm run test:integration -- --shard=1/2` (not the `test:service:integration` alias, which drops the flag: npm reads it as its own config).
- **Required pre-push gate:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:service:integration`.
- **Coverage policy:** **No threshold** in `tests/integration/jest.config.js`, and no coverage in CI. Integration coverage is collected only for the merged report in `coverage.yml`.
- **Database setup:** `npm run db:test:reset` recreates the test DB (empty schema, every migration applied); `npm run db:test:migrate` applies pending migrations only.

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
- **Environment:** jsdom. React Testing Library renders components; tests find elements by role and label (see `rules/testing-rules.md` §6 *React Testing Library Selector Rule*).
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
  - `golden-journey.e2e.ts` — one `test()` per act in a serial file (`test.describe.configure({ mode: 'serial' })`), so the report names the failing act in the test title and the failing stage in its steps, act 1's ids reach the later acts through module state, and a failure skips the acts after it. Tags select tests, not steps, so acts 1–3 sit in a describe tagged `@smoke` and acts 4–6 sit outside it, untagged — a test inside a tagged block cannot drop the tag. A retry re-runs the whole file in a fresh worker with a fresh run id.
    - Act 1 (`@smoke`): the root admin walks the manage list pages, then creates a run-named golf tour, six players and a tournament on that tour in its start year (a draft), loads the six into the field, places one in each default tier, then releases it for contests through the confirm dialog and checks the tier board is locked (#431).
    - Act 2 (`@smoke`): a fresh commissioner registers, creates a run-named league, creates a contest on act 1's tournament (roster 6, counted 4, one entry per team), which lands it on the draft's setup page; the draft takes an unchanged configuration write, the commissioner opens it to the league through the confirm dialog, and the same write is then refused with 409 `CONTEST_CONFIGURATION_LOCKED` (#117). It then confirms the contest on the board and the league's contest list, edits the league description, and generates the join URL.
    - Act 3 (`@smoke`): a fresh member opens the join URL signed out, registers through the invite, names a squad, picks an icon, accepts, builds an entry with one golfer from each of the six tiers plus the tiebreaker, and submits; then renames the entry, changes a preference and opens the league history page. The invite **link** is the only member-join flow that completes post-deploy: QA's SES has no inbox the suite can read.
    - Act 4 (untagged, pre-merge only): the root admin bulk-loads round-1 scores, moves the tournament to `IN_PROGRESS`, checks the member's picks are revealed on the board and scored on the golf leaderboard endpoint, and finds the new league and both new users in `/manage`. The transition activates the contest and sends its members the contest-started email, which is why it is not tagged.
    - Act 5 (untagged, pre-merge only): the root admin bulk-loads round 2 and then round 3, and the contest leaderboard is re-read after each upload and after two one-golfer corrections. Each read is asserted against the read before it — the entry's total, the order the field is placed in and which of its picks count all move — and the counted/dropped asymmetry of best-4-of-6 is proven both ways: a penalty on a dropped pick moves that golfer alone, the same correction on a counting pick moves the entry's total by exactly its own change. It writes scores, so it is untagged for the same reason act 4 is.
    - Act 6 (untagged, pre-merge only): the root admin loads the round that completes the card — read off the event's own schedule, not assumed — then moves the tournament to `COMPLETED`, which is what settles its contests: there is no settle operation, settlement is a consequence of the event reaching that status. The frozen standing is asserted to be the last live leaderboard read before the transition, field by field; and a late score correction moves the golfer's own event total while the settled entry's total, position and displayed position do not. It drives the event to a terminal status, so it is untagged for the reason acts 4 and 5 are, and more so.
    - Acts 1–3 **write to QA on every main push**. `afterAll` removes every attempt's data through the API with the admin token, in dependency order: the league (with its contest, entry, squads, memberships and invite link), the tournament (with field, rounds, scores and tiers), then the tour and players — inactivated, because neither has a delete operation — then both users. Each run therefore leaves one inactive tour, one `event_series` row and six inactive players behind, all named with the run id.
  - `squad-management.e2e.ts` (untagged, pre-merge only) — squad management against the real API (#363). A fresh commissioner creates a run-named league and join URL; a fresh member joins and, on My Team, renames the squad (checked on My Team and the squad list), changes its icon, and invites a co-owner by a brand-new `@e2e.invalid` address, reading the pending invite code from the response. The co-owner registers through `/team-invite/<code>` and lands on the squad as their own. The commissioner then inactivates the squad from the squad list, and the root admin deletes it from its Team Home — delete is root-admin only and requires an inactive squad. Each role keeps its own browser context, because a registered user's password is never kept. It is its own file, not a journey act, because deleting a squad deletes its contest entries. `afterAll` removes the league and the three users through the API.
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

### 6. Mock contest feed provider (`packages/mock-contest-feed-provider/src/**/*.test.ts`)

- **Runner:** Node's built-in `node --test`, with `--import tsx` for TypeScript. The glob is quoted in the package script so Node expands it, not the shell; an unquoted `**` in `sh` only matches one directory level.
- **Scope:** the mock provider's live golf simulation, scenario store, sandbox events and tour seed validation. The mock drives all live-score testing, so a regression here breaks fake-event testing everywhere downstream.
- **Environment:** Node only. No database, no built `@poolmaster/shared`.
- **Local command:** `npm test --workspace @poolmaster/mock-contest-feed-provider`
- **CI job:** `service-mock-provider-build`, after the package's lint, typecheck and build (#392).
- **Coverage policy:** none collected.

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
| Backend unit | 65% / 60.5% / 62% / 65% (stmts / branches / fns / lines) | `tests/jest.config.js` |
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
scripts/check-schema-migration-drift.mjs — schema/migration drift gate (#340),
                                          run by the schema-migration-drift job
packages/core-api/scripts/export-openapi.ts — Fastify→OpenAPI export
                                              used by api:check and api:refresh
```

Each `.mjs` has a `.sh` shell wrapper alongside it for environments that
cannot invoke `node` directly. The wrappers are interchangeable.

## Related rules

- `rules/architecture-rules.md §2` — contract-first architecture (the basis
  for the `api:check` freshness gate)
- `rules/model-change-rules.md` — *Schema And Migration History Must Agree*
  (the basis for the `schema-migration-drift` gate)
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
