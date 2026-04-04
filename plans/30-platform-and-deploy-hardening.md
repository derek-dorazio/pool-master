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

## Decision

For the current platform, keep database migration and seed execution on the ECS/Fargate path rather than trying to grant GitHub-hosted runners network access to private RDS.

Why this remains the chosen path:

- RDS stays private inside the VPC
- migration and seed run from the same AWS runtime boundary as the app
- the pattern fits an ECS-based deployment model well
- the current issue is deploy determinism and observability, not the basic choice to run migrations from AWS-side compute

This means the next fixes should improve the existing ECS approach rather than replace it immediately.

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
- Keep the migration path on ECS for now; treat any CodeBuild-based migration runner as a future optional alternative, not the current target architecture.

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

## Current Failure Signal

- CI run `23969314887` proved a real rollout-stabilization gap:
  - `lint-typecheck`, `build`, `test-webapp`, `test`, `test-admin`, and `publish-images` all passed
  - `migrate-qa` successfully ran the ECS migration task and the QA seed task
  - the run then failed in `Wait for ECS service to stabilize`
  - exact failing command: `aws ecs wait services-stable --cluster poolmaster-qa-cluster --services poolmaster-qa-core-api`
  - exact failure: `Waiter ServicesStable failed: Max attempts exceeded`
  - downstream `smoke-test` and `e2e-test` never started because they correctly depend on `migrate-qa`

This means the current blocker is not schema migration drift. It is lack of visibility and deterministic verification around ECS service rollout health after deployment.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| PDH-001 | CI/CD | Remove or sharply reduce `continue-on-error` from deploy-critical steps in [ci.yml](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/.github/workflows/ci.yml) | In Progress | The QA ECS backend rollout path now fails at `Deploy QA services` instead of silently swallowing `update-service` errors. Remaining work is to review the web/admin S3+CloudFront steps and any other deploy-critical actions that should stop the pipeline instead of degrading into best-effort drift |
| PDH-002 | Deploy Strategy | Stop deploying ECS from `:latest` tags referenced in [ci.yml](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/.github/workflows/ci.yml) and [main.tf](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/infrastructure/terraform/main.tf) | In Progress | The workflow now registers release-specific task definitions with the exact `core-api` image digest built in CI for both `poolmaster-qa-core-api` and `poolmaster-qa-migrate`. Remaining work is to finish the Terraform/runtime follow-through so long-lived infrastructure no longer points at mutable `:latest` defaults. |
| PDH-003 | Deploy Strategy | Move away from “force new deployment against latest image” and register new ECS task definitions per release | In Progress | `.github/workflows/ci.yml` now renders new QA task definition revisions from the current deployed definitions and updates the service to the new revision explicitly. Remaining work is to verify the expected revision after rollout and then carry the same deterministic approach into infrastructure-managed release paths. |
| PDH-004 | QA Jobs | Promote migrate and seed into first-class deploy primitives | In Progress | Keep this on ECS. Next fixes should split `migrate`, `seed`, and `service rollout` more explicitly, consider dedicated ECS task definitions/log groups for `migrate` and `seed`, and rename CI steps/jobs so rollout verification is not conflated with the migration primitive |
| PDH-005 | Verification | Add explicit post-deploy verification before smoke | In Progress | Current CI already proved a real rollout-stabilization failure mode: run `23969314887` completed build/test/publish, migration, and seed successfully, then failed waiting for `aws ecs wait services-stable` on `poolmaster-qa-core-api` after 10 minutes. The first diagnostics slice is now in `.github/workflows/ci.yml`: capture the reported/PRIMARY task definition before waiting, and dump ECS service description, service events, task definition metadata, running tasks, recently stopped tasks, and latest stopped-task logs before failing. After immutable task-definition rollout was added, run `23981057955` showed the new `poolmaster-qa-core-api:4` revision still exiting with code `1`; local reproduction traced the crash to backend route files directly `require`-ing raw `packages/shared/**/*.ts` DTO source files instead of importing `@poolmaster/shared/dto`, which plain Node in ECS cannot resolve safely. |
| PDH-012 | Runtime Drift | Remove unused Redis infrastructure and environment wiring from Terraform and service runtime | Done | Redis client usage does not appear in live app code. The cleanup now removes Redis from CI test services, local docker compose/scripts, Terraform, OpenAPI export env setup, admin health source contracts, generated OpenAPI/client artifacts, architecture rules, and active docs so Redis is no longer described as part of the current runtime. |
| PDH-013 | Frontend Deploys | Make QA web/admin frontend deployments immutable and traceable instead of overwrite-only S3 root syncs | In Progress | Keep the public QA URLs stable, but publish each Vite build under a release prefix such as `releases/<git-sha>/`, promote only the root `index.html`, remove `continue-on-error` from web/admin deploy steps, and emit the deployed release prefixes in the CI summary so manual QA can verify what build is live. |
| PDH-006 | Terraform Hygiene | Remove local Terraform artifacts from version control, especially [infrastructure/terraform/.terraform/terraform.tfstate](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/infrastructure/terraform/.terraform/terraform.tfstate) | In Progress | Audit confirmed the real local working-state drift is under `infrastructure/terraform/.terraform`, including `terraform.tfstate`. `.terraform.lock.hcl` is currently the only tracked Terraform artifact in this area and should remain versioned as the provider lockfile. Remaining work is to document the remote-state-only workflow for shared environments and ensure no local `.terraform/` state is ever committed. |
| PDH-007 | Terraform Structure | Split monolithic Terraform concerns where helpful and document environment promotion flow | Not Started | Networking, compute, app delivery, and observability can likely be factored more cleanly over time |
| PDH-008 | AWS Runtime | Review autoscaling, desired counts, one-AZ assumptions, and operational resilience for QA/prod ECS services | Not Started | Current service setup is minimal and may be fine for QA, but should be explicitly evaluated for prod risk |
| PDH-009 | Node Actions | Upgrade GitHub Actions that still rely on Node 20 | In Progress | CI run `23989110624` proved the upgraded workflow actions run cleanly, but GitHub still emits Node 20 deprecation annotations for `actions/upload-artifact@v4` in `test`, `test-webapp`, `test-admin`, and `e2e-test`. Remaining work is to move those artifact uploads to a Node-24-safe version and rerun CI cleanly. |
| PDH-010 | Test Infra | Replace the legacy DB-backed integration suite with small self-contained CRUD-style integration batches | Done | On 2026-04-03 the old `tests/integration/core-api` suites were removed and replaced with new self-contained CRUD/read-flow suites for contests, leagues, invitations/members, contest entries, draft session flow, and standings/results reads. See [integration-crud-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/integration-crud-rebuild.md) for the completed baseline and [integration-expansion-by-domain.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/integration-expansion-by-domain.md) for the next worker-split expansion phase. |
| PDH-011 | Coverage Gates | Enforce current coverage baselines locally and in GitHub CI, then ratchet upward over time | In Progress | Thresholds are already enforced locally and in CI through Jest/Vitest config. CI run `23989110624` confirmed backend/web/admin coverage artifacts are uploaded and visible in GitHub UI, and summary/log output now runs in all three jobs. Remaining work is future ratchets from a stable reported baseline rather than basic visibility. |

## Immediate Follow-Up For PDH-005

1. Capture recent ECS service events in CI when `services-stable` fails.
2. Capture task ARNs, last status, desired status, stop reasons, and health-check failures for the replacement tasks.
3. Print the active task definition revision and deployed image digest before and after rollout.
4. Fail with a compact deployment summary that tells us whether the issue is:
   - task crash loop
   - failing ALB/container health checks
   - capacity/placement issue
   - image/task-definition drift
5. Only run smoke/E2E after that verification step succeeds.

## Immediate ECS Hardening Follow-Up

1. Stop using `:latest` for the QA ECS service and migration task definitions.
2. Register or render release-specific ECS task definitions per CI run.
3. Deploy the exact release task definition instead of forcing a rollout against a mutable image tag.
4. Split CI naming and control flow so:
   - migration means the one-shot schema task
   - seed means the one-shot bootstrap task
   - rollout verification means the ECS service stabilization and health check phase
5. Consider separate ECS task definitions and CloudWatch log groups for:
   - `core-api`
   - `migrate`
   - `seed`
6. Keep smoke and E2E gated behind successful rollout verification only.
