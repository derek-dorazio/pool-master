# PoolMaster — Service Rules

These rules govern backend services in `packages/*/src`, especially Fastify modules, Prisma-backed services, DTOs, mappers, and OpenAPI generation.

---

## 1. Core Standards

- Use TypeScript strict mode.
- Use English for code and documentation.
- Avoid `any`.
- Prefer explicit return types on exported functions and public methods.
- Use descriptive names and small, focused functions.
- Prefer immutable data and `readonly` where practical.
- Use shared enums/constants instead of bare string literals.

### Banned Backend Patterns

- Returning hardcoded sample JSON from handlers
- Returning raw Prisma entities directly from handlers
- Defining a route without a real `schema.response`
- Shipping mock data or development-only fallbacks in `packages/*/src`
- Hand-editing generated OpenAPI/client output
- Fixing generated-client problems with frontend casts instead of repairing backend schemas

---

## 2. No Mock Data in Application Code

This applies to all backend services and handlers.

- Never include mock data, fake data, stub responses, or hardcoded sample records in backend application code.
- Handlers must return real service results backed by real repositories/data access.
- If a dependency is missing, implement it or surface a real error. Do not fake the response.
- The presence of mock data under `packages/*/src/` is a defect.

---

## 3. Fastify Module Structure

Organize backend code by domain module.

Typical module layout:

```
modules/<domain>/
  routes.ts
  handler.ts
  service.ts
```

Rules:

- Keep one domain area per module.
- Route files define Fastify schemas and wire handlers.
- Handlers translate HTTP concerns to service calls.
- Services own business logic.
- Mappers translate domain/service results to DTOs.

---

## 4. DTOs, Mappers, and OpenAPI

PoolMaster uses DTO-driven API contracts.

### Required Backend Flow

For every API endpoint:

1. Define or update the DTO Zod schema in `packages/shared/dto/`.
2. Map domain/service results to that DTO in `packages/core-api/src/mappers/`.
3. Use `zodToJsonSchema()` in the Fastify route schema for request/response payloads.
4. Provide `tags`, `summary`, and unique `operationId`.
5. Regenerate and validate the shared OpenAPI/client artifacts.

### Mapper File Requirement

Every module that registers Fastify routes **must** have a corresponding mapper file at `packages/core-api/src/mappers/<module>.mapper.ts`. The mapper file must export named functions (e.g., `mapContestToDto`, `mapLeagueToListItem`) that handlers call to transform service/domain results into DTO shapes.

- Inline `.map()` transformations in route handlers or handler files are not acceptable as a substitute for a dedicated mapper.
- The mapper is the single place where persistence/domain shapes are translated to API response shapes.
- Modules exempt from this rule: `config` (static data only), `health` (no domain objects).

If a module currently lacks a mapper file, creating one is part of the slice — not deferred cleanup.

### Required Route Schema Fields

Every route must include:

- `tags`
- `summary`
- `operationId`
- request schema where applicable (`body`, `params`, `querystring`)
- `response` schema for every supported status returned by the handler

### Response Rules

- Always describe the real response envelope.
- If the response is `{ league: ... }`, schema must say `{ league: ... }`.
- If the response is `{ success: true }`, schema must say `{ success: true }`.
- Dates over the wire must be ISO 8601 strings, not `Date` objects.

### Generated Artifacts Rules

- Run `npm run api:refresh` after DTO/route changes that affect the contract.
- Run `npm run api:validate` after regeneration.
- Never hand-edit:
  - `packages/shared/generated/openapi.json`
  - anything under `packages/shared/generated/hey-api/`

### What Not To Do

- Do not leave placeholder `SuccessSchema` responses on endpoints that return real domain data.
- Do not omit response schemas because “the frontend already knows.”
- Do not add local frontend interfaces to paper over backend schema gaps.
- Do not use `as unknown as` in app code to force a generated response into shape.

---

## 5. Prisma and Persistence

- Use Prisma for database access.
- Keep persistence concerns out of handlers.
- Keep Prisma row shapes from leaking directly into API responses.
- When Prisma models change, update DTOs, mappers, route schemas, and tests in the same work.
- Prefer explicit mapping from persistence models to domain/DTO models.

---

## 6. Enums, Constants, and Paths

### Enums and Status Values

- Never compare important state with ad hoc bare strings if a shared enum/constant exists.
- Use shared domain constants/enums from `packages/shared/domain`.
- Route schema enums must derive from shared values, not copied literal arrays where possible.

### Route Constants

- `packages/shared/api-routes.ts` is the canonical route constant registry.
- Use it for:
  - backend registration prefixes
  - integration tests
  - smoke tests
  - MSW handlers
- Do not create new duplicate route-constant registries.

### Frontend Boundary Clarification

- Frontend runtime app code should prefer the generated `hey-api` SDK over manual path constants when an operation exists.
- Backend work must still keep `API_ROUTES` current so non-generated consumers stay aligned.

---

## 7. Error Handling

- Catch exceptions only to add context, translate domain errors, or handle expected failures.
- Do not swallow backend errors to preserve a fake success path.
- Prefer clear typed/domain errors over ambiguous generic errors where practical.
- Let global Fastify error handling deal with unhandled failures.

### Error Response Shape Consistency

All error responses must follow a consistent envelope so frontend clients can handle errors uniformly without per-endpoint parsing logic.

**Standard error envelope:**

```typescript
{
  error: {
    code: string;         // machine-readable error code (e.g., "LEAGUE_NOT_FOUND", "VALIDATION_ERROR")
    message: string;      // human-readable description
    details?: unknown;    // optional structured details (validation field errors, etc.)
  }
}
```

**Rules:**
- New routes and materially changed routes must use this envelope.
- Existing untouched routes should migrate to this envelope when they are next materially changed.
- Validation errors (400) should include `details` with per-field errors when available.
- Not-found errors (404) should use domain-specific codes (e.g., `CONTEST_NOT_FOUND`, not generic `NOT_FOUND`).
- Permission errors (403) should use codes that distinguish the denial reason (e.g., `INSUFFICIENT_PERMISSION`, `NOT_LEAGUE_MEMBER`).
- Define a shared DTO/schema for the standard error envelope in `packages/shared/dto/`.
- Fastify's global error handler should format unhandled errors into this envelope where practical, and new route work should not bypass that standard.
- When a route is touched, declare error response shapes for the most relevant statuses such as `400`, `401`, `403`, and `404`.
- Smoke and contract tests should validate error response shapes, not just success paths.

---

## 8. Testing Expectations for Backend Work

- Unit-test service logic.
- Integration-test request/response behavior with Fastify `inject` where appropriate.
- Add/update contract tests for API response shapes.
- When API schema changes, verify:
  - contract tests
  - `api:refresh`
  - `api:validate`

### Do Not Preserve Bad Tests

- Do not keep tests that only lock in outdated manual wrapper behavior.
- Do not keep tests that validate copied path strings without exercising real request construction.
- Replace stale tests with contract/integration coverage where that provides better signal.

---

## 9. Backend Review Checklist

Before finishing backend API work, verify:

1. Does every changed route have real request/response schemas?
2. Do handlers return mapped DTOs instead of raw Prisma rows?
3. Is `operationId` present and unique?
4. Does `npm run api:refresh` succeed?
5. Does `npm run api:validate` succeed?
6. Did generated files update as expected?
7. Did any frontend casts/local API interfaces become removable?

---

## 10. Pre-Commit Self-Review

Before committing backend code, scan changed files for these anti-patterns. This is an execution gate, not a suggestion — catching these before commit prevents the pattern from accumulating across slices.

**Grep for these in changed route/handler files:**

| Pattern to find | What it means | Fix |
|---|---|---|
| `additionalProperties: true` in route schemas | Passthrough/generic response schema | Replace with Zod DTO via `zodToJsonSchema()` |
| `SuccessSchema` on a route returning domain data | Placeholder response, not real contract | Create domain-specific response DTO |
| `{ type: 'object', properties:` in route files | Inline JSON schema instead of Zod | Move to `packages/shared/dto/` as Zod schema |
| `prisma.*.find` in handler or route files | Raw Prisma access outside service layer | Move to service; return through mapper |
| `reply.send(await prisma` | Prisma result returned directly to client | Route through service → mapper → DTO |
| `.map((` in route or handler files | Inline transformation instead of mapper | Extract to `packages/core-api/src/mappers/` |

**Quick validation commands:**

```bash
# Find inline JSON schemas in route files
grep -rn "type: 'object', properties:" packages/core-api/src/modules/*/routes.ts

# Find SuccessSchema used for domain responses
grep -rn "SuccessSchema" packages/core-api/src/modules/*/routes.ts

# Find passthrough schemas
grep -rn "additionalProperties: true" packages/core-api/src/modules/*/routes.ts

# Find direct Prisma access in handlers
grep -rn "prisma\." packages/core-api/src/modules/*/handler*.ts packages/core-api/src/modules/*/routes.ts
```

If any of these patterns appear in your changed files, fix them before committing. Do not defer to a cleanup slice.
