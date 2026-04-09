## Objective

Address the valid, currently actionable findings from
`plans/codex-backend-refactor-lane-code-review-2.md`:

- contract and DTO hygiene in active backend routes
- mapper extraction where route handlers still map inline
- targeted contract/integration coverage additions
- small stale-contract cleanup items discovered by the review

This plan intentionally excludes:

- tenant/auth structural work already captured in Plan 63
- review items whose premise is stale or inaccurate
- broad repo-wide coverage improvement work beyond the concrete route/test gaps below

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Replace inline contest-management request schemas with shared DTO schemas | `contest-management/routes.ts` now uses the shared Zod DTOs already defined in `packages/shared/dto/contest-management.dto.ts` |
| Done | Replace passthrough and inline league route schemas with named DTOs | Invitations, invite link, dashboard, action-item resolution, audit-log, and league request bodies now use named DTO schemas |
| Done | Add ingestion DTOs and stop using `SuccessSchema` for structured ingestion responses | Added `packages/shared/dto/ingestion.dto.ts` and wired ingestion routes to it |
| Done | Convert remaining contest override inline request bodies to DTO schemas | Undo/pause/extend/adjust/reopen/close/extend-deadline/update-lock all moved to DTO-backed schemas |
| Done | Fix account-consent POST contract and use DTO request schema | Route now uses the DTO request schema and returns the created consent record DTO |
| Done | Convert draft request bodies to DTO schemas | Start draft, submit selection, and extend current turn now use DTO-backed schemas |
| Done | Extract events route mapping into `events.mapper.ts` | Event list route now routes through a dedicated mapper |
| Done | Add web/admin API contract integration suites | Added `api-contracts-web.integration.ts` and `api-contracts-admin.integration.ts` with Zod `.safeParse()` checks |
| Done | Add dedicated league-membership lifecycle integration coverage | Added `league-membership-crud.integration.ts` covering activate/inactivate/reactivate and role changes |
| Done | Add dedicated draft-session CRUD/state-transition integration coverage | Added `draft-session-crud.integration.ts` covering create/read/duplicate-start/ownership/not-found behavior |
| Done | Remove stale compiled `dist/` artifacts and rebuild generated outputs | Deleted `packages/core-api/dist` and `packages/shared/dist`, then rebuilt both packages |
| Done | Rename stale standings recalculation contract naming | Introduced `ContestRecalculationResponseSchema` and moved contest routes to it while keeping a compatibility alias |
| Done | Remove deferred `PREDICTION` participant scoring definition from active enum/catalog | Active participant scoring definition enum no longer advertises `PREDICTION` |
| Done | Add explicit request body schema to `/scoring/config/validate` | Route now declares an explicit Fastify-safe body schema instead of relying on untyped `request.body` |
| Done | Deepen a small set of shallow integration suites with negative-path cases | Added dedicated contract/membership/draft-session suites and regression-tested existing contest/league flows |

## Validation

- `npx turbo typecheck --filter=@poolmaster/core-api --filter=@poolmaster/shared --force`
- `npx eslint 'packages/core-api/src/**/*.ts' 'packages/shared/**/*.ts' 'tests/**/*.ts' --max-warnings 0`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:coverage:backend`
- `npm run api:export`
- `npm run api:validate`
- `npm run api:generate`
