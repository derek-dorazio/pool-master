# PoolMaster

Multi-tenant fantasy sports pool management platform. Create leagues, configure contests across any sport, draft squads, and compete on live leaderboards.

Sport-agnostic by design -- golf, NFL, F1, NCAA brackets, horse racing, tennis, and more are all first-class citizens configured through a flexible domain model rather than hard-coded sport logic.

---

## Quick Start

```bash
# Prerequisites: Node.js >= 20, Docker
npm install
npm run dev:start
```

This starts Docker (Postgres, DynamoDB, and Mailpit), runs migrations, seeds test data, and launches all services.

| What | URL | Purpose |
|------|-----|---------|
| **Webapp** | http://localhost:5173 | React frontend |
| **Core API** | http://localhost:3000 | REST API (health: `GET /health`) |
| **Mailpit** | http://localhost:8025 | View all sent emails |
| **Push Mock** | http://localhost:3099/push-log | View push notifications |
| **Prisma Studio** | `npm run db:studio` | Browse/edit database |
| **DynamoDB** | `localhost:8000` | NoSQL event store |
| **PostgreSQL** | `localhost:5432` | CLI: `docker exec -it docker-postgres-1 psql -U postgres -d poolmaster` |

See [docs/DEVELOPER-SETUP.md](docs/DEVELOPER-SETUP.md) for full setup instructions.

## Testing

```bash
# Unit tests
npm run test:unit

# Smoke tests (requires npm run dev:start first)
npm run test:smoke:api   # API smoke tests
npm run test:smoke:e2e   # E2E browser tests — Playwright for web + admin
npm run test:smoke       # Both
```

---

## Architecture

```
                    @poolmaster/shared
        Domain Types | Events | DB Ports | Utils
                         |
              ┌──────────┴──────────┐
              │   core-api :3000    │
              │   (modular monolith)│
              ├─────────────────────┤
              │ Leagues & Contests  │
              │ Draft Engines       │
              │ Scoring Engines     │
              │ Notifications       │
              │ Ingestion Workers   │
              │ Admin & Billing     │
              └─────────────────────┘
```

Fastify + TypeScript modular monolith. All modules run in a single process on port 3000, communicating via in-process domain events. PostgreSQL is the active system of record. Hexagonal architecture with repository port/adapter pattern.

| Module | Responsibility |
|--------|----------------|
| **auth, leagues, contests** | REST API -- leagues, contests, members, picks, standings |
| **drafts** | Draft engines -- snake, tiered, budget, survivor, pick'em, bracket |
| **scoring** | Score calculation -- 7 engines, 16 templates across 9 sports |
| **ingestion** | Sports data polling from external providers (ESPN, OpenF1, PGA Tour) |
| **social** | League feed, contest chat, direct messages, recaps, share cards |
| **notifications** | Push, email, in-app notifications with preferences and scheduling |
| **admin, billing** | Platform admin, subscription management |

---

## Features

### Leagues & Members
- League creation with configurable settings (visibility, invite policy, member limits)
- Email invitations, shareable invite links, CSV bulk import
- Role hierarchy: Owner > Commissioner > Manager > Viewer
- 25 granular commissioner permissions

### Social & Communication
- League activity feed, threaded replies, commissioner pinning, and moderation
- Contest chat, direct messages, weekly recaps, and share-card surfaces
- Compliance/settings flows for consent, data export, and self-exclusion now use the live backend contract
- Admin, billing, compliance, and social surfaces are contract-aligned, but any persistence follow-up remains tracked explicitly in the relevant plans

### Contests
- Multi-step contest wizard (sport, draft config, scoring, payouts, schedule)
- 6 selection types: snake draft, tiered pick, budget pick, open selection, pick'em, bracket
- 7 scoring engines with 16 pre-built templates across 9 sports
- Payout structure configuration with validation
- Contest templates for quick-create from saved configs

### Commissioner Tools
- Dashboard with action items, contest summaries, member activity, upcoming events
- Draft overrides: undo pick, pause/resume, extend clock
- Scoring overrides: adjust scores, force recalculate standings
- Contest lifecycle: reopen, close, extend deadline
- Payout confirmation
- Full audit trail with commissioner and member views

### Bulk Operations
- Season bulk setup (create multiple contests from template)
- Copy last season
- CSV member import

---

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js 20+ LTS |
| API | Fastify 5 |
| Language | TypeScript 5.5 (strict) |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Cache/Queue | In-process event bus + service-local scheduling |
| Monorepo | Turborepo + npm workspaces |
| Testing | Jest 29 + ts-jest |
| Containers | Docker (multi-stage builds) |

---

## Scripts

```bash
npm run dev          # Start all services (Turborepo)
npm run build        # Build all packages
npm test             # Run all tests
npm run test:unit    # Unit tests only
npm run typecheck    # TypeScript validation
npm run lint         # ESLint
npm run format       # Prettier
```

---

## Project Structure

```
poolmaster/
├── packages/           # Backend + shared types
│   ├── core-api/       # Modular monolith (all backend modules)
│   └── shared/         # Domain types, DB ports, events
├── clients/            # Web (React), iOS (Swift), Android (Kotlin)
├── tests/              # All tests (separate from app code)
├── infrastructure/     # Docker, K8s, Terraform
├── plans/              # Feature plans with task tracking
└── rules/              # Architecture and coding rules
```

---

## Documentation

### Guides
- [Architecture Overview](docs/ARCHITECTURE.md) — Components, dependencies, data flow
- [Authentication & Authorization](docs/AUTHENTICATION-AUTHORIZATION.md) — Current web/admin auth flows, token handling, and authorization enforcement
- [Database Schema](docs/DATABASE-SCHEMA.md) — ERDs and a practical data dictionary for PostgreSQL tables and app ownership
- [Developer Setup Guide](docs/DEVELOPER-SETUP.md) — Environment setup, Docker, database, running services
- [Scoring & Configuration Guide](docs/scoring-and-configuration-guide.md) — End-user scoring configuration
- [AWS Deployment Plan](plans/archive/2026-04-completed-wave/16-aws-deployment.md) — Historical deployment plan with action items and status

### Code READMEs
- [Backend Services](packages/README.md) — Monolith modules, shared package, API routes, engines
- [Web App](clients/web/README.md) — React app features, pages, components, architecture

### Rules
- [Architecture Rules](rules/architecture-rules.md) — System design, tech stack, security, deployment, local dev infra
- [Service Rules](rules/service-rules.md) — Backend TypeScript/Fastify conventions
- [React UI Rules](rules/react-ui-rules.md) — Web: React, shadcn/ui, TailwindCSS
- [Testing Rules](rules/testing-rules.md) — Test strategy, coverage, CI pipeline
- [Workflow Rules](rules/workflow-rules.md) — Task tracking via plan documents

---

## Deployment

AWS deployment via Terraform + GitHub Actions CI/CD.

```bash
cd infrastructure/terraform
terraform init -backend-config=envs/qa.backend.hcl
terraform plan -var-file=envs/qa.tfvars
terraform apply -var-file=envs/qa.tfvars
```

See [Terraform Workflow](infrastructure/terraform/README.md) for the remote-state-only workflow and local `.terraform/` hygiene rules.

### Infrastructure

| Component | Technology | Notes |
|-----------|-----------|-------|
| **Backend** | ECS Fargate (1 service) | core-api monolith (all modules in one process) |
| **Webapp + Admin** | S3 + CloudFront CDN | Global edge caching, SPA routing, API proxying via /api/* |
| **Database** | RDS PostgreSQL 16 | Private subnet, db.t3.micro (QA) |
| **Load Balancer** | ALB | Path-based routing to ECS services |
| **DNS** | Route 53 | `qa.ultimateofficepoolmanager.com`, `qa-admin.ultimateofficepoolmanager.com` |
| **SSL** | ACM | Auto-validated wildcard cert for CloudFront (us-east-1) + ALB (us-east-2) |
| **CI/CD** | GitHub Actions | Lint → Test → Build → ECR push → S3 sync → ECS deploy |
| **IaC** | Terraform | Per-environment state (qa/staging/prod) |

### Environments

| Env | Deploy | Backend | Frontend |
|-----|--------|---------|----------|
| **QA** | Auto on push to main | ECS Fargate | S3 + CloudFront |
| **Staging** | Manual workflow_dispatch | ECS Fargate | S3 + CloudFront |
| **Prod** | Manual workflow_dispatch | ECS Fargate | S3 + CloudFront |

See [AWS Deployment Plan](plans/archive/2026-04-completed-wave/16-aws-deployment.md) for historical details and [Architecture Simplification](plans/architecture/architecture-simplification.md) for the CloudFront migration rationale.

---

## Sports Supported

Golf, NFL, NBA, NHL, MLB, F1, NASCAR, NCAA Basketball, NCAA Football, NCAA Hockey, Tennis, Horse Racing, Soccer, UFC

---

## License

Private. All rights reserved.
