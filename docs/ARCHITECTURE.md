# PoolMaster Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Webapp   │  │  Admin   │  │   iOS    │  │ Android  │           │
│  │  (React)  │  │  (React) │  │ (Swift)  │  │ (Kotlin) │           │
│  └─────┬─────┘  └─────┬────┘  └────┬─────┘  └────┬─────┘           │
│        │S3+CloudFront  │S3+CF       │              │                │
└────────┼───────────────┼────────────┼──────────────┼────────────────┘
         │               │            │              │
         └───────┬───────┘            └──────┬───────┘
                 │ /api/*                    │ /api/*
                 ▼                           ▼
         ┌──────────────┐            ┌──────────────┐
         │  CloudFront  │            │     ALB      │
         │  (webapp/    │───/api/*──→│  (us-east-2) │
         │   admin)     │            └──────┬───────┘
         └──────────────┘                   │
                                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ECS FARGATE (core-api :3000)                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Fastify Server                             │   │
│  │                                                               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │   │
│  │  │  Auth   │ │ Leagues │ │ Contests │ │   Participants   │  │   │
│  │  │ Guard   │ │ Members │ │ Pools    │ │   Standings      │  │   │
│  │  │ Tenant  │ │ Invites │ │ Templates│ │   History        │  │   │
│  │  └─────────┘ └─────────┘ └──────────┘ └──────────────────┘  │   │
│  │                                                               │   │
│  │  ┌─────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────┐  │   │
│  │  │ Drafts  │ │   Scoring    │ │ Notifications│ │Ingestion│  │   │
│  │  │ 6 draft │ │ 7 engines    │ │ Push/Email/  │ │ ESPN    │  │   │
│  │  │ engines │ │ 16 templates │ │ In-App       │ │ OpenF1  │  │   │
│  │  │         │ │ Rollup (30s) │ │ Scheduler    │ │ PGA Tour│  │   │
│  │  └─────────┘ └──────┬───────┘ └──────────────┘ └────┬────┘  │   │
│  │                      │                               │        │   │
│  │              ┌───────┴───────────────────────────────┘        │   │
│  │              │      EventBus (in-process)                     │   │
│  │              │  stat.updated → score.updated → standings.*    │   │
│  │              └────────────────────────────────────────────────│   │
│  │                                                               │   │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐                      │   │
│  │  │ Search  │ │  Admin   │ │ Billing  │                      │   │
│  │  │ Discover│ │ Audit    │ │ Plans    │                      │   │
│  │  │         │ │ Flags    │ │ Entitle. │                      │   │
│  │  └─────────┘ └──────────┘ └──────────┘                      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│  PostgreSQL  │ │ AWS SES  │ │ External     │
│  (RDS)       │ │ APNs/FCM │ │ Sports APIs  │
│  50+ models  │ │          │ │ ESPN, OpenF1 │
│  via Prisma  │ │          │ │ PGA Tour     │
└──────────────┘ └──────────┘ └──────────────┘
```

---

## Components

### Backend (packages/core-api)

Single Fastify + TypeScript process running on port 3000. All domain modules are registered as Fastify plugins with route prefixes.

| Module | Prefix | Key Responsibilities |
|--------|--------|---------------------|
| **auth** | `/api/v1/auth` | JWT authentication, registration, login, OAuth |
| **leagues** | `/api/v1/leagues` | League CRUD, members, invitations, dashboard, audit |
| **contests** | `/api/v1/contests` | Contest CRUD, pool management, scoring/selection config |
| **participants** | `/api/v1/participants` | Player search, season records, provider mappings |
| **standings** | `/api/v1/contests/:id/standings` | Leaderboards, rankings |
| **history** | `/api/v1/` | Historical data, timelines, records, rivalries |
| **search** | `/api/v1/search` | Full-text search, league/contest discovery |
| **drafts** | `/api/v1/drafts` | draft-room runtime and selection workflows |
| **scoring** | `/api/v1/scoring` | participant scoring rules, aggregation rules, stat validation |
| **notifications** | `/api/v1/notifications` | Multi-channel dispatch, preferences, scheduling |
| **ingestion** | `/api/v1/ingestion` | Sports data polling, provider adapters |
| **admin** | `/api/v1/admin` | Platform admin, feature flags, impersonation |
| **billing** | `/api/v1/billing` | Plans, entitlements, usage tracking |
| **account/privacy** | `/api/v1/account` | minimal consent and account-related flows retained for first pass |

### Shared Package (packages/shared)

Cross-cutting types and interfaces shared between backend and tests.

| Layer | Purpose |
|-------|---------|
| `domain/` | TypeScript types (40+ interfaces), enums (20+ types), Zod-validated ScoringConfig |
| `events/` | Domain event definitions (StatEvent, ScoreUpdatedEvent, NotificationEvent) + EventBus |
| `db/` | Repository port interfaces (25+ ports for hexagonal architecture) |
| `i18n/` | Internationalization setup |

### Frontend (clients/)

| App | Technology | Hosting |
|-----|-----------|---------|
| **Webapp** | React 18, Vite, TailwindCSS, shadcn/ui, TanStack Query, Zustand | S3 + CloudFront |
| **Admin** | React 18, Vite, TailwindCSS | S3 + CloudFront |
| **iOS** | SwiftUI, Observation framework | App Store (planned) |
| **Android** | Kotlin, Jetpack Compose, Hilt | Play Store (planned) |

---

## Data Flow

### 1. User Request Flow

```
Browser → CloudFront → ALB → ECS (Fastify) → Prisma → PostgreSQL
```

### 2. Sports Data Ingestion Flow

```
ESPN/OpenF1/PGA   →   Ingestion Adapters   →   EventBus.publish('stat.updated')
(external APIs)       (polling scheduler)            │
                                                     ▼
                                              Scoring Consumer
                                              (scoreParticipant)
                                                     │
                                                     ▼
                                              ScoreStore.append()
                                              EventBus.publish('score.updated')
                                                     │
                                                     ▼
                                              StandingsRollup (every 30s)
                                              (assignRanks, detect changes)
                                                     │
                                                     ▼
                                              EventBus.publish('standings.updated')
```

### 3. Notification Flow

```
Domain Event (e.g., score.updated)
        │
        ▼
NotificationDispatcher
        │
        ├──→ Resolve recipients (ALL_LEAGUE / SPECIFIC_USERS)
        ├──→ Check user preferences (category opt-in/out, DND)
        ├──→ Check rate limits (push/hr, email/day)
        ├──→ Render template (title, body, data)
        │
        └──→ Deliver to channels:
             ├── IN_APP  → Prisma (notification table)
             ├── EMAIL   → SES / SMTP (Mailpit in dev)
             └── PUSH    → APNs / FCM (push-mock in dev)
```

### 4. Draft Flow

```
Commissioner creates contest with selection config
        │
        ▼
Draft session created (PENDING)
        │
        ▼
Commissioner starts draft → LIVE
        │
        ▼
┌─────────────────────────────┐
│  Engine processes picks     │
│  (snake order, tier rules,  │
│   budget constraints, etc.) │
│                             │
│  Auto-pick on timeout       │
│  Commissioner can pause     │
└──────────────┬──────────────┘
               │
               ▼
All picks made → COMPLETE
        │
        ▼
Contest moves to ACTIVE (scoring begins)
```

---

## Dependencies

### Runtime Dependencies

```
core-api
├── fastify (HTTP server)
├── @prisma/client (PostgreSQL ORM)
├── jsonwebtoken (JWT auth)
├── bcryptjs (password hashing)
├── @aws-sdk/client-ses (email)
├── @aws-sdk/client-sns (push notifications)
├── nodemailer (SMTP fallback)
├── zod (validation, via @poolmaster/shared)
└── @poolmaster/shared (domain types, events)
```

### Infrastructure Dependencies

| Service | Purpose | Dev (Docker) | QA/Prod (AWS) |
|---------|---------|-------------|---------------|
| **PostgreSQL 16** | Primary database | `localhost:5432` | RDS (private subnet) |
| **DynamoDB** | Event store (future) | `localhost:8000` (Local) | DynamoDB |
| **Mailpit** | Email capture | `localhost:8025` | N/A (SES in prod) |
| **Push Mock** | Push notification capture | `localhost:3099` | N/A (APNs/FCM in prod) |
| **LocalStack** | AWS service mock | `localhost:4566` | N/A (real AWS) |

### External API Dependencies

| Provider | Sports | Auth | Rate Limits |
|----------|--------|------|-------------|
| ESPN | NFL, NBA, MLB, NHL, NCAA | None (public) | Reasonable use |
| OpenF1 | Formula 1 | None (public) | Reasonable use |
| PGA Tour (via ESPN) | Golf | None (public) | Reasonable use |
| The Odds API | All (betting odds) | API key | 500 req/mo (free) |

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AWS (us-east-2)                    │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │                      VPC                         │ │
│  │                                                   │ │
│  │  ┌──────────────┐    ┌──────────────────────┐    │ │
│  │  │ Public Subnet│    │   Private Subnet      │    │ │
│  │  │              │    │                        │    │ │
│  │  │  ┌────────┐  │    │  ┌──────────────────┐ │    │ │
│  │  │  │  ALB   │──┼────┼─→│ ECS Fargate      │ │    │ │
│  │  │  └────────┘  │    │  │ (core-api)       │ │    │ │
│  │  │              │    │  └──────────────────┘ │    │ │
│  │  │  ┌────────┐  │    │                        │    │ │
│  │  │  │  NAT   │  │    │  ┌──────────────────┐ │    │ │
│  │  │  │Gateway │  │    │  │ RDS PostgreSQL   │ │    │ │
│  │  │  └────────┘  │    │  └──────────────────┘ │    │ │
│  │  │              │    │                        │    │ │
│  │  └──────────────┘    │                        │    │ │
│  │                       │                        │    │ │
│  │                       │                        │    │ │
│  │                       └──────────────────────┘    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │ S3 (webapp)      │  │ S3 (admin)       │          │
│  │ + CloudFront CDN │  │ + CloudFront CDN │          │
│  └──────────────────┘  └──────────────────┘          │
│                                                       │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │ ECR (core-api)   │  │ CloudWatch       │          │
│  │ Docker images    │  │ Alarms + Logs    │          │
│  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────┘

CloudFront (us-east-1):
  qa.ultimateofficepoolmanager.com        → S3 webapp + ALB /api/*
  qa-admin.ultimateofficepoolmanager.com  → S3 admin + ALB /api/*
```

### Environments

| Environment | Deploy Trigger | Domain |
|-------------|---------------|--------|
| **QA** | Auto on push to `main` | `qa.ultimateofficepoolmanager.com` |
| **Staging** | Manual (workflow_dispatch) | `stage.ultimateofficepoolmanager.com` |
| **Production** | Manual (workflow_dispatch) | `ultimateofficepoolmanager.com` |

### CI/CD Pipeline

```
Push to main
    │
    ├──→ Lint + Typecheck (turbo)
    ├──→ Unit Tests (Jest, 468 tests)
    ├──→ Build (turbo)
    │
    └──→ Deploy (on merge to main):
         ├── Docker build → ECR push (core-api)
         ├── Vite build → S3 sync (webapp)
         ├── Vite build → S3 sync (admin)
         ├── CloudFront invalidation
         └── ECS task-definition rollout
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Modular monolith** (not microservices) | All modules share one DB and one in-process event bus. No network boundaries needed. Single Docker image eliminates workspace resolution issues. |
| **In-process EventBus** (not Redis Streams) | All publishers and subscribers run in the same process. External queue infrastructure can be added later only when scale or deployment topology requires it. |
| **S3 + CloudFront** (not Docker/nginx for frontends) | Static React SPAs don't need a server. CloudFront is cheaper, faster (global CDN), and simpler to deploy. |
| **Hexagonal architecture** | Repository port interfaces allow swapping Prisma for any adapter. Tests can use in-memory implementations. |
| **Explicit scoring rules** | Scoring is driven by code-owned rule registries plus contest-owned configured rules. Adding a new sport or rule means adding tested code and configuration support, not preserving a broad template abstraction. |
| **Multi-tenancy via tenant_id** | Every row carries `tenant_id`. Extracted from JWT or `x-tenant-id` header. Supports white-label deployments. |
| **Tests separate from source** | All tests in `tests/` directory, never inside `src/`. Keeps package builds clean and test dependencies isolated. |

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/core-api/src/index.ts` | Application entry point — registers all modules, lifecycle hooks |
| `packages/core-api/prisma/schema.prisma` | Full database schema (50+ models) |
| `packages/shared/events/event-bus.ts` | In-process event bus singleton |
| `packages/shared/domain/scoring-config.ts` | Zod-validated scoring configuration schema |
| `infrastructure/terraform/main.tf` | AWS infrastructure (VPC, ECS, RDS, ALB) |
| `infrastructure/terraform/cloudfront.tf` | S3 + CloudFront for webapp/admin |
| `infrastructure/docker/Dockerfile.core-api` | Backend Docker build |
| `.github/workflows/ci.yml` | CI/CD pipeline |
