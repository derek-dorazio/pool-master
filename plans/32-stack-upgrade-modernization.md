# Plan 32: Stack Upgrade Modernization

> **Planning Note (2026-04-04):** Re-check the current workspace manifests, CI workflows, and generated-client/tooling assumptions before each upgrade phase. Do not batch unrelated majors together. Re-measure test coverage and CI behavior after every meaningful tooling bump.

## Purpose

Upgrade the repo stack to current supported versions in a controlled, phased way so the platform stays on maintained runtimes and tooling without breaking the current MVP delivery path.

This plan exists to:

- remove Node/GitHub Actions deprecation risk
- modernize the toolchain in dependency order instead of ad hoc upgrades
- keep web/admin/backend/generated-client workflows aligned through each step
- preserve a reliable validation gate after each bump

## Current Snapshot

Repo-local evidence shows the following high-risk or likely-stale areas:

- GitHub Actions and CI are still pinned to `actions/setup-node@v4` with `node-version: '20'`
- root `package.json` still declares `"engines": { "node": ">=20.0.0" }`
- root `package.json` still pins `npm@11.3.0`
- root `package.json` still carries `@types/node@^20.0.0`
- shared/backend tooling is still on older major/minor lines:
  - `typescript@^5.5.0`
  - `turbo@^2.0.0`
  - `eslint@^9.0.0`
  - `jest@^29.7.0`
  - `prisma@^6.0.0`
  - `fastify@^5.0.0`
  - `@hey-api/openapi-ts@^0.95.0`
- web/admin app toolchains are still on:
  - `vite@^5.4.0`
  - `vitest@^4.1.2`
  - `@playwright/test@^1.45.0`
  - `react@^18.3.0`
  - `react-dom@^18.3.0`

None of those are automatically wrong, but they are the places most likely to create CI/runtime drift, generated-client incompatibility, or dependency-order surprises.

## Scope

In scope:

- root workspace toolchain versions
- package-level runtime and devDependency upgrades
- GitHub Actions runtime/tooling alignment
- generated-client/OpenAPI/Prisma compatibility
- local validation and CI verification sequencing

Out of scope:

- feature rewrites
- mock data changes
- product behavior changes unrelated to version bumps
- broad dependency refreshes without version-order planning

## Upgrade Principles

- Upgrade the runtime foundation before dependent tooling.
- Upgrade code generators before consumers that read their output.
- Keep backend, web, admin, and shared packages aligned with the same TypeScript baseline.
- Treat CI runner/runtime changes as first-class work, not a cleanup afterthought.
- Use one phase per risk class, not one giant dependency sprint.

## Recommended Order

1. Node and CI runtime alignment
2. TypeScript, package manager, and core lint/build toolchain
3. Generated API/OpenAPI and backend runtime packages
4. Web/admin UI toolchain
5. Test harness and coverage/tooling polish
6. Major framework jumps only after the lower layers are stable

## Immediate Execution Queue

When CI/deploy stabilization work no longer blocks upgrades, execute this plan in the following narrow slices:

1. GitHub Actions runtime upgrade first, because Node 20 deprecation is already producing warnings in CI.
2. Root engine and local developer guidance update second, so CI and local expectations stop drifting.
3. Core toolchain upgrade in a single coordinated pass across root, shared, backend, web, and admin.
4. Generated-client/OpenAPI and Prisma compatibility pass after the shared toolchain is stable.
5. Web/admin runner upgrades only after backend and generated artifacts are confirmed stable.

Do not combine steps 1-5 into one large dependency refresh.

## Phases

### Phase 1: Node And CI Runtime

Goal:

- move CI and local development to a current supported Node runtime
- resolve the GitHub Actions Node 20 deprecation before it becomes a forced break

Likely tasks:

- update `actions/setup-node` usage in CI to the supported Node line
- verify local developer docs and repo guidance match the target Node version
- align `package.json` `engines` and any runtime docs with the same target
- review `npm` version expectations if the chosen Node line changes the bundled npm behavior

Risks:

- CI-only breakage from Node engine mismatches
- transitive tool incompatibility with newer Node
- local developer environment drift if docs lag behind CI

Validation:

- `npm ci`
- `npx turbo typecheck --force`
- `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
- `npx jest --config tests/jest.config.js --forceExit`
- `cd clients/web && npx vitest run`
- `cd clients/admin && npx vitest run`

### Phase 2: Core Toolchain Baseline

Goal:

- bring the shared TypeScript/build/lint/test baseline to a current supported line

Likely tasks:

- upgrade TypeScript in root/shared/workspaces together
- update ESLint/Turbo/Jest/Vitest in a coordinated pass
- keep `@types/node` aligned with the chosen Node baseline

Risks:

- TS config churn across shared/backend/web/admin
- lint rule behavior changes
- test runner behavior changes, especially around coverage and ESM

Validation:

- package builds/typechecks across all workspaces
- full lint
- full backend/web/admin test suites

### Phase 3: Backend And Generated Contracts

Goal:

- keep backend runtime, Prisma, Fastify, and OpenAPI generation compatible with the new toolchain

Likely tasks:

- evaluate Prisma upgrade compatibility against current schema/migrations
- verify Fastify and swagger/openapi packages still generate and validate cleanly
- verify `@hey-api/openapi-ts` and generated clients remain in sync with the exported OpenAPI spec
- ensure generated artifacts still match workspace exports and package boundaries

Risks:

- generated client drift
- schema-generation differences
- backend route/DTO validation changes that surface only in CI

Validation:

- `npm run api:export`
- `npm run api:generate`
- `npm run api:validate`
- backend unit and integration tests

### Phase 4: Web And Admin Tooling

Goal:

- move web/admin Vite, Vitest, Playwright, and React-related dependencies together

Likely tasks:

- upgrade Vite and Vitest in lockstep with the React plugin/tooling
- verify Playwright version support against the new runtime and browser matrix
- check React/React DOM compatibility before attempting any major framework jump

Risks:

- browser test flakes due to runner changes
- Vite plugin or alias behavior changes
- snapshot and coverage changes in vitest

Validation:

- `cd clients/web && npx vitest run`
- `cd clients/admin && npx vitest run`
- `cd clients/web && npx playwright test --list`
- then run the browser MVP smoke against a local or QA target

### Phase 5: Coverage And CI Observability

Goal:

- make coverage and test results easier to inspect after toolchain changes

Likely tasks:

- upload coverage artifacts in CI
- print coverage summaries into job logs
- enforce baseline thresholds after the upgrade settles
- tighten backend coverage collection excludes so generated/config files do not distort reporting

Risks:

- coverage regressions hidden by noisy collector config
- CI outputs becoming harder to compare after tooling changes

Validation:

- compare coverage summary outputs before and after each bump
- confirm GitHub Actions exposes the latest artifacts and logs cleanly

### Phase 6: Major Framework Jumps

Goal:

- evaluate any larger framework jumps only after the foundation is stable

Likely tasks:

- decide whether React should remain on the current major for now or be upgraded in a dedicated pass
- consider only one major family at a time if the app needs it

Risks:

- large UI churn
- test fixture and rendering changes
- compatibility issues with generated client/react-query integration

Validation:

- one framework family at a time
- full web/admin unit and browser verification after each major jump

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| SUT-001 | Inventory | Reconfirm the actual baseline versions in root/workspace manifests and CI workflows | Not Started | Use repo-local evidence before each phase; do not rely on memory |
| SUT-002 | Node/CI | Move GitHub Actions and local guidance off Node 20 | Not Started | CI is already warning about Node 20 deprecation |
| SUT-003 | Toolchain | Align TypeScript, ESLint, Turbo, Jest, and Vitest on a single current supported baseline | Not Started | Upgrade together to reduce cross-package drift |
| SUT-004 | Backend | Upgrade Prisma, Fastify, and OpenAPI generation in dependency order | Not Started | Keep generated client/spec compatibility intact |
| SUT-005 | Web/Admin | Upgrade Vite, Playwright, React, and supporting UI test tooling | Not Started | Only after the shared toolchain is stable |
| SUT-006 | CI Observability | Make coverage artifacts and summaries easier to retrieve in GitHub Actions | Not Started | Pair with the coverage threshold ratchet plan |
| SUT-007 | Validation | Define the phased verification checklist that must pass before each version bump is merged | Not Started | Include build, typecheck, lint, unit, integration, smoke, and browser checks |

## Acceptance Criteria

- CI no longer warns about the repo being pinned to Node 20 in a way that risks near-term breakage.
- The repo has a clear, phased upgrade order instead of ad hoc dependency bumps.
- Shared/generated/backend/web/admin tooling stays compatible at each stage.
- Validation expectations are explicit and repeatable for future agents.
- The plan clearly identifies the highest-risk version families before implementation starts.
