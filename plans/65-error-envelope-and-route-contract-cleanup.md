## Objective

Proactively standardize backend error handling and route error contracts so the repo can later enforce a stricter universal error-envelope rule without putting the whole codebase into immediate violation.

This plan focuses on:

- adopting a shared backend error envelope for active and touched routes
- normalizing Fastify/global error formatting
- replacing ad hoc route-level error shapes with shared DTOs
- adding contract/integration coverage for error responses

This plan intentionally excludes:

- tenant/auth redesign work already captured in Plan 63
- frontend error-state implementation details beyond contract alignment
- unrelated success-response DTO cleanup already handled in Plan 64

## Target Standard

All new and materially changed backend routes should converge on:

```ts
{
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

With the following expectations:

- domain-specific error codes for not-found and authorization failures
- structured validation details when available
- shared DTO/schema definition in `packages/shared/dto/`
- route schemas that declare relevant error responses
- contract and integration tests that assert error shape, not just status code

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Inventory active backend routes that do not yet use a consistent error envelope | Identify route groups, current error shapes, and whether they rely on raw Fastify defaults, thrown domain errors, or bespoke reply bodies |
| Pending | Add shared backend error DTO/schema package support | Introduce shared error envelope DTOs and reusable schema helpers in `packages/shared/dto/` |
| Pending | Normalize global Fastify error formatting | Ensure unhandled and translated domain errors flow through one consistent formatter where practical |
| Pending | Standardize domain error translation in high-traffic modules | Prioritize auth, leagues, squads, contests, draft, scoring, history, ingestion, and consent routes |
| Pending | Declare route-level error response schemas for active product routes | Add `400`, `401`, `403`, `404` response schemas where they are relevant and realistic |
| Pending | Replace bespoke inline error bodies on touched routes | Remove one-off `{ message }`, `{ success: false }`, or raw Fastify-style error responses where route work already touches that surface |
| Pending | Add API contract coverage for error envelopes | Extend contract suites to `safeParse()` representative error responses for active web/admin routes |
| Pending | Add negative integration coverage for critical flows | Assert status code plus error-envelope shape for validation, auth, permission, and not-found scenarios |
| Pending | Document remaining non-conforming routes and defer if needed | Keep a short tracked list of routes intentionally left for later so the stricter rule can be adopted incrementally |
| Pending | Tighten service rules after implementation reaches acceptable coverage | Once the active route surface is mostly compliant, update `rules/service-rules.md` from “new/touched routes” to the stricter universal standard |

## Suggested Execution Order

1. Shared error DTO/schema and global formatter
2. Route inventory and high-traffic module cleanup
3. Contract and integration error-shape coverage
4. Residual-route inventory and stricter rule adoption

## Validation

- `npx turbo typecheck --filter=@poolmaster/core-api --filter=@poolmaster/shared --force`
- `npx eslint 'packages/core-api/src/**/*.ts' 'packages/shared/**/*.ts' 'tests/**/*.ts' --max-warnings 0`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/jest.config.js --forceExit`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/integration/jest.config.js --forceExit`
- `npm run api:export`
- `npm run api:validate`
- `npm run api:generate`
