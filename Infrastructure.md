# PoolMaster — Infrastructure Requirements

> Last updated: 2026-03-26

---

## Summary

- **Local development** is fully containerized via Docker Compose — one command starts everything.
- **Production infrastructure has no Terraform or IaC** — the `infrastructure/terraform/` and `infrastructure/k8s/` directories contain only `.gitkeep` files.
- Production deployment requires either writing Terraform/CDK, or manually provisioning AWS resources and setting connection strings in `.env`.

---

## Infrastructure Inventory

| # | Component | Purpose | Local Dev | Production | Status | Action Required |
|---|---|---|---|---|---|---|
| **Databases & Cache** |||||||
| 1 | **PostgreSQL 16** | Primary relational DB (Prisma ORM) | Docker Compose (`localhost:5432`) | AWS RDS or self-hosted | No Terraform exists | Run `docker compose up` locally. For prod: provision RDS instance, set `DATABASE_URL` in `.env` |
| 2 | **Redis 7** | Cache, pub/sub, message broker, draft state | Docker Compose (`localhost:6379`) | AWS ElastiCache or self-hosted | No Terraform exists | Run `docker compose up` locally. For prod: provision ElastiCache, set `REDIS_URL` in `.env` |
| **AWS Services** |||||||
| 3 | **AWS SES** | Production email delivery | LocalStack mock (`localhost:4566`) | Real AWS SES | No Terraform exists | Locally: Docker Compose starts LocalStack + auto-inits SES. For prod: verify sender domain in SES console, set `EMAIL_PROVIDER=ses` + AWS creds in `.env` |
| 4 | **AWS SNS** | Notification fan-out (event → multiple consumers) | LocalStack mock (`localhost:4566`) | Real AWS SNS | No Terraform exists | Locally: auto-created by `init-aws.sh`. For prod: create topic, set `SNS_TOPIC_ARN` in `.env` |
| 5 | **AWS SQS** | Durable notification queue | LocalStack mock (`localhost:4566`) | Real AWS SQS | No Terraform exists | Locally: auto-created by `init-aws.sh`. For prod: create queue + subscribe to SNS, set `SQS_QUEUE_URL` in `.env` |
| **Push Notifications** |||||||
| 6 | **APNs** (Apple Push) | iOS push notifications | Push Mock Server (`localhost:3099`) | Apple's `api.push.apple.com` | Needs Apple Developer account | Locally: Docker Compose runs mock. For prod: get APNs key from Apple Developer portal, set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` in `.env` |
| 7 | **FCM** (Firebase Cloud Messaging) | Android push notifications | Push Mock Server (`localhost:3099`) | Google's `fcm.googleapis.com` | Needs Firebase project | Locally: Docker Compose runs mock. For prod: create Firebase project, set `FCM_PROJECT_ID` + service account creds in `.env` |
| **Email** |||||||
| 8 | **SMTP / Mailpit** | Dev email capture & preview | Docker Compose (`localhost:1025` SMTP, `localhost:8025` UI) | N/A (use SES in prod) | Docker only | Run `docker compose up`. Browse `localhost:8025` to see captured emails |
| **External APIs** |||||||
| 9 | **The Odds API** | Sports odds for participant pricing | Optional (free tier) | Same key | Needs API key signup | Sign up at the-odds-api.com (free: 500 req/month), set `ODDS_API_KEY` in `.env` |
| **Auth** |||||||
| 10 | **Auth0 or AWS Cognito** | User identity & authentication | Not yet implemented | Not yet implemented | Not built yet | Architecture rules mention it but no code exists. Needs decision + provisioning |
| **Future / Planned** |||||||
| 11 | **AWS S3** | File storage (images, exports) | Not implemented | Not implemented | Not built yet | Will need bucket creation when implemented |
| 12 | **AWS CloudFront** | CDN for static web assets | Not needed locally | Not implemented | Not built yet | Will need distribution when web app deploys |
| 13 | **DynamoDB** | High-volume stat event storage (optional) | Not implemented | Not implemented | Not built yet | Alternative to PostgreSQL for stat events — decision pending |
| 14 | **Stripe** | Payments & subscriptions | Not implemented | Not implemented | Not built yet | Will need Stripe account + API keys when billing is built |
| 15 | **Sentry** | Error tracking | Not implemented | Not implemented | Not built yet | Will need Sentry project + DSN |

---

## Local Development Setup

Everything starts with one command:

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up
```

This starts:

| Service | Image | Ports | Notes |
|---|---|---|---|
| PostgreSQL | `postgres:16` | `5432` | Persistent volume `pgdata` |
| Redis | `redis:7-alpine` | `6379` | |
| Mailpit | `axllent/mailpit:latest` | `8025` (UI), `1025` (SMTP) | Browse UI at `http://localhost:8025` |
| LocalStack | `localstack/localstack:latest` | `4566` | Mocks SES, SNS, SQS |
| Push Mock | Built from `packages/push-mock-server` | `3099` | Captures APNs/FCM payloads |

### LocalStack Auto-Initialization

The script at `infrastructure/docker/localstack-init/ready.d/init-aws.sh` runs automatically on startup and creates:

- SES sender identity verification for `noreply@poolmaster.local`
- SNS topic: `poolmaster-notifications`
- SQS queue: `poolmaster-notification-queue`
- SNS → SQS subscription

### Environment Configuration

Copy `.env.example` to `.env` — the defaults point to `localhost` and work with Docker Compose out of the box:

```env
# Database & Cache
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster
REDIS_URL=redis://localhost:6379

# Service Ports
CORE_API_PORT=3000
DRAFT_SERVICE_PORT=3001
SCORING_SERVICE_PORT=3002
INGESTION_WORKER_PORT=3003
NOTIFICATION_SERVICE_PORT=3004

# Email (dev)
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=noreply@poolmaster.local

# AWS (LocalStack)
AWS_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SES_FROM_EMAIL=noreply@poolmaster.local
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:000000000000:poolmaster-notifications
SQS_QUEUE_URL=http://localhost:4566/000000000000/poolmaster-notification-queue

# Push (dev mocks)
APNS_BASE_URL=http://localhost:3099
APNS_KEY_ID=dev-key
APNS_TEAM_ID=dev-team
APNS_BUNDLE_ID=com.poolmaster.dev
FCM_BASE_URL=http://localhost:3099
FCM_PROJECT_ID=poolmaster-dev

# External APIs (optional)
ODDS_API_KEY=
AUTO_START_SCHEDULER=false
```

---

## Production Infrastructure (Not Yet Provisioned)

No Terraform, CloudFormation, or CDK exists. The `infrastructure/terraform/` and `infrastructure/k8s/` directories are empty placeholders.

### What Needs To Be Provisioned

To deploy to AWS, the following resources are required:

#### Networking & Compute
- VPC with public/private subnets
- ECS Fargate cluster (or EKS) for running the 5 microservices + push mock replacement
- Application Load Balancer (ALB) with TLS termination
- Security groups for service-to-service and internet access

#### Data Stores
- **RDS PostgreSQL 16** — primary database, encryption at rest (AES-256), automated backups
- **ElastiCache Redis 7** — cache and message broker, cluster mode optional

#### Messaging
- **SNS Topic** — `poolmaster-notifications` for event fan-out
- **SQS Queue** — `poolmaster-notification-queue` subscribed to the SNS topic

#### Email
- **SES** — verify sender domain, request production access (out of sandbox)

#### Container Registry
- **ECR** — one repository per service (core-api, draft-service, scoring-service, ingestion-worker, notification-service)

#### DNS & CDN (for web app)
- **Route 53** — domain management
- **CloudFront** — CDN for React web app static assets
- **S3** — bucket for web app build output

#### Secrets
- **AWS Secrets Manager** or **SSM Parameter Store** — database credentials, API keys, APNs/FCM keys

#### Monitoring
- **CloudWatch** — logs, metrics, alarms
- **Sentry** — error tracking (external service)

### Environment Variables for Production

Replace the local defaults with production values:

```env
DATABASE_URL=postgresql://<user>:<pass>@<rds-endpoint>:5432/poolmaster
REDIS_URL=redis://<elasticache-endpoint>:6379
EMAIL_PROVIDER=ses
AWS_REGION=<your-region>
SNS_TOPIC_ARN=arn:aws:sns:<region>:<account-id>:poolmaster-notifications
SQS_QUEUE_URL=https://sqs.<region>.amazonaws.com/<account-id>/poolmaster-notification-queue
SES_FROM_EMAIL=noreply@<your-domain>
APNS_BASE_URL=https://api.push.apple.com
FCM_BASE_URL=https://fcm.googleapis.com
```

---

## Microservice Topology

All services are Node.js 20+ Fastify applications, independently deployable as Docker containers.

| Service | Port | Database | Redis | AWS | External |
|---|---|---|---|---|---|
| **Core API** | 3000 | PostgreSQL (Prisma) | Yes | — | — |
| **Draft Service** | 3001 | — | Yes | — | — |
| **Scoring Service** | 3002 | — | Yes | — | — |
| **Ingestion Worker** | 3003 | — | Yes | — | The Odds API, ESPN, OpenF1, PGA Tour |
| **Notification Service** | 3004 | PostgreSQL (Prisma) | Yes | SES, SNS, SQS | APNs, FCM |
| **Push Mock Server** | 3099 | — | — | — | — (dev only) |

### Docker Build

Each service is built from the same multi-stage Dockerfile:

```bash
docker build -f infrastructure/docker/Dockerfile.service \
  --build-arg SERVICE=core-api -t poolmaster-core-api .
```

---

## File Reference

| File | Purpose |
|---|---|
| `infrastructure/docker/docker-compose.dev.yml` | Local dev infrastructure (PostgreSQL, Redis, Mailpit, LocalStack, Push Mock) |
| `infrastructure/docker/Dockerfile.service` | Multi-stage Docker build for all services |
| `infrastructure/docker/localstack-init/ready.d/init-aws.sh` | LocalStack auto-init (SES, SNS, SQS) |
| `infrastructure/terraform/.gitkeep` | Placeholder for future Terraform |
| `infrastructure/k8s/.gitkeep` | Placeholder for future Kubernetes manifests |
| `packages/core-api/prisma/schema.prisma` | Database schema (~17,900 lines) |
| `.env.example` | Environment variable template |
| `.env` | Active environment configuration (not committed) |
