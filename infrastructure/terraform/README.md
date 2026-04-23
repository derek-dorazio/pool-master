# Terraform Workflow

Terraform in this repo is remote-state-only for shared environments.

## Environment State

Initialize Terraform with the environment-specific backend config:

```bash
terraform init -backend-config=envs/qa.backend.hcl
terraform init -backend-config=envs/staging.backend.hcl
terraform init -backend-config=envs/prod.backend.hcl
```

Those backend config files select the S3 state key for each environment. Do not use ad hoc local state files for shared QA, staging, or prod work.

## Local Working Directory Rules

- `infrastructure/terraform/.terraform/` is local working state only.
- `infrastructure/terraform/.terraform/terraform.tfstate` must never be committed.
- `infrastructure/terraform/.terraform.lock.hcl` is the only Terraform artifact here that should remain tracked.

If local Terraform state appears in your worktree, delete the local `.terraform/` directory and re-run `terraform init -backend-config=...` for the environment you actually mean to target.

## Bootstrap Image Tag

Terraform creates the initial ECS task definitions using `core_api_bootstrap_image_tag`.

- Set that tag in the environment tfvars before the first service bootstrap if needed.
- After bootstrap, CI/CD registers release-specific task definition revisions from immutable image tags and digests.
- Do not revert ECS services back to mutable `latest` tags.

QA also bootstraps a dedicated `mock-contest-feed-provider` task definition using `mock_contest_feed_provider_bootstrap_image_tag`.

## QA-Only Mock Contest Feed Provider

QA includes a dedicated ECS service for `mock-contest-feed-provider`.

- It is deployed only in `qa`.
- It is registered in private DNS as `mock-contest-feed-provider.qa.poolmaster.internal`.
- It is intentionally not promoted to staging or prod.
- It exists so QA/manual flows and future verification lanes can use a stable internal mock sports-data source without introducing any production fallback behavior.

## Sports Data Provider Binding

Terraform now passes environment-level provider binding configuration into `core-api` via:

- `SPORT_DATA_DEFAULT_PROVIDER`
- `SPORT_DATA_PROVIDER_BINDINGS_JSON`

Recommended usage:

- QA points to the internal mock provider.
- Staging and prod bind explicitly to approved real providers later.
- Do not use these variables to introduce silent fallback from real providers to the mock provider.

## Direct QA Database Access

Terraform can also model intentionally approved direct PostgreSQL access when QA operators need it.

- `db_publicly_accessible` controls whether the RDS instance should expose a public endpoint.
- `db_allowed_cidr_blocks` is the allow-list of approved direct client CIDRs for PostgreSQL access.
- Keep both disabled by default and only enable them explicitly in local `envs/*.tfvars` files for environments where that access is truly intended.
