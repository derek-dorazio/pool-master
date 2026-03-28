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

This starts Docker (Postgres, Redis, DynamoDB, Mailpit), runs migrations, seeds test data, and launches all services.

| What | URL | Purpose |
|------|-----|---------|
| **Webapp** | http://localhost:5173 | React frontend |
| **Core API** | http://localhost:3000 | REST API (health: `GET /health`) |
| **Mailpit** | http://localhost:8025 | View all sent emails |
| **Push Mock** | http://localhost:3099/push-log | View push notifications |
| **Prisma Studio** | `npm run db:studio` | Browse/edit database |
| **Redis** | `localhost:6379` | CLI: `docker exec -it docker-redis-1 redis-cli` |
| **DynamoDB** | `localhost:8000` | NoSQL event store |
| **PostgreSQL** | `localhost:5432` | CLI: `docker exec -it docker-postgres-1 psql -U postgres -d poolmaster` |

See [docs/DEVELOPER-SETUP.md](docs/DEVELOPER-SETUP.md) for full setup instructions.

## Testing

```bash
# Unit tests
npm run test:unit

# Smoke tests (requires npm run dev:start first)
npm run test:smoke:api   # API smoke tests — hits all 5 services
npm run test:smoke:e2e   # E2E browser tests — Playwright
npm run test:smoke       # Both
```

---

## Architecture

```
                    @poolmaster/shared
        Domain Types | Events | DB Ports | Utils
                         |
    +-----------+--------+--------+-------------+
    |           |        |        |             |
 core-api  draft-svc  scoring  ingestion  notification
  :3000     :3001      :3002    :3003       :3004
```

Five Fastify + TypeScript microservices communicating via domain events over Redis Streams. PostgreSQL for relational data, Redis for caching and message brokering. Hexagonal architecture with repository port/adapter pattern.

| Service | Port | Responsibility |
|---------|------|----------------|
| **core-api** | 3000 | REST API gateway -- leagues, contests, members, picks, standings |
| **draft-service** | 3001 | Draft engines -- snake, tiered, budget, survivor, pick'em, bracket |
| **scoring-service** | 3002 | Score calculation -- 7 engines, 16 templates across 9 sports |
| **ingestion-worker** | 3003 | Sports data polling from external providers |
| **notification-service** | 3004 | Push, email, SMS notifications |

---

## Features

### Leagues & Members
- League creation with configurable settings (visibility, invite policy, member limits)
- Email invitations, shareable invite links, CSV bulk import
- Role hierarchy: Owner > Commissioner > Manager > Viewer
- 25 granular commissioner permissions

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
| Cache/Queue | Redis 7 |
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
├── packages/           # Backend services + shared types
│   ├── core-api/       # Main REST API (Fastify + Prisma)
│   ├── draft-service/  # Draft engines
│   ├── scoring-service/# Scoring engines + templates
│   ├── ingestion-worker/
│   ├── notification-service/
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
- [Developer Setup Guide](docs/DEVELOPER-SETUP.md) — Environment setup, Docker, database, running services
- [Scoring & Configuration Guide](docs/scoring-and-configuration-guide.md) — End-user scoring configuration
- [AWS Deployment Plan](plans/16-aws-deployment.md) — Full deployment plan with action items and status

### Code READMEs
- [Backend Services](packages/README.md) — All 5 microservices, shared package, API routes, engines
- [Web App](clients/web/README.md) — React app features, pages, components, architecture

### Rules
- [Architecture Rules](rules/architecture-rules.md) — System design, tech stack, security, deployment, local dev infra
- [Service Rules](rules/service-rules.md) — Backend TypeScript/Fastify conventions
- [React UI Rules](rules/react-ui-rules.md) — Web: React, shadcn/ui, TailwindCSS
- [Testing Rules](rules/testing-rules.md) — Test strategy, coverage, CI pipeline
- [Workflow Rules](rules/workflow-rules.md) — Task tracking via plan documents

---

## Deployment

AWS deployment via Terraform (ECS Fargate) + GitHub Actions CI/CD.

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars    # Set db_password, domain (optional)
terraform init
terraform plan -var="environment=dev"
terraform apply -var="environment=dev"
```

Infrastructure: ECS Fargate (6 services), RDS PostgreSQL, ElastiCache Redis, ALB with path-based routing, CloudWatch alarms, ECR repositories. HTTPS and custom domain are optional (works with ALB DNS out of the box).

See [AWS Deployment Plan](plans/16-aws-deployment.md) for full details.

---

## Sports Supported

Golf, NFL, NBA, NHL, MLB, F1, NASCAR, NCAA Basketball, NCAA Football, NCAA Hockey, Tennis, Horse Racing, Soccer, UFC

---

## License

Private. All rights reserved.
