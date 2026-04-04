# Coverage Threshold Ratchet

> **Planning Note (2026-04-04):** Re-measure current coverage before implementing threshold changes, especially if coverage include/exclude rules or generated-file handling changes. Treat the numbers below as the starting baseline for the next implementation pass, not as a forever target.

## Purpose

Enforce coverage floors in local development and GitHub CI so new code cannot quietly land without tests, while using the current real suite coverage as the initial threshold baseline.

This plan exists to:

- make coverage regressions fail locally before commit
- make coverage regressions fail in GitHub CI
- preserve the current real baseline first
- ratchet coverage upward over time instead of trying to jump to an unrealistic target all at once

## Current Baseline

These are the current measured totals and should be used as the initial threshold floor on the first implementation pass:

| Suite | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Backend Jest | 21.85% | 13.09% | 17.50% | 24.01% |
| Web Vitest | 47.60% | 40.64% | 47.19% | 50.10% |
| Admin Vitest | 21.34% | 15.29% | 16.18% | 22.78% |

## Scope

In scope:

- [tests/jest.config.js](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/jest.config.js)
- [clients/web/vitest.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/vitest.config.ts)
- [clients/admin/vitest.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/vitest.config.ts)
- CI coverage reporting and artifact visibility
- follow-up plan increments to raise thresholds over time

Out of scope:

- artificially inflating coverage with trivial tests
- hiding untested code with broad exclusions
- changing thresholds without re-measuring real suite output

## Design Rules

- Thresholds should fail locally and in GitHub CI.
- Initial thresholds should match the current real measured baseline.
- Generated files and config files that should not count toward backend product coverage must be explicitly excluded rather than tolerated as noisy breakage.
- Coverage summaries should be visible in:
  - job logs
  - GitHub step summaries
  - uploaded CI artifacts
- Threshold increases should happen in small ratchet steps with updated plan notes.

## Implementation Notes

Backend likely needs cleanup before the thresholds are practical:

- exclude generated client files from Jest coverage collection
- exclude tool/config files such as [openapi-ts.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/openapi-ts.config.ts) from backend coverage collection
- restore a clean summary JSON output path so coverage totals are easy to inspect and enforce

## Ratchet Strategy

1. Enforce the current baseline exactly.
2. Stabilize the collector configuration so coverage outputs are deterministic.
3. Raise floors in small increments, likely by suite rather than globally.
4. Update this plan each time thresholds move.

Example ratchet style:

- backend: raise lines/statements first once collector noise is fixed
- web: raise branches and lines in small increments
- admin: raise from the current low baseline as core admin surfaces gain tests

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| CTR-001 | Backend | Clean Jest coverage collection so generated/config files do not break or distort backend coverage | Not Started | Exclude generated and tool-config files intentionally rather than letting coverage fail noisily |
| CTR-002 | Thresholds | Add backend coverage thresholds to [tests/jest.config.js](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/jest.config.js) using the current baseline | Not Started | Statements 21.85, branches 13.09, functions 17.50, lines 24.01 |
| CTR-003 | Thresholds | Add web coverage thresholds to [clients/web/vitest.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/vitest.config.ts) using the current baseline | Not Started | Statements 47.60, branches 40.64, functions 47.19, lines 50.10 |
| CTR-004 | Thresholds | Add admin coverage thresholds to [clients/admin/vitest.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/vitest.config.ts) using the current baseline | Not Started | Statements 21.34, branches 15.29, functions 16.18, lines 22.78 |
| CTR-005 | CI Visibility | Upload coverage artifacts and print actual totals to logs in CI | Not Started | Make coverage easier to retrieve from GitHub UI and CLI |
| CTR-006 | Policy | Update rules/docs so local and CI coverage thresholds are treated as required quality gates | Not Started | Keep AGENTS/rules/docs aligned once the thresholds are live |
| CTR-007 | Ratchet | Define the first threshold increase after the baseline gate is stable | Not Started | Do not raise until the initial enforced baseline is proven stable |

## Acceptance Criteria

- Local backend, web, and admin test commands fail if coverage drops below the current baseline thresholds.
- GitHub CI fails if coverage drops below those same thresholds.
- Coverage totals are easy to retrieve from logs, summaries, or artifacts.
- Backend coverage collection is clean enough that thresholds reflect real code coverage rather than generated-file noise.
- Future increases are tracked explicitly in this plan instead of being changed ad hoc.
