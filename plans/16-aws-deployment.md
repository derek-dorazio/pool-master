# PoolMaster — AWS Deployment Plan

## Overview

Deploy PoolMaster to AWS using ECS Fargate, RDS PostgreSQL, ElastiCache Redis, and ALB. Terraform manages all infrastructure. GitHub Actions CI/CD builds and pushes Docker images. This plan covers initial setup through first production deploy.

---

## Action Plan

| ID | Phase | Task | Owner | Status | Notes |
|---|---|---|---|---|---|
| 16-001 | 1 | Create S3 bucket for Terraform state | Derek | Done | `poolmaster-terraform-state-614049083306-us-east-2-an` |
| 16-002 | 1 | Create DynamoDB table for Terraform state locking | Derek | Done | `poolmaster-terraform-locks` (ARN: arn:aws:dynamodb:us-east-2:614049083306:table/poolmaster-terraform-locks) |
| 16-003 | 1 | Register domain or configure Route 53 hosted zone | Derek | In Progress | Derek settling on domain name. Provide hosted zone ID + domain when ready |
| 16-004 | 1 | Request ACM certificate for HTTPS | Derek | Not Started | Blocked on 16-003. Request cert for `*.yourdomain.com` + `yourdomain.com` in us-east-2 |
| 16-005 | 1 | Create IAM user/role for GitHub Actions with ECR + ECS permissions | Derek | Done | `poolmaster-github-deploy` with ECR Full + custom `poolmaster-deploy` inline policy |
| 16-006 | 1 | Add AWS credentials to GitHub repo secrets | Derek | Done | All 4 secrets configured (KEY, SECRET, REGION, ACCOUNT_ID) |
| 16-007 | 2 | Configure Terraform remote state backend (S3 + DynamoDB) | Agent | Done | S3 bucket + DynamoDB lock table configured in main.tf backend block |
| 16-008 | 2 | Add HTTPS listener to ALB with ACM certificate | Agent | Done | Conditional: created only when acm_certificate_arn is provided. HTTP redirects to HTTPS |
| 16-009 | 2 | Add ECS task definitions for all 5 backend services | Agent | Done | core-api, draft-service, scoring-service, ingestion-worker, notification-service |
| 16-010 | 2 | Add ECS task definition for webapp (nginx + static) | Agent | Done | Web SPA via nginx on port 80, ALB default route |
| 16-011 | 2 | Add ALB target groups and listener rules for each service | Agent | Done | Path-based: /api/* → core-api, /api/v1/notifications* → notification-service, default → web |
| 16-012 | 2 | Add ECR repositories for all 7 images | Agent | Done | Already existed in scaffolding (for_each on local.services) |
| 16-013 | 2 | Wire secrets via AWS Secrets Manager | Agent | Deferred | DB password still in env vars. Move to Secrets Manager when prod-ready |
| 16-014 | 2 | Add Route 53 A record alias pointing domain to ALB | Agent | Done | Conditional: created only when domain_name + route53_zone_id provided |
| 16-015 | 2 | Add CloudWatch alarms (CPU, memory, 5xx rate) | Agent | Done | 7 alarms: ALB 5xx + latency, ECS CPU + memory, RDS CPU + storage + connections |
| 16-016 | 2 | Update GitHub Actions to push to ECR instead of GHCR | Agent | Done | Uses aws-actions/configure-aws-credentials + amazon-ecr-login. Region: us-east-2 |
| 16-017 | 3 | Run `terraform init` and `terraform plan` for staging | Derek | Not Started | Review plan output before applying |
| 16-018 | 3 | Run `terraform apply` for staging environment | Derek | Not Started | Creates all AWS resources |
| 16-019 | 3 | Run Prisma migrations against RDS endpoint | Agent | Not Started | One-time: `DATABASE_URL=<rds-endpoint> npx prisma migrate deploy` |
| 16-020 | 3 | Run seed script against RDS | Derek | Not Started | `DATABASE_URL=<rds-endpoint> npx tsx prisma/seed.ts` |
| 16-021 | 3 | Push first Docker images to ECR | Agent | Not Started | Can be manual push or triggered by GitHub Actions |
| 16-022 | 3 | Verify all services healthy via ALB health checks | Derek | Not Started | Check ECS console — all tasks should be RUNNING |
| 16-023 | 3 | Verify webapp loads at domain | Derek | Not Started | Open https://your-domain.com in browser |
| 16-024 | 3 | Verify API endpoints via domain | Derek | Not Started | `curl https://your-domain.com/api/v1/health` |
| 16-025 | 4 | Run `terraform apply` for production environment | Derek | Not Started | After staging is validated |
| 16-026 | 4 | Configure production domain DNS | Derek | Not Started | Point production domain to production ALB |
| 16-027 | 4 | Enable RDS multi-AZ for production | Agent | Not Started | Set `multi_az = true` in Terraform variables |
| 16-028 | 4 | Enable RDS automated backups and point-in-time recovery | Agent | Not Started | Retention: 7 days |

---

## Phase Summary

### Phase 1 — Manual AWS Setup (Derek) — IN PROGRESS
- [x] 16-001: S3 bucket created
- [x] 16-002: DynamoDB lock table created
- [ ] 16-003: Domain + Route 53 (Derek choosing domain name)
- [ ] 16-004: ACM certificate (blocked on domain)
- [ ] 16-005: IAM user for GitHub Actions
- [ ] 16-006: GitHub repo secrets

### Phase 2 — Complete Terraform + CI/CD (Agent) — DONE
All 10 tasks complete (9 Done, 1 Deferred to prod). Terraform is ready to apply.

### Phase 3 — First Deploy (Derek + Agent) — WAITING
Can proceed in two modes:
- **Without domain:** `terraform apply` now using ALB DNS. App accessible via `http://<alb-dns>`. No HTTPS.
- **With domain:** Wait for 16-003/16-004, then `terraform apply` with domain + HTTPS.

### Phase 4 — Production (Derek + Agent) — WAITING
After staging validated.

---

## Known Values (Collected)

| Key | Value |
|---|---|
| AWS Account ID | `614049083306` |
| AWS Region | `us-east-2` |
| S3 Bucket | `poolmaster-terraform-state-614049083306-us-east-2-an` |
| DynamoDB Table | `poolmaster-terraform-locks` |
| GitHub Repo | `derek-dorazio/pool-master` |
| Domain | TBD — Derek choosing |
| Route 53 Zone ID | TBD |
| ACM Certificate ARN | TBD |
| GitHub Secrets | Not yet configured |

---

## Remaining Steps for Derek (Before First Deploy)

### Required (can deploy without domain):
1. **Create IAM user** `poolmaster-github-deploy` with ECR + ECS permissions
2. **Add GitHub secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-2`, `AWS_ACCOUNT_ID=614049083306`
3. **Create `terraform.tfvars`**: `cp infrastructure/terraform/terraform.tfvars.example infrastructure/terraform/terraform.tfvars` and set `db_password`

### Required for HTTPS (can add later):
4. **Register domain** and create Route 53 hosted zone → provide **domain name** + **hosted zone ID**
5. **Request ACM certificate** for `*.yourdomain.com` in us-east-2 → provide **certificate ARN**
6. **Update `terraform.tfvars`** with domain_name, acm_certificate_arn, route53_zone_id

### When ready, return and say "deploy to AWS" — the Agent will:
1. Prompt for any missing values (domain, cert ARN, zone ID)
2. Run `terraform init` + `terraform plan` (for review)
3. After approval, run `terraform apply`
4. Run Prisma migrations against RDS
5. Trigger first image push to ECR
6. Verify health checks

---

## Cost Estimate (Monthly)

| Resource | Dev | Production |
|---|---|---|
| ECS Fargate (6 services) | ~$30-50 | ~$100-200 |
| RDS PostgreSQL (db.t3.micro) | ~$15 | ~$50-100 (multi-AZ) |
| ElastiCache Redis (cache.t3.micro) | ~$12 | ~$25-50 |
| ALB | ~$16 | ~$16 |
| NAT Gateway | ~$32 | ~$32 |
| ECR storage | ~$1 | ~$1 |
| Route 53 | ~$0.50 | ~$0.50 |
| CloudWatch | ~$5 | ~$10 |
| **Total** | **~$110-130/mo** | **~$230-410/mo** |

> Note: NAT Gateway is the largest fixed cost (~$32/mo). Can be removed in dev if services are placed in public subnets instead.

---

*PoolMaster AWS Deployment Plan v1.2*
