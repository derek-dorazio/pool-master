# Plan 136 — Test Runner and Layer Consolidation

**Tracking epic:** _not yet created_ — substrate depends on Plan 139.

## Purpose

Consolidate on a single test runner, and reduce the backend test layers from four to
three.

Two changes, one plan, because both restructure the same files and the same gate set.
Doing them separately means editing `testing-rules.md §2`, `§3`, and `§6` twice.

## Governing Principles

- **One tool per job.** Two test runners is two configs, two mocking APIs, and two mental
  models for no benefit.
- **A layer is defined by how it runs, not by what it asserts.** An assertion style that
  applies across layers is a convention, not a layer.
- **Redundancy between layers is fine when each is true to its purpose** — this plan
  removes a layer that was never distinguished by purpose, not layers that overlap.

## Triggering Findings

**Two runners.** `testing-rules.md §1` specifies Jest for backend and Vitest for frontend.
The market consolidated on Vitest for TypeScript projects — faster, ESM-native, and
largely Jest-API-compatible.

**Four backend layers with ~250 lines of placement heuristics.** Unit, Data Integration,
Contract Verification, and Functional API, plus a *Backend Suite Placement Heuristics*
section that exists purely to resolve the ambiguity the layering created.

**Contract Verification is not a layer.** Compare it to Data Integration: both run against
a real DB, both use `Fastify.inject()`, both are integration-style suites. The only
distinction is *what they assert* — schema shape via `.safeParse()` rather than behavior.
That is an assertion convention, not an execution boundary. `§4`'s own warning — "Do not
turn contract verification into a duplicate FAPI suite" — is the rule noticing its own
overlap.

## Key Decisions

### 1. Consolidate on Vitest

Backend migrates from Jest + ts-jest to Vitest. Frontend already uses it.

**Known migration risks, to be sized before committing:**

- `jest.mock` → `vi.mock` hoisting semantics differ in edge cases
- ts-jest → esbuild/SWC transform: decorator and `emitDecoratorMetadata` behavior, and
  any reliance on ts-jest's type-checking during test runs
- Prisma client and ESM interop
- `maxWorkers: 1` (serial integration runs) → `fileParallelism: false` or
  `poolOptions.threads.singleThread`
- `--forceExit` has no direct Vitest equivalent; open handles that Jest papered over will
  surface and need fixing rather than suppressing
- Coverage moves from Jest's istanbul setup to Vitest's v8 or istanbul provider —
  thresholds and the merged-coverage script (`run-backend-coverage.mjs`) need reworking

The merged service coverage pipeline is the highest-risk piece and should be proven before
the suites migrate.

### 2. Contract Verification becomes an assertion convention, not a layer

Three backend layers remain:

| Layer | Boundary |
|---|---|
| **Unit** | No DB, mocked dependencies, business logic and validation branches |
| **Integration** | Real DB via `Fastify.inject()` — persistence, queries, repositories, lower-level route behavior |
| **Functional API** | Generated SDK over real HTTP — client-visible journeys, auth/session, cross-endpoint flows |

The schema check survives as a **rule applied within layers 2 and 3**: any test exercising
a route asserts the response against its DTO with `.safeParse()`. Nothing is lost — the
same assertion runs on more endpoints than the dedicated suite covered, because it rides
along with tests that already exist.

The existing `contract-verification-*.integration.ts` files fold into the integration
suites for their domains.

This deletes `§2`'s four-row table, most of `§6`'s placement heuristics, and the
"if a test could fit in both" tiebreakers.

### 3. The gate set shrinks accordingly

`testing-rules.md §3` currently lists ten commands. Consolidating the runner and removing
a layer collapses several. The rewritten gate set should be short enough to remember,
because Plan 132 makes CI the primary merge signal.

**Add a `git push` PreToolUse hook** verifying the gate set actually ran, rather than
relying on an agent to remember `§3`. This matters more now that no bot review stands
between a push and a merge.

## Data Model / API Surface Implications

None. `api:check` and `api:validate` are unaffected and must stay green throughout.

## Dependencies

- **Plan 135** — the test-lint plugin choice (`eslint-plugin-vitest` vs
  `eslint-plugin-jest`) depends on this plan landing first.
- **Plans 137 and 138** also edit `testing-rules.md`. This plan restructures `§2`, `§3`,
  and `§6`; 137 edits the selector rules in `§6`; 138 edits `§1A`. Sequencing 136 → 137 →
  138 keeps each diff readable; running them concurrently means conflicts.
- **Plan 132** — the gate set becomes the primary merge signal, which raises the stakes on
  getting this right.

## Execution Sequence

**First — prove the Vitest migration on one backend suite.** Unit tests are the lowest
risk. Do not migrate everything before knowing the transform and coverage story works.

**Second — migrate the remaining backend suites** and the merged coverage pipeline.

**Third — collapse Contract Verification.** Fold the existing suites into their domain
integration files, add the `safeParse` convention to the rules, and rewrite `§2` and `§6`.

**Fourth — rewrite the gate set and add the push hook.**

The runner migration and the layer collapse are separable and should be separate slices;
bundling them makes a failure ambiguous between the two causes.

## Open Questions

- **Does the merged-coverage approach survive the runner change?** The current pipeline
  merges four coverage runs. With three layers and a different provider, the shape may
  simplify — or may need rebuilding from scratch.
- **Is `Fastify.inject()` still the right integration boundary,** or should integration
  also go through real HTTP now that FAPI proves the SDK path? Inject is faster and the
  speed is worth keeping, but running two transport paths is its own small split.

## Sources / Prior Decisions

- Plan 132 — Review flow simplification (CI becomes the primary merge signal)
- Plan 135 — Rule scanners to ESLint (depends on the runner choice)
- Plans 137, 138 — also edit `testing-rules.md`
