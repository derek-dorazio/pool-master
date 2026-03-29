# Architecture Simplification Plan

## Context

The current 5-backend-service architecture creates significant deployment complexity (7 Docker images, 7 ECR repos, 7 ECS task definitions, shared module resolution issues in Docker) without delivering real microservice benefits. All services share one Postgres database, one Redis instance, and communicate via an in-process event bus — not actual network boundaries. This plan covers two decisions:

1. **Backend consolidation**: Merge 5 services into a modular monolith + ingestion worker
2. **Frontend hosting**: Move webapps from Docker/nginx/ECS to S3 + CloudFront CDN

---

## Analysis 1: Backend Consolidation

### Current State (5 services)

| Service | Port | ALB | Status | Lines of Business Logic |
|---|---|---|---|---|
| core-api | 3000 | Yes | Full implementation | Auth, leagues, contests, participants, history, search, compliance, billing |
| draft-service | 3001 | No (internal) | Routes return 501 (not implemented) | Draft engines exist as pure functions |
| scoring-service | 3002 | No (internal) | Event consumer | Subscribes to stat.received, publishes score.updated |
| ingestion-worker | 3003 | No (internal) | Full implementation | Provider adapters, scheduler, stat publishing |
| notification-service | 3004 | Yes | Full implementation | Dispatcher, channels, preferences, scheduling, digest |

### Key Findings

- **No HTTP calls between services** — all communication is via in-process EventBus (shared memory)
- **draft-service routes are stubs** (return 501) — the draft engines are pure functions in packages/draft-service/src/engine/ but aren't exposed as real endpoints
- **scoring-service** is an event consumer — subscribes to stat events, runs scoring, publishes updates. This is just a background job, not a separate API
- **All services share the same Prisma schema and database** — no data isolation
- **The event bus is in-process** (not Redis Streams/SQS) — services MUST run in the same process to communicate

### Recommendation: Modular Monolith + Ingestion Worker (2 services)

**Service 1: poolmaster-api (port 3000)**
Merge core-api + draft-service + scoring-service + notification-service into one Fastify app. All modules register on the same server.

- All current API routes stay the same (no client-side changes)
- Draft engines imported directly (already pure functions)
- Scoring event consumer runs as a background job in the same process
- Notification dispatcher runs in-process (no need for separate HTTP calls)
- Event bus stays in-process (works perfectly in a monolith)
- One Docker image, one ECS task definition, one health check

**Service 2: poolmaster-ingestion (port 3003)**
Keep ingestion worker separate — it has a genuinely different runtime pattern:
- Runs scheduled polling jobs (not HTTP-driven)
- Talks to external APIs (ESPN, OpenF1, Odds API)
- Publishes stat events to Redis Streams (upgrade from in-process event bus)
- Can be scaled/restarted independently without affecting the API

### What Changes

| Before | After |
|---|---|
| 5 backend Docker images | 2 backend Docker images |
| 5 ECS task definitions | 2 ECS task definitions |
| 5 ECR repos (backend) | 2 ECR repos (backend) |
| 5 CloudWatch log groups (backend) | 2 CloudWatch log groups (backend) |
| ~$35-50/mo Fargate (5 tasks) | ~$15-20/mo Fargate (2 tasks) |
| Shared module resolution headaches | One image, no symlink issues |
| Inter-service event bus (in-process) | Same process (direct calls) + Redis pub/sub to ingestion |

### What Stays the Same

- All API endpoints and routes (no client changes)
- Database schema (unchanged)
- Webapp and admin app (unchanged)
- All business logic (just moved into one process)
- Code organization in packages/ (keep the module boundaries)

### Migration Steps

1. Create `packages/poolmaster-api/` — new combined service
2. Import all modules from core-api, draft-service, scoring-service, notification-service
3. Register all routes on one Fastify instance
4. Start scoring consumer and notification scheduler as background jobs
5. Create single Dockerfile
6. Update Terraform: remove 4 ECS services, keep 1 API + 1 ingestion
7. Update CI: build 2 backend images instead of 5
8. Update ALB: all /api/* routes go to one service

---

## Analysis 2: Frontend Hosting — Docker/nginx vs S3 + CloudFront

### Option A: Current (Docker + nginx + ECS Fargate)

**How it works:** Vite builds React → static files in Docker image → nginx serves them → ECS Fargate runs the container → ALB routes to it

| Aspect | Assessment |
|---|---|
| **Cost** | ~$7-15/mo per app (Fargate task minimum + ALB target group) |
| **Latency** | Single region (us-east-2). Users far from Ohio get slow first load |
| **Scaling** | Manual (increase ECS desired count). nginx is efficient but still a running process |
| **Deploy** | Build Docker image → push to ECR → ECS rolling update (~3-5 min) |
| **Caching** | nginx caches static assets. No CDN edge caching |
| **SSL** | Handled by ALB (already configured) |
| **Complexity** | Docker image, ECR repo, ECS task definition, target group, listener rule per app |
| **Cold start** | Fargate task startup ~30-60s if scaled to 0 |

### Option B: S3 + CloudFront CDN (Recommended)

**How it works:** Vite builds React → static files uploaded to S3 bucket → CloudFront CDN serves them globally → Route 53 points domain to CloudFront

| Aspect | Assessment |
|---|---|
| **Cost** | ~$1-3/mo (S3 storage pennies + CloudFront free tier covers 1TB/mo) |
| **Latency** | Global edge caching. Sub-100ms first load from anywhere |
| **Scaling** | Infinite — CloudFront handles any traffic spike automatically |
| **Deploy** | `aws s3 sync dist/ s3://bucket` + `aws cloudfront create-invalidation` (~10 sec) |
| **Caching** | Edge-cached globally. Immutable asset hashes + no-cache index.html |
| **SSL** | CloudFront handles SSL with the same ACM certificate |
| **Complexity** | S3 bucket + CloudFront distribution + OAI policy. No Docker/ECS/ECR needed |
| **Cold start** | None — always served from edge cache |

### Side-by-Side Comparison

| Factor | Docker/nginx/ECS | S3 + CloudFront | Winner |
|---|---|---|---|
| Monthly cost (2 apps) | ~$15-30 | ~$2-5 | **CloudFront** |
| Global performance | Single region | 400+ edge locations | **CloudFront** |
| Deploy speed | 3-5 min (Docker build + ECS) | 10 seconds (S3 sync) | **CloudFront** |
| Operational overhead | Docker, ECR, ECS, ALB target groups | S3 bucket + CF distribution | **CloudFront** |
| Infinite scale | No (need to add Fargate tasks) | Yes (automatic) | **CloudFront** |
| API proxying | nginx proxies /api to core-api | CloudFront origin for /api → ALB | **Tie** |
| SPA routing | nginx try_files → index.html | CloudFront custom error → index.html | **Tie** |
| Preview deploys | Hard (need separate ECS service) | Easy (separate S3 prefix) | **CloudFront** |

### Recommendation: S3 + CloudFront

For static React SPAs, CloudFront is strictly better in every dimension — cheaper, faster, simpler, more scalable. The only reason to use Docker/nginx is if the frontend needs server-side rendering (SSR), which PoolMaster doesn't use.

### CloudFront Implementation

```
CloudFront Distribution
├── Origin 1: S3 bucket (default) — serves webapp static files
│   └── Behaviors: /* → S3, Cache-Control from Vite hashes
│   └── Custom error: 403/404 → /index.html (SPA routing)
├── Origin 2: ALB (API) — proxies API calls to backend
│   └── Behaviors: /api/* → ALB, no caching
└── SSL: ACM certificate (already have it)
```

Two CloudFront distributions:
- `qa.ultimateofficepoolmanager.com` → S3 webapp bucket + ALB API origin
- `qa.ultimateofficepoolmanager.com/admin` → S3 admin bucket (or same bucket with /admin prefix)

---

## Combined Recommendation

| Component | Current | Proposed |
|---|---|---|
| Backend API | 4 ECS services (core-api, draft, scoring, notification) | 1 ECS service (poolmaster-api) |
| Ingestion | 1 ECS service | 1 ECS service (unchanged) |
| Webapp | 1 ECS service (nginx) | S3 + CloudFront |
| Admin | 1 ECS service (nginx) | S3 + CloudFront |
| **Total ECS tasks** | **7** | **2** |
| **Total Docker images** | **7** | **2** |
| **Monthly cost (QA)** | ~$110-130 | ~$40-60 |

### Implementation Phases

**Phase 1: Frontend to S3 + CloudFront**
- Create S3 buckets for webapp + admin
- Create CloudFront distributions with API origin → ALB
- Update CI to deploy via `aws s3 sync` instead of Docker build
- Remove web + admin ECS services from Terraform
- Fastest win — eliminates 2 Docker images and 2 ECS services immediately

**Phase 2: Backend consolidation**
- Merge core-api + draft + scoring + notification into one service
- Create single Dockerfile (eliminates shared module resolution issue)
- Update Terraform: 1 API service + 1 ingestion worker
- Upgrade event bus from in-process to Redis pub/sub for ingestion → API communication

---

## Verification

After Phase 1:
- `https://qa.ultimateofficepoolmanager.com` loads from CloudFront
- `/api/v1/health` proxies to ALB → core-api
- Deploy speed < 30 seconds (S3 sync + CF invalidation)

After Phase 2:
- All API endpoints work unchanged
- One Docker image builds and starts cleanly
- Scoring and notification background jobs run in-process
- `npm run test:smoke:api` passes

---

## Files to Create/Modify

### Phase 1 (Frontend to CloudFront)
- `infrastructure/terraform/cloudfront.tf` — new: S3 buckets + CF distributions
- `infrastructure/terraform/main.tf` — remove web + admin ECS services
- `.github/workflows/ci.yml` — replace Docker build/push with S3 sync for web/admin
- `infrastructure/terraform/outputs.tf` — add CloudFront distribution URLs

### Phase 2 (Backend consolidation)
- `packages/poolmaster-api/` — new combined service
- `infrastructure/docker/Dockerfile.poolmaster-api` — single backend Dockerfile
- `infrastructure/terraform/main.tf` — consolidate to 1 API + 1 ingestion ECS service
- `.github/workflows/ci.yml` — build 2 images instead of 5
