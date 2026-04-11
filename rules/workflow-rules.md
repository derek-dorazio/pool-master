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
- [ ] Contract-verification case added to `contract-verification-web.integration.ts`, `contract-verification-root-admin.integration.ts`, or an equivalent contract-verification suite for every new/changed endpoint
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
| D.8 | Contract verification | Not Started |
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

### Webapp Rebuild Direction

The go-forward web frontend is the single role-based PoolMaster app.

- New web implementation work should target `clients/poolmaster`.
- Do not spend implementation effort keeping `clients/web` or `clients/admin` current with new plans once the rebuild plan is active.
- `clients/web` may be used as reference material for planning, layout ideas, and feature discovery until it is archived, but implementation agents should not treat it as an active delivery target.
- `clients/admin` is being removed rather than modernized into a separate long-lived app.
- If a frontend plan or slice is intended for the new app, keep the work isolated to the PoolMaster app and update related build/test/CI wiring in the same effort.

### Product Design Workflow For PoolMaster Webapp Planning

When an agent is acting in a product-design or product-manager capacity for the
PoolMaster web app, the agent must not jump straight from rough ideas into UI
implementation assumptions.

Required workflow:

1. Capture the product idea in a plan or use-case companion under `plans/`.
2. Write explicit user/use cases for the flow before implementation begins.
3. Include open functional questions, decisions, and assumptions that still need
   confirmation.
4. At the end of the design review, explicitly surface any implied backend or
   model changes required by the proposed webapp behavior, including:
   - Prisma/model changes
   - migrations or backfills
   - new DTOs or API routes
   - backend auth/session or invitation-flow changes
   Confirm those backend implications with the user before implementation
   begins.
5. Propose the browser E2E flows that should eventually prove the designed
   behavior end to end.
6. Review those use cases, questions, backend implications, and proposed E2E
   flows with the user
   before locking the design
   direction into implementation work.
7. Once reviewed, treat the agreed E2E flows as planned implementation work for
   the related webapp plan rather than leaving them as optional follow-up ideas.
8. Treat the reviewed use-case document as the companion for later UI planning
   and execution slices.

This is especially required for:

- landing and onboarding flows
- route and navigation design
- league/home context behavior
- commissioner and member UX entry points
- invite and join flows
- modal/wizard workflow design
- post-deploy browser E2E coverage for the designed flows

Do not assume that an early scaffold or placeholder page defines the final
product flow. For PoolMaster webapp design, plans should be use-case driven and
confirmed with the user before implementation expands.

### Persona Playbooks

- Persona playbooks may live under `agents/` to scope role-specific workflows
  such as product management, project management, backend implementation,
  frontend implementation, architecture/platform work, and code review.
- These playbooks are execution aids, not replacement policy sources.
- `AGENTS.md` and `rules/` remain canonical.
- Cross-cutting workflow requirements remain mandatory for all personas,
  including:
  - checking for active plans
  - updating task rows for the exact slice worked
  - validating work before marking slices done
  - updating docs and rules when the change affects them
- The `project-manager` persona may help with plan shaping, sequencing, and
  progress reconciliation, but it is not the sole owner of task tracking.
  Agents doing implementation work must still update plans themselves.

---

## 2A. Source-Of-Truth Priority

- `rules/` and active `plans/` / use-case companions are the authoritative implementation guidance.
- Treat `docs/` as reference material only unless an active rule or active plan explicitly promotes a doc as current source of truth.
- If `docs/` conflicts with active plans or rules, follow the active plans/rules and treat the doc as stale.

---

## 3. Required Local Validation Before Push

Before pushing code that could trigger CI, agents must run the full local quality gate set first unless the user explicitly approves skipping a gate for a narrow reason.

Required local pre-push commands:

1. `npx turbo typecheck --force`
2. `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
3. `npx jest --config tests/jest.config.js --forceExit`
4. `npm run test:service:functional-api`
5. `npm run test:poolmaster:unit`
6. `npm run test:coverage:service:merged`
7. `npm run test:coverage:poolmaster:unit`

Rules:

- Treat these as pre-push gates, not optional follow-up checks.
- Do not rely on GitHub CI to discover basic lint, unit, or integration failures that could have been caught locally.
- Treat coverage threshold enforcement as part of the required local gate once thresholds are configured; do not defer coverage regressions to GitHub CI.
- Retired smoke suites and browser E2E must not be reintroduced into the active gate set unless an active plan explicitly restores them.
- If a gate is blocked by local environment constraints, state that clearly before pushing.

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

Archived/deferred and not active execution guidance:

- `13` search and discovery
- `07` billing/subscriptions
- `10` social communication
- `12` mobile client
- `15` responsible gaming / legal compliance
