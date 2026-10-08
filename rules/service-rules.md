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
- Logging and continuing after required runtime configuration is missing,
  malformed, or unsupported in deployed runtime paths

---

## 2. No Mock Data in Application Code

The prohibition itself is stated once, in
[`architecture-rules.md`](architecture-rules.md) §3 *No Mock Data in Application Code*, and
it covers every runtime: no mock data, fake data, stub responses or hardcoded sample records
in application code, and no development-only fallback payloads. Where test doubles are
allowed to live is [`testing-rules.md`](testing-rules.md) §1B *Forbidden Application-Code
Patterns*. Both apply here in full; the presence of mock data under `packages/*/src/` is a
defect.

What follows is the backend-specific shape of the same rule — the two ways a service fakes
data without ever writing a `MOCK_` constant.

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

### No Silent Configuration Failures

Backend services must surface required configuration problems as real startup or
registration errors. Logging a missing dependency, credential, provider binding,
endpoint, or feature-critical configuration value and then continuing is a
defect in deployed runtime paths.

Rules:

- Missing required runtime configuration in deployed runtimes such as QA,
  staging, and production must throw a
  typed or explicit configuration error before the dependent workflow is
  registered as usable.
- Unsupported provider IDs, malformed binding JSON, missing credentials, and
  missing required base URLs must fail fast. They must not silently disable a
  production workflow.
- Local/development opt-out behavior is allowed only when the workflow is
  explicitly optional in that runtime and the disabled state is observable.
- Emergency overrides must be explicit, auditable, narrow, and include a
  meaningful operator reason that is safe to log. Do not make a permissive
  fallback the normal behavior.

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

### Route Authorization

The global auth guard proves only that the caller is signed in. Every route that reaches data
someone else owns decides who may reach it, and says so where a reader will look:

- **A `preHandler` is the default** for anything decidable from the path and the session. The
  league gates live in `modules/leagues/permissions.ts`:
  - `requireMemberOfLeague(membershipRepo, leagueOf)` — read-only access within a league. The
    resolver says where the league comes from: `leagueFromPath` for routes carrying it as `:id`,
    `leagueOfContest(contestRepo)` for routes that reach a contest by `:contestId`.
  - `requireCommissioner` (`:id`) and `requireCommissionerForContest` (`:contestId`) — league
    administration.
  - `requireMemberOfSquad` — anything done on a squad's behalf, under
    `/leagues/:id/squads/:squadId`: an ACTIVE owner of the squad, or the league's commissioner
    acting for a member (access rule A7).

  Root admins bypass all of them. Every rejection in a gate awaits `sendError`; a hook that sends
  without awaiting lets Fastify run the handler behind the refusal.
- **Authorizing in the handler or service is the declared exception**, taken only when the check
  needs what a hook cannot see — the request body, or which sub-resource is being acted on — or
  when the service already takes the actor and enforces the rule itself.
- **A declared exception is stated, not implied.** Every route whose full path has a parameter —
  under a by-id mount (`/api/v1/contests/:contestId`) or a nested one
  (`/api/v1/leagues/:id/squads`) — either declares a `preHandler`/`onRequest` hook or appears in
  `scripts/route-authorization-opt-outs.mjs` with a one-line reason. Carrying the league id in the
  path is not checking it. `npm run rules:check` (`rules:check:route-authorization`) fails a route
  that does neither.
- **An authenticated handler reads its caller with `requireAuthUser(request)`**
  (`plugins/auth-guard.ts`), never `request.authUser!`: it answers 401 if the route is ever made
  public or optional-auth, instead of a `TypeError` or an `undefined` user id.
- League and squad membership are resolved by query inside the gate, never read from the token —
  `docs/DOMAIN-OPERATIONS.md` access rule A12.

---

## 4. DTOs, Mappers, and OpenAPI

PoolMaster uses DTO-driven API contracts.

### Required Backend Flow

For every API endpoint:

1. Define or update the DTO Zod schema in `packages/shared/dto/`.
2. Map domain/service results to that DTO in `packages/core-api/src/mappers/`.
3. Publish each request body and response schema as a named OpenAPI component: `registerSchema('Name', NameSchema)`
   in the DTO module, then `schemaRef('Name')` in the Fastify route schema. An inline schema generates no
   importable type, so `api:validate` refuses one.
4. Provide `tags`, `summary`, descriptive endpoint documentation, and unique `operationId`.
5. Regenerate and validate the shared OpenAPI/client artifacts.

### Request Normalisation Lives on the DTO

Trimming and case-folding a request string is declared on its Zod schema (`.trim()`,
`.toLowerCase()`), never left to the service. JSON Schema cannot say either, so
`zodToJsonSchema()` records them under `x-transform` and core-api's Ajv plugin applies them
before the rest of the schema checks the value. Without that, `" derek@x.com "` fails
`format: email` before any service code runs.

- Every email a request carries uses `EmailInputSchema` from `common.dto.ts` (trimmed and
  lowercased).
- Every `Fastify()` that registers routes, in the app or in a test, passes
  `ajv: FASTIFY_AJV_OPTIONS`. Ajv refuses a schema whose keyword it does not know, and an
  app built without the option would also skip the normalisation.

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

List endpoints must return a consistent envelope rather than ad hoc arrays.

**There is no pagination in this API.** See §16 of
`rules/domain-model-conventions-rules.md`, set by the repo owner 2026-09-26: no operation
takes `page`, `pageSize`, `limit`, `offset`, `perPage` or a cursor, and no response carries
a paging envelope. This section previously told you how to build one — it was written
before §16 and contradicted it. Where a set could grow without bound, the answer is a
tighter filter or a retention policy: a date range narrows *which rows you want*, which the
caller can answer, while a page answers *how many at a time*, which is transport leaking
into the contract.

Rules:

- Collection responses use a named DTO envelope with the item array and any metadata
  clients need — `{ events: [...] }`, `{ leagues: [...] }` — not a bare array.
- **No paging parameters and no paging envelope.** No `total`, `page`, `pageSize` or
  `totalPages` beside `items`. §16 lists what this rules out and what remains to be
  converted.
- Narrow with filters instead: a status, a league, a search term, a date range. An
  append-only log gets a window, not a page.
- Route schemas and OpenAPI descriptions must document how the list is filtered and
  sorted, and what the default ordering is.
- Frontend code must consume the DTO envelope from the generated SDK rather
  than guessing at route-specific array shapes.

### Generated Artifacts Rules

- Run `npm run api:refresh` after DTO/route changes that affect the contract.
- Run `npm run api:validate` after regeneration.
- Never hand-edit:
  - `packages/shared/generated/openapi.json`
  - anything under `packages/shared/generated/hey-api/`

### What Not To Do

- Do not leave placeholder `SuccessResponse` responses on endpoints that return real domain data.
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

- `packages/shared/api-routes.ts` is **generated** from the OpenAPI spec (#212) — see `rules/architecture-rules.md`, "Route Source of Truth". Do not hand-edit it; a hand edit is reverted by the next `npm run api:refresh` and fails `npm run api:check` before that.
- Prefer the generated SDK to a literal path. `api-routes.ts` exists for callers that cannot use it: backend registration prefixes, and integration suites building `inject()` URLs.
- **Adding an entry needs the repo owner's explicit approval**, and it goes in the manifest in `scripts/generate-api-routes.mjs`, not in the generated file.
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
- The envelope is `ErrorEnvelopeSchema` in `packages/shared/dto/errors.dto.ts`, published once as the `ErrorEnvelope` component. Route schemas reference it with `schemaRef('ErrorEnvelope')` (spread it with a `description` to name the codes a status carries); never inline it.
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
| `additionalProperties: true` in route schemas | Passthrough/generic response schema | Replace with a Zod DTO, `registerSchema` it, `schemaRef` it |
| `SuccessResponse` on a route returning domain data | Placeholder response, not real contract | Create domain-specific response DTO |
| `{ type: 'object', properties:` or `zodToJsonSchema(` on a body or response in route files | Inline schema instead of a named component | Move to `packages/shared/dto/` as Zod schema, `registerSchema` it, `schemaRef` it |
| `prisma.*.find` in handler or route files | Raw Prisma access outside service layer | Move to service; return through mapper |
| `reply.send(await prisma` | Prisma result returned directly to client | Route through service → mapper → DTO |
| `.map((` in route or handler files | Inline transformation instead of mapper | Extract to `packages/core-api/src/mappers/` |

**Quick validation commands:**

```bash
# Run the automated route discipline baseline scan
npm run rules:check:route-discipline

# Find inline JSON schemas in route files
grep -rn "type: 'object', properties:" packages/core-api/src/modules/*/routes.ts

# Find SuccessResponse used for domain responses
grep -rn "SuccessResponse" packages/core-api/src/modules/*/routes.ts

# Find passthrough schemas
grep -rn "additionalProperties: true" packages/core-api/src/modules/*/routes.ts

# Find direct Prisma access in handlers
grep -rn "prisma\." packages/core-api/src/modules/*/handler*.ts packages/core-api/src/modules/*/routes.ts
```

If any of these patterns appear in your changed files, fix them before committing. Do not defer to a cleanup slice.

## 11. Backend Logging Conventions

Pino's `logger.info({...})` accepts any object — nothing in the type system
requires an `action` field or a particular shape, so this convention is held
today only by developers copying nearby code. That drifts the moment
someone works in a file with no nearby example. This section is the
enforceable version, for new code as much as existing code.

### Envelope Shape

Pass a payload object as the first argument, a human-readable message string
as the second:

```ts
logger.warn({
  action: 'authService.login.invalidCredentials',
  data: { identifierType },
}, 'Rejected login for missing or passwordless user');
```

- `action` — a stable, dot-separated identifier for what happened, shaped
  `<domain>.<verb>.<outcome>` (e.g. `authService.login.invalidCredentials`,
  `ingestion.providers.unconfigured`). This is the primary field CloudWatch
  queries filter on. Each module names its own actions following this
  shape — there is no fixed enum to import; enumerating specific action
  names here would just create a second, drifting list.
- `data` — event-specific fields (ids, counts, flags). Nest them under
  `data`; don't spread them across the root of the payload object.
- `err` — pass the raw error object through this field on a failure log so
  Pino's serializer captures `type`/`message`/`stack`, rather than manually
  picking fields off the error into `data`.

Request-scoped logs (`request.log` / `request.contextLogger`) already carry
`reqId`, `sessionId`, `userId`, `isRootAdmin`, `ip`, `method`, and `route`
via `buildRequestLogBindings` (`packages/core-api/src/core/logger.ts`) — do
not re-pass these manually in `data`.

Cross-tier correlation (`clientTraceId`, `clientRequestId`) is a separate,
already-documented mechanism — see ADR-0005
(`docs/adr/0005-cross-tier-log-correlation.md`). This section covers the
shape of one backend log entry, not how it joins to a browser-originated
event.

### Severity Semantics

- `debug` — verbose trace: parameter bindings, intermediate state,
  entry/exit points. Useful only during investigation.
- `info` — meaningful lifecycle milestones and successful major operations:
  startup, sync/ingestion summaries, admin actions, successful mutations.
- `warn` — expected negative paths: validation failures, authorization
  denial, missing-but-expected resources, invalid state transitions. The
  system is working correctly by rejecting something; `warn` is not a bug
  signal.
- `error` — unexpected exceptions, failed background jobs, unhandled
  request failures, `5xx` conditions. Something went wrong that shouldn't
  have.
- `fatal` — unrecoverable process-level failure; the service cannot safely
  continue. Reserve it for that specific case — it is part of the logger's
  level set but has no call sites in the backend today, and reaching for it
  on an ordinary unexpected error would blur the one severity level meant
  to signal "this process is done."

### Redaction

At minimum, redact authorization headers, cookies, passwords, access
tokens, refresh tokens, and any other secret-bearing value before it can
reach a log line. `packages/core-api/src/core/logger.ts`'s `REDACT_PATHS` is
the enforced list — extend it when a new secret-bearing field enters any
request/response shape; don't work around it with ad hoc field-stripping at
the call site.

### Testing

Per `rules/testing-rules.md`'s Logging and Branch-Proof Rule, tests assert
branch outcomes (typed exceptions, error codes, state transitions), never
log message strings. That rule depends on this one: branch-outcome
assertions only make sense as a substitute for log-string assertions when
logs are actually structured enough to reason about without reading their
prose.
