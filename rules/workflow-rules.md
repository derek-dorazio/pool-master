# PoolMaster — Workflow Rules

## 1. Action Plan Tracking

Every plan document in `plans/` has an **Action Plan** section with a task table. These are the project's issue tracker.

### Task Table Format

```markdown
| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 01-001 | 1 | Task description | Done | Completed notes |
| 01-002 | 1 | Task description | In Progress | What's done, what remains |
| 01-003 | 1 | Task description | Not Started | |
```

### Status Values

| Status | Meaning |
|---|---|
| Not Started | Work has not begun |
| In Progress | Work has started but is not complete |
| Done | Fully implemented and working |
| Removed | Out of scope; strike through the task and explain why |

### Required Workflow

When starting work:

1. Find the relevant task in the plan.
2. Mark it `In Progress`.
3. Add notes about the implementation slice you are taking.

When finishing work:

1. Mark the task `Done` or `Removed`.
2. Add notes with the relevant files and decisions.
3. Update every affected plan, not just the first one you looked at.

### Slice Execution Rules

- Keep one execution slice per commit unless the user explicitly approves bundling multiple slices together.
- Report every changed file in the final handoff for a slice. Do not summarize a broader file set as if it were narrower.
- If slice work exposes adjacent-slice files or tasks, stop and report that spillover instead of bundling it into the same commit.
- Coverage threshold changes are main-thread coordination work. Worker slices must not raise or lower thresholds on their own.
- Update plan rows only for the exact slice being worked. Do not mark unrelated queue items `In Progress` or `Done`.
- Mark a slice `Done` only when the exact scoped work is complete and validated. Partial work stays `In Progress`.

### Slice Completion Checklist (Required Before Marking Done)

Before marking any backend slice task `Done`, run through this checklist for every domain object or endpoint touched by the slice. This checklist enforces the layer-completeness requirements from `rules/model-change-rules.md` and `rules/service-rules.md` as execution gates, not just reference material.

**Schema & Domain:**
- [ ] Prisma schema updated (if model changed)
- [ ] Migration generated (if schema changed)
- [ ] Shared domain types/enums updated in `packages/shared/domain/`

**DTOs & Mappers:**
- [ ] Zod request DTO exists in `packages/shared/dto/<module>.dto.ts` for every request body
- [ ] Zod response DTO exists in `packages/shared/dto/<module>.dto.ts` for every response
- [ ] Mapper file exists at `packages/core-api/src/mappers/<module>.mapper.ts` with named export functions
- [ ] Handlers call mapper functions — no inline `.map()` transformations in route or handler files

**Route Schemas:**
- [ ] Every route uses `zodToJsonSchema()` for request and response schemas — no inline `{ type: 'object', properties: ... }` JSON objects
- [ ] No route uses `SuccessSchema` or `passthroughResponseSchema` for endpoints returning domain data
- [ ] Every route has `operationId`, `summary`, and `tags`

**Tests:**
- [ ] Unit test exists for service logic
- [ ] DB integration test covers create, read, update, delete/inactivate, findById for new/changed domain objects
- [ ] Contract test case added to `api-contracts-web.integration.ts` or `api-contracts-admin.integration.ts` for every new/changed endpoint
- [ ] Coverage on changed files ≥ 80% statements

**OpenAPI:**
- [ ] `npm run api:refresh` succeeds
- [ ] `npm run api:validate` succeeds

A slice that lands the schema and service logic correctly but skips DTOs, mappers, or tests is `In Progress`, not `Done`.

### Slice Deliverables

When plans break work into slices (e.g., Plan 59's A–I slices), each slice should be tracked at layer granularity, not as a single monolithic task. Either expand the plan's task table to include per-layer rows:

```markdown
| D.1 | Schema + migration | Done |
| D.2 | Service + repository | Done |
| D.3 | DTOs (request + response Zod schemas) | Not Started |
| D.4 | Mappers | Not Started |
| D.5 | Route schemas (zodToJsonSchema, operationId, tags) | Not Started |
| D.6 | Unit tests | In Progress |
| D.7 | Integration tests (CRUD + negative paths) | Not Started |
| D.8 | Contract tests | Not Started |
```

Or confirm all layers pass the Slice Completion Checklist above before marking the slice `Done`. A slice is only complete when all applicable layers are done — not when the "hard part" (schema + service) lands.

### Plan Closeout And Archiving

- Plans are execution tools, not long-lived policy documents. Durable rules belong in `rules/`, not in active plans.
- When all remaining tasks in an umbrella plan are done, removed, or intentionally handed off to a newer active plan, close it out instead of leaving it in `plans/` indefinitely.
- Archive completed or superseded plans under `plans/archive/` and add a short note explaining why they were archived.
- Update any active plans that still reference the archived plan so they point to it only as historical context, not as active execution guidance.
- If a plan contained temporary guidance that has either served its purpose or become durable policy, remove it from the active plan during closeout. Only move it into `rules/` if it is genuinely long-lived guidance.

---

## 2. Rule and Documentation Maintenance

Rules are part of the codebase contract.

When a refactor changes architecture, API usage, testing patterns, or generated-client workflow:

- update the relevant file in `rules/` in the same change
- do not leave stale rules behind for a future cleanup
- prefer tightening rules after a painful refactor so the same mistake is harder to repeat

Examples that require rule updates:

- moving frontend API access to the generated `hey-api` client
- changing OpenAPI generation/validation workflow
- replacing manual-client tests with MSW
- removing obsolete UI or endpoint patterns

---

## 2A. Source-Of-Truth Priority During The Backend Refactor

On `codex-backend-refactor-lane`:

- `rules/` and active `plans/` / use-case companions are the authoritative implementation guidance.
- Treat `docs/` as reference material only.
- Do not use `docs/` as source-of-truth implementation guidance unless:
  - the user explicitly directs you to use a specific doc, or
  - an active rule or active plan explicitly points to that doc as current authoritative guidance.
- If `docs/` conflicts with active plans or rules, follow the active plans/rules and treat the doc as stale.

This exists because many docs in `docs/` were generated for review and may
reflect older model decisions.

---

## 3. Required Local Validation Before Push

Before pushing code that could trigger CI, agents must run the full local quality gate set first unless the user explicitly approves skipping a gate for a narrow reason.

Required local pre-push commands:

1. `npx turbo typecheck --force`
2. `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
3. `npx jest --config tests/jest.config.js --forceExit`
4. `cd clients/web && npx vitest run`
5. `cd clients/admin && npx vitest run`
6. `npx jest --config tests/jest.config.js --coverage --forceExit`
7. `cd clients/web && npm run test:coverage`
8. `cd clients/admin && npm run test:coverage`

Rules:

- Treat these as pre-push gates, not optional follow-up checks.
- Do not rely on GitHub CI to discover basic lint, unit, or integration failures that could have been caught locally.
- Treat coverage threshold enforcement as part of the required local gate once thresholds are configured; do not defer coverage regressions to GitHub CI.
- Smoke tests and deployed browser E2E remain CI/deployment signals unless explicitly run locally as part of the task.
- If a gate is blocked by local environment constraints, state that clearly before pushing.

Backend-first refactor lane exception:

- On the dedicated backend-first refactor branch `codex-backend-refactor-lane`,
  the required local gates are intentionally narrowed to backend/service-side
  validation while the API contract is being redesigned.
- Required gates on that branch are:
  1. backend/shared typecheck
  2. backend/shared lint
  3. backend unit tests
  4. DB-backed integration tests
  5. merged backend coverage via `npm run test:coverage:backend`
  6. OpenAPI export/validation when API shapes change
  7. coverage on changed files ≥ 80% statements (verify with `--collectCoverageFrom`)
  8. contract test exists for every new/changed endpoint (in `api-contracts-web` or `api-contracts-admin`)
  9. no route in changed modules uses `SuccessSchema` or `passthroughResponseSchema` for domain responses
- Web/admin test, coverage, smoke, and browser E2E suites are not required
  pre-push gates on that branch.
- This exception is branch-specific only. `main` and ordinary feature branches
  still use the full default validation set.

Backend-first refactor execution rules on `codex-backend-refactor-lane`:

- Focus implementation on the backend service stack only:
  - database schema
  - migrations
  - ORM mappings
  - domain entities
  - repositories/services
  - DTOs
  - mappers
  - API endpoints
  - generated service-side contracts
- Do not update web/admin application code just to keep it compiling during this branch.
- It is expected that web/admin may be temporarily out of sync while the backend contract is being redesigned.
- Do not preserve old filenames, function names, object names, or DTO names when the domain model has been renamed.
- Do not hide a new domain concept inside a legacy function or file name just to reduce diff size.
- Do not let existing service code or old model naming override the decisions already captured in active plans and use-case documents.
- Prefer replacing old backend slices outright over building compatibility shims around retired domain concepts.
- If a legacy endpoint or model shape is being replaced, implement the new contract cleanly rather than keeping a parallel alias unless the user explicitly asks for backward compatibility.
- Use the active plans and use-case companions as the implementation source of truth for how the application should behave.
- Do not mix old and new domain terminology within the same execution slice.
- If an implementation slice needs behavior that is not covered by an active use-case document, stop and document that use case before inventing the behavior from old code.
- If use cases are unclear or ambiguous, ask for clarification instead of inventing product behavior.
- Prefer incremental target-shaped slices:
  - it is acceptable to introduce new target-model tables, repositories, DTOs, and APIs in a narrow slice before every old consumer is removed
  - but the slice must use the new domain names directly
  - and it must not add compatibility shims, aliases, or legacy wrappers just to bridge old and new models
- Finish and commit ancillary cleanup that touches shared schema files before beginning the next core schema/model slice.
- Keep runtime/model commits separate from docs-only terminology cleanup when practical so validation, rollback, and review stay clear.
- Plan-row updates are part of the slice itself, not a follow-up task:
  - every implementation slice must update the relevant plan rows before commit
  - do not leave slice status changes for a later cleanup pass

---

## 4. Do Not Preserve Bad Patterns

Do not protect obsolete architecture with inertia.

- Remove or replace stale tests that enforce retired code paths.
- Remove dead endpoints and no-op UI instead of keeping them “for later.”
- Strengthen rules when a refactor reveals a repeated failure mode.

---

## 5. Finding Tasks

Use the table below for active plan ranges still expected to receive execution updates. Completed plan ranges may live in `plans/archive/` as historical reference only.

| Prefix | Plan File | Area |
|---|---|---|
| 13-xxx | `plans/13-poolmaster-search-discovery.md` | Search and discovery |
| 28-xxx | `plans/28-backend-service-hardening.md` | Backend service hardening |
| 29-xxx | `plans/29-webapp-and-admin-hardening.md` | Webapp/admin hardening |
| 30-xxx | `plans/30-platform-and-deploy-hardening.md` | Platform and deploy hardening |
| 31-xxx | `plans/31-mock-contest-feed-provider.md` | Mock contest feed provider |
| 32-xxx | `plans/32-stack-upgrade-modernization.md` | Stack modernization |
| 36-xxx | `plans/36-authentication-and-authorization-unification.md` | Authentication and authorization unification |
| 37-xxx | `plans/37-league-top-level-domain-and-data-simplification.md` | League-first domain and data simplification |
| 38-xxx | `plans/38-contest-entry-and-squad-alignment-review.md` | Contest, entry, and squad alignment review |
| ST-xxx | `plans/testing/smoke-tests.md` | Smoke test suites |

Archived/deferred and not active execution guidance:

- `13` search and discovery
- `07` billing/subscriptions
- `10` social communication
- `12` mobile client
- `15` responsible gaming / legal compliance
