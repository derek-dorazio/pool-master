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

---

## 4. Do Not Preserve Bad Patterns

Do not protect obsolete architecture with inertia.

- Remove or replace stale tests that enforce retired code paths.
- Remove dead endpoints and no-op UI instead of keeping them “for later.”
- Strengthen rules when a refactor reveals a repeated failure mode.

---

## 5. Finding Tasks

| Prefix | Plan File | Area |
|---|---|---|
| 01-xxx | `plans/01-poolmaster-architecture.md` | Core architecture, foundation, infrastructure |
| 02-xxx | `plans/02-poolmaster-draft-config.md` | Draft/selection mechanics |
| 03-xxx | `plans/03-poolmaster-scoring-rules.md` | Scoring engines and templates |
| 04-xxx | `plans/04-poolmaster-history.md` | Contest and league history |
| 05-xxx | `plans/05-poolmaster-sports-data-integration.md` | Sports data providers |
| 06-xxx | `plans/06-poolmaster-participant-data.md` | Participant management |
| 07-xxx | `plans/07-poolmaster-billing-subscription.md` | Billing and subscriptions |
| 08-xxx | `plans/08-poolmaster-commissioner-tooling.md` | Commissioner tools |
| 09-xxx | `plans/09-poolmaster-notifications-alerts.md` | Notifications |
| 10-xxx | `plans/10-poolmaster-social-communication.md` | Social features |
| 11-xxx | `plans/11-poolmaster-admin-dashboard.md` | Admin dashboard |
| 12-xxx | `plans/12-poolmaster-mobile-client.md` | Mobile clients |
| 13-xxx | `plans/13-poolmaster-search-discovery.md` | Search and discovery |
| 14-xxx | `plans/14-poolmaster-localisation-i18n.md` | Localisation |
| 15-xxx | `plans/15-poolmaster-responsible-gaming.md` | Compliance and legal |
| ST-xxx | `plans/testing/smoke-tests.md` | Smoke test suites |
