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

## 1. Tech Stack Summary

### Backend

| Concern | Choice | Details In |
|---|---|---|
| Language | TypeScript (strict mode) | [Service Rules](service-rules.md) |
| API framework | Fastify | [Service Rules](service-rules.md) |
| Validation | Zod DTO schemas converted to Fastify JSON Schema | [Service Rules](service-rules.md) |
| API contract | OpenAPI 3.1 generated from live Fastify route schemas | [Service Rules](service-rules.md) |
| Client generation | `@hey-api/openapi-ts` + `@hey-api/client-fetch` | [Service Rules](service-rules.md) |
| ORM / DB access | Prisma | [Service Rules](service-rules.md) |
| Runtime | Node.js 20+ LTS | — |
| Queue / async work | In-process event bus and service-local scheduling; add external queueing only when the architecture truly needs it | — |
| Auth | App-issued JWT access + refresh tokens, with social auth callback support | [Service Rules](service-rules.md) |

### Frontend — Web

| Concern | Choice | Details In |
|---|---|---|
| Web framework | React 18 + TypeScript | [React UI Rules](react-ui-rules.md) |
| UI library | Radix primitives, shadcn-style components, and TailwindCSS utilities | [React UI Rules](react-ui-rules.md) |
| Build tool | Vite | [React UI Rules](react-ui-rules.md) |
| Server state | TanStack Query | [React UI Rules](react-ui-rules.md) |
| Client state | Zustand | [React UI Rules](react-ui-rules.md) |
| Forms | React Hook Form | [React UI Rules](react-ui-rules.md) |
| Routing | React Router | [React UI Rules](react-ui-rules.md) |
| API access | Shared generated `hey-api` SDK from `packages/shared/generated/hey-api` | [React UI Rules](react-ui-rules.md) |

The go-forward web frontend is a single role-based application: `clients/poolmaster`.

- root-admin capability currently lives in the backend API rather than a separate go-forward admin web app.
- `clients/_archived/web` is archived reference material only.
- New web implementation work should target the single PoolMaster app rather than splitting functionality across multiple React apps.

### Frontend — iOS

| Concern | Choice | Details In |
|---|---|---|
| Language | Swift | [Swift Rules](swift-rules.md) |
| UI framework | SwiftUI | [Swift Rules](swift-rules.md) |
| State management | Observation framework (`@Observable`, `@State`, `@Environment`) | [Swift Rules](swift-rules.md) |
| Networking | `URLSession` and shared API contract-driven models | [Swift Rules](swift-rules.md) |

### Frontend — Android

| Concern | Choice | Details In |
|---|---|---|
| Language | Kotlin | [Android Rules](android-rules.md) |
| UI framework | Jetpack Compose | [Android Rules](android-rules.md) |
| Architecture | MVVM / MVI-style unidirectional data flow | [Android Rules](android-rules.md) |
| DI | Hilt | [Android Rules](android-rules.md) |
| Networking | Retrofit + OkHttp + kotlinx.serialization | [Android Rules](android-rules.md) |

### Databases and Infrastructure

| Concern | Choice | Rationale |
|---|---|---|
| Primary relational DB | PostgreSQL | Prisma-backed primary application database |
| Cache / messaging | In-process event bus + persistent services where needed | no Redis dependency in the active MVP runtime |
| Containers | Docker | consistent local and CI environments |
| IaC | Terraform | reproducible infrastructure |
| CI/CD | GitHub Actions | build, typecheck, test, deploy |
| Monitoring | Sentry + cloud metrics/logging | operational visibility |
| Monorepo | npm workspaces + Turborepo | shared packages and fast pipelines |

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
- Files under `packages/shared/generated/openapi.json` and `packages/shared/generated/hey-api/` are generated artifacts. Do not hand-edit them.

### Route Source of Truth

- `packages/shared/api-routes.ts` is the shared source of truth for canonical route constants used by:
  - backend route prefixes
  - integration tests
  - smoke tests
  - MSW handlers
- For **frontend runtime application code**, the generated SDK is the primary path source of truth. Do not add new manual path-building code when a generated operation exists.

---

## 3. No Mock Data in Application Code

This is a non-negotiable architecture rule.

- Application code must never ship mock data, fake data, seeded sample responses, or development-only fallback payloads.
- If an endpoint is missing or broken, surface loading/error/empty UI states. Do not hide the defect with fake data.
- This applies across backend services, web/admin hooks, pages, stores, mobile view models, and shared runtime modules.
- Test doubles belong only in test code, fixtures, previews, or dedicated test infrastructure.

Related anti-patterns that are banned:

- `if (process.env.NODE_ENV === 'development') return mockData`
- `initialData: mockData` in TanStack Query
- `queryFn: async () => mockData`
- `catch { return mockData }`
- hand-built success envelopes that do not reflect the real domain payload

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

### Domain Event Bus

The in-process event bus (`packages/shared/events/event-bus.ts`) is the primary mechanism for cross-module communication. It is an architectural seam, not an implementation detail.

- Every domain event type must be defined as a typed interface in `packages/shared/events/`.
- Services emit events after successful state changes, not before.
- Subscribers must not assume emission order or delivery guarantees beyond "at least once, in process."
- Event payloads must be serializable (no Prisma models, no class instances, no functions).
- When adding a new event type, update the event type registry and add appropriate tests for emission and affected subscriber behavior (see [Testing Rules §8](testing-rules.md)).

---

## 5. Project Structure

```
poolmaster/
├── packages/
│   ├── core-api/
│   └── shared/
│       ├── api-routes.ts
│       ├── dto/
│       ├── generated/
│       │   ├── openapi.json
│       │   └── hey-api/
│       └── domain/
├── clients/
│   ├── poolmaster/
│   ├── _archived/
│   ├── ios/
│   └── android/
├── tests/
├── plans/
├── rules/
└── infrastructure/
```

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
