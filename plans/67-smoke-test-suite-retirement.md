## Objective

Retire the current deployed smoke-test suite as the primary acceptance gate now that the functional API suite will provide stronger, faster pre-merge service-stack verification.

The old smoke suite should no longer be the place where detailed backend use-case validation lives.

## Direction

- Move backend CRUD/use-case/service validation into the local + CI functional API suite.
- Keep only a very thin deployed verification layer rather than the current broad smoke suite.

Recommended retained minimum:

- `deployment-health.smoke.ts`
  - health endpoint returns 200
  - one authenticated round-trip proves the deployed stack is wired

This plan is blocked until Plan 66 has established functional coverage for the backend flows that currently justify the smoke suite.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Inventory the current smoke-test suite and CI jobs | Identify scripts, workflow jobs, docs, and routes currently covered by `tests/api/functional/*.smoke.ts` |
| Pending | Map each current smoke test to its replacement functional coverage | Do not delete a smoke flow until its corresponding functional suite coverage exists |
| Pending | Lock the retained deployed verification minimum | Keep only the thin deployment sanity layer, not use-case coverage |
| Pending | Remove smoke tests that duplicate functional API suite coverage | Delete or archive flows once equivalent functional coverage exists |
| Pending | Remove smoke-test gate expectations from local and CI flows | Update package scripts, workflow docs, AGENTS/rules references, and CI job dependencies, including the old browser-E2E dependency chain |
| Pending | Update workflow/testing docs to reflect the new strategy | Functional API suite becomes the backend gate; smoke is reduced or retired |
| Pending | Archive or delete stale smoke planning docs if they no longer apply | Keep only intentional, active guidance |

## Validation

- Functional API suite is green and wired into CI before smoke removal is finalized
- CI passes with the reduced deployment smoke layer
- Documentation and rules no longer refer to retired smoke behavior as an active quality gate
