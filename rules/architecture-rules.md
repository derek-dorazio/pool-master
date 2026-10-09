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
- **[Domain Model Conventions Rules](domain-model-conventions-rules.md)** — lifecycle, enums, one canonical DTO per entity, schema design, league/squad vocabulary, and operation access roles

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
- `npm run api:validate` must stay green. Missing JSON response content is a defect, and so is a request body or response that is not a named component.
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
- Cross-module communication is a typed service call, wired in the calling module's
  `wiring.ts`. There is no event bus — see *No event bus — modules call each other* below.
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

### Provider data reaches only events an admin authored and linked

Every event is created by an admin, and a provider feeds only events an admin has linked
to a provider event. Sync-driven event creation, scheduled event lists, scheduled results
and the rankings feed are **removed, not legacy**: do not re-add them, put them behind a
flag, or keep them as a fallback. The decision and its alternatives are
[ADR-0009](../docs/adr/0009-admin-authored-events-score-only-linking.md).

- The only feed that runs on a schedule by default is live scores, for linked events.
- A provider's field and odds are an on-demand complement an admin triggers for one linked
  event. A provider that has no such feed for a sport or league is a normal empty state,
  not an error.
- Listing a provider's events is a lookup behind an admin action (browse, link, year
  import). It never creates, updates or changes the status of an event by itself.
- A new feed that would create events or write across events on a schedule needs a new ADR
  first.
- A sync writes only what it feeds — scores, the field and the field size. It never writes
  an event's name, venue, dates, rounds, timing or status, and never creates a round; those
  are the admin's. `SportEventSyncScope` has two values: `NONE` (unlinked) and `SCORES_ONLY`
  (linked). There is no provider-owned scope; do not add one.

---

## 5. Project Structure and Layer Boundaries

**The layout is not documented here** — the filesystem is the source of truth, and a tree
in a rules file rots on the first directory that moves. What follows is the part the
filesystem cannot tell you: the constraints on where things are allowed to go, and what each
layer is forbidden to know.

### Structural Rules

- Tests remain outside production `src/` folders unless there is a deliberate package-local test convention already in use.
- Generated API artifacts live under `packages/shared/generated/`.
- The PoolMaster web app consumes the shared generated API package.
- Do not create parallel handwritten clients when the shared generated client can be extended with thin app-specific configuration.

### The two rules that hold the layering together

Everything below is a consequence of these.

- **Arrows into `domain/` only ever point inward.** `packages/shared/domain` imports
  nothing — not Prisma, not Zod, not Fastify. Ports are written in terms of domain types,
  DTOs in terms of domain enums, adapters translate rows into domain objects. Nothing
  translates the other way. The package-level half of this is in §4 *Service Topology*:
  `packages/shared` must never import from `packages/core-api`.
- **The contract is generated, in one direction.** Routes declare Zod schemas, `api:export`
  boots the app and writes `openapi.json`, `api:generate` writes the SDK and the TypeScript
  types, and the webapp imports those. The webapp never hand-writes a request shape, and the
  service never hand-writes a client. The chain is in §2 *Contract-First API Architecture*.

### The service, layer by layer

Each layer is stated as what it owns, what it is forbidden to hold, and the suite that
proves it — a layer whose tests live somewhere unrelated is a layer whose boundary nobody
can see. The suites themselves are governed by `testing-rules.md` §2 *Test Layers*.

| Layer | Owns | Must not hold | Proved by |
|---|---|---|---|
| `shared/domain` | The fields an entity has; the values its enums may take | Storage (`passwordHash` is deliberately absent from `User`), transport, authorization. **No imports** | Unit tests over the vocabulary itself — that the enum a DTO validates against and the enum an adapter maps to are the same enum. Prisma surfaces enum *member names* (`TWELVE_HOUR`) while the domain holds *values* (`12H`), so this is a real check, not a tautology |
| `shared/db/ports.ts` | One interface per aggregate, written entirely in domain terms; queries named for the question they answer | Paging (`domain-model-conventions-rules.md` §16 *No Paging In The API*), Prisma types, secrets | Nothing of their own. They are interfaces; their tests are their adapters' |
| `core-api/src/adapters` | `where`, `select`, `orderBy`, row→domain mapping, the null/undefined boundary. The only place that knows a Prisma row, and the only place enum mapping happens | Business rules, authorization, anything spanning aggregates | Integration tests against **real Postgres, no mocks**. This is the one layer where a mock proves nothing |
| `core-api/src/modules/<object>` | The operations: guards and their order, idempotence, what shares a transaction, which side effects follow a write, which typed error each failure raises | HTTP — a service never sees a `request`, never sets a cookie, never picks a status code. A single-aggregate read that bypasses its port: the only exceptions are `$transaction`, the cross-table cascade, the refresh-token revoke and the `passwordHash` read the port deliberately never serves, each commented at the call site | Unit tests per service, with port fakes |
| `core-api/src/mappers` | One projection per object: field selection and `Date → ISO string` | Anything conditional on the caller | The contract-verification suites, which parse real responses against the DTO schema — a stronger check than asserting a mapper's return against a literal |
| `shared/dto` | Zod schemas, their inferred types, and the `registerSchema` call that publishes each as a named OpenAPI component | Viewer context (below); per-caller variants | Unit tests over the generated artifacts: that every registered component is published, and that the generator emits `| null` where the schema says nullable |
| `<object>/routes.ts` | Path, method, schema refs — and, with the module's `wiring.ts` where one exists, its composition root: the only place that knows both an interface and its implementation | Logic. A route wires and declares; it does not decide | Contract-verification integration (does the response still match its schema) and functional suites driven through the **generated SDK** (does the published contract and the client still agree) |
| `plugins/` and `core/` | Cross-cutting Fastify plugins; process-level helpers with no domain content | Domain content. Root-admin operations live in the module of what they administer — `admin` is a permission, not a place | The suites of whatever they cut across |

### Traps in the service layers

Each of these was a real defect, and each reads as plausible code.

- **A port with no implementation is worse than a missing port.** `UserRepository` was
  declared and exported for months with zero adapters and zero consumers, so every user
  query went straight to `prisma.user` and from there to its own result shape — two services
  accumulated 36 and 26 raw calls. The port looked like the convention was being followed.
- **A mapper's declared return type is the check.** `mapLeagueMembershipToDto` had none for
  months, which left `LeagueMembershipDto` a registered OpenAPI component with nothing
  type-checked against it: a field added to the schema or dropped from the mapper compiled
  either way, and the shape held together only because Fastify's serializer dropped unknown
  keys.
- **Exhaustive `Record`s, not switches, for enum mapping** — so adding an enum member fails
  the build in the adapter instead of falling through to `undefined` at runtime. The
  worked example: mapping a `null` through an enum `Record` returns `undefined`, which
  Prisma reads as *no change*, so "clear my preference" silently did nothing.
- **A service test may not assert which repository method was called with what.** That pins
  the call graph, breaks on refactors that change nothing, and the thing it stands in for —
  does the query return the right rows — belongs to the adapter's integration test. What it
  may assert: the returned value, the typed error (`code`, `statusCode`), the **absence** of
  a write (the only way idempotence and a short-circuiting guard are visible), that two
  writes shared one `$transaction`, the content of a side effect handed to a port, and that
  **both callers reach the same operation**. The one exception: a service that holds no state
  and issues no query, where the update it hands the port *is* its output — and the test file
  that relies on it says so.
- **Positional constructor parameters with trailing optionals are the reason some reads are
  still on raw Prisma.** Services taking twelve, nine and seven of them cannot absorb a new
  dependency safely: converting them landed a Prisma mock in a logger slot and a repository
  in a base-URL slot, and was reverted. Replace the parameter list with an options object
  before adding to it.
- **No live read sits in front of a table nothing writes.** Two did, and both went with the
  features that never wrote to them. An endpoint whose data can only arrive by someone
  inserting rows by hand is not an endpoint.

### DTOs and routes

**One canonical DTO per entity and per edge — not per caller, view or access level — and no
viewer context on an entity DTO.** Both are stated once:
[`domain-model-conventions-rules.md`](domain-model-conventions-rules.md) §8
*Typed-End-to-End DTO Conventions* for the shape, and access rule A8 in
[`docs/DOMAIN-OPERATIONS.md`](../docs/DOMAIN-OPERATIONS.md) for how the viewer's
relationship travels instead (once per league, as the canonical edges). The layer
consequence: a mapper takes the entity and nothing about who asked.

**One route per operation, with the subject as a parameter.** `/users/:userId/disable`,
where `me` resolves to the caller, rather than one route per kind of caller. Two routes for
one operation drift silently and did: only one half carried the last-root-admin guard, only
one refused to write an inactive account, only one answered with the updated entity. None of
those differences were decisions — they are what happens when "who is asking" is encoded in
*which file you are in* instead of in a parameter. The general form of this rule is in §4
*Service Topology*, **One code path per piece of business logic**.

### The webapp's layers

`react-ui-rules.md` governs the frontend in detail; these are the boundary constraints.

- **`lib/api.ts` is the only place that configures the generated client** — base URL, cookie
  credentials, the CSRF header on state-changing methods, the client trace id, and the
  401-triggered refresh-and-retry. Everything else imports operations *through* it.
- **`lib/query-keys.ts` is a single factory.** Every key is built there, so invalidation
  after a mutation names the same key the read used. The failure it prevents is a page that
  mutates successfully and then shows stale data because two call sites spelled a key
  differently.
- **TanStack Query is the state store, deliberately, and there is no second copy of server
  state.** The server response *is* the state; a mirror of it is a shadow. See
  `react-ui-rules.md` §4 *TanStack Query Rules* and §5 *State, Effect, Form*.
- **Types come from the generated SDK, never re-derived.** `type RootAdminUser = UserDto`,
  not an index into a response map. The second form couples a component to the shape of an
  *envelope*, so the component has to change when the envelope does even though the entity
  did not.
- **A feature folder holds its pages, modals, cards, query hooks, routing helpers and its
  tests, colocated** — whereas backend tests live centrally. That asymmetry follows the
  runner, not a preference: the webapp's tests need the Vite module graph and jsdom, which is
  vitest's environment and not the root jest project's. The consequence to know is that the
  backend unit script does **not** include the webapp.
- **Registration order in the MSW request harness is load-bearing**, because MSW matches
  handlers in order and the full operation set contains paths that shadow each other —
  `GET /leagues/{id}/squads/{squadId}` would answer a request for
  `GET /leagues/{id}/squads/owner-invitations`. Handlers are sorted most-specific-first: a
  literal segment beats a parameter at the first position two paths differ.
- **Neither route map is hand-written.** `packages/shared/api-routes.ts` is generated from
  the spec and the MSW map derives from the committed spec at test-setup time. Both were
  hand-maintained once and both had drifted — ten paths missing a trailing slash, four
  pointing at deleted routes, and `/account/*` entries outliving the routes themselves. The
  rule and its one narrow exception are in §2 *Route Source of Truth*.

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
| **Manual-testing seed** | Gives a human something to test by hand (tournaments, fields, scores). Made up or public, never needed by the app | **An opt-in seed through the admin API**, run on request |

### Reference data goes in a migration

- Insert it with `ON CONFLICT ... DO NOTHING` on its natural key, so the migration is idempotent
  and does not overwrite a row an environment has corrected by hand.
- State every column the table requires, including ones that have a column default, when the
  default is one the schema warns against relying on (`Sport.tournamentFormat`, #236).
- An `id` no longer has to be supplied: every uuid `id` carries `DEFAULT gen_random_uuid()` as
  of #340. `20261004140000_seed_golf_sport_reference_row` calls `gen_random_uuid()` by hand
  because `sports.id` had no default when it was written; it stays exactly as it is, because it
  is applied, but a new reference-data migration can simply omit the column.
- Change it in a *later* migration, never by editing an applied one: Prisma records applied
  migrations by checksum, and an edited migration makes the next `migrate deploy` fail.
- Two examples are in the tree: `contest_config_templates`, seeded by
  `20260419213000_add_contest_config_templates` and evolved by later migrations, and the GOLF
  `sports` row, seeded by `20261004140000_seed_golf_sport_reference_row`.
- A new sport needs code as well as a row, so its row arrives in the migration that adds its
  support — not in a list of every sport the `Sport` enum names.

**The test for "is this reference data" is whether the app breaks without it, not whether it is
convenient to have.** A row the app merely starts empty without — `platform_runtime_configs`,
whose settings groups have their defaults in code and create their row on the first save — is
not reference data and needs no migration.

### Runtime settings live in the database, not in env

How the app *behaves* must be changeable without a Terraform apply or a redeploy (#450). So:

- **Env / Terraform holds secrets and how this deployment is wired:** `DATABASE_URL`,
  `JWT_SECRET`, cloud region and credentials, the mail transport and sender identity, SMTP
  host/port/credentials, `APP_BASE_URL`, and the sports data provider settings.
- **A settings group in the database holds behaviour:** on/off switches, intervals, and
  choices between things the deployment already has.
- **A settings group never holds a secret.** Its payload is served to root-admin screens and
  copied into the change history.

A group is declared once with `defineSettingsGroup` (key, title, description, Zod schema,
code defaults that may depend on the environment) and added to `SETTINGS_GROUPS`;
`AppSettingsService` owns all of them. What that buys, and what a new group must not undo:

- **Reads are synchronous and never write.** A missing row means the defaults; an invalid
  stored row is logged and served as the defaults, and left for an admin to fix. Nothing creates
  or rewrites a row except a save, so two tasks booting together cannot race.
- **Every task converges within 30 seconds.** Production runs more than one core-api task; a
  value cached once at boot is how a save on one task never reached the other. The cache is
  refreshed from one query on a timer, with no pub/sub.
- **Stored payloads are read over the defaults, nested objects included, and unknown keys are
  dropped**, so adding or retiring a field never invalidates an old row. Cleaning up an old row's shape is a migration,
  not a boot-time rewrite.
- **Every save is validated whole and recorded** in `platform_runtime_config_history` in the
  same transaction, and can be checked against the `updatedAt` the admin last saw.
- **A partial change goes through `update`, never `get` then `save`.** A task's cache can be up
  to 30 seconds old, so merging onto it and saving the whole payload unchecked silently reverts
  another task's recent save. `update` saves against the version it merged onto and, on a
  conflict, merges onto the newer one once more.

### Fixture data goes in a bootstrap script

- `packages/core-api/scripts/bootstrap-users.mjs` is the pattern: idempotent upserts, driven by
  explicit input (`FIXTURE_JSON`), invoked by the workflow that wants it.
- It must never carry a credential into a migration, and never run against production.
- Keep the fixture minimal and prove each entry is used. QA's fixture carried a commissioner and
  a member for an e2e design (storage-state reuse and a shared `QATESTLEAGUE`) that #84/#280
  replaced with a journey that creates and tears down its own data; both users survived as
  orphans and came back on every reset until the fixture was trimmed to the root admin, which is
  needed because the post-deploy journey signs in as it and the owner uses it to reach the site.

### Manual-testing seed data goes through the admin API

- `packages/core-api/scripts/seed-golf/` is the pattern: one data file (`golf-2026.json`) and a
  script that writes it with the generated SDK as a root admin, so every rule the Manage
  screens apply applies to it too and nothing writes the database behind the service.
- It runs only when someone asks: `npm run seed:golf` locally, the *Seed QA golf data*
  workflow on QA. Never from a migration, a deploy, a reset, or a Prisma seed.
- It is idempotent by skipping, not by overwriting: anything that already exists is left as
  it is, so it is safe after a QA reset and never clobbers what someone edited by hand.
- Its dates are moved relative to the day it runs, so what it creates is usable then. No
  automated test may depend on seeded rows; tests build their own.

### There is deliberately no Prisma seed

No `prisma.seed` is configured, and none should be added without a reason that survives this
paragraph. A seed runs implicitly on every `prisma migrate dev` and `migrate reset`, for
everyone, which makes it the least predictable place to put data. With reference data in
migrations and fixtures in scripts there is nothing left for it to do.

---

## 7. Documentation and Drift Prevention

Architecture rules must describe the codebase that actually exists, not an aspirational
future state. If a rule conflicts with the codebase after a refactor, update the rule in
that same change rather than leaving stale guidance behind.

**The policy for keeping rules and docs in sync lives once, in
[`workflow-rules.md`](workflow-rules.md) §2 *Rule and Documentation Maintenance*** — what
belongs in a rule, what rots, and the sorting principle for deciding between a code comment,
a rule, product truth and an ADR (§0 governing rule 7). Read it before editing any rule
file. The one addition specific to this file: a change to the API-contract flow lands in
these architecture rules and in [Service Rules](service-rules.md),
[React UI Rules](react-ui-rules.md), [Testing Rules](testing-rules.md) and
[Model Change Rules](model-change-rules.md) together, because the contract chain and the
generated-client regeneration it sequences span all five.
