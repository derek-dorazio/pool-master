## Objective

Retire the current deployed smoke-test suite as the primary acceptance gate now that the functional API suite will provide stronger, faster pre-merge service-stack verification.

The old smoke suite should no longer be the place where detailed backend use-case validation lives.

## Direction

- Move backend CRUD/use-case/service validation into the local + CI functional API suite.
- Reduce deployed smoke to either:
  - a very thin health/deployment verification layer, or
  - remove it entirely until a later deployment-validation strategy is intentionally reintroduced.

This plan assumes the functional API suite from Plan 66 becomes the active gate first.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Inventory the current smoke-test suite and CI jobs | Identify scripts, workflow jobs, docs, and routes currently covered by `tests/api/functional/*.smoke.ts` |
| Pending | Decide the retained deployed verification minimum | Likely health-only or a tiny deployment sanity layer, not use-case coverage |
| Pending | Remove smoke tests that duplicate functional API suite coverage | Delete or archive flows once equivalent functional coverage exists |
| Pending | Remove smoke-test gate expectations from local and CI flows | Update package scripts, workflow docs, AGENTS/rules references, and CI job dependencies |
| Pending | Update workflow/testing docs to reflect the new strategy | Functional API suite becomes the backend gate; smoke is reduced or retired |
| Pending | Archive or delete stale smoke planning docs if they no longer apply | Keep only intentional, active guidance |

## Validation

- Functional API suite is green and wired into CI before smoke removal is finalized
- CI passes without the old smoke gate
- Documentation and rules no longer refer to retired smoke behavior as an active quality gate
