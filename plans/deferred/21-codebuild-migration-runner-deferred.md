# CodeBuild Migration Runner Deferred

> **Planning Note (2026-04-04):** Re-analyze the current AWS deployment model, GitHub Actions support, ECS task-definition strategy, and private-network requirements before reopening this plan. This is a future alternative, not the active migration architecture.

## Purpose

Capture the optional future path of moving database migration execution from one-off ECS tasks to GitHub Actions jobs backed by AWS CodeBuild managed self-hosted runners inside the VPC.

This plan is deferred because the current recommended path is to keep migrations on ECS and harden that flow first.

## Why This Is Deferred

The current problem is not that ECS-based migrations are inherently the wrong pattern.

The current problem is:

- mutable `:latest` deploys
- weak rollout verification
- insufficient rollout diagnostics
- conflated CI naming between migration and rollout phases

Those should be fixed before considering a platform change.

## When To Reopen This

Reopen this plan only if one or more of these become true:

- ECS migration tasks become operationally burdensome
- GitHub-native job execution inside the VPC would materially simplify deployment
- the team wants GitHub Actions jobs themselves to run against private AWS resources without piggybacking on ECS
- ECS migrate/seed tasks remain awkward even after immutable-task-definition hardening

## Future Direction

Potential future architecture:

- run selected GitHub Actions jobs on AWS CodeBuild managed self-hosted runners
- place those runners inside the VPC with private RDS access
- run migration commands directly in those jobs instead of invoking ECS `run-task`
- keep app rollout verification separate from migration execution

## Constraints

- Do not expose private RDS directly to GitHub-hosted runners.
- Do not reopen this plan just to work around current ECS rollout bugs.
- If adopted, compare it against the hardened ECS approach first.
- Preserve the same contract boundaries:
  - migration
  - seed
  - rollout verification
  - smoke/E2E gating

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| CBM-001 | Research | Evaluate AWS CodeBuild managed self-hosted GitHub runners inside the VPC | Deferred | Compare operational complexity against the hardened ECS migration path |
| CBM-002 | Network | Define how the runner would access private RDS and Secrets Manager safely | Deferred | Keep RDS private; do not broaden ingress just for CI |
| CBM-003 | Workflow | Design a GitHub Actions job that runs migrate/seed from CodeBuild-backed runners | Deferred | Keep rollout verification separate from migration execution |
| CBM-004 | IAM | Define least-privilege IAM for CodeBuild-based migration execution | Deferred | Include DB secret access, CloudWatch, and any artifact pulls needed |
| CBM-005 | Comparison | Compare ECS task-based migrations vs CodeBuild-based migrations after ECS hardening is complete | Deferred | Reopen only if CodeBuild is materially better, not just different |

## Acceptance Criteria

- A future team can evaluate CodeBuild without rediscovering the question from scratch.
- The plan makes clear that ECS remains the active migration architecture today.
- The alternative remains explicitly deferred until the ECS path is hardened and reassessed.
