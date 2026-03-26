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

## 2. Start Local Databases

PostgreSQL 16 and Redis 7 run via Docker Compose:

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
```

This starts:
- **PostgreSQL 16** on `localhost:5432` (database: `poolmaster`, user: `postgres`, password: `postgres`)
- **Redis 7** on `localhost:6379`

To stop:
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml down
```

---

## 3. Configure Environment

Create a `.env` file in the repo root (or in `packages/core-api/`):

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster

# Redis
REDIS_URL=redis://localhost:6379

# Auth (placeholder — not yet integrated)
# AUTH_PROVIDER=auth0
# AUTH_DOMAIN=your-domain.auth0.com
# AUTH_CLIENT_ID=xxx

# Ports (defaults)
PORT=3000
```

---

## 4. Initialize the Database

Generate the Prisma client and apply the schema:

```bash
cd packages/core-api
npx prisma generate
npx prisma migrate dev --name init
cd ../..
```

To reset the database (drops all data):
```bash
cd packages/core-api && npx prisma migrate reset
```

---

## 5. Run the Development Server

Start all services in parallel:

```bash
npm run dev
```

Or start individual services:

```bash
# Core API only
npm run dev --workspace=@poolmaster/core-api

# Scoring service only
npm run dev --workspace=@poolmaster/scoring-service
```

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| core-api | 3000 | Main REST API gateway |
| draft-service | 3001 | Draft orchestration |
| scoring-service | 3002 | Score calculation |
| ingestion-worker | 3003 | Sports data ingestion |
| notification-service | 3004 | Email/push/SMS |

---

## 6. Run Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# API tests only
npm run test:api

# Specific test file
npx jest tests/unit/core-api/permissions.test.ts
```

Tests use **Jest** with **ts-jest**. All tests live in the top-level `tests/` directory (separate from application code). The `@poolmaster/shared/*` module alias is configured in `tests/jest.config.ts`.

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

Build a specific service as a Docker image:

```bash
docker build -f infrastructure/docker/Dockerfile.service \
  --build-arg SERVICE=core-api \
  -t poolmaster-core-api .
```

The Dockerfile uses a multi-stage build: the build stage compiles TypeScript, and the runtime stage copies only the compiled output and `node_modules`.

---

## Monorepo Structure

```
poolmaster/
├── packages/
│   ├── core-api/           # Fastify REST API (port 3000)
│   ├── draft-service/      # Draft engines (port 3001)
│   ├── scoring-service/    # Scoring engines (port 3002)
│   ├── ingestion-worker/   # Data polling (port 3003)
│   ├── notification-service/ # Notifications (port 3004)
│   └── shared/             # Domain types, DB ports, events, utils
├── clients/
│   ├── web/                # React + TypeScript (not yet started)
│   ├── ios/                # Swift + SwiftUI (not yet started)
│   └── android/            # Kotlin + Jetpack Compose (not yet started)
├── tests/                  # All tests (separate from app code)
├── infrastructure/
│   ├── docker/             # Dockerfile, docker-compose.dev.yml
│   ├── k8s/                # Kubernetes manifests (planned)
│   └── terraform/          # Terraform modules (planned)
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
| Cache/Queue | Redis 7 (ioredis) |
| Monorepo | Turborepo + npm workspaces |
| Testing | Jest 29 + ts-jest |
| Validation | JSON Schema (Fastify built-in) + Zod |
| Build | Turborepo pipeline, tsx for dev |

---

## Architecture Patterns

- **Hexagonal architecture** — services depend on repository port interfaces, not concrete implementations
- **Multi-tenancy** — every row carries `tenant_id`, extracted from `x-tenant-id` header
- **Event-driven** — services communicate via domain events (Redis Streams/SQS)
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
