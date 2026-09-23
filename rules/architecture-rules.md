# PoolMaster — Architecture Rules

All plan documents and implementation work must conform to these rules. This is the single source of truth for system-level architecture, infrastructure, and cross-cutting decisions.

**For implementation-level rules, see:**
- **[Product Requirements Rules](product-requirements-rules.md)** — requirement artifacts, use-case structure, and product handoff floor
- **[Technical Specification Rules](technical-specification-rules.md)** — technical-spec artifacts, domain/API/flow structure, and technical handoff floor
- **[Service Rules](service-rules.md)** — backend TypeScript, Fastify, Prisma, OpenAPI, DTO, and mapper rules
- **[PoolMaster Webapp Rules](poolmaster-webapp-rules.md)** — single-webapp product behavior, role-based access expectations, and archived-app policy
- **[React UI Rules](react-ui-rules.md)** — PoolMaster React app technology, generated API client usage, TanStack Query, and frontend testing patterns
- **[Swift Rules](swift-rules.md)** — iOS SwiftUI client rules
- **[Android Rules](android-rules.md)** — Android Kotlin + Jetpack Compose rules
- **[Testing Rules](testing-rules.md)** — unit, integration, contract, smoke, and browser E2E rules
- **[Workflow Rules](workflow-rules.md)** — action-plan tracking and rule/documentation update requirements
- **[Domain Model Conventions Rules](domain-model-conventions-rules.md)** — lifecycle naming, `status` vs `isActive`, and shared domain-model consistency defaults

---

## 1. Stack Decisions

**The stack itself is not documented here.** What the repo uses is what `package.json`,
`tsconfig.base.json` and `schema.prisma` say; a table restating them is a second source of
truth that drifts silently and is always the less reliable one. Read the manifests.

What belongs here is the subset a manifest cannot express: choices made deliberately, and
things deliberately *not* adopted. Those exist nowhere else.

### Deliberate absences

- **No external queue.** Async work runs on the in-process event bus and service-local
  scheduling. Add external queueing only when the architecture genuinely requires it —
  not because a task is asynchronous.
- **No Redis.** Caching and messaging use the in-process event bus plus persistent services
  where needed. The active MVP runtime has no Redis dependency and should not acquire one
  incidentally.

### One web application

The go-forward web frontend is a single role-based application: `clients/poolmaster`.

- Root-admin capability lives in the backend API, not in a separate admin web app.
- `clients/_archived/web` is archived reference material only. Do not extend it.
- New web work targets the single PoolMaster app. **Do not split functionality across
  multiple React apps.**

### Unbuilt clients

`rules/swift-rules.md` and `rules/android-rules.md` describe clients that do not exist in
this repo. They are retained as the starting position for whenever those clients begin, and
nothing in this file should be read as asserting they are built.

---

## 2. Contract-First API Architecture

PoolMaster is now explicitly **contract-first at the API boundary**.

The source-of-truth chain is:

`Zod DTO schema -> Fastify route schema.response/request schema -> exported OpenAPI spec -> generated hey-api client -> PoolMaster app usage`

Required implications:

- Backend routes must describe real request and response payloads.
- OpenAPI generation must be treated as part of the build contract, not optional documentation.
- Frontend application code must consume the generated SDK/types instead of recreating API contracts locally.
- If the generated client is wrong, fix the backend route schema or DTO first. Do not patch around it in app code.

### OpenAPI Rules

- The live Fastify app is the source for exported OpenAPI, not a hand-written YAML file.
- `npm run api:refresh` is the standard regeneration command:
  - export spec
  - regenerate `hey-api` client
- `npm run api:validate` must stay green. Missing JSON response content is a defect.
- `npm run api:check` is the CI freshness gate. It regenerates OpenAPI and
  the `hey-api` client into a temporary location and fails when committed
  generated artifacts are stale.
- Files under `packages/shared/generated/openapi.json` and `packages/shared/generated/hey-api/` are generated artifacts. Do not hand-edit them.

### Route Source of Truth

- `packages/shared/api-routes.ts` is the shared source of truth for canonical route constants used by:
  - backend route prefixes
  - integration tests
  - smoke tests
  - MSW handlers
- For **frontend runtime application code**, the generated SDK is the primary path source of truth. Do not add new manual path-building code when a generated operation exists.

### Validity / Compatibility Matrices Source of Truth

Small enumerated compatibility matrices — `(tournamentFormat × contestFormat) → valid?`,
provider × sport, selection-mode-per-contest-format — **live in code as TypeScript const
maps, not in the database.** The criteria for that choice, its tradeoffs, and the rejected
alternatives are in [ADR-0007](../docs/adr/0007-small-validity-matrices-live-in-code.md).

The one prohibition, stated here because it is a rule rather than a decision:

- **A validity matrix is a domain catalog, not a write permission.** It says which
  combinations are coherent, not which are implemented. Creation and mutation paths must
  gate against both — the matrix, *and* what the current configuration, scoring and UI
  contracts actually support.

---

## 3. No Mock Data in Application Code

This is a non-negotiable architecture rule.

- Application code must never ship mock data, fake data, seeded sample responses, or development-only fallback payloads.
- If an endpoint is missing or broken, surface loading/error/empty UI states. Do not hide the defect with fake data.
- This applies across backend services, web/admin hooks, pages, stores, mobile view models, and shared runtime modules.

Where test doubles are allowed to live is stated once, in
[`testing-rules.md §1B`](testing-rules.md) — it names the exact paths, which this file
previously restated in looser terms. That section covers the *other* route into mock data
in production: bending application code to make a test pass. This section covers shipping
fake data to users. They overlap on one case and are otherwise different rules; read both.

Related anti-patterns that are banned:

- `if (process.env.NODE_ENV === 'development') return mockData`
- `initialData: mockData` in TanStack Query
- `queryFn: async () => mockData`
- `catch { return mockData }`
- hand-built success envelopes that do not reflect the real domain payload

### Provider and Adapter Registry Discipline

Provider, adapter, and integration factories are production architecture, even
when one of the available providers is a mock or local-development provider.

Rules:

- Production and staging provider registries must be driven by explicit runtime
  configuration, not by a hardcoded single provider id.
- QA and local development may use mock providers when configured for that
  environment. The provider must still be selected through the same registry
  and configuration path that real providers use.
- Production and staging must reject mock providers unless an explicit
  emergency override is configured, and that override must log loudly at
  startup with environment, provider id, and reason.
- Adding a new provider means updating the registry, configuration schema,
  validation, startup logging, and tests together.
- A factory that silently falls back to a mock provider because configuration is
  missing is a production defect. Missing provider configuration should surface
  as disabled ingestion or a typed startup/configuration error, not fabricated
  data.

---

## 4. Service Topology

All backend services are TypeScript services with explicit module boundaries.

| Module / Surface | Responsibility |
|---|---|
| Core API | Auth, leagues, invitations, contests, squads, participants, events, scoring, standings, notifications, history, config, consent, and root-admin operations |
| Draft module | Draft session lifecycle and draft engines inside the monolith |
| Scoring module | Scoring computation, standings rollups, and event-consumption logic inside the monolith |
| Ingestion module | Sports-data provider ingestion and provider/status operations inside the monolith |
| Notification module | In-app notification delivery orchestration inside the monolith |

### Architectural Rules

- Keep domain modules isolated behind services and mappers.
- Route handlers do not return raw Prisma models.
- Database access stays behind service/repository boundaries.
- Cross-service/module communication uses shared events and typed contracts.
- League isolation must remain explicit in request context and persistence boundaries.
- **One code path per piece of business logic, however many callers reach it.**
  When the same behavior must be triggered from more than one caller — two
  route lanes (admin vs. sync), an admin-initiated action and a
  system/scheduler-initiated one, a manual trigger and a scheduled one — the
  behavior lives in one shared function/service, and every caller invokes
  that same function. Do not give each caller its own copy of the logic,
  even a thin one; copies drift silently, and a fix or a new branch applied
  to only one copy is a defect the moment a second path exists. This is the
  backend mirror of `rules/react-ui-rules.md`'s Component Reuse Threshold
  ("the rule of two") — apply it the first time a second caller needs
  behavior a first caller already has, not after it has drifted twice.
  Example: `EventLifecycleService.applySportEventStatusTransition` is the
  one place `SportEvent.status` is ever written, called identically by
  provider-driven ingestion, admin-triggered transitions, and the automatic
  lifecycle scheduler — each caller supplies a different `actor`, not a
  different implementation.

### Domain Event Bus

The in-process event bus (`packages/shared/events/event-bus.ts`) is the primary mechanism for cross-module communication. It is an architectural seam, not an implementation detail.

- Every domain event type must be defined as a typed interface in `packages/shared/events/`.
- Services emit events after successful state changes, not before.
- Subscribers must not assume emission order or delivery guarantees beyond "at least once, in process."
- Event payloads must be serializable (no Prisma models, no class instances, no functions).
- When adding a new event type, update the event type registry and add appropriate tests for emission and affected subscriber behavior (see [Testing Rules §8](testing-rules.md)).

### Event-Driven Mutation Discipline

Any domain-event subscriber that mutates application state must be designed for
at-least-once delivery and partial subscriber failure.

Rules:

- Subscriber side effects must be idempotent for the event key they process, or
  the subscriber must maintain enough durable state to detect duplicates.
- Recalculation or rollup subscribers that touch multiple rows must define the
  transaction boundary explicitly. If the recalculation is logically atomic,
  wrap the full mutation set in one transaction.
- Subscribers that can be invoked concurrently for the same aggregate must
  serialize per aggregate key, use idempotent upserts, or otherwise prove that
  interleaving cannot corrupt state.
- The event bus default failure policy is `allSettled`: one subscriber failure
  must be logged and surfaced without preventing unrelated subscribers from
  running. Use fail-fast behavior only when the event contract explicitly says
  all subscribers are part of one atomic operation.
- Subscriber failures must include event type, aggregate id, subscriber name,
  and correlation context in logs.
- Tests for event-driven mutations must cover duplicate event handling and at
  least one subscriber failure path when the subscriber writes data.

---

## 5. Project Structure

**The layout is not documented here** — the filesystem is the source of truth, and a tree
in a rules file rots on the first directory that moves. What follows is the part the
filesystem cannot tell you: the constraints on where things are allowed to go.

### Structural Rules

- Tests remain outside production `src/` folders unless there is a deliberate package-local test convention already in use.
- Generated API artifacts live under `packages/shared/generated/`.
- The PoolMaster web app consumes the shared generated API package.
- Do not create parallel handwritten clients when the shared generated client can be extended with thin app-specific configuration.

---

## 6. Documentation and Drift Prevention

Architecture rules must describe the codebase that actually exists, not an aspirational future state.

- When API-contract flow changes, update these architecture rules and the service/react/testing rules in the same change.
- When testing patterns change materially, update [Testing Rules](testing-rules.md).
- When generated-client usage changes materially, update [React UI Rules](react-ui-rules.md), [Service Rules](service-rules.md), and [Model Change Rules](model-change-rules.md).
- If a rule conflicts with the codebase after a refactor, update the rule immediately instead of leaving stale guidance behind.
