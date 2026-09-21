# Plan 140 — Library and Framework Upgrades

**Tracking epic:** _not yet created_ — substrate depends on Plan 139.

**Scheduled last.** This plan runs after Plans 132–139 have landed. Upgrading frameworks
while the test runner, lint configuration, and workflow are all in motion makes every
failure ambiguous between the upgrade and the restructuring.

## Purpose

Bring the dependency set current in a deliberate pass rather than by drift.

## Current State

Observed in `clients/poolmaster/package.json` at the time of writing:

| Package | Installed |
|---|---|
| `react` / `react-dom` | ^18.3.0 |
| `react-router-dom` | ^6.24.0 |
| `@tanstack/react-query` | ^5.50.0 |
| `react-hook-form` | ^7.52.0 |
| `tailwindcss` | ^3.4.0 |
| `@radix-ui/*` | 1.x / 2.x |
| `@vitejs/plugin-react` | ^4.3.0 |

Backend runs Fastify 5, Prisma 6, Node 20 LTS, TypeScript 5.5.

React and React Router are each approximately one major behind. The rest are current or
near-current.

**Version targets are deliberately not fixed in this plan.** It executes last, by which
time this list will be stale. The first slice establishes current targets by checking the
registry and each project's release notes — not from memory. This follows
`working-style.md`'s own rule about verifying before using.

## Governing Principles

- **One major version bump per slice.** Bundling upgrades makes a regression ambiguous.
- **Upgrade for a reason.** A major bump needs a benefit — a security fix, a capability
  the repo wants, or falling out of support. "Newer" is not a reason on its own.
- **The gate set is the safety net.** This plan is the strongest argument for landing
  Plan 136 first: a fast, reliable, single-runner suite is what makes framework upgrades
  tractable.

## Key Decisions

### 1. Sequence by blast radius, smallest first

Rough ordering, to be confirmed against actual release notes at execution time:

1. **Patch and minor sweeps** across the tree. Near-zero risk, clears noise before the
   majors.
2. **Build tooling** — Vite and its React plugin. Contained, and failures are loud and
   immediate.
3. **Tailwind major.** Config format and build-pipeline changes; affects every component
   visually, so it wants a careful visual pass rather than a test run.
4. **React Router major.** Router API changes are mechanical but touch every route
   definition.
5. **React major.** Largest blast radius. Ecosystem compatibility — Radix, TanStack Query,
   React Hook Form, Testing Library — must be confirmed *before* starting, not discovered
   during.
6. **Node LTS**, if the current LTS has moved on. Affects CI, Docker images, and Terraform
   task definitions together.

Backend majors (Fastify, Prisma, TypeScript) are separable from the frontend chain and can
interleave wherever convenient.

### 2. Each slice proves itself the same way

For every bump: dependency update, codemod where the project ships one, full gate set,
then the app actually exercised in a browser — not just a green test run. UI framework
upgrades break things tests do not see.

### 3. React 19 needs a compatibility audit before it is scheduled

React 19 is the one bump where the ecosystem, not the codebase, decides the timeline. The
audit answers: do the installed Radix versions support it, does Testing Library, does the
Vite plugin, and does anything in the tree still rely on behavior React 19 changed.

If the audit finds blockers, the slice is "upgrade the blockers," and React moves behind
them.

## Data Model / API Surface Implications

None directly. A Prisma major could affect generated client shape, which would ripple
through DTOs and OpenAPI — that bump needs `api:check` and `api:validate` treated as
first-class gates rather than afterthoughts.

## Dependencies

- **Plan 136 should land first.** Upgrading frameworks against a half-migrated test setup
  means every failure has two candidate causes.
- **Plan 135 should land first.** ESLint config changes with major versions of the
  plugins; doing the scanner migration into a config that is about to change is rework.
- **Everything else in 132–139** — this plan is scheduled last by design.

## Execution Sequence

**First — establish current targets.** Check the registry and release notes for every
direct dependency. Produce the actual upgrade list; this plan's table above is a snapshot,
not the target.

**Then — one slice per bump**, in the blast-radius order above, each with its own gate run
and browser check.

## Open Questions

- **Is there a reason to upgrade React at all,** beyond currency? If nothing in the repo
  wants React 19's additions and 18.3 remains supported, this may be worth deferring
  again rather than doing because it is on the list.
- **Does Tailwind's major justify the visual re-verification cost** on an app whose theme
  discipline is enforced by scanners that would all need review?
- **Should mobile clients be considered here?** `clients/ios` and `clients/android` are
  planned but unbuilt; if they stay unbuilt, their absence from this plan is correct.

## Sources / Prior Decisions

- Plan 135 — Rule scanners to ESLint (config changes with plugin majors)
- Plan 136 — Test runner and layer consolidation (the safety net for this work)
