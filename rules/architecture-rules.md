# PoolMaster — Architecture Rules

All plan documents and implementation work must conform to these rules. This is the single source of truth for technology choices, architectural patterns, and infrastructure decisions across the PoolMaster platform.

---

## 1. Tech Stack

### Backend

| Concern | Choice | Rationale |
|---|---|---|
| **Language** | Python 3.12+ | Mature ecosystem, strong data processing, fast development |
| **API Framework** | FastAPI | Async-native, automatic OpenAPI docs, Pydantic validation, high performance |
| **Data Validation** | Pydantic v2 | Schema validation, serialisation, settings management |
| **ORM / DB Access** | SQLAlchemy 2.0 (async) + Alembic | Port/adapter pattern via repository interfaces; Alembic for migrations |
| **Task Queue** | Celery + Redis (broker) or ARQ | Background jobs, scheduled tasks, notification delivery |
| **WebSockets** | FastAPI WebSocket + Redis Pub/Sub | Native FastAPI WebSocket support; Redis for multi-instance fan-out |
| **Auth** | Auth0 or AWS Cognito | OAuth, MFA, JWT — no reinventing |
| **ASGI Server** | Uvicorn (production: behind Gunicorn) | High-performance async Python server |

### Frontend (Client-Side)

| Concern | Choice | Rationale |
|---|---|---|
| **Web** | React + TypeScript | Component model, large ecosystem, type safety |
| **Mobile** | React Native (Expo managed workflow) | Shared codebase iOS/Android, code sharing with web via shared packages |
| **Mobile State** | Zustand or similar | Lightweight, React-native compatible |
| **Form Validation (client)** | Zod | TypeScript-first schema validation |
| **Internationalisation (client)** | i18next (React + React Native) | Works across web and mobile, pluralisation, interpolation |

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

## 2. Architectural Patterns

### Service Topology

All backend services are Python + FastAPI applications deployed as independent Docker containers.

| Service | Responsibility |
|---|---|
| **Core API** | Auth, leagues, memberships, contests, roster management, standings reads |
| **Draft Service** | Draft session lifecycle, live/async pick orchestration, WebSocket room per draft |
| **Scoring Service** | Consumes stat events, applies scoring rules, writes to NoSQL, updates SQL standings |
| **Stats Ingestion Worker** | Polls or receives webhooks from sport data providers, normalises to internal schema, publishes events |
| **Notification Service** | Push (APNs/FCM), email, in-app via WebSocket — draft reminders, score alerts |

### Port / Adapter (Hexagonal Architecture)

No service touches a database directly. All DB access goes through typed repository interfaces (ports). The adapter is injected at startup via a factory that reads `DB_RELATIONAL_ADAPTER` and `DB_NOSQL_ADAPTER` from environment config.

```python
# Port (interface)
class LeagueRepository(Protocol):
    async def find_by_id(self, id: str, tenant_id: str) -> League | None: ...
    async def find_by_tenant(self, tenant_id: str) -> list[League]: ...
    async def create(self, league: CreateLeagueInput) -> League: ...
    async def update(self, id: str, updates: dict) -> League: ...
    async def delete(self, id: str) -> None: ...

# Adapter (implementation)
class PostgresLeagueRepository(LeagueRepository): ...
class MySQLLeagueRepository(LeagueRepository): ...
```

Services never import adapters directly — only ports. The correct implementation is injected at startup.

### Multi-Tenancy

Every row in every relational table carries a `tenant_id`. A `TenantContext` middleware extracts the tenant from the JWT or subdomain on every request and attaches it to the request context. Repository implementations always scope queries by `tenant_id`.

```python
# FastAPI dependency for tenant context
async def get_tenant_context(request: Request) -> TenantContext:
    # Extract tenant from JWT claims or subdomain
    # Attach to request state for repository scoping
    ...
```

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

The WebSocket gateway subscribes to Redis Pub/Sub and fans out events to connected clients. Redis allows the WebSocket layer to scale across multiple container instances.

### Provider Abstraction

All external service integrations use an adapter pattern so providers can be swapped without changing business logic:

- **Sports data providers:** Each implements a `SportDataProvider` protocol
- **Email providers:** SES / SendGrid behind an `EmailProvider` protocol
- **Push providers:** APNs / FCM behind a `PushProvider` protocol
- **Payment provider:** Stripe behind a `PaymentProvider` protocol

---

## 3. Project Structure

```
poolmaster/
├── services/
│   ├── core-api/              # FastAPI, main REST API
│   │   ├── app/
│   │   │   ├── api/           # Route handlers
│   │   │   ├── models/        # SQLAlchemy models
│   │   │   ├── schemas/       # Pydantic request/response schemas
│   │   │   ├── services/      # Business logic
│   │   │   ├── repositories/  # Repository implementations (adapters)
│   │   │   └── middleware/     # Tenant context, auth, etc.
│   │   ├── alembic/           # Database migrations
│   │   ├── tests/
│   │   └── pyproject.toml
│   ├── draft-service/         # FastAPI + WebSocket, draft orchestration
│   ├── scoring-service/       # Score computation worker
│   ├── ingestion-worker/      # Stats data ingestion
│   └── notification-service/  # Push, email, in-app notifications
├── packages/
│   └── shared/
│       ├── domain/            # Shared Python domain types (Pydantic models)
│       ├── db/                # Repository port interfaces (Protocols)
│       ├── events/            # Event schema definitions (shared message contracts)
│       └── utils/             # Shared utilities
├── clients/
│   ├── web/                   # React + TypeScript
│   ├── mobile/                # React Native (Expo)
│   ├── shared/                # Shared TypeScript types, API client, validation
│   │   ├── types/             # TypeScript types matching backend Pydantic schemas
│   │   ├── api-client/        # Typed HTTP + WebSocket client
│   │   └── validation/        # Zod schemas for client-side validation
│   ├── ios/                   # Swift / SwiftUI (if native path chosen)
│   └── android/               # Kotlin (if native path chosen)
├── infrastructure/
│   ├── docker/
│   ├── k8s/                   # or ECS task definitions
│   └── terraform/
└── rules/                     # This file and other project rules
```

### Python Package Management

- **Package manager:** `uv` (preferred) or `pip` + `pyproject.toml`
- **Dependency locking:** `uv.lock` or `requirements.lock`
- **Shared code:** Published as internal packages or symlinked via workspace configuration
- **Python version:** 3.12+ (for modern typing, performance improvements)

---

## 4. Data Model Conventions

### Database

- All tables include `id` (UUID), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ)
- All tenant-scoped tables include `tenant_id` (UUID, NOT NULL, FOREIGN KEY)
- Flexible configuration stored as `JSONB` columns (scoring rules, draft config, settings)
- All times stored in **UTC** in the database
- Monetary values stored in **smallest unit** (cents) as integers
- Soft deletes where audit trail matters; hard deletes where data privacy requires it

### API

- REST API with OpenAPI 3.0 specification (auto-generated by FastAPI)
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
- Database migrations run before service deployment (Alembic)
- Feature flags for gradual rollouts (not code branches)
- Environment parity: dev, staging, production all use the same Docker images with different config
- Health check endpoint on every service: `GET /health`

---

## 7. Configuration Priority

When a technology or pattern decision is needed, consult this file first. If this file doesn't cover it, the relevant plan document is the next authority. If neither covers it, make the decision, document it, and update this file.

**Update policy:** When a technology choice changes (e.g., swapping a provider), update this file first, then update affected plan documents to reference these rules rather than repeating the choice.

---

*PoolMaster Architecture Rules v1.0*
