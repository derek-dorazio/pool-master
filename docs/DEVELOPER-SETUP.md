# PoolMaster Developer Setup Guide

Step-by-step instructions for setting up a local development environment. Aimed at developers (or their AI agents) starting from a fresh clone.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 20.0.0 LTS | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| npm | >= 10 (ships with Node 20) | Included with Node.js |
| Docker + Docker Compose | Latest | [docker.com](https://www.docker.com/) |
| Git | Latest | [git-scm.com](https://git-scm.com/) |

Optional but recommended:
- **nvm** — manage multiple Node.js versions
- **Turborepo** CLI — `npm install -g turbo` (also installed as dev dependency)

---

## 1. Clone and Install

```bash
git clone https://github.com/derek-dorazio/pool-master.git
cd pool-master
npm install
```

This installs all dependencies across the monorepo workspaces (`packages/*` and `clients/*`).

---

## 2. Start Local Infrastructure

All local services (database and dev utilities) run via Docker Compose:

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
```

This starts:

| Service | Port(s) | Purpose |
|---|---|---|
| **PostgreSQL 16** | `5432` | Primary database (`poolmaster` / `postgres` / `postgres`) |
| **DynamoDB Local** | `8000` | NoSQL for high-volume event data |
| **Mailpit** | `8025` (UI), `1025` (SMTP) | Email viewer — all outbound email. Browse at http://localhost:8025 |
| **LocalStack** | `4566` | AWS mock (SES, SNS, SQS) — no credentials needed |
| **Push Mock** | `3099` | APNs/FCM push capture — view at http://localhost:3099/push-log |

### Browser-Accessible Dev Tools

| Tool | URL | What It Shows |
|---|---|---|
| **Mailpit** | http://localhost:8025 | All emails sent by notification service (welcome, drafts, results, digests) |
| **Push Mock Log** | http://localhost:3099/push-log | All push notifications sent to APNs/FCM mock |
| **Prisma Studio** | `npm run db:studio` → http://localhost:5555 | Visual database browser — view/edit all tables |

### CLI Access to Infrastructure

```bash
# PostgreSQL CLI — run SQL queries
docker exec -it docker-postgres-1 psql -U postgres -d poolmaster

# DynamoDB — list tables (requires AWS CLI or use the SDK)
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws dynamodb list-tables --endpoint-url http://localhost:8000 --region us-east-1

# LocalStack — interact with mock AWS services
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws ses get-send-statistics --endpoint-url http://localhost:4566 --region us-east-1

# Push Mock — clear the log between test runs
curl -X DELETE http://localhost:3099/push-log
```

LocalStack auto-initialises on first start (verifies SES sender, creates SNS topic + SQS queue).

To stop:
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml down
```

---

## 3. Configure Environment

Copy the example env file and adjust as needed:

```bash
cp .env.example .env
```

The defaults work out of the box with Docker Compose. Key settings:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster

# Email: "smtp" sends to Mailpit (localhost:1025), "ses" sends to LocalStack
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025

# Push: points to push-mock-server in dev
APNS_BASE_URL=http://localhost:3099
FCM_BASE_URL=http://localhost:3099

# AWS mock (LocalStack)
AWS_ENDPOINT=http://localhost:4566
```

See `.env.example` for the full list of variables.

---

## 4. Quick Start (Recommended)

Start everything — Docker containers, database migrations, the minimal bootstrap seed step, and all services — with one command:

```bash
npm run dev:start
```

This will:
1. Create `.env` from `.env.example` (if not present)
2. Start Docker containers (PostgreSQL, DynamoDB, Mailpit)
3. Run Prisma migrations
4. Run the minimal bootstrap seed step
5. Launch the backend and active PoolMaster web app via Turborepo

After startup you'll have:
- **PoolMaster web app** at http://localhost:5173
- **Mailpit (email viewer)** at http://localhost:8025
- **Core API** at http://localhost:3000
- **API docs** at http://localhost:3000/apidoc
- **Prisma Studio** (optional) at `npm run db:studio`

---

## 5. Individual Commands

If you prefer to run steps separately:

### Database Commands

```bash
npm run dev:infra          # Start Postgres + DynamoDB + Mailpit
npm run dev:infra:all      # Start all containers (+ Mailpit, LocalStack, Push Mock)
npm run dev:infra:stop     # Stop all containers

npm run db:migrate         # Run Prisma migrations
npm run db:reset           # Reset database (drops all data)
npm run db:test:migrate    # Apply migrations to disposable test DB
npm run db:test:reset      # Reset disposable test DB and reapply migrations
npm run db:test:recreate   # Alias for db:test:reset
npm run db:studio          # Open Prisma Studio (visual DB browser)
```

### Local Database Roles

- `poolmaster`
  - persistent local development database
  - keep working state here while building features manually
- `poolmaster_test`
  - disposable local test database
  - used for data integration, functional API, and merged service coverage runs
  - safe to reset or recreate at any time

Recommended rule:

- do not preserve manual development state in `poolmaster_test`
- if test migrations drift or a validation run wedges the schema, run
  `npm run db:test:reset`
- if a DB-backed suite was interrupted or you suspect leftover residue, prefer a
  `:fresh` script instead of debugging against a dirty `poolmaster_test`

### Run the Development Server

Start all services in parallel:

```bash
npm run dev
```

Or start the API directly:

```bash
npm run dev --workspace=@poolmaster/core-api
```

### Service Port

| Service | Port | Description |
|---------|------|-------------|
| core-api | 3000 | Monolith API (all modules: auth, leagues, contests, drafts, scoring, notifications, ingestion, admin) |

---

## 6. Run Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Same run, but first recreate the disposable test DB
npm run test:service:integration:fresh

# Service functional API tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:service:functional-api

# Same run, but first recreate the disposable test DB
npm run test:service:functional-api:fresh

# Merged backend coverage against a freshly reset disposable test DB
npm run test:coverage:service:fresh

# Specific test file
npx jest tests/unit/core-api/permissions.test.ts
```

### DB-Backed Test Recovery

When a local DB-backed test command fails, use this order:

1. confirm local Postgres is actually running
2. if it was down, start/restart it and rerun the exact command
3. if `poolmaster_test` still looks dirty or wedged, run `npm run db:test:reset`
   or use the matching `:fresh` test script

Do not preserve manual working state in `poolmaster_test`, and do not try to
hand-edit the local test schema to “unstick” validation.

Tests use **Jest** with **ts-jest**. All tests live in the top-level `tests/` directory (separate from application code). The `@poolmaster/shared/*` module alias is configured in `tests/jest.config.ts`.

### Active Test Strategy

The active local gate now centers on:

```bash
# Merged service coverage
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:coverage:service:merged

# Same merged coverage run, but first recreate the disposable test DB
npm run test:coverage:service:fresh

# Service functional API tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npm run test:service:functional-api

# Data integration against a freshly recreated disposable test DB
npm run test:service:integration:fresh

# PoolMaster unit tests
npm run test:poolmaster:unit
```

The active browser lane is the deployed Playwright journey suite for PoolMaster onboarding and league flows. It currently covers registration, explicit league creation, league-list navigation, multi-league switching, and invite/join behavior on the deployed QA environment.

PoolMaster production builds also emit `clients/poolmaster/dist/version-info.json` so deployed environments can expose the webapp version, service version, git SHAs, and build metadata.

When the backend service is running, interactive API documentation is available
at `/apidoc`. After Terraform is applied in deployed environments, CloudFront
also forwards `/apidoc*` to the API origin so the same developer docs route is
available on the app domain.

---

## 7. Type Checking and Linting

```bash
# TypeScript type check (all packages)
npm run typecheck

# ESLint (all packages)
npm run lint

# Prettier formatting
npm run format
```

---

## 8. Build for Production

```bash
npm run build
```

Build output goes to `dist/` in each package.

### Docker Build

Build the backend as a Docker image:

```bash
docker build -f infrastructure/docker/Dockerfile.core-api -t poolmaster-core-api .
```

The Dockerfile uses a multi-stage build: builds shared + core-api TypeScript, then copies compiled output to a slim runtime image.

### Deploy to AWS

```bash
cd infrastructure/terraform
terraform init -backend-config=envs/qa.backend.hcl
terraform plan -var-file=envs/qa.tfvars
terraform apply -var-file=envs/qa.tfvars
```

This creates: ECS Fargate (1 backend service), RDS PostgreSQL, ALB, S3 + CloudFront (PoolMaster web), ECR repository, CloudWatch alarms.

If QA intentionally needs direct operator DB access, model it in `envs/qa.tfvars` instead of making manual AWS changes:
- `db_publicly_accessible = true`
- `db_allowed_cidr_blocks = ["YOUR_PUBLIC_IP/32"]`

For runtime backend log usage and CloudWatch query patterns, see
[Logging Operations](./LOGGING-OPERATIONS.md).

After `terraform apply`, run migrations:
```bash
DATABASE_URL=$(terraform output -raw database_url) npx prisma migrate deploy --schema=packages/core-api/prisma/schema.prisma
```

See [Terraform Workflow](../infrastructure/terraform/README.md) for the current remote-state-only workflow.

---

## Monorepo Structure

```
poolmaster/
├── packages/
│   ├── core-api/            # Modular monolith (all backend modules on port 3000)
│   │   └── src/modules/     # auth, leagues, invitations, contests,
│   │                        # drafts, scoring, notifications, ingestion, admin, ...
│   ├── push-mock-server/    # APNs/FCM mock for local dev (port 3099)
│   └── shared/              # Domain types, DB ports, events, utils
├── clients/
│   ├── poolmaster/          # React + Vite + MUI
│   ├── _archived/           # Historical legacy web/admin references
│   ├── ios/                 # Swift + SwiftUI (planned)
│   └── android/             # Kotlin + Jetpack Compose (planned)
├── tests/                  # All tests (separate from app code)
├── infrastructure/
│   ├── docker/             # Dockerfile, docker-compose.dev.yml
│   ├── k8s/                # Kubernetes manifests (future)
│   └── terraform/          # AWS infrastructure (ECS Fargate, RDS, ALB, frontend delivery)
├── plans/                  # Feature plan documents with task tables
├── rules/                  # Architecture and coding rules
├── package.json            # Monorepo root (npm workspaces)
├── turbo.json              # Turborepo pipeline config
└── tsconfig.base.json      # Shared TypeScript config (strict mode)
```

---

## Tech Stack Quick Reference

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ LTS |
| API Framework | Fastify 5 |
| Language | TypeScript 5.5 (strict mode) |
| ORM | Prisma 6 (PostgreSQL) |
| Database | PostgreSQL 16 |
| Cache/Queue | In-process event bus + service-local scheduling |
| Monorepo | Turborepo + npm workspaces |
| Testing | Jest 29 + ts-jest |
| Validation | JSON Schema (Fastify built-in) + Zod |
| Build | Turborepo pipeline, tsx for dev |

---

## Architecture Patterns

- **Hexagonal architecture** — services depend on repository port interfaces, not concrete implementations
- **Multi-tenancy** — every row carries `tenant_id`, extracted from `x-tenant-id` header
- **Event-driven** — modules communicate via in-process domain events (EventBus)
- **One export per file** — TypeScript modules follow single-export convention
- **Tests separate from source** — all tests in `tests/`, never inside `src/`

---

## Common Tasks

### Add a new Prisma model

1. Edit `packages/core-api/prisma/schema.prisma`
2. Run `cd packages/core-api && npx prisma migrate dev --name your-migration-name`
3. Add domain type to `packages/shared/domain/types.ts`
4. Add repository port to `packages/shared/db/ports.ts`
5. Create Prisma adapter in `packages/core-api/src/adapters/`

### Add a new API endpoint

1. Create or update the service in `packages/core-api/src/modules/<module>/`
2. Create handler functions
3. Register routes in the module's `routes.ts`
4. Register the module in `packages/core-api/src/index.ts` with a URL prefix
5. Add JSON schema validation inline on the route
6. Write tests in `tests/unit/core-api/`

### Run a specific service in isolation

```bash
npm run dev --workspace=@poolmaster/core-api
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot find module '@poolmaster/shared'` | Run `npm install` from repo root |
| Prisma client not generated | Run `cd packages/core-api && npx prisma generate` |
| Database connection refused | Ensure Docker containers are running: `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d` |
| Port already in use | Check for running processes: `lsof -ti:3000` |
| Tests fail with import errors | Ensure you're running from `tests/` directory or using `npm test` from root |
| Emails not appearing in Mailpit | Ensure docker-compose is running and SMTP_HOST=localhost, SMTP_PORT=1025 |
| Push payloads not in push-log | Ensure push-mock container is running on port 3099 |
| LocalStack SES errors | Run `awslocal ses get-send-statistics` to verify; check init script ran |
