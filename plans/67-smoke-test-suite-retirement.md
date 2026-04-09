## Objective

Retire the current deployed smoke-test suite as the acceptance gate now that the functional API suite provides stronger, faster pre-merge service-stack verification.

The old smoke suite should no longer be the place where detailed backend use-case validation lives.

## Direction

- Move backend CRUD/use-case/service validation into the local + CI functional API suite.
- Do not keep the old smoke suite alive as a temporary parallel gate.
- A future thin deployment-health check may be reintroduced later in a dedicated slice, but it is not part of the active baseline now.

This plan is blocked until Plan 66 has established functional coverage for the backend flows that currently justify the smoke suite.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Inventory the current smoke-test suite and CI jobs | The retired suite consisted of `tests/api/functional/mvp-baseline.smoke.ts`, `tests/api/functional/contest-lifecycle.smoke.ts`, `tests/api/jest.config.ts`, root smoke scripts, and the QA `smoke-test` workflow job. |
| Done | Map each current smoke test to its replacement functional coverage | The replacement direction now runs through the backend functional API suite from Plans 64 and 66 rather than keeping a parallel smoke acceptance layer. |
| Removed | Lock the retained deployed verification minimum | Deferred until a later deployment-health slice is explicitly planned; this cleanup pass removes the old smoke suite first. |
| Done | Remove smoke tests that duplicate functional API suite coverage | Deleted the old `tests/api` smoke suite and removed the active smoke scripts. |
| Done | Remove smoke-test gate expectations from local and CI flows | Root scripts, CI smoke job, AGENTS guidance, and rules/docs no longer treat smoke as an active gate. |
| Done | Update workflow/testing docs to reflect the new strategy | Functional API coverage is now the active backend gate in repo guidance. |
| Pending | Archive or delete stale smoke planning docs if they no longer apply | Keep only intentional, active guidance |

## Validation

- Functional API suite is green and wired into CI before smoke removal is finalized
- CI passes without the old smoke suite
- Documentation and rules no longer refer to retired smoke behavior as an active quality gate
