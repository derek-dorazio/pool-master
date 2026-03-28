# PoolMaster — Claude Code Instructions

## Rules Files

Read the rules files in `rules/` before doing any implementation work:

- `rules/architecture-rules.md` — System architecture, tech stack, infrastructure, databases
- `rules/service-rules.md` — Backend: Fastify, TypeScript, Prisma, coding conventions
- `rules/react-ui-rules.md` — Web: React, shadcn/ui, TailwindCSS, TanStack Query
- `rules/swift-rules.md` — iOS: SwiftUI, Observation framework
- `rules/android-rules.md` — Android: Kotlin, Jetpack Compose, Hilt
- `rules/testing-rules.md` — Test strategy, coverage, CI pipeline
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

## Project Structure

- `packages/` — Backend services (Fastify + TypeScript) and shared domain types
- `clients/` — Web (React), iOS (Swift), Android (Kotlin)
- `tests/` — All tests, separate from application code
- `plans/` — Plan documents with action plan task tables
- `rules/` — Architecture and coding rules
- `infrastructure/` — Docker, Kubernetes, Terraform
