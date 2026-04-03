# Plan 30: Platform and Deploy Hardening

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Purpose

Harden CI/CD, Terraform hygiene, and AWS deployment strategy so deploys are deterministic, observable, and fail fast instead of silently drifting.

## Review Findings Driving This Plan

1. Deploy jobs still rely on `continue-on-error` in places where a failed deploy should block downstream confidence signals.
2. ECS service and one-shot task definitions still run `:latest` rather than immutable image digests.
3. The repo contains local Terraform working-state artifacts that should not be versioned.
4. QA deploy success is still coupled to ad hoc waits and implicit runtime assumptions rather than explicit rollout verification.

## Scope

- `.github/workflows/ci.yml`
- `infrastructure/terraform/*`
- AWS ECS/S3/CloudFront deploy strategy
- repo hygiene for Terraform state/artifacts

## Goals

- Make deploys deterministic and traceable to a specific artifact.
- Fail CI when deploy prerequisites or deploy actions fail.
- Separate migrate/seed/app rollout concerns cleanly.
- Clean Terraform hygiene and remote-state usage.

## Priorities

### Priority 1

Make failed deploys fail loudly:

- remove deploy-critical `continue-on-error`
- verify rollout success before downstream smoke confidence signals run

### Priority 2

Make deployed artifacts deterministic:

- stop using `:latest`
- register release-specific ECS task definitions
- tie smoke coverage to the exact image that passed CI

### Priority 3

Reduce platform drift and operational ambiguity:

- clean Terraform hygiene
- clarify migrate/seed/app rollout boundaries
- document runtime resilience assumptions for QA and production

## Implementation Phases

### Phase 1: Fail-fast CI/CD audit

- Review the deploy portions of GitHub Actions and remove `continue-on-error` where failure should block promotion.
- Separate informational best-effort steps from deploy-critical ones so pipeline intent is explicit.
- Confirm downstream smoke and E2E jobs only run when the deployment they target actually succeeded.

### Phase 2: Immutable artifact deployment

- Replace `:latest` ECS references with digest-pinned or SHA-pinned task definitions.
- Update CI to build, publish, capture, and deploy the exact artifact identifier produced in that run.
- Ensure deploy metadata is visible in logs so rollback and audit trails are straightforward.

### Phase 3: Explicit ECS rollout model

- Move from “force new deployment” semantics toward registering new task definitions per release.
- Separate service rollout, migration, and seeding into explicit deployment primitives with dedicated commands and logs.
- Decide whether migrate/seed should remain one-shot ECS tasks, distinct task definitions, or another runner abstraction.

### Phase 4: Post-deploy verification and runtime checks

- Add explicit verification that the intended task definition or image digest is live before smoke begins.
- Check ALB health, ECS rollout status, and static asset versioning so failures are caught at the right boundary.
- Tighten QA runtime assumptions around waits, readiness, and service convergence.

### Phase 5: Terraform hygiene and infrastructure clarity

- Remove local Terraform state artifacts from version control and strengthen ignores around generated working-state files.
- Verify remote backend usage is the only supported workflow for shared environments.
- Factor or document Terraform modules where the current monolith obscures environment promotion or ownership.

### Phase 6: Operational resilience follow-up

- Review autoscaling, desired counts, and single-AZ assumptions for QA and production services.
- Upgrade GitHub Actions that are approaching runtime deprecation, including Node-version transitions.
- Document the deploy and promotion flow so future infrastructure changes do not reintroduce silent drift.

## Acceptance Criteria

- Deploy-critical CI steps fail the workflow when deployment actions fail.
- ECS services and one-shot tasks deploy immutable image identifiers rather than `:latest`.
- Each release registers or references an explicit task definition revision tied to the artifact built in CI.
- Post-deploy verification confirms the intended runtime revision before smoke tests run.
- Terraform working-state artifacts are no longer tracked in the repo, and remote-state expectations are documented.
- QA and production deployment assumptions around migrations, seeding, scaling, and resilience are explicit and reviewable.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| PDH-001 | CI/CD | Remove or sharply reduce `continue-on-error` from deploy-critical steps in [ci.yml](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/.github/workflows/ci.yml) | Not Started | Especially web/admin deploy and ECS update steps that currently allow silent drift |
| PDH-002 | Deploy Strategy | Stop deploying ECS from `:latest` tags referenced in [ci.yml](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/.github/workflows/ci.yml) and [main.tf](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/infrastructure/terraform/main.tf) | Not Started | Use image digest or explicit SHA-pinned task definitions so smoke tests target the exact build that passed CI |
| PDH-003 | Deploy Strategy | Move away from “force new deployment against latest image” and register new ECS task definitions per release | Not Started | This improves rollback, auditability, and deploy determinism |
| PDH-004 | QA Jobs | Promote migrate and seed into first-class deploy primitives | Not Started | Consider dedicated ECS task definitions/log groups for `migrate` and `seed` instead of overloading one task definition long term |
| PDH-005 | Verification | Add explicit post-deploy verification before smoke | Not Started | Verify service revision/digest, ALB health, and static asset version before running smoke tests |
| PDH-006 | Terraform Hygiene | Remove local Terraform artifacts from version control, especially [infrastructure/terraform/.terraform/terraform.tfstate](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/infrastructure/terraform/.terraform/terraform.tfstate) | Not Started | Add/update `.gitignore` and ensure only remote state/backends are used |
| PDH-007 | Terraform Structure | Split monolithic Terraform concerns where helpful and document environment promotion flow | Not Started | Networking, compute, app delivery, and observability can likely be factored more cleanly over time |
| PDH-008 | AWS Runtime | Review autoscaling, desired counts, one-AZ assumptions, and operational resilience for QA/prod ECS services | Not Started | Current service setup is minimal and may be fine for QA, but should be explicitly evaluated for prod risk |
| PDH-009 | Node Actions | Upgrade GitHub Actions that still rely on Node 20 | Not Started | CI is already warning about upcoming deprecation; this should be cleaned up before it becomes a forced break |
