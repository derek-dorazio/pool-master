# PoolMaster — AWS Deployment Plan

## Overview

Deploy PoolMaster to AWS using ECS Fargate, RDS PostgreSQL, ElastiCache Redis, and ALB. Terraform manages all infrastructure. GitHub Actions CI/CD builds and pushes Docker images. This plan covers initial setup through first production deploy.

---

## Action Plan

| ID | Phase | Task | Owner | Status | Notes |
|---|---|---|---|---|---|
| 16-001 | 1 | Create S3 bucket for Terraform state (`poolmaster-terraform-state`) | Derek | Not Started | AWS Console or CLI. Enable versioning. |
| 16-002 | 1 | Create DynamoDB table for Terraform state locking (`poolmaster-terraform-locks`) | Derek | Not Started | Partition key: `LockID` (String) |
| 16-003 | 1 | Register domain or configure Route 53 hosted zone | Derek | Not Started | Or point existing domain NS records to Route 53 |
| 16-004 | 1 | Request ACM certificate for HTTPS (`*.poolmaster.com` or your domain) | Derek | Not Started | DNS validation — add the CNAME record Route 53 suggests |
| 16-005 | 1 | Create IAM user/role for GitHub Actions with ECR + ECS permissions | Derek | Not Started | Needs: ecr:*, ecs:UpdateService, iam:PassRole. Save access key as GitHub secrets |
| 16-006 | 1 | Add AWS credentials to GitHub repo secrets | Derek | Not Started | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ACCOUNT_ID` |
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

### Phase 1 — Manual AWS Setup (Derek)
One-time bootstrap steps that must be done in AWS Console before Terraform can run. ~30 minutes.

### Phase 2 — Complete Terraform + CI/CD (Agent)
Finish the Terraform scaffolding: add all service definitions, HTTPS, secrets, DNS, monitoring, and update GitHub Actions. ~2-3 hours of agent work.

### Phase 3 — First Deploy to Staging (Derek + Agent)
Apply Terraform, run migrations, push images, verify. ~1 hour.

### Phase 4 — Production (Derek + Agent)
Repeat for production with multi-AZ database and production DNS. ~30 minutes.

---

## Cost Estimate (Monthly)

| Resource | Staging | Production |
|---|---|---|
| ECS Fargate (7 services) | ~$30-50 | ~$100-200 |
| RDS PostgreSQL (db.t3.micro/small) | ~$15 | ~$50-100 (multi-AZ) |
| ElastiCache Redis (cache.t3.micro) | ~$12 | ~$25-50 |
| ALB | ~$16 | ~$16 |
| ECR storage | ~$1 | ~$1 |
| Route 53 | ~$0.50 | ~$0.50 |
| CloudWatch | ~$5 | ~$10 |
| **Total** | **~$80-100/mo** | **~$200-380/mo** |

---

## Prerequisites Checklist (Before Agent Work)

Derek must complete these before the Agent can implement Phase 2:

- [ ] 16-001: S3 bucket created — provide bucket name
- [ ] 16-002: DynamoDB lock table created
- [ ] 16-003: Route 53 hosted zone configured — provide hosted zone ID and domain name
- [ ] 16-004: ACM certificate requested and validated — provide certificate ARN
- [ ] 16-005: IAM user created — provide access key ID (secret key stored in GitHub)
- [ ] 16-006: GitHub secrets configured

Once these are done, return and say "implement the AWS deployment plan" — the Agent will prompt you for the required values below before starting.

---

## Agent Prompt Checklist

**When Derek requests Phase 2 implementation, the Agent MUST ask for these values before writing any code:**

1. **S3 bucket name** for Terraform state
   - Example: `poolmaster-terraform-state`

2. **S3 bucket region**
   - Example: `us-east-1`

3. **DynamoDB table name** for Terraform state locking
   - Example: `poolmaster-terraform-locks`

4. **Domain name**
   - Example: `poolmaster.com` or `app.poolmaster.com`

5. **Route 53 hosted zone ID**
   - Found in Route 53 console → Hosted zones → Zone ID column
   - Example: `Z0123456789ABCDEFGHIJ`

6. **ACM certificate ARN**
   - Found in ACM console → Certificates → Certificate ARN
   - Example: `arn:aws:acm:us-east-1:123456789012:certificate/abc-def-ghi`

7. **AWS account ID**
   - Found in top-right of AWS console → Account ID
   - Example: `123456789012`

8. **AWS region** for deployment
   - Example: `us-east-1`

9. **GitHub repo owner/name** (for ECR image references)
   - Example: `derek-dorazio/pool-master`

10. **Confirm GitHub secrets are set** (yes/no)
    - `AWS_ACCESS_KEY_ID`
    - `AWS_SECRET_ACCESS_KEY`
    - `AWS_REGION`
    - `AWS_ACCOUNT_ID`

The Agent should use AskUserQuestion to collect all values in one prompt before proceeding with implementation.

---

*PoolMaster AWS Deployment Plan v1.1*
