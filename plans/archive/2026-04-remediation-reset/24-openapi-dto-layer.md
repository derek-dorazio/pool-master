# Plan 24: OpenAPI 3.2 Specification & Shared DTO Layer

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Problem Statement

The monorepo has three layers that should share a single API contract but don't:

1. **Backend handlers** return raw objects with untyped shapes — no response schemas defined
2. **Shared domain types** mix persistence entities, domain objects, and config shapes — not suitable as API contracts
3. **Frontend hooks** define their own response interfaces locally — they drift from actual API responses

This caused real bugs: `LoginResponse.token` vs actual `tokens.accessToken`, `League[]` vs `{ leagues: League[] }`, etc.

## Architecture

```
Prisma Schema → Domain Entities → DTO Mappers → API Response (JSON)
                                       ↑                ↓
                              Zod DTO Schemas    OpenAPI 3.2 Spec
                                       ↑                ↓
                              Frontend Hooks     Swagger UI / SDK
```

**Zod DTO schemas are the single source of truth.** They produce:
- TypeScript types via `z.infer<>` (for frontend + backend)
- JSON Schema via `zod-to-json-schema` (for Fastify validation + OpenAPI spec)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OpenAPI version | 3.2 (latest, 2025) | Uses JSON Schema 2020-12, aligns with Fastify's native validation |
| Schema source of truth | TypeScript + Zod | Team works in TS; Zod gives runtime validation + static types from one definition |
| DTO naming | `Create{Resource}Request`, `{Resource}Response`, `{Resource}SummaryDto` | Clear intent, avoids confusion with domain entities |
| Date format | ISO 8601 strings in DTOs | Never `Date` objects over the wire |
| DTO location | `packages/shared/dto/` | Consumed by backend (mappers), frontend (hooks), and tests |
| Error envelope | Standardized `{ error, message, details? }` | Consistent error handling across all endpoints |

## Action Plan

| ID | Phase | Task | Priority | Status | Notes |
|---|---|---|---|---|---|
| **Phase 1: OpenAPI + Fastify** | | | | | |
| 24-001 | 1 | Install `@fastify/swagger` + `@fastify/swagger-ui` | HIGH | Todo | In core-api package |
| 24-002 | 1 | Create swagger plugin config (OpenAPI 3.2) | HIGH | Todo | `plugins/swagger.ts` — info, servers, security schemes, tags |
| 24-003 | 1 | Register swagger plugin in index.ts | HIGH | Todo | Before all route modules |
| 24-004 | 1 | Add tags + operationId to all route modules (18 modules) | MEDIUM | Todo | Groups routes in Swagger UI |
| 24-005 | 1 | Add description/summary to all routes | LOW | Todo | Human-readable docs |
| 24-006 | 1 | Verify spec at /docs | HIGH | Todo | Start dev, confirm all routes visible |
| **Phase 2: Shared DTO Module** | | | | | |
| 24-007 | 2 | Install `zod-to-json-schema` in shared package | HIGH | Todo | Bridge between Zod and OpenAPI |
| 24-008 | 2 | Create `common.dto.ts` (error, pagination, primitives) | HIGH | Todo | `ApiError`, `PaginatedResponse<T>`, date/id types |
| 24-009 | 2 | Create `auth.dto.ts` | HIGH | Todo | Register/Login/Refresh request + response schemas |
| 24-010 | 2 | Create `leagues.dto.ts` | HIGH | Todo | CRUD request/response + `LeagueSummaryDto` |
| 24-011 | 2 | Create `contests.dto.ts` | HIGH | Todo | CRUD + `ContestSummaryDto` |
| 24-012 | 2 | Create `drafts.dto.ts` | HIGH | Todo | Start/Pick request + `DraftStateResponse` |
| 24-013 | 2 | Create `standings.dto.ts` | MEDIUM | Todo | Query params + standings response |
| 24-014 | 2 | Create `billing.dto.ts` | MEDIUM | Todo | Plan, usage, invoices |
| 24-015 | 2 | Create `participants.dto.ts` | MEDIUM | Todo | Participant profiles, contest pools |
| 24-016 | 2 | Create `search.dto.ts` | MEDIUM | Todo | Search results, discovery |
| 24-017 | 2 | Create `notifications.dto.ts` | MEDIUM | Todo | Notification list, preferences |
| 24-018 | 2 | Create `admin.dto.ts` | MEDIUM | Todo | Tenants, users, flags, announcements |
| 24-019 | 2 | Create `social.dto.ts`, `config.dto.ts`, `ingestion.dto.ts` | LOW | Todo | Lower-traffic endpoints |
| 24-020 | 2 | Create `dto/index.ts` barrel + add `./dto` export to package.json | HIGH | Todo | |
| 24-021 | 2 | Create `zodToJsonSchema` utility wrapper | HIGH | Todo | Used by route schemas |
| **Phase 3: Backend Mappers** | | | | | |
| 24-022 | 3 | Create `mappers/` directory with auth, leagues, contests mappers | HIGH | Todo | `toLeagueSummaryDto()`, `toAuthTokensResponse()`, etc. |
| 24-023 | 3 | Create remaining mappers (drafts, standings, billing, admin, etc.) | MEDIUM | Todo | One mapper per domain group |
| 24-024 | 3 | Update auth handlers to use mappers + DTO response types | HIGH | Todo | `reply.send(toAuthResponse(result))` |
| 24-025 | 3 | Update league handlers to use mappers | HIGH | Todo | |
| 24-026 | 3 | Update all remaining handlers | HIGH | Todo | ~15 handler files |
| 24-027 | 3 | Add `schema.response` to all route definitions | HIGH | Todo | JSON Schema from Zod DTOs |
| 24-028 | 3 | Enable Fastify response serialization | MEDIUM | Todo | Strips unknown fields (prevents data leakage) |
| **Phase 4: Frontend DTO Consumption** | | | | | |
| 24-029 | 4 | Migrate dashboard hooks to shared DTOs | HIGH | Todo | use-my-leagues, use-active-contests, etc. |
| 24-030 | 4 | Migrate contest/draft/standings hooks | HIGH | Todo | Remove local interfaces |
| 24-031 | 4 | Migrate billing/discovery/notification hooks | MEDIUM | Todo | |
| 24-032 | 4 | Migrate all admin hooks | MEDIUM | Todo | use-admin-api, use-config-api, etc. |
| 24-033 | 4 | Move inline mock data to `__fixtures__/` typed against DTOs | LOW | Todo | |
| 24-034 | 4 | Optional: add Zod validation in dev-mode api-client | LOW | Todo | Catches drift in development |
| **Phase 5: Contract Testing** | | | | | |
| 24-035 | 5 | Create OpenAPI spec export script | HIGH | Todo | Boots Fastify, calls `app.swagger()`, writes JSON |
| 24-036 | 5 | Create contract test validator helper | HIGH | Todo | `validateResponse(method, path, status, body)` |
| 24-037 | 5 | Create dedicated contract test suite (per module) | HIGH | Todo | Validates responses against spec |
| 24-038 | 5 | Add OpenAPI generation + validation to CI | MEDIUM | Todo | |
| 24-039 | 5 | Add Zod parse assertions in handler unit tests | MEDIUM | Todo | `DtoSchema.safeParse(response.json())` |
| **Phase 6: Optional — Client SDK Generation** | | | | | |
| 24-040 | 6 | Install openapi-typescript + openapi-fetch | LOW | Todo | Auto-generate typed client from spec |
| 24-041 | 6 | Create type generation script | LOW | Todo | |
| 24-042 | 6 | Migrate hooks to generated client | LOW | Todo | `client.GET('/api/v1/leagues')` — fully typed |
| **Phase 7: Rules Updates** | | | | | |
| 24-043 | 7 | Update `rules/architecture-rules.md` | HIGH | Todo | Add DTO layer to architecture diagram, document hex architecture boundaries |
| 24-044 | 7 | Update `rules/service-rules.md` | HIGH | Todo | Add: handlers MUST return mapped DTOs, never raw Prisma/domain objects. New routes MUST have response schemas. |
| 24-045 | 7 | Update `rules/testing-rules.md` | HIGH | Todo | Add: contract tests required for new endpoints. Response assertions MUST use DTO schemas. |
| 24-046 | 7 | Update `rules/model-change-rules.md` | HIGH | Todo | Add DTO layer to the 19-step checklist: after domain types, update DTOs + mappers + response schemas |
| 24-047 | 7 | Update `rules/react-ui-rules.md` | HIGH | Todo | Add: hooks MUST import response types from `@poolmaster/shared/dto`, NEVER define local interfaces |

---

## Phase 2 Detail: DTO Schema Pattern

```typescript
// packages/shared/dto/auth.dto.ts
import { z } from 'zod';

// --- Requests ---
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// --- Responses ---
export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

export const UserProfileDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type UserProfileDto = z.infer<typeof UserProfileDtoSchema>;

export const LoginResponseSchema = z.object({
  user: UserProfileDtoSchema,
  tokens: AuthTokensSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

## Phase 3 Detail: Mapper Pattern

```typescript
// packages/core-api/src/mappers/leagues.mapper.ts
import type { LeagueSummaryDto, LeagueListResponse } from '@poolmaster/shared/dto';

export function toLeagueSummaryDto(row: PrismaLeagueRow): LeagueSummaryDto {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    memberCount: row._count?.memberships ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLeagueListResponse(rows: PrismaLeagueRow[]): LeagueListResponse {
  return { leagues: rows.map(toLeagueSummaryDto) };
}
```

## Phase 3 Detail: Route with Response Schema

```typescript
import { zodToJsonSchema } from '@poolmaster/shared/dto/json-schema';
import { LeagueListResponseSchema } from '@poolmaster/shared/dto';

fastify.get('/', {
  schema: {
    tags: ['Leagues'],
    operationId: 'listLeagues',
    response: { 200: zodToJsonSchema(LeagueListResponseSchema) },
  },
  handler: league.listLeagues,
});
```

## Phase 7 Detail: Rules Updates

### architecture-rules.md additions:
- Add "DTO Layer" to the architecture diagram between Domain and API
- Document: Prisma types → Domain entities → **DTOs** → JSON responses
- Rule: DTOs are the API contract. They live in `packages/shared/dto/`
- Rule: Backend handlers NEVER return Prisma types or domain entities directly

### service-rules.md additions:
- Every new route handler MUST return a mapped DTO, not a raw object
- Every route MUST define `schema.response` with JSON Schema derived from DTO Zod schema
- Every route MUST have `tags`, `operationId`, and `summary` for OpenAPI docs
- DTO Zod schemas use `z.string().datetime()` for dates, never `Date` objects

### testing-rules.md additions:
- Contract tests MUST validate responses against DTO Zod schemas
- New endpoints MUST have a contract test in `tests/contract/`
- Test mock data MUST satisfy DTO schema types (import from `@poolmaster/shared/dto`)
- Integration tests SHOULD parse response bodies with `DtoSchema.safeParse()` for shape validation

### model-change-rules.md additions (insert after step 5 "services"):
- Step 5a: Create/update DTO schema in `packages/shared/dto/{module}.dto.ts`
- Step 5b: Create/update mapper in `packages/core-api/src/mappers/{module}.mapper.ts`
- Step 5c: Update route `schema.response` with new DTO JSON Schema
- Step 5d: Regenerate `openapi.json` and verify spec is valid

### react-ui-rules.md additions:
- Hooks MUST import response types from `@poolmaster/shared/dto`, NEVER define local interfaces
- API calls MUST be typed with shared DTOs: `api.get<LeagueListResponse>(...)`
- If a DTO doesn't exist for your endpoint, create one in shared/dto FIRST

## Estimated Effort

| Phase | Effort | Can Parallel? |
|-------|--------|---------------|
| 1: OpenAPI setup | ~2 days | Yes (with Phase 2) |
| 2: DTO module | ~3 days | Yes (with Phase 1) |
| 3: Backend mappers | ~3 days | After Phase 2 |
| 4: Frontend migration | ~2 days | After Phase 2, overlaps Phase 3 |
| 5: Contract testing | ~2 days | After Phases 1 + 3 |
| 6: SDK generation | ~1 day | After Phase 5 (optional) |
| 7: Rules updates | ~0.5 day | After Phase 2 |

**Total: ~13 days, ~8 days on critical path (Phases 2→3→5)**

## Files to Create

| File | Purpose |
|------|---------|
| `packages/core-api/src/plugins/swagger.ts` | OpenAPI 3.2 + Swagger UI config |
| `packages/shared/dto/common.dto.ts` | Error envelope, pagination, primitives |
| `packages/shared/dto/auth.dto.ts` | Auth request/response schemas |
| `packages/shared/dto/leagues.dto.ts` | League CRUD schemas |
| `packages/shared/dto/contests.dto.ts` | Contest CRUD schemas |
| `packages/shared/dto/drafts.dto.ts` | Draft state/pick schemas |
| `packages/shared/dto/standings.dto.ts` | Standings response schemas |
| `packages/shared/dto/billing.dto.ts` | Billing plan/usage schemas |
| `packages/shared/dto/participants.dto.ts` | Participant profile schemas |
| `packages/shared/dto/search.dto.ts` | Search/discovery schemas |
| `packages/shared/dto/notifications.dto.ts` | Notification schemas |
| `packages/shared/dto/admin.dto.ts` | Admin panel schemas |
| `packages/shared/dto/social.dto.ts` | Social/feed schemas |
| `packages/shared/dto/config.dto.ts` | Platform config schemas |
| `packages/shared/dto/json-schema.ts` | `zodToJsonSchema()` utility |
| `packages/shared/dto/index.ts` | Barrel export |
| `packages/core-api/src/mappers/*.ts` | Entity → DTO mappers (one per domain) |
| `packages/core-api/scripts/export-openapi.ts` | Spec export for CI |
| `tests/contract/*.contract.test.ts` | Contract test suite |
