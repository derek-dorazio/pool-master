# PoolMaster — Architecture Rules

All plan documents and implementation work must conform to these rules. This is the single source of truth for system-level architecture, infrastructure, and cross-cutting decisions.

**For implementation-level rules, see:**
- **[Product Definition Rules](product-requirements-rules.md)** — discovery, requirements and tech-spec artifacts, and when to skip all three *(rarely needed)*
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

- **No external queue.** Async work runs in-process: service-local scheduling and work
  submitted after a request is accepted. Add external queueing only when the architecture genuinely requires it —
  not because a task is asynchronous.
- **No Redis.** Caching and coordination use in-process state plus persistent services
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

- **The generated SDK is the route source of truth**, for frontend runtime code and for tests alike. Do not add manual path-building code when a generated operation exists.
- `packages/shared/api-routes.ts` is **generated** from `packages/shared/generated/openapi.json` by `scripts/generate-api-routes.mjs` (#212). It is not hand-edited, and it is not "the source of truth" — it was described that way while it was hand-written, and it drifted into ten wrong paths and four dead routes. `npm run api:refresh` regenerates it; `npm run api:check` fails CI when it and the spec disagree.
- **Do not add entries to it without the repo owner's explicit approval.** An entry is for a caller that genuinely cannot use the SDK — today the client-log transport, which needs `fetch` with `keepalive` and a `sendBeacon` fallback, and integration suites building `inject()` URLs. Entries are added to the manifest in the generator, never to the generated file.
- `clients/poolmaster/src/test/msw-api.ts` likewise derives its map from the committed spec; it is not a hand-maintained table either.

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
| Core API | Auth, leagues, invitations, contests, squads, participants, events, scoring, standings, history, config, and root-admin operations |
| Draft module | Draft session lifecycle and draft engines inside the monolith |
| Scoring module | Scoring computation, standings rollups, and event-consumption logic inside the monolith |
| Ingestion module | Sports-data provider ingestion and provider/status operations inside the monolith |

### Architectural Rules

- Keep domain modules isolated behind services and mappers.
- Route handlers do not return raw Prisma models.
- Database access stays behind service/repository boundaries.
- Cross-service/module communication uses shared events and typed contracts.
- League isolation must remain explicit in request context and persistence boundaries.
- **Dependency direction is one-way: `packages/shared` must never import from
  `packages/core-api`.** Shared is the contract layer that both the service and the clients
  depend on; an import in the other direction makes the contract depend on one of its
  consumers, and the package stops being shareable. Circular dependencies between any two
  packages are a defect, not a style preference — they break incremental builds and make
  module initialisation order load-bearing. `import-x/no-cycle` is the mechanical check for
  the circular half; the direction rule needs a reader.
- **Do not land `TODO` markers or half-implementations for work you intend to do later.**
  A `TODO` in merged code is untracked work with no owner and no deadline, and it is
  invisible to the tracker. If the work is in scope, finish it; if it is not, open an issue
  and let the issue carry it.
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

### No event bus — modules call each other

There is no in-process event bus. One existed in `packages/shared/events/` with typed event
contracts and two publishers, and #261 deleted it: in six months nothing ever subscribed, so
every publish iterated an empty handler list. A module that needs another module's effect calls
that module's service directly, wired in its `wiring.ts`; the event lifecycle service calling
settlement is the model. The persisted rows are the outcome, and tests assert those rather than
an event.

If pub/sub is wanted later, reintroduce it against a real subscriber, so a concrete consumer
decides its shape, and write its rules then. The rules that stood here (typed events, emission
after commit, at-least-once idempotent subscribers, `allSettled` failure policy) were written
for subscribers that never existed; they are in git history if that day comes.

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

## 6. Database Data: Reference, Fixture, Test

Three kinds of row get confused with each other, and the confusion is expensive: the first QA
reset wiped the `sports` table, nothing restored it, and every golf admin screen went dead —
`golfSportQueryOptions` throws "The golf sport is not set up." with no GOLF row. The row had
existed in each environment by a different accident, and in QA by nothing but the assumption
that it was already there.

| Kind | Test | Where it goes |
|---|---|---|
| **Reference data** | The app is *broken* without it. It belongs to the schema's meaning, is identical in every environment, and no user action creates it | **A migration** |
| **Fixture data** | Makes one environment *usable* by a human. Environment-specific, often holds credentials | **A bootstrap script**, invoked explicitly |
| **Test data** | Belongs to one test, torn down after | **Test helpers** |

### Reference data goes in a migration

- Insert it with `ON CONFLICT ... DO NOTHING` on its natural key, so the migration is idempotent
  and does not overwrite a row an environment has corrected by hand.
- State every column the table requires, including ones that have a column default, when the
  default is one the schema warns against relying on (`Sport.tournamentFormat`, #236).
- Change it in a *later* migration, never by editing an applied one: Prisma records applied
  migrations by checksum, and an edited migration makes the next `migrate deploy` fail.
- Two examples are in the tree: `contest_config_templates`, seeded by
  `20260419213000_add_contest_config_templates` and evolved by later migrations, and the GOLF
  `sports` row, seeded by `20261004140000_seed_golf_sport_reference_row`.
- A new sport needs code as well as a row, so its row arrives in the migration that adds its
  support — not in a list of every sport the `Sport` enum names.

**The test for "is this reference data" is whether the app breaks without it, not whether it is
convenient to have.** A row the app merely starts empty without — `platform_runtime_configs`,
which has `DEFAULT_INGESTION_CONFIG` in code and creates its row on demand — is not reference
data and needs no migration.

### Fixture data goes in a bootstrap script

- `packages/core-api/scripts/bootstrap-users.mjs` is the pattern: idempotent upserts, driven by
  explicit input (`FIXTURE_JSON`), invoked by the workflow that wants it.
- It must never carry a credential into a migration, and never run against production.
- Keep the fixture minimal and prove each entry is used. QA's fixture carried a commissioner and
  a member for an e2e design (storage-state reuse and a shared `QATESTLEAGUE`) that #84/#280
  replaced with a journey that creates and tears down its own data; both users survived as
  orphans and came back on every reset until the fixture was trimmed to the root admin, which is
  needed because the post-deploy journey signs in as it and the owner uses it to reach the site.

### There is deliberately no Prisma seed

No `prisma.seed` is configured, and none should be added without a reason that survives this
paragraph. A seed runs implicitly on every `prisma migrate dev` and `migrate reset`, for
everyone, which makes it the least predictable place to put data. With reference data in
migrations and fixtures in scripts there is nothing left for it to do.

---

## 7. Documentation and Drift Prevention

Architecture rules must describe the codebase that actually exists, not an aspirational future state.

- When API-contract flow changes, update these architecture rules and the service/react/testing rules in the same change.
- When testing patterns change materially, update [Testing Rules](testing-rules.md).
- When generated-client usage changes materially, update [React UI Rules](react-ui-rules.md), [Service Rules](service-rules.md), and [Model Change Rules](model-change-rules.md).
- If a rule conflicts with the codebase after a refactor, update the rule immediately instead of leaving stale guidance behind.
