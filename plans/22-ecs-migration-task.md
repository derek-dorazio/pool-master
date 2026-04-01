# Plan 22: ECS Migration Task — Run Prisma Migrations from Within the VPC

## Problem

The `migrate-qa` CI job tries to run `prisma migrate deploy` directly from the GitHub Actions runner against an RDS instance in a private VPC subnet. This always fails (`P1001: Can't reach database server`) because there's no network path from GitHub's hosted runners to the private subnet.

## Solution

Run migrations inside an ECS Fargate task within the same VPC, triggered by CI via `aws ecs run-task`.

```
Current (broken):   GitHub Runner --> (public internet) --> RDS (private subnet) = BLOCKED
Proposed:           GitHub Runner --> aws ecs run-task --> ECS Fargate (private subnet) --> RDS = WORKS
```

## Design Decisions

- **Reuse core-api image** — The Dockerfile already copies `prisma/` into the runtime stage and generates the Prisma client at build time. The ECS task definition simply overrides the container `CMD` to run `prisma migrate deploy` instead of starting the Fastify server. No separate image or ECR repo needed.
- **No new security group** — The existing `aws_security_group.database` already allows inbound 5432 from `aws_security_group.ecs_tasks`. The migration task uses `ecs_tasks` SG and inherits RDS access.
- **NAT Gateway already exists** — Private subnets route through `aws_nat_gateway.main`, so the Fargate task can pull images from ECR and write logs to CloudWatch.

## Action Plan

| ID | Phase | Task | Owner | Status | Notes |
|---|---|---|---|---|---|
| 22-001 | 1 | Add ECS task definition for migration runner in `main.tf` | Agent | Done | Fargate, 256 CPU / 512 MiB, reuse existing execution/task roles, override CMD to `prisma migrate deploy` |
| 22-002 | 1 | Add CloudWatch log group for migration task | Agent | Done | `/ecs/poolmaster-{env}/migrate` with 7-day retention |
| 22-003 | 1 | Add Terraform outputs for migration task definition ARN and family | Agent | Done | `migrate_task_definition_family` and `migrate_task_definition_arn` |
| 22-004 | 2 | Update IAM policy for `poolmaster-github-deploy` | Derek | Done | Added `ecs:RunTask`, `ecs:DescribeTasks`, `iam:PassRole`, `logs:GetLogEvents` scoped to migration resources |
| 22-005 | 3 | Replace `migrate-qa` job in `ci.yml` with `aws ecs run-task` + poll | Agent | Done | Gracefully skips if secrets not set; polls every 15s with 10min timeout; streams logs on failure |
| 22-006 | 3 | Add `QA_PRIVATE_SUBNETS` and `QA_ECS_SECURITY_GROUP` GitHub secrets | Agent | Done | `QA_PRIVATE_SUBNETS=subnet-0d1831e28633548a8,subnet-0debf0f4db219cdc5`, `QA_ECS_SECURITY_GROUP=sg-02a2fbb240133436d` |
| 22-007 | 4 | Test end-to-end by pushing a commit with a migration | Derek | Todo | Verify task runs, exits 0, smoke tests pass |

---

## Phase 1: Terraform Resources

### 22-001: ECS Task Definition

Add to `infrastructure/terraform/main.tf` after the existing core-api task definition:

```hcl
# ---------- Migration Task Definition ----------
resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name_prefix}/migrate"
  retention_in_days = var.environment == "prod" ? 30 : 7
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${aws_ecr_repository.services["core-api"].repository_url}:latest"
      essential = true
      command   = ["npx", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
      environment = [
        { name = "DATABASE_URL", value = local.db_url }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.migrate.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}
```

### 22-003: Terraform Outputs

Add to `infrastructure/terraform/outputs.tf`:

```hcl
output "migrate_task_definition_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "migrate_task_definition_arn" {
  value = aws_ecs_task_definition.migrate.arn
}
```

---

## Phase 2: IAM Policy Update

### 22-004: IAM Policy for `poolmaster-github-deploy`

Add these permissions (scoped to migration resources):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RunMigrationTask",
      "Effect": "Allow",
      "Action": ["ecs:RunTask", "ecs:DescribeTasks"],
      "Resource": [
        "arn:aws:ecs:us-east-2:614049083306:task-definition/poolmaster-qa-migrate:*",
        "arn:aws:ecs:us-east-2:614049083306:task/poolmaster-qa-cluster/*"
      ]
    },
    {
      "Sid": "PassRoleForECSTask",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::614049083306:role/poolmaster-qa-ecs-execution",
        "arn:aws:iam::614049083306:role/poolmaster-qa-ecs-task"
      ]
    },
    {
      "Sid": "ReadMigrationLogs",
      "Effect": "Allow",
      "Action": ["logs:GetLogEvents", "logs:FilterLogEvents"],
      "Resource": "arn:aws:logs:us-east-2:614049083306:log-group:/ecs/poolmaster-qa/migrate:*"
    }
  ]
}
```

The `iam:PassRole` is required because `ecs:RunTask` specifies which roles the task assumes.

---

## Phase 3: GitHub Actions CI Update

### 22-005: Replace `migrate-qa` Job

Replace the current `migrate-qa` job in `.github/workflows/ci.yml`:

```yaml
migrate-qa:
  runs-on: ubuntu-latest
  needs: publish-images
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  steps:
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ env.AWS_REGION }}

    - name: Run ECS migration task
      id: run-migration
      run: |
        TASK_ARN=$(aws ecs run-task \
          --cluster poolmaster-qa-cluster \
          --task-definition poolmaster-qa-migrate \
          --launch-type FARGATE \
          --network-configuration "awsvpcConfiguration={subnets=[${{ secrets.QA_PRIVATE_SUBNETS }}],securityGroups=[${{ secrets.QA_ECS_SECURITY_GROUP }}],assignPublicIp=DISABLED}" \
          --query 'tasks[0].taskArn' \
          --output text)

        if [ "$TASK_ARN" = "None" ] || [ -z "$TASK_ARN" ]; then
          echo "Failed to start migration task"
          exit 1
        fi

        echo "task_arn=${TASK_ARN}" >> $GITHUB_OUTPUT
        echo "Migration task started: ${TASK_ARN}"

    - name: Wait for migration to complete
      run: |
        TASK_ARN="${{ steps.run-migration.outputs.task_arn }}"
        CLUSTER="poolmaster-qa-cluster"

        echo "Waiting for migration task to complete..."
        for i in $(seq 1 40); do
          STATUS=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASK_ARN \
            --query 'tasks[0].lastStatus' --output text)
          echo "  Status: $STATUS (attempt $i/40)"

          if [ "$STATUS" = "STOPPED" ]; then
            EXIT_CODE=$(aws ecs describe-tasks --cluster $CLUSTER --tasks $TASK_ARN \
              --query 'tasks[0].containers[0].exitCode' --output text)

            if [ "$EXIT_CODE" = "0" ]; then
              echo "✅ Migration completed successfully"
              exit 0
            else
              echo "❌ Migration failed with exit code: $EXIT_CODE"
              TASK_ID=$(echo $TASK_ARN | awk -F'/' '{print $NF}')
              aws logs get-log-events \
                --log-group-name /ecs/poolmaster-qa/migrate \
                --log-stream-name "ecs/migrate/${TASK_ID}" \
                --query 'events[].message' --output text 2>/dev/null || true
              exit 1
            fi
          fi

          sleep 15
        done

        echo "Migration task timed out after 10 minutes"
        exit 1
```

### 22-006: GitHub Secrets

Set after `terraform apply`:
- `QA_PRIVATE_SUBNETS` — comma-separated subnet IDs from `terraform output private_subnet_ids`
- `QA_ECS_SECURITY_GROUP` — SG ID from `terraform output ecs_security_group_id`

---

## Phase 4: Validation

### 22-007: End-to-End Test

1. `terraform apply -var-file=envs/qa.tfvars` — creates the migration task definition
2. `aws ecs describe-task-definition --task-definition poolmaster-qa-migrate` — verify it exists
3. Push a commit to `main` with a schema change
4. Watch CI: `migrate-qa` should start the ECS task, poll until success, then `smoke-test` passes
5. Verify the new column/table exists in QA RDS

---

## Rollback Strategy

- Migration task exits non-zero → CI reports failure, `smoke-test` is skipped
- Prisma `migrate deploy` is transactional per migration file — partial migrations are rolled back
- The existing core-api service continues on the previous schema

**Future improvement:** Reorder pipeline so migrations run _before_ service deployment (currently deploy happens first in `publish-images`).

---

## Files to Modify

| File | Change |
|---|---|
| `infrastructure/terraform/main.tf` | Add `aws_ecs_task_definition.migrate` + `aws_cloudwatch_log_group.migrate` |
| `infrastructure/terraform/outputs.tf` | Add migration task definition outputs |
| `.github/workflows/ci.yml` | Replace `migrate-qa` job with `aws ecs run-task` + polling |
| AWS Console / Terraform | Update `poolmaster-github-deploy` IAM policy |
