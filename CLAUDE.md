# PoolMaster — Claude Code Instructions

## CRITICAL: No Mock Data in Application Code

**This is the #1 code quality rule in the project. Violations are treated as defects.**

- **NEVER add mock data, fake data, hardcoded sample data, or mocking of any kind to application code.** This includes hooks, pages, components, services, handlers, and any file that ships to production.
- Mock data belongs ONLY in test files (`*.test.ts`, `*.test.tsx`, `__tests__/`, `__fixtures__/`, `e2e/`).
- Application code MUST always call real APIs. If an endpoint does not exist yet, the component should show a loading/error/empty state — NOT return fake data.
- `try/catch` blocks in hooks that return mock data on failure are **BANNED** — they hide real errors.
- `initialData: mockData` in React Query hooks is **BANNED** — it prevents real API calls from ever being made.
- `queryFn: async () => mockData` is **BANNED** — it makes the query return fake data instead of calling the API.
- Unit tests create their own mocks as part of test setup (`vi.mock`, MSW handlers) — mocks are NEVER imported from application code.
- **If you see mock data in application code, it is a defect — remove it and wire to the real API.**

## Rules Files

Read the rules files in `rules/` before doing any implementation work:

- `rules/architecture-rules.md` — System architecture, tech stack, infrastructure, databases
- `rules/service-rules.md` — Backend: Fastify, TypeScript, Prisma, coding conventions
- `rules/react-ui-rules.md` — Web: React, shadcn/ui, TailwindCSS, TanStack Query
- `rules/swift-rules.md` — iOS: SwiftUI, Observation framework
- `rules/android-rules.md` — Android: Kotlin, Jetpack Compose, Hilt
- `rules/testing-rules.md` — Test strategy, coverage, CI pipeline
- `rules/model-change-rules.md` — **Required checklist for ANY data model change** (schema → migration → types → adapters → services → routes → hooks → tests)
- `rules/workflow-rules.md` — **Action plan tracking (read this first)**

## Workflow: Action Plan Tracking

**Every plan document in `plans/` has an Action Plan section with a task table. These are our issue tracker.**

**You MUST update task status when implementing:**
- Set to `In Progress` when you start working on a task
- Set to `Done` when you finish, with notes on what was built
- Check all plan files for related tasks — one implementation may touch multiple plans

See `rules/workflow-rules.md` for the full task tracking protocol.

## Documentation Requirements

**You MUST keep documentation in sync when making changes:**

- **Architecture, infrastructure, or dev environment changes** → Update `README.md`, `docs/DEVELOPER-SETUP.md`, and `rules/architecture-rules.md`
- **New or changed test suites** → Update `README.md` (Testing section), `docs/DEVELOPER-SETUP.md` (Run Tests section), and `rules/testing-rules.md`
- **New backend module or service** → Update `packages/README.md` (service module table) and the service's own README
- **New webapp feature module** → Update `clients/web/README.md` (features table)
- **New Docker container or port** → Update `docker-compose.dev.yml`, `scripts/dev-start.sh` (startup banner), `docs/DEVELOPER-SETUP.md` (infrastructure table), and `README.md`
- **New npm script** → Update `docs/DEVELOPER-SETUP.md`
- **New API endpoint** → Update the relevant service README

**README locations:**
- `README.md` — Project overview, quick start, architecture
- `docs/DEVELOPER-SETUP.md` — Full setup guide, commands, endpoints
- `packages/README.md` — Backend services and shared package reference
- `clients/web/README.md` — Webapp features, pages, and components

## Pre-Commit Quality Gates

**You MUST pass ALL of these checks before committing ANY changes. No exceptions.**

### Required checks (run in this order):

1. **TypeScript typecheck:** `npx turbo typecheck --force`
   - All packages must pass with zero errors
   - If typecheck fails, fix the errors — do NOT commit broken types

2. **ESLint:** `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
   - Fix all errors before committing
   - Warnings are acceptable but errors are not

3. **Backend unit tests:** `npx jest --config tests/jest.config.js --forceExit`
   - All tests must pass — zero failures
   - If a test fails, investigate and fix the root cause

4. **Webapp tests:** `cd clients/web && npx vitest run`
   - All test suites must pass

5. **Admin tests:** `cd clients/admin && npx vitest run`
   - All test suites must pass

### Rules:

- **NEVER commit code that fails typecheck, lint, or tests**
- **NEVER comment out, skip, or delete failing tests to make the build pass** — find and fix the underlying defect instead
- **NEVER use `@ts-ignore` or `as any` to silence type errors** unless there is a genuine need (e.g., mocking in tests)
- If you cannot determine the correct fix, **ask the user** before committing
- If a test failure reveals a real defect in application code, fix the application code
- If a test failure reveals a bad test (wrong assertion, stale mock data), fix the test
- If you are unsure whether the fix belongs in the test or the application, **ask the user**

### What you cannot test locally (CI-only):

- Smoke tests (`tests/api/functional/`) — run against deployed QA environment
- E2E tests (Playwright) — run against deployed QA environment
- Docker image builds — run in CI publish-images job

These are acceptable to fail in CI due to environment issues, but code-level defects in these test files should still be caught by typecheck.

## Project Structure

- `packages/` — Backend services (Fastify + TypeScript) and shared domain types
- `clients/` — Web (React), iOS (Swift), Android (Kotlin)
- `tests/` — All tests, separate from application code
- `plans/` — Plan documents with action plan task tables
- `rules/` — Architecture and coding rules
- `infrastructure/` — Docker, Kubernetes, Terraform
