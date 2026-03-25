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

## Project Structure

- `packages/` — Backend services (Fastify + TypeScript) and shared domain types
- `clients/` — Web (React), iOS (Swift), Android (Kotlin)
- `tests/` — All tests, separate from application code
- `plans/` — Plan documents with action plan task tables
- `rules/` — Architecture and coding rules
- `infrastructure/` — Docker, Kubernetes, Terraform
