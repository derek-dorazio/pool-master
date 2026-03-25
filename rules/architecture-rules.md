# PoolMaster — Architecture Rules

All plan documents and implementation work must conform to these rules. This is the single source of truth for system-level architecture, infrastructure, and cross-cutting decisions.

**For implementation-level rules, see:**
- **[Service Rules](service-rules.md)** — Backend TypeScript, Fastify, Prisma, coding conventions, testing patterns
- **[React UI Rules](react-ui-rules.md)** — React, shadcn/ui, TailwindCSS, TanStack Query, Zustand, Vite
- **[Testing Rules](testing-rules.md)** — Test strategy, coverage thresholds, CI pipeline, load testing

---

## 1. Tech Stack Summary

### Backend

| Concern | Choice | Details In |
|---|---|---|
| **Language** | TypeScript (strict mode) | [Service Rules](service-rules.md) |
| **API Framework** | Fastify | [Service Rules](service-rules.md) |
| **Data Validation** | JSON schemas + ajv (Fastify built-in) | [Service Rules](service-rules.md) |
| **ORM / DB Access** | Prisma | [Service Rules](service-rules.md) |
| **Task Queue** | BullMQ + Redis | — |
| **WebSockets** | ws + Socket.io with Redis adapter | — |
| **Auth** | Auth0 or AWS Cognito | — |
| **Runtime** | Node.js 20+ LTS | — |

### Frontend

| Concern | Choice | Details In |
|---|---|---|
| **Web** | React 18+ + TypeScript | [React UI Rules](react-ui-rules.md) |
| **UI Library** | shadcn/ui (Radix UI + TailwindCSS) | [React UI Rules](react-ui-rules.md) |
| **Build Tool** | Vite | [React UI Rules](react-ui-rules.md) |
| **Server State** | TanStack Query | [React UI Rules](react-ui-rules.md) |
| **Client State** | Zustand | [React UI Rules](react-ui-rules.md) |
| **Forms** | React Hook Form | [React UI Rules](react-ui-rules.md) |
| **Routing** | React Router | [React UI Rules](react-ui-rules.md) |
| **Mobile** | React Native (Expo managed workflow) | — |
| **Internationalisation** | i18next (React + React Native) | — |

### Databases

| Concern | Choice | Rationale |
|---|---|---|
| **Primary Relational DB** | PostgreSQL (AWS RDS) | JSONB support heavily used for flexible configs; mature, reliable |
| **Secondary Relational DB** | MySQL (adapter available) | Swap-in alternative for tenants who require it |
| **NoSQL (high-volume events)** | DynamoDB (primary), MongoDB Atlas (adapter) | DynamoDB scales without ops burden on AWS; MongoDB as alternative |
| **Cache / Real-Time** | Redis (AWS ElastiCache) | Caching, pub/sub for WebSockets, task queue broker, session storage |
| **Search (Phase 1)** | PostgreSQL full-text search (`tsvector`) | Sufficient for launch scale (< 50K participants) |
| **Search (Phase 2)** | Elasticsearch or Algolia | Typo tolerance, phonetic matching, faceted filtering at scale |

### Infrastructure

| Concern | Choice | Rationale |
|---|---|---|
| **Containers** | Docker | Consistent environments, service isolation |
| **Orchestration** | AWS ECS Fargate or EKS | Scales each service independently; Fargate = serverless containers |
| **IaC** | Terraform | Reproducible infrastructure across environments |
| **Message Bus** | AWS EventBridge or SQS + SNS | Decouples services; fan-out for scoring, notifications |
| **Real-Time Messaging** | Redis Streams | StatEvent stream for scoring engine, notification event bus |
| **File Storage** | AWS S3 | Participant photos, share card images, data exports |
| **CDN** | AWS CloudFront | Serve static assets, participant photos, share cards |
| **CI/CD** | GitHub Actions (or equivalent) | Automated build, test, deploy pipeline |
| **Monitoring** | CloudWatch + Sentry (or Datadog) | Metrics, alerting, error tracking |
| **Monorepo** | Turborepo | Fast builds, shared packages, clean boundaries |

### Third-Party Services

| Concern | Choice | Rationale |
|---|---|---|
| **Payments** | Stripe (subscriptions) + Stripe Connect (future entry fees) | Industry standard; webhooks, portal, invoicing |
| **Email** | AWS SES (primary) or SendGrid (fallback) | Transactional email, digest delivery |
| **Push Notifications** | APNs (iOS) + FCM (Android) | Native platform push; Expo Notifications wraps both for React Native |
| **SMS (optional)** | Twilio | Draft clock urgency notifications |
| **Sports Data** | SportsDataIO (primary), Sportradar, Equibase, the-odds-api | Provider-per-sport strategy; see sports data integration plan |
| **Identity Verification (future)** | Stripe Identity or Jumio | For real-money features if pursued |
| **Analytics (privacy-focused)** | Plausible or PostHog (self-hosted) | No Google Analytics — privacy compliance |
| **Share Card Rendering** | Server-side via Puppeteer or Satori | OG image generation for social sharing |

---

## 2. Service Topology

All backend services are Fastify + TypeScript applications deployed as independent Docker containers.

| Service | Responsibility |
|---|---|
| **Core API** | Auth, leagues, memberships, contests, entries, picks, standings reads |
| **Draft Service** | Draft session lifecycle, live/async pick orchestration, WebSocket room per draft |
| **Scoring Service** | Consumes stat events, applies scoring rules, writes to NoSQL, updates SQL standings |
| **Stats Ingestion Worker** | Polls or receives webhooks from sport data providers, normalises to internal schema, publishes events |
| **Notification Service** | Push (APNs/FCM), email, in-app via WebSocket — draft reminders, score alerts |

### Port / Adapter (Hexagonal Architecture)

No service touches a database directly. All DB access goes through typed repository interfaces (ports). The adapter is injected at startup. See [Service Rules](service-rules.md) for Prisma conventions and service structure.

### Multi-Tenancy

Every row in every relational table carries a `tenant_id`. A tenant context hook extracts the tenant from the JWT or subdomain on every request and attaches it to the request context. Repository implementations always scope queries by `tenant_id`.

### Event-Driven Communication

Services communicate asynchronously via a message bus. Events follow a shared schema defined in a shared package.

```
Producer → Message Bus (Redis Streams / SQS) → Consumer

Examples:
  Stats Ingestion Worker → StatEvent → Scoring Service
  Scoring Service → ScoreUpdated → Notification Service
  Draft Service → DraftPickMade → Notification Service
  Contest Service → ContestCompleted → Notification Service
```

### Real-Time Architecture

Three distinct real-time channels:

| Channel | Mechanism | Use Case |
|---|---|---|
| **Draft room** | WebSocket (per session) | Live pick-by-pick draft experience |
| **Live scores** | WebSocket or SSE (per contest) | Leaderboard updates during events |
| **Notifications** | APNs + FCM + in-app WS | Draft reminders, score milestones, contest results |

The WebSocket gateway subscribes to Redis Pub/Sub and fans out events to connected clients. The Redis adapter allows the WebSocket layer to scale across multiple container instances.

### Provider Abstraction

All external service integrations use an adapter pattern so providers can be swapped without changing business logic:

- **Sports data providers:** Each implements a `SportDataProvider` interface
- **Email providers:** SES / SendGrid behind an `EmailProvider` interface
- **Push providers:** APNs / FCM behind a `PushProvider` interface
- **Payment provider:** Stripe behind a `PaymentProvider` interface

---

## 3. Project Structure

```
poolmaster/
├── packages/
│   ├── core-api/                  # Fastify, main REST API
│   │   ├── src/                   # See service-rules.md for internal structure
│   │   ├── prisma/                # Prisma schema + migrations
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── draft-service/             # Fastify + WS, draft orchestration
│   ├── scoring-service/           # Score computation worker
│   ├── ingestion-worker/          # Stats data ingestion
│   ├── notification-service/      # Push, email, in-app notifications
│   └── shared/
│       ├── domain/                # Shared TypeScript domain types & interfaces
│       ├── db/                    # Repository port interfaces
│       ├── events/                # Event schema definitions (shared message contracts)
│       └── utils/                 # Shared utilities
├── tests/                         # ALL tests live here — separate from application code
│   ├── unit/                      # See testing-rules.md for structure
│   ├── integration/
│   ├── api/
│   ├── e2e/
│   ├── factories/
│   └── fixtures/
├── clients/
│   ├── web/                       # React + TypeScript — see react-ui-rules.md
│   ├── mobile/                    # React Native (Expo)
│   └── shared/                    # Shared TS types, API client, validation
├── infrastructure/
│   ├── docker/
│   ├── k8s/
│   └── terraform/
├── plans/
├── rules/
├── package.json                   # Root — workspace config
├── turbo.json                     # Turborepo pipeline
└── tsconfig.base.json             # Shared TypeScript compiler options
```

### Test / Application Code Separation

**Rule: Test code must be separate from application code.** Tests live in the top-level `tests/` directory, not inside service `src/` directories. This keeps application packages clean for deployment (no test code shipped in Docker images) and provides a single place to run all tests across all services. See [Testing Rules](testing-rules.md) for full test structure and conventions.

### Package Management

- **Package manager:** npm (with workspaces) or pnpm
- **Monorepo tool:** Turborepo — fast builds, shared packages, clean boundaries
- **Dependency locking:** `package-lock.json` or `pnpm-lock.yaml`
- **Node version:** 20+ LTS
- **TypeScript:** Strict mode (`"strict": true`) across all packages

---

## 4. Data Model Conventions

### Database

- All tables include `id` (UUID), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ)
- All tenant-scoped tables include `tenant_id` (UUID, NOT NULL, FOREIGN KEY)
- Flexible configuration stored as `JSONB` columns (scoring rules, selection config, settings)
- All times stored in **UTC** in the database
- Monetary values stored in **smallest unit** (cents) as integers
- Soft deletes where audit trail matters; hard deletes where data privacy requires it

### API

- REST API with JSON schema validation (Fastify built-in)
- API versioning via `Accept-Version` header (not URL-based)
- Pagination via `page` + `page_size` query parameters
- Consistent error response format: `{ "error": "CODE", "message": "...", "details": {...} }`
- All endpoints require authentication except: health check, public discovery, share card views

### Event Schema

- All events include: `id` (UUID), `type` (string), `source_service` (string), `timestamp` (ISO 8601), `tenant_id`
- Events are published to Redis Streams or SQS topics
- Consumer groups ensure at-least-once delivery
- Idempotency keys prevent duplicate processing

---

## 5. Security Rules

- All data in transit: **TLS 1.2+** (HTTPS, WSS)
- All data at rest: **AES-256** (RDS encryption, S3 server-side encryption)
- Secrets management: AWS Secrets Manager or environment variables (never in code)
- No raw credit card data stored (handled entirely by Stripe)
- Refresh tokens encrypted in database
- API keys for providers encrypted at rest
- CORS configured per-environment (no wildcard in production)
- Rate limiting on all public endpoints
- CSRF protection for cookie-based auth flows

---

## 6. Deployment Rules

- Every service is independently deployable
- Blue/green or rolling deployments (zero-downtime)
- Database migrations run before service deployment (Prisma Migrate)
- Feature flags for gradual rollouts (not code branches)
- Environment parity: dev, staging, production all use the same Docker images with different config
- Health check endpoint on every service: `GET /health`

---

## 7. Rules Hierarchy

When a decision is needed, consult rules files in this order:

1. **This file** (`architecture-rules.md`) — system architecture, infrastructure, databases, security, deployment
2. **[Service Rules](service-rules.md)** — backend code: Fastify, TypeScript, Prisma, coding patterns
3. **[React UI Rules](react-ui-rules.md)** — frontend code: React, shadcn/ui, TailwindCSS, state management
4. **[Testing Rules](testing-rules.md)** — test strategy, tools, coverage, CI pipeline
5. **Plan documents** — feature-specific design decisions

If a conflict exists between rules files, escalate. If no rules file covers it, make the decision, document it, and update the relevant file.

**Update policy:** When a technology choice changes, update the relevant rules file first, then update affected plan documents.

---

*PoolMaster Architecture Rules v1.1*
