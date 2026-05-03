# PoolMaster — Service Rules

For domain-model consistency conventions such as lifecycle-field naming,
`status` vs `isActive`, and soft-delete defaults, see
[domain-model-conventions-rules.md](./domain-model-conventions-rules.md).

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
- Shipping sentinel fallback values such as `''`, `'UNKNOWN'`, or similar
  invented placeholders in API-facing service output
- Hand-editing generated OpenAPI/client output
- Fixing generated-client problems with frontend casts instead of repairing backend schemas

---

## 2. No Mock Data in Application Code

This applies to all backend services and handlers.

- Never include mock data, fake data, stub responses, or hardcoded sample records in backend application code.
- Handlers must return real service results backed by real repositories/data access.
- If a dependency is missing, implement it or surface a real error. Do not fake the response.
- The presence of mock data under `packages/*/src/` is a defect.

### No Synthetic Lookups

Backend code must not fabricate domain objects, scores, statuses, or aggregate
rows when a real lookup misses.

Rules:

- A missing row returns a typed not-found/domain error, an empty list, or an
  explicitly documented empty-state DTO. It does not return an invented
  placeholder entity.
- Do not synthesize zero scores, default entries, fallback owners, fake
  participants, or sentinel values to keep a workflow moving.
- Do not paper over missing joins with placeholder names such as `UNKNOWN`,
  `Unassigned`, or empty strings in API-facing output.
- If product behavior needs a default, model it explicitly in the domain and
  document it in the DTO/API contract.
- Tests that need missing-data scenarios must assert the real missing-data
  behavior rather than relying on fabricated application responses.

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
4. Provide `tags`, `summary`, descriptive endpoint documentation, and unique `operationId`.
5. Regenerate and validate the shared OpenAPI/client artifacts.

### Mapper File Requirement

Every module that registers Fastify routes **must** have a corresponding mapper file at `packages/core-api/src/mappers/<module>.mapper.ts`. The mapper file must export named functions (e.g., `mapContestToDto`, `mapLeagueToListItem`) that handlers call to transform service/domain results into DTO shapes.

- Inline `.map()` transformations in route handlers or handler files are not acceptable as a substitute for a dedicated mapper.
- The mapper is the single place where persistence/domain shapes are translated to API response shapes.
- The only exempt modules are `config` (static data only) and `health` (no
  domain objects). This exemption is closed: do not extend it casually, and do
  not treat "admin", "internal", "small", "read-only", or "simple" routes as
  equivalent exemptions.
- Reusing an existing shared DTO on a new route surface does **not** justify
  local inline shaping in the handler. The route must call a mapper, and if no
  suitable shared mapper/helper exists yet, creating or extracting one is part
  of the slice.
- "Small", "obvious", or "admin-only" response shaping is not an exception.
  Handler-level DTO assembly is prohibited because it is one of the main ways
  DTO/domain drift re-enters the codebase.

If a module currently lacks a mapper file, creating one is part of the slice — not deferred cleanup.

### Required Route Schema Fields

Every route must include:

- `tags`
- `summary`
- `description` when the endpoint behavior, audience, or lifecycle context is
  not obvious from the path and summary alone
- `operationId`
- request schema where applicable (`body`, `params`, `querystring`)
- `response` schema for every supported status returned by the handler

### Contract Documentation Requirement

Backend-owned API contracts must be documented well enough that frontend
implementation can normally work from the generated SDK/types and OpenAPI docs
without reading backend service code.

That means:

- add meaningful route summaries, descriptions, and tags
- document DTO/object purpose when the type name alone is insufficient
- document field meaning when a consumer could plausibly misread semantics
- document enums/status values when names alone do not explain lifecycle or
  behavior

If a frontend question reveals that the contract meaning was not clear from the
documented API surface, treat that as a backend documentation defect and fix it
in the contract source.

Contract correctness comes before contract prose:

- DTOs and route schemas must reflect the current domain model and approved
  product behavior, not merely a broader set of technically accepted fields.
- If a field is retired from the active domain or product model, remove it from
  DTOs, route schemas, regenerated OpenAPI, and generated SDK/types.
- Do not leave stale properties in the API contract just because handlers or
  services currently ignore them.
- If a DTO or schema is no longer used by any active route, remove it instead
  of leaving it exported as orphaned contract surface.

### Contract Documentation Checklist

Before finishing backend/shared contract work, explicitly verify:

1. Every changed route still has:
   - `tags`
   - `summary`
   - `operationId`
   - `description` when behavior, audience, lifecycle, or permissions are not obvious from the path and summary alone
2. Every changed request and response schema in `packages/shared/dto/` has:
   - an object-level description when the schema represents a meaningful payload or DTO
   - field descriptions for any property whose semantics are not unmistakable from its name alone
3. Any changed enum, status, lifecycle value, or role exposed to clients is documented when the value names alone do not explain how the client should interpret them.
4. Any frontend question that required backend explanation is either:
   - now answered by the documented contract source, or
   - escalated as a product ambiguity rather than left as tribal knowledge.
5. `npm run api:refresh` has been rerun after contract changes, and the generated artifacts still reflect the improved descriptions.

Do not treat contract documentation as optional polish after the code is correct.
For backend/shared API work, documentation completeness is part of the
definition of done.

### Response Rules

- Always describe the real response envelope.
- If the response is `{ league: ... }`, schema must say `{ league: ... }`.
- If the response is `{ success: true }`, schema must say `{ success: true }`.
- Dates over the wire must be ISO 8601 strings, not `Date` objects.

### List Envelope Discipline

List endpoints must return a consistent envelope rather than ad hoc arrays or
per-route pagination shapes.

Rules:

- Collection responses should use a named DTO envelope with the item array and
  any metadata clients need.
- Paginated endpoints should expose consistent pagination fields across the API
  such as `items`, `page`, `pageSize`, `totalItems`, and `totalPages`, unless a
  route has a documented domain-specific reason to use cursor pagination.
- Non-paginated lookup lists should still use an explicit response object, for
  example `{ events: [...] }`, not a bare array.
- Route schemas and OpenAPI descriptions must document whether the list is
  paginated, filtered, sorted, and what the default ordering is.
- Frontend code must consume the DTO envelope from the generated SDK rather
  than guessing at route-specific array shapes.

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

### Time and Timezone Discipline

Time-sensitive behavior must be explicit about the clock and timezone it uses.

Rules:

- Persist instants as UTC timestamps.
- API date/time fields must be ISO 8601 strings and must document whether the
  field is an instant, a local date, or a display-only date.
- Do not use local server timezone assumptions for contest locks, event
  windows, ingestion lookahead, schedule boundaries, or scoring transitions.
- If a workflow is user- or league-timezone aware, carry the timezone as an
  explicit input/config value and test at least one non-UTC timezone.
- Avoid `new Date()` scattered through business logic. Prefer injecting or
  passing a clock when the behavior changes based on current time.

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
- Backend routes must use this envelope for error responses unless the route intentionally returns a domain-specific validation/result DTO instead of a generic error payload.
- The currently documented exception is scoring configuration validation, which returns a validation-result DTO on `400` instead of the generic envelope.
- Validation errors (400) should include `details` with per-field errors when available.
- Not-found errors (404) should use domain-specific codes (e.g., `CONTEST_NOT_FOUND`, not generic `NOT_FOUND`).
- Permission errors (403) should use codes that distinguish the denial reason (e.g., `INSUFFICIENT_PERMISSION`, `NOT_LEAGUE_MEMBER`).
- Intentional application errors must use stable, descriptive,
  domain-specific codes rather than transport-only placeholders such as
  `BAD_REQUEST`, `FORBIDDEN`, or `NOT_FOUND`.
- Error codes must be specific enough for clients and tests to distinguish materially different failures that share the same HTTP status.
- Human-readable messages must explain the real failure clearly without exposing unsafe internals.
- When useful, `details` should carry structured machine-readable context rather than ad hoc string blobs.
- Define a shared DTO/schema for the standard error envelope in `packages/shared/dto/`.
- Fastify's global error handler should format unhandled errors into this envelope where practical, and new route work should not bypass that standard.
- Route schemas must declare error response shapes for the most relevant statuses such as `400`, `401`, `403`, and `404`.
- Functional API, contract-verification, or data integration tests must validate representative error response shapes, not just success paths.

### Typed Error Class Discipline

Domain and service layers should throw typed application/domain errors rather
than generic `Error` values when the error is expected and client-visible.

Rules:

- Expected application failures must carry a stable error code, HTTP status,
  safe user-facing message, and optional structured details at the point the
  error is created.
- Route handlers should translate typed errors consistently through shared
  error handling rather than switch on message text.
- Do not infer domain meaning from a generic `Error.message` string in route
  code.
- If a new error condition is product-significant, add or reuse a typed error
  class/value and cover it in the appropriate test layer.
- Unexpected programming failures can remain untyped and should flow to the
  global error handler.

---

## 8. Testing Expectations for Backend Work

- Unit-test service logic.
- Integration-test request/response behavior with Fastify `inject` where appropriate.
- Add/update contract-verification suites for API response shapes.
- When API schema changes, verify:
  - contract verification
  - `api:refresh`
  - `api:validate`

### Do Not Preserve Bad Tests

- Do not keep tests that only lock in outdated manual wrapper behavior.
- Do not keep tests that validate copied path strings without exercising real request construction.
- Replace stale tests with contract verification, data integration, or FAPI coverage where that provides better signal.

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
8. Did changed routes and DTOs pass the Contract Documentation Checklist above?

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
# Run the automated route discipline baseline scan
npm run rules:check:route-discipline

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
