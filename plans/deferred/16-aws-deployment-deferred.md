# PoolMaster AWS Deployment — Deferred Tasks

> These tasks are explicitly deferred and should NOT be implemented until the web platform is complete and stable. They were extracted from the main plan file to prevent accidental implementation. Infrastructure and Terraform configuration (Phase 1-2) is complete; remaining tasks require manual AWS operations and a stable application.

## Deferred Tasks

| ID | Phase | Task | Owner | Original Status | Reason |
|---|---|---|---|---|---|
| 16-017 | 3 | Run `terraform init` and `terraform plan` for staging | Derek | Not Started | Waiting for application stability |
| 16-018 | 3 | Run `terraform apply` for staging environment | Derek | Not Started | Creates all AWS resources |
| 16-019 | 3 | Run Prisma migrations against RDS endpoint | Agent | Not Started | One-time migration against deployed RDS |
| 16-020 | 3 | Run seed script against RDS | Derek | Not Started | Seed data for staging |
| 16-021 | 3 | Push first Docker images to ECR | Agent | Not Started | Manual or CI-triggered |
| 16-022 | 3 | Verify all services healthy via ALB health checks | Derek | Not Started | Post-deploy verification |
| 16-023 | 3 | Verify webapp loads at domain | Derek | Not Started | Post-deploy verification |
| 16-024 | 3 | Verify API endpoints via domain | Derek | Not Started | Post-deploy verification |
| 16-025 | 4 | Run `terraform apply` for production environment | Derek | Not Started | After staging validated |
| 16-026 | 4 | Configure production domain DNS | Derek | Not Started | Point production domain to ALB |
| 16-027 | 4 | Enable RDS multi-AZ for production | Agent | Not Started | Set multi_az = true in Terraform |
| 16-028 | 4 | Enable RDS automated backups and point-in-time recovery | Agent | Not Started | Retention: 7 days |
