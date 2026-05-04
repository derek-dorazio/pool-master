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
stages (`publish-images`, `migrate-qa`, `poolmaster-browser-e2e`) are gated to
push events on `main` only — they do not run for pull requests.

## Repository setup — branch protection

The CI gates only enforce discipline if `main` cannot be reached without going
through them. This section documents the GitHub branch-protection ruleset that
backs the workflow.

Without this configuration, direct pushes to `main` bypass every gate:
the rule-enforcement scanners, `api:check`, the Riley findings marker, and
the test/build/coverage jobs. The `rules:check:pr-riley-marker` gate
specifically becomes meaningless without enforced PR flow.

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
        - lint-and-typecheck
        - service-coverage-report
        - poolmaster-unit-tests
        - service-build
        - mock-contest-feed-provider-build
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
  "required_status_checks": ["lint-and-typecheck", "service-coverage-report", "poolmaster-unit-tests", "service-build", "mock-contest-feed-provider-build", "poolmaster-build"],
  "allowed_merge_methods": ["squash"]
}
```

If `bypass_actors` is empty and `current_user_can_bypass` is `"never"`, the
ruleset is configured strictly. If the `required_status_checks` list does
not include all six job names, the gates are partially bypassed — fix
before treating the configuration as complete.

### Why the marker gate matters here

`rules:check:pr-riley-marker` (gate 8 below) reads the PR body for a
literal `<!-- riley:findings -->` marker and fails if missing. If branch
protection does not require PRs, a contributor can bypass the marker by
direct-pushing to `main`, in which case the gate never runs. The marker
gate's value depends entirely on PR flow being enforced.

## GitHub App setup runbook (multi-pass review identities)

The multi-pass review flow defined in `rules/workflow-rules.md §6` requires
each agent runtime to act under a distinct GitHub identity so that:

- Cross-model review approvals satisfy branch protection's
  `required_approving_review_count: 1` (the implementer cannot self-approve
  per GitHub's self-review rule).
- Conversation history visibly distinguishes implementer-time work from
  review-time work.
- Different model runtimes (Claude / Codex / future) post under different
  bot identities even when running under the same operator account.

Identities are implemented as **GitHub Apps**, not bot user accounts.
Apps are GitHub's first-class automation primitive: they have their own
identity (`@<app-name>[bot]` in the UI), short-lived auto-rotated tokens,
and fine-grained per-resource permissions.

### Currently installed Apps on `derek-dorazio/pool-master`

| App | App ID | Used by | Purpose |
|---|---|---|---|
| `derek-dorazio-agent-claude` | 3589005 | Claude runtimes | Cross-model review pass when Codex implements; can also implement |
| `derek-dorazio-agent-codex` | 3589131 | Codex runtimes | Cross-model review pass when Claude implements; can also implement |

Adding a new runtime = creating a new App and following this runbook.

### Creating a new App

While logged in as `derek-dorazio` (or whichever account owns the repo):

1. Go to <https://github.com/settings/apps/new>.
2. **GitHub App name**: `<owner>-<descriptive-name>` (must be globally unique;
   appears as `@<name>[bot]` in PR conversations).
3. **Description**: optional.
4. **Homepage URL**: required field; the repo URL works
   (e.g., `https://github.com/derek-dorazio/pool-master`).
5. **Identifying and authorizing users**: leave defaults (no callback URL).
6. **Post installation**: leave defaults.
7. **Webhook**: **uncheck "Active"** — the agent calls the API directly,
   not via webhook events.
8. **Permissions** → **Repository permissions** (only these):
   - **Contents**: Read-only
   - **Metadata**: Read-only (auto-required)
   - **Pull requests**: Read and write
   - **Commit statuses**: Read-only
   - Everything else: No access.
9. **Subscribe to events**: none.
10. **Where can this GitHub App be installed?**: **Only on this account**.
11. Click **Create GitHub App**.

After creation, GitHub redirects to the App's settings page. Note the
**App ID** at the top — you'll need it.

### Generating the private key

On the App's settings page, scroll past **Client secrets** (which we don't
need — that's for OAuth user-authorization flows) to the **Private keys**
section.

1. Click **Generate a private key**. A `.pem` file downloads.
2. Move it to a gitignored, owner-only-readable location:
   ```bash
   mkdir -p ~/.config/github-apps
   mv ~/Downloads/<app-name>.<date>.private-key.pem \
      ~/.config/github-apps/<app-name>.private-key.pem
   chmod 600 ~/.config/github-apps/<app-name>.private-key.pem
   ```
3. The private key is unrecoverable if lost — you would have to generate
   a new one. Treat it like an SSH key.

### Installing the App on the repo

Still on the App's settings page:

1. Left sidebar → **Install App**.
2. Click **Install** next to your account.
3. Select **Only select repositories** → check `pool-master`.
4. Click **Install**.
5. After install, GitHub's URL becomes
   `https://github.com/settings/installations/<INSTALLATION_ID>`. Note the
   **Installation ID** — it pairs with the App ID for token minting.

You now have three pieces of identifying information per App:

```
GH_APP_ID=<numeric App ID>
GH_APP_INSTALLATION_ID=<numeric Installation ID>
GH_APP_PRIVATE_KEY_PATH=~/.config/github-apps/<app-name>.private-key.pem
```

### Wiring the App into an agent runtime

The agent's environment must export the three credentials before invoking
`gh`. The helper `scripts/get-app-installation-token.mjs` mints a fresh
installation token (~1 hour validity) from the credentials:

```bash
# At agent session start — typically owned by the harness's launch script:
export GH_APP_ID=3589005
export GH_APP_INSTALLATION_ID=129217243
export GH_APP_PRIVATE_KEY_PATH=~/.config/github-apps/derek-dorazio-agent-claude.private-key.pem
export GH_TOKEN=$(node scripts/get-app-installation-token.mjs)

# Verify the token landed under the right App identity:
gh api user --jq '.login'   # → derek-dorazio-agent-claude[bot]

# All subsequent gh / API calls now run as the App.
gh pr review <PR> --approve --body-file <findings.md>
```

For each runtime that hosts agents (Claude, Codex, future), point that
runtime's session-launch at the corresponding App's credentials. The
helper script is runtime-agnostic — it reads the same three env vars
regardless of which App they describe.

### Branch protection alignment

`required_approving_review_count: 1` is configured on the `protect-main`
ruleset. A non-author App approval (Pass 2 in the multi-pass flow)
satisfies this gate. The implementer (whether running as `derek-dorazio`
or as one of the Apps) cannot self-approve — GitHub blocks it. The
multi-App setup is what makes the gate satisfiable.

If the human merger needs to approve directly via the GitHub UI (e.g.,
the bot machinery is unavailable), admin bypass is enabled on the
ruleset and the merger can override.

### Verifying an App after setup

Quick smoke test for a new App:

```bash
GH_APP_ID=<id> \
GH_APP_INSTALLATION_ID=<id> \
GH_APP_PRIVATE_KEY_PATH=<path> \
node scripts/get-app-installation-token.mjs > /tmp/token.txt

GH_TOKEN=$(cat /tmp/token.txt) gh api /installation/repositories --jq '.repositories[].full_name'
```

Expected output: the list of repos the App is installed on
(e.g., `derek-dorazio/pool-master`). If the call fails, recheck the App
ID, Installation ID, private key path, and that the App is actually
installed on the target repo.

### Runtime credential routing — operator's responsibility

Each agent runtime (Claude Code, Codex CLI, etc.) reads `GH_TOKEN` from
env. The runbook above gives you the credentials; how they reach the
runtime is operator-configured per harness:

- Per-runtime shell profile that exports the right App's credentials
  before launching the agent
- Direnv `.envrc` keyed off the working directory or runtime
- Harness setup script that detects which runtime is launching and exports
  accordingly

This is intentionally not codified in the repo — different operators run
different harness configurations and the credential-routing strategy is
local to each one.

## Job DAG

```mermaid
flowchart TD
  T[push to main / PR to main] --> LT[lint-typecheck]

  LT --> SC[service-coverage-report]
  LT --> PU[poolmaster-unit-tests]
  LT --> SB[service-build]
  LT --> MB[mock-contest-feed-provider-build]
  LT --> PB[poolmaster-build]

  SC --> CS[coverage-summary]
  PU --> CS

  SC --> PI[publish-images]
  PU --> PI
  SB --> PI
  MB --> PI
  PB --> PI

  PI --> MQ[migrate-qa]
  MQ --> E2E[poolmaster-browser-e2e]

  classDef gate fill:#fff4e6,stroke:#d97706,stroke-width:2px
  classDef test fill:#e6f7ff,stroke:#0369a1
  classDef deploy fill:#e6ffed,stroke:#15803d
  classDef report fill:#f3f4f6,stroke:#6b7280

  class LT gate
  class SC,PU,SB,MB,PB test
  class PI,MQ,E2E deploy
  class CS report
```

The `lint-typecheck` job is the gate. Every downstream job depends on it
(`needs: lint-typecheck`). If lint-typecheck fails, nothing else runs.

The deploy track (`publish-images` → `migrate-qa` → `poolmaster-browser-e2e`)
is push-to-main-only and additionally requires all the test and build jobs to
pass.

## The lint-typecheck job

This job runs five ordered steps after install. The order matters: cheaper,
broader gates run first so a violation surfaces with the smallest possible
runtime cost.

```mermaid
flowchart LR
  I[npm ci + prisma generate + build shared] --> R[npm run rules:check]
  R --> A[npm run api:check]
  A --> M[Riley marker (PRs only)]
  M --> L[npm run lint]
  L --> TC[npm run typecheck]
```

| Step | Command | Approximate cost | Blocking? |
|---|---|---|---|
| 1 | `npm run rules:check` | ~1-2s (regex scan) | One sub-check is blocking; six are warn-only |
| 2 | `npm run api:check` | ~20-30s (re-exports OpenAPI + regenerates SDK) | Yes |
| 3 | Riley findings marker | <1s (single API call to GitHub) | Yes (PRs only) |
| 4 | `npm run lint` | ~10-20s | Yes |
| 5 | `npm run typecheck` | ~30-60s | Yes |

## The 8 gates

`npm run rules:check` is a sequential `&&` chain of seven sub-scripts.
`npm run api:check` is its own command. `npm run rules:check:pr-riley-marker`
is the eighth gate, run only on PRs. Together they are the eight quality
gates added by the rule-enforcement hardening epic (`pool-master-1y8`).

| # | Gate | Command | Mode | Baseline | What it catches | Source |
|---|---|---|---|---|---|---|
| 1 | No mocked API boundary | `rules:check:no-mocked-api` | warn-only | 30 | `vi.mock('@/lib/api')` and `vi.mock('@/lib/api-client')` in `clients/poolmaster/src` | `scripts/check-no-mocked-api.mjs` |
| 2 | Route discipline | `rules:check:route-discipline` | warn-only | 112 | The `service-rules.md §10` grep set: `prisma.*` calls in routes/handlers, inline `.map((`, `additionalProperties: true`, `SuccessSchema` on domain endpoints, inline JSON schemas | `scripts/check-route-discipline.mjs` |
| 3 | Test traceability | `rules:check:test-traceability` | warn-only | 777 | `describe(`/`it(` blocks without a `UC-`, `BR-`, `pool-master-`, or `rule:` reference within the block or two lines above | `scripts/check-test-traceability.mjs` |
| 4 | Test-disable discipline | `rules:check:test-disable` | **blocking** | 0 | `.skip` / `.todo` / `xit` / `it.fails` / `describe.skip` without a `SKIP: pool-master-NNN` comment within two lines above | `scripts/check-test-disable-discipline.mjs` |
| 5 | Unsafe casts | `rules:check:unsafe-casts` | warn-only | 38 | `as unknown as` and `as any` in production source (test directories are exempt) | `scripts/check-unsafe-casts.mjs` |
| 6 | Shared UI controls | `rules:check:shared-ui-controls` | warn-only | 52 | Bare `<button>`, `<input>`, `<textarea>` outside `clients/poolmaster/src/features/shared/ui/` | `scripts/check-shared-ui-controls.mjs` |
| 7 | Form/query mirror | `rules:check:form-query-mirror` | warn-only | 19 | `useEffect` whose deps reference a TanStack Query result and whose body calls a `setState` (the form-overwrite-on-refetch hazard) | `scripts/check-form-query-mirror.mjs` |
| 8 | Generated API freshness | `api:check` | **blocking** | clean | Re-exports OpenAPI to a tmp dir, regenerates the hey-api SDK, diffs against committed `packages/shared/generated/`. Fails if any file is stale. | `scripts/check-openapi-fresh.mjs` |
| (PR-only) | Riley findings marker | `rules:check:pr-riley-marker` | **blocking** | clean | The PR body must contain the literal HTML comment `<!-- riley:findings -->`. Documents that Riley was actually invoked. Skipped on `push` events (no PR context). | `scripts/check-pr-riley-marker.mjs` |

The six warn-only gates print findings with file:line locations and a `WARN`
prefix. They exit 0 regardless of finding count, so they do not fail the
build today. Their counts are visible in every CI run and are tracked as the
"size of debt" for the parallel cleanup epics.

The blocking gates (`test-disable`, `api:check`, and the PR-only Riley
marker) exit non-zero on any finding and fail the lint-typecheck job,
which blocks the rest of CI and any PR merge.

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

The only `rules:check` sub-script that is blocking. The reasoning: a skipped
test without a tracking issue is dead silent regression risk. Every other
debt class (mocked APIs, untraced tests, bare buttons) is cleanup that
accumulates measurably; a silently disabled test is debt that hides itself.

The pattern detected (matches `rules/testing-rules.md §1C` verbatim):

```
.skip(  .todo(  .fails(  .failing(  xit(  xtest(  xdescribe(
```

The exception that makes it pass: an adjacent comment within two lines above:

```
// SKIP: pool-master-NNN — short reason
it.skip('UC-LM-003: ...', ...)
```

Without that comment, the gate fails and the build blocks. The remediation
is either to add the SKIP comment with a real Beads story tracking the
un-skip, or to remove the disable and either fix or delete the test.

## Detail: the Riley findings marker gate

This gate runs only on `pull_request` events. It calls
`gh pr view <PR_NUMBER> --json body --jq .body` and greps for the literal
HTML comment `<!-- riley:findings -->`. If the marker is missing, the gate
fails and the PR cannot merge.

The marker is auditable proof that Riley was actually invoked for the slice.
The gate does not enforce the *content* under the marker — that's between
the implementing agent and the Riley review process. The gate just enforces
the structural requirement that the marker exists, which means the
implementing agent at least followed the workflow.

The marker is pre-populated in `.github/pull_request_template.md` so PR
authors don't have to remember it. Removing the marker from a PR body
fails the gate and blocks merge.

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
npm run rules:check:no-mocked-api
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

The Riley marker gate (`rules:check:pr-riley-marker`) skips silently when
no `PR_NUMBER` is provided — it has no useful local invocation outside of
CI. To test it locally against a real PR:

```bash
PR_NUMBER=42 node scripts/check-pr-riley-marker.mjs
```

## Failure remediation

| Gate | Failure means | Fix |
|---|---|---|
| `rules:check:no-mocked-api` (warn) | A test added a module-level mock of the generated API. Today does not block, but lands as visible debt. | Replace `vi.mock('@/lib/api', ...)` with MSW handlers under a shared test-handler module. See `rules/testing-rules.md §5` and the `pool-master-rop.4` cleanup defect. |
| `rules:check:route-discipline` (warn) | A route or handler file violates `service-rules.md §10`. | Pull `prisma.*` calls into a service. Move inline `.map((...))` shaping into `packages/core-api/src/mappers/<module>.mapper.ts`. Replace `additionalProperties: true` with `zodToJsonSchema(SomeSchema)`. |
| `rules:check:test-traceability` (warn) | A new or modified test lacks a `UC-`, `BR-`, `pool-master-`, or `rule:` reference. | Add a describe-block prefix or leading comment that references the documented use case, business rule, defect, or rule section. See `rules/testing-rules.md §1A`. |
| `rules:check:test-disable` (**block**) | A test was disabled without a `SKIP: pool-master-NNN` comment. | Either: (a) add the comment with a real Beads story tracking the un-skip, (b) remove the disable and fix the test, or (c) delete the test. |
| `rules:check:unsafe-casts` (warn) | A new `as unknown as` or out-of-test `as any` was introduced. | Replace with a properly typed signature. If a generated SDK type seems wrong, fix the backend DTO/route schema and regenerate — do not cast around it. |
| `rules:check:shared-ui-controls` (warn) | A new bare `<button>`, `<input>`, or `<textarea>` was introduced outside `features/shared/ui/`. | Use the shared `Button` / `FormField` / `Input` / `Textarea` components. See `rules/react-ui-rules.md §5A`. |
| `rules:check:form-query-mirror` (warn) | A `useEffect` reads from a query result and calls `setState`. | Refactor to seed form defaults at modal-open time using React Hook Form `defaultValues` plus a `key`-based reset, or pause the query while the modal is open. See `rules/react-ui-rules.md §5B`. |
| `api:check` (**block**) | The committed generated SDK is stale relative to the live route schemas. | Run `npm run api:refresh` and commit the regenerated `packages/shared/generated/openapi.json` and `packages/shared/generated/hey-api/` files. |
| `rules:check:pr-riley-marker` (**block**, PRs only) | The PR body is missing the `<!-- riley:findings -->` marker. | Edit the PR body to include the marker section. The PR template pre-populates it; removing it manually fails the gate. See `rules/workflow-rules.md §6` and `personas/riley.md`. |

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

The two blocking gates (`test-disable`, `api:check`) had clean baselines at
landing and went straight to blocking, since they protect against debt
classes that should never be allowed to grow at all.

## Downstream jobs (unchanged by the rule-enforcement work)

For completeness, the workflow continues with these jobs after
lint-typecheck. Their behavior was not changed by the rule-enforcement
hardening epic.

- **Test suites** — `service-coverage-report`, `poolmaster-unit-tests`,
  `coverage-summary`, and `poolmaster-browser-e2e`. See *Test suites*
  below for each suite's purpose, runner, configuration, coverage
  policy, and CI mapping.
- **`service-build`** — backend service Docker build verification.
- **`mock-contest-feed-provider-build`** — mock provider Docker build
  verification.
- **`poolmaster-build`** — webapp build verification.
- **`publish-images`** (push to `main` only) — builds and pushes Docker
  images to ECR, registers ECS task definitions, syncs the webapp to S3 and
  invalidates CloudFront.
- **`migrate-qa`** (push to `main` only) — runs the migration ECS task,
  waits for ECS service stabilization, and dumps diagnostics on failure.

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
- **CI job:** runs as part of `service-coverage-report` via `npm run test:coverage:service:merged` (the merged-coverage runner runs unit, integration, and FAPI sequentially against the same coverage directory).
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
- **CI job:** `service-coverage-report` (Postgres provided as a Docker service container).
- **Required pre-push gate:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:service:integration`.
- **Coverage policy:** **No threshold** in `tests/integration/jest.config.js`. Integration coverage feeds the merged report but isn't gated on its own.
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
- **CI job:** `service-coverage-report` (runs as part of the merged coverage script).
- **Required pre-push gate:** `DATABASE_URL=... npm run test:service:functional-api` (per `AGENTS.md` Quality Gates).
- **Coverage policy:** No threshold; coverage feeds the merged report.

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
- **Coverage policy:** **No threshold configured** in `vitest.config.ts`. Coverage is reported but not gated. (Riley flagged this in the rop.19 review; future work to set per-feature thresholds will need to add a `coverage.thresholds` block.)
- **Known anti-pattern this suite has accumulated:** `vi.mock('@/lib/api')` at module level in 30+ tests — see `pool-master-rop.4`. The intent is for this suite to use **MSW** for HTTP boundary mocking instead of replacing the SDK; the migration is tracked in epic `pool-master-rop.71`.

### 5. Webapp browser E2E (`clients/poolmaster/e2e/**/*.e2e.ts`)

- **Runner:** Playwright (Chromium project).
- **Config:** [`clients/poolmaster/playwright.config.ts`](../clients/poolmaster/playwright.config.ts).
- **Environment:** Real browser (Chromium / optionally a system-installed channel via `POOLMASTER_E2E_BROWSER_CHANNEL`) hitting the **deployed QA frontend** at `qa.ultimateofficepoolmanager.com` (override via `POOLMASTER_E2E_BASE_URL`).
- **Test count today:** ~5 `.e2e.ts` files plus `*.setup.ts` auth setup.
- **Concurrency:** `fullyParallel: false`, `workers: 1`. Tests share state through the deployed environment.
- **Retries:** none. CI fails immediately on flake; local failures are reproducible.
- **Artifacts on failure:** trace, screenshot, video — all retained on failure for triage.
- **Local commands:**
  - `npm run test:poolmaster:browser-e2e` — run the suite
  - `npm run test:poolmaster:browser-e2e:list` — list tests without running
- **CI job:** `poolmaster-browser-e2e` (push-to-main only; not run on PR builds). Triggered after `migrate-qa` deploy succeeds.
- **Required pre-push gate:** none. E2E is a **CI-only** signal; per `AGENTS.md` Quality Gates, browser E2E falls under "CI-only follow-up signals" and isn't required pre-push.
- **Coverage policy:** N/A. E2E doesn't produce coverage artifacts.

### Merged coverage and the consolidation job

- **`test:coverage:service:merged`** (`scripts/run-backend-coverage.mjs`) runs all three backend suites (unit + integration + FAPI) with coverage collection and merges the results into `coverage/service-merged/`. This is the canonical local backend coverage command.
- **`coverage-summary`** (CI job) downloads the `coverage-service-report` and `coverage-webapp-unit` artifacts and emits a single Markdown table to the GitHub Actions step summary covering Service / Web App Unit metrics.
- **Why merged matters:** the same source file is often partly covered by a unit test (logic correctness) and partly by an integration test (real-DB behavior). Merging gives an honest count of "how much of this file is exercised by *any* test."

### Coverage thresholds — current state and roadmap

| Suite | Threshold today | Source of truth |
|---|---|---|
| Backend unit | 24% / 14.2% / 21.15% / 24.53% (stmts / branches / fns / lines) | `tests/jest.config.js` |
| Backend integration | none | — |
| Backend FAPI | none | — |
| Webapp unit | none | — |
| Webapp E2E | N/A | — |

The single configured threshold is intentionally a **regression floor**, not a target. Real per-feature coverage targets are tracked in the rule-enforcement epic follow-ups; pages and modules touched by the q8h frontend rule hardening epic will gain explicit thresholds as part of that work. Until then, slice authors should aim for ≥ 80% statements on touched files but the suite-level gate stays at the floor.

## File reference

```
.github/workflows/ci.yml             — workflow definition
package.json                         — npm script wiring (rules:check chain, api:check)
scripts/rule-check-utils.mjs         — shared file-walk + reporting helpers
scripts/check-no-mocked-api.mjs      — gate 1
scripts/check-route-discipline.mjs   — gate 2
scripts/check-test-traceability.mjs  — gate 3
scripts/check-test-disable-discipline.mjs — gate 4
scripts/check-unsafe-casts.mjs       — gate 5
scripts/check-shared-ui-controls.mjs — gate 6
scripts/check-form-query-mirror.mjs  — gate 7
scripts/check-openapi-fresh.mjs      — gate 8
scripts/check-pr-riley-marker.mjs    — Riley marker gate (PRs only)
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
