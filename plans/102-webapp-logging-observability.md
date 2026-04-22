# Implementation Plan: Observability-Grade Logging for PoolMaster Webapp Frontend

This is a full-stack observability plan for the PoolMaster webapp, not a
frontend-only change. The web client is the primary producer of the new
signals, but the rollout also introduces backend correlation/header handling
and a backend operational ingestion route so browser events can join the
existing CloudWatch-backed service logs.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| WLO-001 | 1 | Logger foundation in the webapp | Done | Added shared logger types, redaction, trace id helper, console sink, singleton hook, bootstrap wiring, test logger helper, and unit proof under `clients/poolmaster/src/lib/logger/`. |
| WLO-001A | 1 | Expose safe sessionId in the webapp auth/session model | Done | Added safe `sessionId` to auth/session DTOs, authenticated account self-service responses, generated SDK types, and the frontend session store/logger context, with unit/contract/functional proof. |
| WLO-002 | 2 | Correlation headers and backend request bindings | Done | Added browser request headers in `clients/poolmaster/src/lib/api.ts`, bound them into backend request logs in `packages/core-api/src/core/logger.ts`, and added unit + webapp proof for header propagation. |
| WLO-003 | 3 | Client log ingestion endpoint and transport | Done | Added shared client-log DTOs, the public `/api/v1/client-logs` operational endpoint with optional auth binding and rate-limit/oversize handling, browser batching transport, functional/unit proof, and refreshed generated OpenAPI artifacts. |
| WLO-004 | 3 | Global browser failure capture and fallback UX | Done | Added a top-level React error boundary, global `error` and `unhandledrejection` listeners, fallback reload UX, and behavioral proof for render-failure capture plus browser-global fatal logging. |
| WLO-005 | 4 | Feature-level logging backfill and branch proof | In Progress | Auth/session, first-pass league/team workflows, and contest workflows are complete (`auth-provider`, `auth-home-page`, `session-store`, `join-league-page`, `join-team-owner-page`, `create-league-modal`, `teams-page`, `create-contest-page`, `contest-detail-page`, `contest-entry-page`); account, root-admin, routes, and app-shell remain. |
| WLO-006 | 5 | Docs and final gap sweep | Not Started | Add operational query guidance and final observability gap audit. |

## Research Summary

### 1. Backend logging baseline (what we're mirroring)

- **Framework**: Pino, wired through Fastify's built-in logger (`Fastify({ logger: createFastifyLoggerOptions('core-api') })`). Configuration lives at `packages/core-api/src/core/logger.ts`.
- **Format / destination**: Structured JSON to stdout with `level` uppercased, ISO `ts`, `base` metadata (`service`, `env`, `version`), and a redaction list covering `authorization`, `cookie`, `x-csrf-token`, `accessToken`, `refreshToken`, `password*`. ECS ships stdout to CloudWatch log groups at `/ecs/${local.name_prefix}/core-api` (see `infrastructure/terraform/main.tf:460-466`).
- **Correlation**: Each request gets a Fastify `reqId`; the plugin at `packages/core-api/src/plugins/request-logging-context.ts` binds `request.contextLogger` with child fields from `buildRequestLogBindings`: `reqId`, `sessionId`, `userId`, `isRootAdmin`, `ip`, `method`, `route`. `sessionId` comes from the access token `sid` claim (persisted auth session id), not token material.
- **Envelope convention**: Every log call uses `{ action: '<domain>.<verb>.<outcome>', data: {...}, err?: Error }` as the first argument plus a human message string. Severity policy documented in `tech-specs/features/platform-logging-observability/domain-model.md`: `debug` entry/exit + decisions, `info` happy-path milestones, `warn` expected negative branches, `error` unexpected failures, `fatal` unrecoverable process failures.
- **Unit-test pattern**: Tests inject a `createLogger()` spy of `{ debug, info, warn, error, fatal: jest.fn() }` or assert on mocked `request.log.warn/error` (see `tests/unit/core-api/league-permissions.test.ts:61-68` and `tests/unit/core-api/logger.test.ts:92-159`). Per `rules/testing-rules.md` §1 "Logging and Branch-Proof Rule", tests do **not** assert log message strings — they assert branch outcomes (exceptions, envelope codes, state transitions). Log spies are used to satisfy branch coverage (touch both positive and negative paths), not to pin copy.

### 2. Frontend stack (what we're adding to)

- `clients/poolmaster`: **React 18 + TypeScript**, **Vite 5** bundler, **React Router 6** (`createBrowserRouter`), **TanStack Query 5**, **Zustand** for session store, **@hey-api/client-fetch** generated SDK at `@/lib/api`.
- **Auth model**: cookie-based. Access cookie is set by the backend; `X-CSRF-Token` is read from `poolmaster_csrf` cookie and attached to mutating requests via the client interceptor in `clients/poolmaster/src/lib/api.ts:18-29`. `credentials: 'include'`. Session user is held in a Zustand store (`features/auth/session-store.ts`). JWTs are not in JS memory.
- **Existing logging / error-tracking**: none. No `console.*` calls in `src/`, no error boundary component, no Sentry/Datadog/RUM, no existing correlation header. The app only catches and swallows query errors via TanStack Query; there is no global uncaught-error handler and no `window.onerror` / `unhandledrejection` listener. `main.tsx` is wrapped only in `React.StrictMode`.
- **Test harness**: Vitest + jsdom + React Testing Library + MSW (already a devDependency). `vitest.config.ts` enables coverage (`v8`, lcov). Tests may run in Node environment via `src/test-setup.ts`.

### 3. Observability sinks already in AWS

- CloudWatch log groups exist per ECS service (`/ecs/${name_prefix}/core-api`, `.../mock-contest-feed-provider`, `.../migrate`) with 30-day retention in prod, 7 days otherwise (`infrastructure/terraform/main.tf:460-466`).
- No frontend-specific log group exists. There is no Kinesis/Firehose, no CloudFront real-time log sink, no direct browser-to-CloudWatch pipe. Frontend logs must travel through the backend ALB to land in CloudWatch alongside backend logs.
- Alarms in `monitoring.tf` are ECS/ALB/RDS focused; there is no client-side alarm hook today.

## Answers to the Required Questions

### A. Framework choice — recommendation: **custom minimal wrapper over `console.*`**, not a third-party lib

| Option | Bundle cost | API symmetry with backend | Browser sinks | Notes |
|---|---|---|---|---|
| **pino** (`pino` browser build) | ~11 KB gzip; pulls `abstract-logging`, `quick-format-unescaped`, serializers even with browser tree-shaking | Identical call shape `log.info({ action, data }, msg)` | Supports custom `write` sink via `browser.transmit` | API symmetry is perfect, but bundle is heavy for an SPA and most features (serializers, fastify integration) do no work in a browser. |
| **loglevel** | ~1 KB gzip | Level-only API, no structured-field discipline; would require a wrapper anyway | Custom method factory | Forces us to build a structured wrapper on top, which defeats the point of taking a dep. |
| **Custom wrapper (~80 lines)** | 0 KB beyond app code | Matches Pino call shape `{ action, data, err }, msg` by convention | Console sink for dev, Beacon/fetch sink for prod — both under our control | Fastest to ship, smallest, matches backend envelope exactly, testable as a single file. |

**Recommendation: custom wrapper.** Expose a `PoolmasterLogger` interface with the same five levels the backend uses (`debug | info | warn | error | fatal`) and the same `(payload: { action: string; data?: unknown; err?: unknown }, msg?: string) => void` call shape. This keeps dev velocity high, keeps bundle cost at zero, and keeps QA muscle memory (searching CloudWatch for `action: "x.y.z"`) working identically across the tiers. If we later adopt Sentry or Datadog RUM for the error tier specifically, it plugs into this wrapper as an additional sink rather than replacing it.

### B. Ingestion path — confirmed: a backend endpoint is required

Direct browser-to-CloudWatch is not wired (no Kinesis/Firehose, no unauthenticated write IAM surface, and no intent to expose one). Shipping logs through core-api keeps the correlation story clean (backend can stamp its own `reqId` on top of the client payload).

**Proposed endpoint:** `POST /api/v1/client-logs`

- **Module location:** new module `packages/core-api/src/modules/client-logs/` with `routes.ts` + `handler.ts` + `service.ts`, registered in `packages/core-api/src/index.ts` alongside the other `app.register(...)` calls. DTOs in `packages/shared/dto/client-logs.dto.ts` (Zod schema), export through `packages/shared/dto/index.ts`.
- **Auth:** not in `PUBLIC_ROUTES` (`plugins/auth-guard.ts`). Authenticated users' sessions attach naturally via the cookie + CSRF interceptor. Unauthenticated pages (auth-home, invite acceptance) also need to log — accept unauthenticated calls but apply the existing auth-guard rule that allows public routes. Cleanest path: add `POST /api/v1/client-logs` to `PUBLIC_ROUTES` and validate in-handler that either `request.authUser` is present OR the batch is flagged `anonymous: true` with strict per-IP rate-limit.
- **Payload schema** (Zod, in `client-logs.dto.ts`):
  - `schemaVersion: 1`
  - `clientTraceId: string` (ULID/UUID, per tab/session)
  - `webappVersion: string` (from `version-info.ts`)
  - `userAgent: string` (truncated)
  - `entries: Array<{ ts: string (ISO), level: 'debug'|'info'|'warn'|'error'|'fatal', action: string, msg?: string, data?: Record<string, unknown>, err?: { name: string, message: string, stack?: string }, route?: string, clientRequestId?: string }>`
- **Batching strategy:** client-side ring buffer flushes on (a) level >= `error`, (b) batch size >= 20 entries, (c) every 10 s, (d) `visibilitychange: hidden` via `navigator.sendBeacon`. Max payload 64 KB (guarded client-side).
- **Retry / backoff:** on `5xx` or network error, retry once with 1 s jitter. On second failure, drop the batch silently. Never retry >1 time, never queue more than 200 pending entries (oldest evicted), never block UI work.
- **Failure mode:** the ingestion client must never recurse (its own errors go to `console.error` directly, not back through the logger). Transport failures increment an in-process counter and surface via `console.warn` once per minute in dev only.
- **Backend handler:** re-emit each entry through `request.contextLogger` at the requested level, setting `source: 'client'` in the `data` envelope, with entry `action` preserved. This joins browser events into the same CloudWatch log group (`/ecs/${name_prefix}/core-api`) that the rest of the backend writes to — no new infra required for phase 1.
- **Rate limiting:** add a lightweight per-IP sliding-window limiter in the handler (e.g. 60 entries/60 s per IP for anonymous; 600/60 s for authenticated). Exceeded batches log a `warn` with `action: 'clientLogs.ingest.rateLimited'` and return 429.

This endpoint is an operational observability surface only. It is not
member-facing product functionality, and its payloads remain transient
operational events rather than persisted application data.

### C. Correlation — identifiers and join strategy

Three layered identifiers, each with a clear job:

1. **`sessionId`** — backend-owned safe session correlation id, now echoed through authenticated auth/session responses (`/api/v1/auth/me`, login/register, refresh) and authenticated self-service account responses. We do not derive it from cookies on the client; we read it from the session store and include it in log payloads when present.
2. **`clientTraceId`** — new, client-generated UUIDv4 stored in `sessionStorage` under `poolmaster_client_trace_id`. Sticks for the tab's lifetime (not persisted across tab close; regenerates on tab re-open so it remains unambiguous). Included on every client log entry *and* sent as a request header on API calls.
3. **`clientRequestId`** — new, per-outbound-API-call UUIDv4 generated by the client, sent as `X-Client-Request-Id`. Echoed into every log entry that describes that request (outgoing, success, error). Lets us join one specific client call to one specific backend `reqId`.

**Header(s) to introduce:**
- `X-Client-Trace-Id` (per tab, attached to every API call via the existing `client.interceptors.request.use(...)` in `lib/api.ts`).
- `X-Client-Request-Id` (per call, attached by the same interceptor).

Neither exists today. Add both in the same slice as the logger — they cost almost nothing and are what makes frontend logs joinable to backend logs post-hoc.

**Backend side (small change to backend logging in the same plan):** extend `buildRequestLogBindings` in `packages/core-api/src/core/logger.ts` to also capture `clientTraceId` and `clientRequestId` from request headers into the request-scoped child logger. Tests in `tests/unit/core-api/logger.test.ts` already cover the bindings shape — add two new cases.

**Join story:** ops goes to CloudWatch, filters the core-api log group for a specific `clientTraceId` (comes from both frontend entries — `source: 'client'` — and backend entries — because we propagate it from the header). Or joins on a specific `clientRequestId` to trace one call across both tiers.

### D. Log-level strategy with frontend-specific examples

| Level | When | Example actions |
|---|---|---|
| `fatal` | Unhandled render crash caught by React error boundary; top-level `window.onerror` / `unhandledrejection` where the SPA is unusable. | `app.errorBoundary.caught`, `app.unhandledRejection` |
| `error` | API call returned `5xx`; generated-SDK response shape failed Zod parsing; a mutation threw after user interaction; log transport lost >1 batch. | `api.call.5xx`, `contest.entry.submit.failed`, `auth.refresh.failed` |
| `warn` | API `4xx` (except expected 404 on optional reads); retry-after-429; auth-guard-driven redirect; known recoverable state (e.g., offline, retry scheduled). | `api.call.4xx`, `api.call.rateLimited`, `route.guard.denied`, `session.expired.redirected` |
| `info` | Route navigation; successful mutation completion; feature-level milestones (e.g., entry saved, league joined, logged in/out). | `route.navigate`, `league.create.success`, `auth.login.success` |
| `debug` | Component lifecycle points useful only during investigation; query cache-hit / cache-miss noise; form draft state transitions. | `query.cache.hit`, `form.draft.saved`, `leagueSelector.open` |

**Never log:**
- passwords or email verification codes (forms must not pass raw form values to `data`)
- tokens (none live in JS memory, but guard against someone putting `document.cookie` in `data`)
- full API response bodies (log `status`, `errorCode`, `clientRequestId` — not the body)
- PII beyond what the backend already logs (never log full `firstName`/`lastName`/addresses in `data`)
- values that look like JWTs, bearer tokens, or csrf tokens (the client logger must run a redaction pass on every payload mirroring the backend's `REDACT_PATHS` set: `password`, `passwordHash`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `x-csrf-token`)
- raw form values or free-text user input by default. Frontend `data` payloads
  should prefer identifiers, route names, error codes, status codes, and
  branch context. If a future use case truly needs user-entered content, it
  requires explicit product/privacy review first.

### E. Testing approach (branch-coverage mirror)

The backend plan 103 defines "log + prove": every branch is both logged and independently asserted by a lower-layer test. The frontend plan mirrors this through five test surfaces:

1. **Logger unit tests** (`logger.test.ts`): assert that each level method calls the sink with the correct payload shape, that redaction scrubs `password`/`accessToken`/etc. out of `data`, that level-below-threshold calls are no-ops, and that the sink exception path does not throw into the caller.
2. **Transport unit tests** (`log-transport.test.ts`): assert batching triggers (size, time, level >= error, visibilitychange), retry budget, drop behavior when payload exceeds the cap, and that transport errors do not recurse into the logger.
3. **Error boundary component tests** (`error-boundary.test.tsx`): render a child that throws, assert fallback UI renders, assert logger `fatal` was called with `action: 'app.errorBoundary.caught'` and the original error in `err`.
4. **Correlation-header interceptor tests**: extend existing `msw` test harness (add a new file under `src/lib/`) to assert that `X-Client-Trace-Id` and `X-Client-Request-Id` are set on outbound requests, that the trace ID persists across calls in the same tab, and that the request ID changes per call.
5. **Backend unit tests** (extend `tests/unit/core-api/logger.test.ts` + add `tests/unit/core-api/client-logs-handler.test.ts`): assert that `buildRequestLogBindings` picks up the new headers; assert the `/client-logs` handler validates payload, re-emits at correct levels, rate-limits, and rejects oversized batches.

Tests assert branch outcomes (sink was/wasn't called, header was/wasn't present, rate-limit returned 429) — **never** the exact log message string, consistent with `rules/testing-rules.md` §1.

## Step-by-Step Implementation Plan

### Phase 1 — Client-side logger core + console sink (ships independently)

Deliverable: a working logger with console output, wired into one or two call sites, no network sink yet.

1. **New file** `clients/poolmaster/src/lib/logger/types.ts`
   - Export `LogLevel`, `LogPayload { action: string; data?: Record<string, unknown>; err?: unknown }`, `LogSink { write(level: LogLevel, payload: LogPayload, msg?: string, meta: LogMeta): void }`, `LogMeta { ts: string; clientTraceId: string; webappVersion: string; userAgent: string; route?: string; sessionId?: string | null; userId?: string | null }`, and `PoolmasterLogger { debug; info; warn; error; fatal; child(bindings) }`.

2. **New file** `clients/poolmaster/src/lib/logger/redact.ts`
   - Export `redactPayload(payload: LogPayload): LogPayload`. Recursive deep-clone that replaces any key matching `/^(password|passwordHash|authorization|cookie|accessToken|refreshToken|x-csrf-token)$/i` with `'[REDACTED]'`. Mirrors `REDACT_PATHS` in backend `logger.ts`.

3. **New file** `clients/poolmaster/src/lib/logger/console-sink.ts`
   - Export `consoleSink: LogSink`. Maps `fatal/error` → `console.error`, `warn` → `console.warn`, `info` → `console.info`, `debug` → `console.debug`. Emits a single object so browser devtools keeps the structure inspectable.

4. **New file** `clients/poolmaster/src/lib/logger/client-trace-id.ts`
   - Export `getOrCreateClientTraceId(): string`. Reads/writes `sessionStorage` under key `poolmaster_client_trace_id`; falls back to `crypto.randomUUID()` with a safe in-memory fallback when `sessionStorage` is unavailable.

5. **New file** `clients/poolmaster/src/lib/logger/logger.ts`
   - Export `createLogger(options: { sinks: LogSink[]; minLevel: LogLevel; getContext: () => { sessionId?: string | null; userId?: string | null; route?: string; webappVersion: string } }): PoolmasterLogger`.
   - Honors `minLevel` (default `info` in prod, `debug` in dev, `warn` in tests — read `import.meta.env.MODE`).
   - Runs `redactPayload` before dispatching to sinks.
   - Catches sink exceptions and forwards to `console.error` with a fixed string — never re-enters the logger.
   - `child(bindings)` returns a new logger whose payloads are merged with those bindings (matches Fastify's `log.child` ergonomics).

6. **New file** `clients/poolmaster/src/lib/logger/index.ts`
   - Module singleton: creates `const logger = createLogger({ sinks: [consoleSink], minLevel: ..., getContext: () => ({...}) })`. `getContext` reads `useSessionStore.getState().user`, resolves `webappVersion` from `getEmbeddedVersionInfo()`, resolves `route` from `window.location.pathname`.
   - Exports `logger` and `useLogger()` convenience hook (the hook just returns the singleton but is easier to spy in component tests).

7. **Tests** (new files under `clients/poolmaster/src/lib/logger/`):
   - `logger.test.ts` — level filtering, redaction pass, sink exception isolation, child bindings merge.
   - `redact.test.ts` — each sensitive key; nested objects; arrays; non-object data passthrough.
   - `console-sink.test.ts` — level-to-method routing, payload structure.
   - `client-trace-id.test.ts` — sessionStorage present, sessionStorage throwing, UUID uniqueness.

**Phase 1 ships as a standalone PR.** No user-visible behavior changes except that `console.*` output in dev is now structured.

### Phase 2 — Correlation headers on outbound API calls (ships independently)

Deliverable: every API call carries `X-Client-Trace-Id` + `X-Client-Request-Id`; backend log lines include them. No ingestion endpoint yet.

1. **Edit** `clients/poolmaster/src/lib/api.ts`
   - Extend the existing `client.interceptors.request.use` to attach both headers. Trace id from `getOrCreateClientTraceId()`; request id from `crypto.randomUUID()`. Keep the existing CSRF attach logic in place.

2. **Edit** `packages/core-api/src/core/logger.ts`
   - Extend `RequestLogBindings` interface: add `clientTraceId: string | null`, `clientRequestId: string | null`.
   - Extend `buildRequestLogBindings` to read them from `request.headers['x-client-trace-id']` and `request.headers['x-client-request-id']`.

3. **Edit** `packages/core-api/src/plugins/request-logging-context.ts`
   - No structural change needed — the new bindings flow through automatically because `createRequestContextLogger` already spreads all `RequestLogBindings` fields onto the child logger.

4. **Tests:**
   - Extend `tests/unit/core-api/logger.test.ts` — two new cases: headers present → fields populated; headers absent → fields null.
   - New test in `clients/poolmaster/src/lib/` that uses MSW to assert headers are attached (intercept a real SDK call and read the inbound request).

**Phase 2 ships as a standalone PR.** Headers are additive — backend ignores them until phase 4 backfill binds them into every log line.

### Phase 3 — Network sink + batching transport + ingestion endpoint

Deliverable: logs ship to CloudWatch through the backend. Error boundary and global handlers are wired.

1. **New file** `packages/shared/dto/client-logs.dto.ts`
   - Zod schemas: `ClientLogEntrySchema`, `ClientLogBatchSchema` (envelope with `schemaVersion`, `clientTraceId`, `webappVersion`, `userAgent`, `entries`).
   - Export through `packages/shared/dto/index.ts`.

2. **New file** `packages/core-api/src/modules/client-logs/routes.ts`
   - Fastify module registers `POST /client-logs`.
   - Uses `zodToJsonSchema(ClientLogBatchSchema)` for body validation.

3. **New file** `packages/core-api/src/modules/client-logs/handler.ts`
   - Validates batch, applies per-IP rate limit (implement in-memory sliding window keyed on `request.ip`; configurable via env `CLIENT_LOGS_RATE_LIMIT_PER_MIN`).
   - For each entry, calls `request.contextLogger[level]({ action: entry.action, data: { ...entry.data, source: 'client', clientRequestId: entry.clientRequestId, route: entry.route }, err: entry.err }, entry.msg)`.
   - Returns `204 No Content` on success; `429` on rate limit; `400` on invalid batch; `413` on oversize.

4. **Edit** `packages/core-api/src/index.ts`
   - Import and register `clientLogsModule` at `prefix: '/api/v1/client-logs'`.

5. **Edit** `packages/core-api/src/plugins/auth-guard.ts`
   - Add `'POST /api/v1/client-logs'` to `PUBLIC_ROUTES`. In the handler, still bind `authUser` when the cookie is present (the guard already does this for public routes when the cookie happens to be valid).

6. **New file** `clients/poolmaster/src/lib/logger/network-sink.ts`
   - Implements `LogSink` with a ring buffer (max 200 entries), batch flush triggers (size 20, timer 10 s, level >= error, `visibilitychange: hidden` via `navigator.sendBeacon`).
   - Transport: `fetch(POST /api/v1/client-logs, { body: JSON.stringify(batch), credentials: 'include', keepalive: true })`. Retry once on `5xx`/network error with 1 s jitter. Silent drop after.
   - Transport errors go to `console.error` only, never back through the logger.
   - Factory takes `{ endpoint, fetchImpl?, now? }` so tests can inject fakes.

7. **Edit** `clients/poolmaster/src/lib/logger/index.ts`
   - Compose sinks conditionally: `[consoleSink, networkSink]` in prod/qa, `[consoleSink]` in dev/test. Detect via `import.meta.env.MODE`.

8. **New file** `clients/poolmaster/src/features/app-shell/error-boundary.tsx`
   - Class component that catches render errors via `componentDidCatch`; on catch, calls `logger.fatal({ action: 'app.errorBoundary.caught', err: error, data: { componentStack: info.componentStack } }, 'Unhandled render error')` and renders a fallback panel with a "Reload" button.

9. **Edit** `clients/poolmaster/src/app.tsx`
   - Wrap `<RouterProvider />` in the new `<ErrorBoundary>`.

10. **Edit** `clients/poolmaster/src/main.tsx`
    - Register `window.addEventListener('error', ...)` → `logger.fatal({ action: 'app.unhandledError', err })`.
    - Register `window.addEventListener('unhandledrejection', ...)` → `logger.fatal({ action: 'app.unhandledRejection', err: event.reason })`.
    - Listeners live outside React on purpose so they survive any boundary failure.

11. **Tests:**
    - `clients/poolmaster/src/lib/logger/network-sink.test.ts` — batch flushes by size, by timer, by level, by visibilitychange; retry once on 5xx; drop on second failure; payload size cap rejects oversize batch; transport error doesn't recurse.
    - `clients/poolmaster/src/features/app-shell/error-boundary.test.tsx` — child throws, fallback renders, logger.fatal called with expected action + err.
    - `tests/unit/core-api/client-logs-handler.test.ts` — valid batch → re-emitted at correct levels; invalid schema → 400; rate limit exceeded → 429; oversize → 413. Use the existing `createLogger()` spy pattern from `admin-support-services.test.ts`.
    - `tests/functional/client-logs.functional.ts` (optional for phase 3, required before calling the lane complete) — full SDK round trip: authenticated user POSTs a batch, backend logs it, response is 204. Lives under `tests/functional/` per `rules/testing-rules.md` §6.

**Tradeoff called out here:** we are not adding a new CloudWatch log group for client logs. All client entries land in `/ecs/${name_prefix}/core-api` tagged with `data.source: 'client'`. Pros: zero infra change, instant correlation with backend. Cons: CloudWatch filters need `{ $.data.source = "client" }`; retention is the same as backend (30d prod / 7d non-prod). If ops later wants a separate retention or a separate log-group, splitting is a one-file terraform change in phase 5.

### Phase 4 — Instrument frontend call sites (branch-coverage push)

Deliverable: every meaningful positive/negative branch across the frontend is logged and independently tested, mirroring plan 103 phase 2–3 for backend.

Ownership slices (disjoint, parallelizable, each follows the same "log + prove" protocol):

- **F-A** — `features/auth/*` (auth-provider, session-store, auth-home-page): `auth.login.*`, `auth.register.*`, `auth.refresh.*`, `auth.logout.*`, `auth.me.missing`, `auth.session.cleared`.
- **F-B** — `features/leagues/*` + `features/teams/*`: league join/create/detail, team join/create. Positive milestones at `info`, validation failures at `warn`, 5xx at `error`.
- **F-C** — `features/contests/*`: create contest, contest detail, entry create/edit. Same pattern.
- **F-D** — `features/account/*` + `features/root-admin/*`: account ops, root-admin surfaces.
- **F-E** — `routes/route-guards.tsx` + `features/app-shell/*`: route navigation (`info` on enter, `warn` on guard denial), app-shell lifecycle.

Each slice:
- Inventories its positive and negative branches.
- Adds `logger.info` at success milestones, `logger.warn` at expected-negative branches (validation failures, guard denials, 404 reads, 429 handling), `logger.error` in `onError` callbacks for 5xx and unknown errors.
- Does **not** assert on log strings in tests; instead extends or adds RTL/MSW tests that assert the behavioral outcome (e.g., after a guard denial the user is redirected to `/`), per `rules/react-ui-rules.md` §7 and `rules/testing-rules.md` §1 Logging-and-Branch-Proof Rule.
- Adds a logger spy to existing test files that touches both branches of the code path under test, to prove the branch was reached.
- Is only complete when it proves at least:
  - one happy-path behavior
  - one expected negative branch (`warn`) behavior
  - one unexpected error path where that slice can surface `error`/`fatal`
    behavior truthfully

Keep `info` logs milestone-oriented. Do not promote render churn, effect churn,
or high-frequency component lifecycle events to `info`; those belong at
`debug` only when they have real diagnostic value.

Central helper: new file `clients/poolmaster/src/lib/logger/test-logger.ts` that exports a `createTestLogger()` spy (`{ debug, info, warn, error, fatal } as vi.Mock` quintet) matching the backend `createLogger()` pattern in `tests/unit/core-api/admin-support-services.test.ts`. Feature tests import it and pass it in via a test-only provider or by spying on the module export.

### Phase 5 — Ops follow-ups (optional, tracked separately)

- CloudWatch query documentation: add a section to `docs/DEVELOPER-SETUP.md` or a new `docs/observability.md` with example CloudWatch Insights queries — `fields @timestamp, action, data.source, clientTraceId, userId | filter clientTraceId = 'xxx'` — mirroring what plan 103 task 103-014 does for backend.
- Optional terraform change: if ops decides frontend logs need a distinct retention/alarm profile, carve out a second log group or a CloudWatch subscription filter. Not required for the initial rollout.
- Optional: introduce Sentry/Datadog RUM as an *additional* sink at the `error`/`fatal` tier. The custom wrapper supports multi-sink out of the box.

## Ordering summary

| Phase | Ships independently? | Blocked by |
|---|---|---|
| 1 — logger core + console sink | Yes | — |
| 2 — correlation headers | Yes (can interleave with 1) | Phase 1 for the client trace id helper |
| 3 — network sink + ingestion endpoint + error boundary | Yes | Phases 1 and 2 |
| 4 — frontend branch-coverage instrumentation push | Per slice (F-A…F-E) | Phase 3 (so logs actually reach CloudWatch) |
| 5 — ops doc + optional infra split | Yes | — |

## Proposed Execution Slices

Use these as the implementation beads/slices for the rollout:

1. `WLO-001` Logger foundation in the webapp
- `clients/poolmaster/src/lib/logger/**`
- console sink, redaction, client-trace id, singleton wiring, unit tests

2. `WLO-002` Correlation header propagation and backend request binding
- `clients/poolmaster/src/lib/api.ts`
- `packages/core-api/src/core/logger.ts`
- related header/interceptor tests

3. `WLO-003` Client log ingestion contract and transport
- shared DTOs
- backend `/api/v1/client-logs`
- client batching/network sink
- transport and handler tests

4. `WLO-004` Global browser failure capture
- error boundary
- `window.onerror`
- `unhandledrejection`
- fallback UX + tests

5. `WLO-005` Feature slice A: auth/account/session instrumentation + proof

6. `WLO-006` Feature slice B: league/team/member instrumentation + proof

7. `WLO-007` Feature slice C: contests/entries/history instrumentation + proof

8. `WLO-008` Feature slice D: root-admin/manage instrumentation + proof

9. `WLO-009` Feature slice E: routing/app-shell/navigation instrumentation + proof

10. `WLO-010` Operational docs and final gap sweep
- CloudWatch query guidance
- final frontend/runtime logging gap audit
- full required gates before closeout

## Tradeoffs captured at each decision point

- **Custom logger vs. Pino browser**: chose custom for bundle size and API-shape control; accepted cost of maintaining ~80 lines ourselves. Revisit if the wrapper grows past ~200 lines.
- **Backend ingestion endpoint vs. direct-to-CloudWatch**: chose backend endpoint because AWS credentials + Firehose/Kinesis aren't wired and exposing unauthenticated write IAM to the browser is not acceptable. Cost: adds core-api traffic and a new route. Benefit: perfect correlation and one CloudWatch log group.
- **Sessionstorage-scoped `clientTraceId` vs. durable localstorage**: chose sessionStorage so a closed tab resets the trace — avoids stitching together unrelated sessions. Cost: can't correlate across tab reopens. Acceptable given the backend already has `sessionId` for durable session correlation.
- **Shared log group with `source: 'client'` vs. separate log group**: chose shared for phase 3 simplicity; documented the split as a phase 5 option if ops ever needs different retention.
- **Rate limit in-memory vs. Redis**: chose in-memory (per-task sliding window) because core-api already scales out on ECS and a noisy browser client is a per-IP concern; if the surface is ever abused we can graduate to a shared store.
- **Batching via sendBeacon on visibilitychange vs. pagehide**: chose `visibilitychange` because it fires on tab switch *and* pagehide equivalents; sendBeacon payloads survive navigation without keeping the tab alive.

### Critical Files for Implementation

- clients/poolmaster/src/lib/api.ts
- clients/poolmaster/src/app.tsx
- packages/core-api/src/core/logger.ts
- packages/core-api/src/plugins/auth-guard.ts
- packages/core-api/src/index.ts
