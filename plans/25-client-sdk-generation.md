# Plan 25: OpenAPI Client SDK Generation — Replace Manual API Calls

## Problem

We currently have three layers of manual wiring between frontend and backend:
1. `API_ROUTES` constants in `packages/shared/api-routes.ts` — manually maintained path strings
2. `clientPath()` helper — strips `/api` prefix for the frontend api-client
3. Manual `api.get<SomeDto>(clientPath(API_ROUTES.xxx))` calls in every hook

This works but is redundant: the OpenAPI spec (generated from Fastify route schemas + Zod DTOs) already contains all the information needed to produce a fully typed client automatically. The `API_ROUTES` constants and `clientPath()` helper are workarounds that should be replaced.

## Solution

Generate a typed API client from the OpenAPI spec using `openapi-typescript` + `openapi-fetch`. The generated client provides:
- **Path autocomplete** — `client.GET('/api/v1/leagues')` with full IntelliSense
- **Request/response types inferred from the spec** — no manual `<LeagueListResponse>` needed
- **Compile-time errors when routes change** — if a path is renamed/removed, TypeScript catches it
- **Request body validation** — can't pass wrong fields

## Architecture

```
Fastify route schemas (Zod DTOs + zodToJsonSchema)
  ↓
@fastify/swagger generates OpenAPI spec at startup
  ↓
npm script exports spec to packages/shared/generated/openapi.json
  ↓
openapi-typescript generates TypeScript types from spec
  ↓
openapi-fetch creates typed client wrapper
  ↓
Frontend hooks use: const { data } = client.GET('/api/v1/leagues')
```

## Action Plan

| ID | Phase | Task | Priority | Status | Notes |
|---|---|---|---|---|---|
| **Phase 1: Spec Export Pipeline** | | | | | |
| 25-001 | 1 | Create spec export script (`packages/core-api/scripts/export-openapi.ts`) | HIGH | Todo | Boots Fastify app (without listening), calls `app.swagger()`, writes JSON to `packages/shared/generated/openapi.json` |
| 25-002 | 1 | Add `openapi:export` npm script to core-api | HIGH | Todo | `"openapi:export": "tsx scripts/export-openapi.ts"` |
| 25-003 | 1 | Add spec export to CI build step | HIGH | Todo | Run after `npx turbo build` in the `build` job, before webapp/admin build |
| 25-004 | 1 | Add `packages/shared/generated/` to `.gitignore` — OR commit the spec | MEDIUM | Todo | Decision: commit the spec so frontends can build without running the backend. Add CI check that spec is up-to-date |
| **Phase 2: Type Generation** | | | | | |
| 25-005 | 2 | Install `openapi-typescript` in shared package | HIGH | Todo | `npm install -D openapi-typescript` |
| 25-006 | 2 | Create type generation script (`packages/shared/scripts/generate-api-types.ts`) | HIGH | Todo | Reads `generated/openapi.json`, outputs `generated/api-types.ts` |
| 25-007 | 2 | Add `openapi:types` npm script | HIGH | Todo | `"openapi:types": "openapi-typescript generated/openapi.json -o generated/api-types.ts"` |
| 25-008 | 2 | Add `./generated` export to shared package.json | HIGH | Todo | `"./generated": { "types": "./generated/api-types.ts" }` |
| **Phase 3: Typed Client** | | | | | |
| 25-009 | 3 | Install `openapi-fetch` in both client packages | HIGH | Todo | `npm install openapi-fetch` in clients/web and clients/admin |
| 25-010 | 3 | Create typed API client wrapper (`clients/web/src/lib/api-client-generated.ts`) | HIGH | Todo | Wraps `createClient<paths>()` from openapi-fetch with auth header injection |
| 25-011 | 3 | Create admin typed client (`clients/admin/src/lib/api-client-generated.ts`) | HIGH | Todo | Same pattern, may use different base URL |
| 25-012 | 3 | Add Vite aliases for `@poolmaster/shared/generated` | HIGH | Todo | Both web and admin vite.config.ts |
| **Phase 4: Migrate Hooks** | | | | | |
| 25-013 | 4 | Migrate auth hooks (login, register, callback, me) | HIGH | Todo | Replace `api.post<AuthResponse>(clientPath(...))` with `client.POST('/api/v1/auth/login', { body })` |
| 25-014 | 4 | Migrate dashboard hooks (my-leagues, active-contests, etc.) | HIGH | Todo | Replace `api.get<LeagueListResponse>(clientPath(...))` with `client.GET('/api/v1/leagues')` |
| 25-015 | 4 | Migrate billing hooks | MEDIUM | Todo | |
| 25-016 | 4 | Migrate discovery/search hooks | MEDIUM | Todo | |
| 25-017 | 4 | Migrate settings/profile hooks | MEDIUM | Todo | |
| 25-018 | 4 | Migrate contest/draft/standings hooks | HIGH | Todo | |
| 25-019 | 4 | Migrate all admin hooks | MEDIUM | Todo | |
| 25-020 | 4 | Migrate remaining hooks (social, notifications) | LOW | Todo | |
| **Phase 5: Remove Manual Wiring** | | | | | |
| 25-021 | 5 | Remove `packages/shared/api-routes.ts` | HIGH | Todo | No longer needed — paths come from the generated client |
| 25-022 | 5 | Remove `clientPath()` usage from all hooks | HIGH | Todo | Generated client handles full paths |
| 25-023 | 5 | Remove `API_ROUTES` imports from all test files | HIGH | Todo | Smoke tests and integration tests should use the spec paths directly or import from generated types |
| 25-024 | 5 | Remove old `clients/web/src/lib/api-client.ts` | HIGH | Todo | Replaced by generated client |
| 25-025 | 5 | Remove old `clients/admin/src/lib/api-client.ts` | HIGH | Todo | |
| 25-026 | 5 | Remove `api-routes` export from shared package.json | HIGH | Todo | |
| 25-027 | 5 | Remove Vite alias for `@poolmaster/shared/api-routes` | HIGH | Todo | |
| **Phase 6: Update Smoke/Integration Tests** | | | | | |
| 25-028 | 6 | Update smoke tests to use spec-derived paths | HIGH | Todo | Import paths from generated types or use the spec directly |
| 25-029 | 6 | Update integration tests | HIGH | Todo | Same approach |
| 25-030 | 6 | Remove enum-consistency and route-sync tests that are now redundant | MEDIUM | Todo | The spec IS the contract — no need for manual sync tests |
| **Phase 7: CI Pipeline Updates** | | | | | |
| 25-031 | 7 | Add OpenAPI spec generation to CI build job | HIGH | Todo | After backend build, before frontend build |
| 25-032 | 7 | Add spec freshness check to CI | HIGH | Todo | If spec is committed: `diff` check. If generated: build step order |
| 25-033 | 7 | Add type generation to CI | HIGH | Todo | After spec export, before frontend typecheck |
| 25-034 | 7 | Update `test-webapp` and `test-admin` CI jobs | MEDIUM | Todo | Ensure generated types are available before tests run |
| **Phase 8: Rules Updates** | | | | | |
| 25-035 | 8 | Update `rules/architecture-rules.md` | HIGH | Todo | Replace API_ROUTES documentation with generated client pattern |
| 25-036 | 8 | Update `rules/service-rules.md` | HIGH | Todo | Add: new routes automatically appear in generated client after spec regeneration |
| 25-037 | 8 | Update `rules/testing-rules.md` | HIGH | Todo | Update path references, remove API_ROUTES testing guidance |
| 25-038 | 8 | Update `rules/react-ui-rules.md` | HIGH | Todo | Replace `clientPath(API_ROUTES.*)` guidance with generated client usage |
| 25-039 | 8 | Update `rules/model-change-rules.md` | HIGH | Todo | Add: regenerate OpenAPI spec + types after route changes |

---

## Phase 3 Detail: Generated Client Pattern

```typescript
// clients/web/src/lib/api-client-generated.ts
import createClient from 'openapi-fetch';
import type { paths } from '@poolmaster/shared/generated';

const client = createClient<paths>({
  baseUrl: '/api',
});

// Add auth header interceptor
client.use({
  async onRequest({ request }) {
    const token = localStorage.getItem('access_token');
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
});

export { client };
```

## Phase 4 Detail: Hook Migration Pattern

```typescript
// BEFORE (manual wiring):
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import type { LeagueListResponse, LeagueSummaryDto } from '@poolmaster/shared/dto';

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async (): Promise<LeagueSummaryDto[]> => {
      const res = await api.get<LeagueListResponse>(clientPath(API_ROUTES.leagues.list));
      return res.leagues;
    },
  });
}

// AFTER (generated client):
import { client } from '@/lib/api-client-generated';

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async () => {
      const { data, error } = await client.GET('/api/v1/leagues');
      if (error) throw error;
      return data.leagues;
    },
  });
}
// Return type is automatically inferred from the OpenAPI spec.
// No manual type imports needed. Path is validated at compile time.
```

## Phase 5 Detail: What Gets Removed

| File/Module | Reason for Removal |
|---|---|
| `packages/shared/api-routes.ts` | Paths come from OpenAPI spec via generated client |
| `clientPath()` helper | Generated client handles full URL construction |
| `API_ROUTES` constant | Replaced by spec-derived paths with autocomplete |
| `clients/web/src/lib/api-client.ts` | Replaced by `api-client-generated.ts` |
| `clients/admin/src/lib/api-client.ts` | Same |
| Vite alias for `@poolmaster/shared/api-routes` | Module no longer exists |
| API_ROUTES imports in smoke/integration tests | Tests use spec-derived paths or raw strings (acceptable in tests hitting real servers) |

## Decision: Commit the Spec or Generate at Build Time?

**Recommendation: Commit `openapi.json` to the repo.**

Reasons:
- Frontend builds don't need a running backend
- PR reviewers can see spec changes in the diff
- Generated types are deterministic from the spec
- CI can verify the committed spec matches what the backend generates

Add a CI check: `npm run openapi:export && git diff --exit-code generated/openapi.json` — fails if the spec is stale.

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| 1: Spec export | 0.5 day | Plan 24 complete |
| 2: Type generation | 0.5 day | Phase 1 |
| 3: Typed client | 0.5 day | Phase 2 |
| 4: Hook migration | 1.5 days | Phase 3 |
| 5: Remove manual wiring | 0.5 day | Phase 4 |
| 6: Test updates | 1 day | Phase 5 |
| 7: CI updates | 0.5 day | Phase 1 |
| 8: Rules updates | 0.25 day | Phase 5 |

**Total: ~5 days, ~4 days critical path**

## Risks

| Risk | Mitigation |
|------|------------|
| `openapi-fetch` doesn't handle all response shapes | Validate with auth, leagues, billing endpoints first before full migration |
| Generated types don't match Zod DTOs exactly | The spec is derived from Zod → JSON Schema — they should match. Add CI check |
| Smoke tests need raw URLs (not generated client) | Smoke tests hit real servers via `fetch` — they can import paths from generated types or use raw strings |
| Breaking change if spec generation fails | Commit the spec; CI only warns if stale, doesn't block |
