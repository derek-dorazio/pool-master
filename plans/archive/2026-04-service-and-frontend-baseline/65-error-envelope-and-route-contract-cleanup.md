# Plan 65: Error Envelope And Route Contract Cleanup

> Archived on 2026-04-09 after the shared nested error envelope, route-level error schema cleanup, and negative-path contract coverage all landed. Use this file only as historical cleanup context.

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

## Dependencies

- Can start independently.
- Must coordinate with [plans/63-tenant-removal-and-auth-redesign.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/63-tenant-removal-and-auth-redesign.md) before touching auth-route internals so the same routes are not refactored twice in conflicting ways.
- Should coordinate with [plans/69-poolmaster-webapp-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/69-poolmaster-webapp-rebuild.md) because tightening error contracts will directly affect the new frontend’s expectations.

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
- functional/integration tests that assert error shape, not just status code

## Compatibility Note

The target nested envelope:

```ts
{
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

is intentionally different from the older flat error payload shape still present in parts of the codebase.

This should be treated as an intentional contract cleanup and coordinated with frontend cutover work. Do not flip large route groups casually without accounting for active consumers.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Inventory active backend routes that do not yet use a consistent error envelope | Major categories: mixed flat `{ error, message }` responses in route handlers, bespoke `{ success: false }`/raw 400s in draft and contest override flows, `SuccessSchema`/generic success responses on route files that return domain data, and raw Fastify default-ish responses in admin/permissions helpers. Plan 63-owned auth routes were left untouched for now. |
| Done | Add shared backend error DTO/schema package support | Added `packages/shared/dto/errors.dto.ts` with the standard nested envelope Zod schema and exported it from the shared DTO index. |
| Done | Normalize global Fastify error formatting | `globalErrorHandler` now produces the shared nested envelope, is registered in the app build, and the integration harness uses the same handler. |
| Done | Standardize domain error translation in high-traffic modules | Completed for leagues, contest CRUD, contest overrides, contest management, standings, participants, history reads, draft route helpers, auth routes, auth guard, permission guards, squads, invitations, and active root-admin handlers. The scoring validation endpoint remains an intentional non-envelope `400` exception because it returns a validation-result DTO. |
| Done | Declare route-level error response schemas for active product routes | Added shared error schemas across active league, contest, contest-management, standings, history, participant, squad, draft, scoring, ingestion, invitations, auth, and root-admin routes. |
| Done | Replace bespoke inline error bodies on touched routes | Active league/contest/contest-management/standings/history/participant/squad/root-admin/auth flows now use the shared helper, and draft routes normalize legacy literals through the shared envelope helper. The scoring validation response body remains intentionally domain-specific. |
| Done | Add functional/integration coverage for error envelopes | Functional helper now understands the shared nested envelope, and integration contract coverage asserts the envelope on representative negative web, auth, draft, contest-management, squad, and root-admin routes. |
| Done | Add negative integration coverage for critical flows | Added unauthorized/not-found/permission/configuration envelope assertions for active web-facing, auth, draft, contest-management, squad, and root-admin routes. |
| Done | Document remaining non-conforming routes and defer if needed | Remaining non-conforming groups are now tracked explicitly below so the stricter rule can be adopted incrementally without rediscovering the tail each time. |
| Done | Tighten service rules after implementation reaches the route-compliance gate | `rules/service-rules.md` now treats the shared nested envelope as the backend standard, with the scoring configuration validation endpoint called out as the intentional exception. |

## Suggested Execution Order

1. Shared error DTO/schema and global formatter
2. Route inventory and high-traffic module cleanup
3. Functional and integration error-shape coverage
4. Residual-route inventory and stricter rule adoption

## Remaining Route Groups

The only intentionally non-standard active route after the current pass is:

- the scoring configuration validation endpoint, which intentionally returns a validation-result DTO on `400` instead of the generic error envelope

## Validation

- `npx turbo typecheck --filter=@poolmaster/core-api --filter=@poolmaster/shared --force`
- `npx eslint 'packages/core-api/src/**/*.ts' 'packages/shared/**/*.ts' 'tests/**/*.ts' --max-warnings 0`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/jest.config.js --forceExit`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/integration/jest.config.js --forceExit`
- `npm run api:export`
- `npm run api:validate`
- `npm run api:generate`
