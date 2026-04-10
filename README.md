# PoolMaster

Fantasy sports pool management platform. Create leagues, configure contests across any sport, draft squads, and compete on live leaderboards.

Sport-agnostic by design -- golf, NFL, F1, NCAA brackets, horse racing, tennis, and more are all first-class citizens configured through a flexible domain model rather than hard-coded sport logic.

---

## Quick Start

```bash
# Prerequisites: Node.js >= 20, Docker
npm install
npm run dev:start
```

This starts Docker (Postgres, DynamoDB, and Mailpit), runs migrations, runs the minimal bootstrap seed step, and launches the active backend and PoolMaster web app.

| What | URL | Purpose |
|------|-----|---------|
| **PoolMaster Web** | http://localhost:5173 | Active React frontend |
| **Core API** | http://localhost:3000 | REST API (health: `GET /health`) |
| **Mailpit** | http://localhost:8025 | View all sent emails |
| **Push Mock** | http://localhost:3099/push-log | View push notifications |
| **Prisma Studio** | `npm run db:studio` | Browse/edit database |
| **DynamoDB** | `localhost:8000` | NoSQL event store |
| **PostgreSQL** | `localhost:5432` | CLI: `docker exec -it docker-postgres-1 psql -U postgres -d poolmaster` |

See [docs/DEVELOPER-SETUP.md](docs/DEVELOPER-SETUP.md) for full setup instructions.

## Testing

```bash
# Service unit tests
npx jest --config tests/jest.config.js --forceExit

# Service functional API tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:service:functional-api

# PoolMaster unit tests
npm run test:poolmaster:unit
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
              │ Root Admin          │
              └─────────────────────┘
```

Fastify + TypeScript modular monolith. All modules run in a single process on port 3000, communicating via in-process domain events. PostgreSQL is the active system of record. Hexagonal architecture with repository port/adapter pattern.

| Module | Responsibility |
|--------|----------------|
| **auth, leagues, contests** | REST API -- leagues, contests, members, picks, standings |
| **drafts** | Draft engines -- snake, tiered, budget, survivor, pick'em, bracket |
| **scoring** | Score calculation -- 7 engines, 16 templates across 9 sports |
| **ingestion** | Sports data polling from external providers (ESPN, OpenF1, PGA Tour) |
| **notifications** | In-app notification reads and preferences |
| **admin** | Root-admin backend surfaces retained in the service |

---

## Features

### Leagues & Members
- League creation with configurable settings (visibility, invite policy, member limits)
- Email invitations, shareable invite links, CSV bulk import
- Role hierarchy: Owner > Commissioner > Manager > Viewer
- 25 granular commissioner permissions

### Account & Communication
- Consent/account essentials use the live backend contract
- In-app notification reads and preference management remain active
- Legacy social, billing, and separate admin frontend surfaces have been removed or deferred

### Contests
- Commissioner-managed contest configuration backed by live backend contracts
- Squad-owned entries, roster picks, live standings, and persisted scoring results
- Configurable participant scoring rules, aggregation rules, and prize definitions

### Commissioner Tools
- Dashboard with action items, contest summaries, member activity, upcoming events
- Draft overrides: undo pick, pause/resume, extend clock
- Scoring overrides: adjust scores, force recalculate standings
- Contest lifecycle: reopen, close, extend deadline
- Full audit trail with commissioner and member views

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
├── clients/            # PoolMaster web, iOS (Swift), Android (Kotlin), archived legacy web
├── tests/              # All tests (separate from app code)
├── infrastructure/     # Docker, K8s, Terraform
├── plans/              # Feature plans with task tracking
└── rules/              # Architecture and coding rules
```

---

## Documentation

### Guides
- [Architecture Overview](docs/ARCHITECTURE.md) — Components, dependencies, data flow
- [Authentication & Authorization](docs/AUTHENTICATION-AUTHORIZATION.md) — Current backend auth model and frontend transition notes
- [Standard Auth Model](docs/STANDARD-AUTH-MODEL.md) — Recommended conventional local-auth + Google OIDC + cookie-session target for PoolMaster
- [Database Schema](docs/DATABASE-SCHEMA.md) — ERDs and a practical data dictionary for PostgreSQL tables and app ownership
- [Developer Setup Guide](docs/DEVELOPER-SETUP.md) — Environment setup, Docker, database, running services
- [Scoring & Configuration Guide](docs/scoring-and-configuration-guide.md) — End-user scoring configuration
- [AWS Deployment Plan](plans/archive/2026-04-completed-wave/16-aws-deployment.md) — Historical deployment plan with action items and status

### Code READMEs
- [Backend Services](packages/README.md) — Monolith modules, shared package, API routes, engines
- [PoolMaster Web App](clients/poolmaster/README.md) — Active React app features, pages, and architecture

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
| **PoolMaster Web** | S3 + CloudFront CDN | Global edge caching, SPA routing, API proxying via /api/* |
| **Database** | RDS PostgreSQL 16 | Private subnet, db.t3.micro (QA) |
| **Load Balancer** | ALB | Path-based routing to ECS services |
| **DNS** | Route 53 | `qa.ultimateofficepoolmanager.com` |
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
