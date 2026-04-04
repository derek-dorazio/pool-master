# Plan 33: Stability Hardening and Defect Discovery

> **Planning Note (2026-04-04):** Re-analyze current CI health, active MVP scope, and the latest coverage baselines before executing this plan. Use this plan to stabilize the system before resuming major feature expansion.

## Purpose

Drive the next stabilization phase now that CI/CD is green:

- finish remaining priority platform and architecture cleanup
- remove stale infrastructure and contract drift that could reintroduce defects
- increase defect-finding power in the fast local suites
- use those stronger suites to expose anti-patterns and remediate them before expanding product scope

## Why This Plan Exists

The repo is finally in a state where build, test, deploy, smoke, and browser sanity checks all pass. The next highest-value work is not new feature breadth. It is reducing latent defect risk and cleaning out stale patterns that can silently destabilize the codebase later.

Current focus should be:

- CI/CD hardening follow-through
- stale architecture cleanup, especially dead runtime assumptions like Redis
- stronger unit, Vitest, and DB-backed integration coverage
- discovery and removal of old anti-patterns

## Explicit Non-Goals For This Phase

- broadening smoke-test coverage aggressively
- broadening deploy-gate browser E2E aggressively
- adding major new feature families
- reactivating deferred contest types

## Workstreams

### Workstream 1: Platform and Architecture Cleanup

- finish remaining high-priority items from Plan 30
- remove stale Redis infrastructure/configuration/documentation
- eliminate other stale runtime assumptions that no longer match the architecture

### Workstream 2: Test Suite Maturity

- enforce local pre-push gates consistently
- add coverage thresholds at current baselines after cleanup
- increase unit, Vitest, and DB-backed integration coverage first
- treat smoke/E2E as stable confidence checks, not the main bug-finding layer

### Workstream 3: Anti-Pattern Discovery and Remediation

- look for stale wrappers, casts, dead compatibility code, and obsolete test patterns
- identify low-value suites that remain from earlier contract/SDK drift
- replace or remove them when stronger coverage already exists

## Current Assessment

- The old DB-heavy integration suites are already gone and replaced with focused CRUD/read/negative integration tests under `tests/integration/core-api`.
- The old broad API smoke suites are already gone and replaced with a small MVP-safe smoke layer.
- The old broad Playwright MVP journey suite is already removed from the required deploy gate and replaced with minimal browser sanity checks.
- The lingering compatibility/helper drift is now more likely to be in lower-level wrappers, stale docs, legacy package usage, and narrow old tests rather than in the previously-reset big suites.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| SHD-001 | Platform | Finish remaining Plan 30 priority items that directly improve deploy determinism and maintenance safety | In Progress | Current slice is Redis/stale-runtime cleanup first, then Node 20 action upgrades, Terraform hygiene, and remaining mutable/dead runtime assumptions |
| SHD-002 | Architecture | Remove Redis from Terraform, ECS config, docs, and runtime assumptions if it is no longer part of the active architecture | In Progress | Inventory confirmed no real runtime Redis client usage. Cleanup is now underway across Terraform, CI, docker compose, admin health contracts, and docs; remaining work is generated artifact refresh and dependency cleanup |
| SHD-003 | Test Strategy | Keep smoke and deploy-gate browser E2E intentionally narrow until fast local suites are stronger | In Progress | This is now the active policy; use Jest/Vitest/DB integration as the main defect-discovery engines |
| SHD-004 | Coverage | Implement coverage threshold enforcement at the current measured baselines after collector cleanup | In Progress | Backend coverage collector noise has been cleaned, fresh baselines have been remeasured, and threshold wiring is underway in Jest/Vitest plus the local pre-push rules. |
| SHD-005 | Test Cleanup | Audit lingering low-value compatibility/contract suites and remove or rewrite any that no longer add signal | In Progress | Initial assessment: the old DB-heavy integration and broad smoke suites are already gone; continue scanning for stale lower-level wrappers/tests. If a suite looks removable rather than fixable, confirm with the user before deleting it |
| SHD-006 | Defect Discovery | Increase coverage in backend Jest, web Vitest, admin Vitest, and DB-backed integration by targeting brittle or under-tested MVP areas | Not Started | Use failures and uncovered high-risk modules to drive remediation work |
| SHD-007 | Anti-Patterns | Inventory and remove stale wrappers, legacy package usage, unsafe casts, and dead compatibility helpers that survived the earlier remediation | Not Started | Likely candidates include old generated-client wrapper patterns, obsolete package dependencies, and stale docs/rules assumptions |

## Acceptance Criteria

- CI/CD hardening work is tracked to completion with the remaining priority platform risks either fixed or explicitly deferred
- Redis and any similar dead architectural assumptions are removed or clearly justified
- Coverage thresholds are enforced at current baseline levels
- Fast local suites become the primary defect-discovery layer
- Lingering low-value compatibility suites and stale anti-patterns are identified and either removed or replaced with stronger tests
