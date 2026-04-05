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
