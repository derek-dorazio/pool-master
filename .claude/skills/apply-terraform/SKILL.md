---
name: apply-terraform
description: Applying a change under infrastructure/terraform to a PoolMaster environment — the copy-paste steps the repo owner runs on their Mac (init, reuse the existing secrets, plan, check the plan, apply, delete the plan) and the post-check that proves the change landed. Use when a merged or ready Terraform change needs applying, or when an apply went wrong.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash]
---

# Applying Terraform

Only the repo owner applies, from their own machine; an agent session has no AWS credentials
and CI never applies. So this skill has two readers: the agent, who writes the steps and
reads back what the owner pastes, and the owner, who runs them. The policy is
`rules/workflow-rules.md` §6 *Applying Terraform*; `infrastructure/terraform/README.md` has
what each resource is for.

## Step 1 — before handing over steps

- **Know what the plan should show.** List the resources the change adds, changes or
  destroys, by address (`aws_iam_role_policy.ecs_task_ses_send`, not "the SES policy"). That
  list is what the owner checks the plan against in step 4, so it goes in the hand-over.
- **Pick the checkout.** Normally `main` after the PR merges. If the change has to be applied
  before merging (a deploy in the same PR needs the resource), rebase the branch onto current
  `main` and push it first. A branch that lacks a change another branch already applied
  reverts that change.
- **Say what needs a deploy.** An IAM, DNS, SES, security-group or S3 change is live when the
  apply finishes. A core-api environment change only registers a new task definition
  revision; the running service picks it up on the next deploy, which is the next merge to
  `main` (or a re-run of the latest deploy). A change that needs a second apply after a
  deploy, like `ses_events_subscribed`, says so and gives both rounds.

## Step 2 — the hand-over message

Give the owner one message they can follow on a phone and paste from on a Mac: the purpose
in a sentence, the expected plan from step 1, then the commands below with `<env>`
filled in (`qa`, `staging` or `prod`) and only the steps this change needs. Every block is
copy-paste as is: no placeholders left for the owner to edit, no prose inside a block, one
block per step. End with what to paste back: the plan's summary line and any resource it
lists that the expected list does not.

```bash
# 1. Up-to-date checkout (run from the pool-master folder)
git checkout main && git pull --ff-only
cd infrastructure/terraform

# 2. Point at the environment's state
terraform init -reconfigure -backend-config=envs/qa.backend.hcl

# 3. Reuse the existing JWT secret (a new one signs everyone out)
export TF_VAR_jwt_secret="$(aws secretsmanager get-secret-value --region us-east-2 \
  --secret-id poolmaster-qa-jwt-secret --query SecretString --output text)"

# 3b. Only when envs/<env>.tfvars does not set db_password (staging, prod):
#     reuse the password already in core-api's DATABASE_URL
export TF_VAR_db_password="$(aws ecs describe-task-definition --region us-east-2 \
  --task-definition poolmaster-qa-core-api \
  --query "taskDefinition.containerDefinitions[?name=='core-api'] | [0].environment[?name=='DATABASE_URL'] | [0].value" \
  --output text | sed -E 's#^postgresql://[^:]*:(.*)@[^@]*$#\1#')"

# 4. Plan into a file, and read it
terraform plan -var-file=envs/qa.tfvars -out=qa.plan

# 5. Apply exactly that plan, then delete it
terraform apply qa.plan
rm qa.plan
```

`-reconfigure` switches cleanly to this environment's state. Without it, an init after
working on another environment stops with "Backend configuration changed" and offers to
migrate state; migrating would copy one environment's state over another's, so the answer
there is always no.

## Step 3 — secrets

Both secrets keep the values the environment already has (`rules/workflow-rules.md` §6
*Applying Terraform*). Neither is in a committed file.

- **`jwt_secret`** — read from Secrets Manager, `poolmaster-<env>-jwt-secret`, as in step 3
  of the hand-over.
- **`db_password`** — the owner's local, git-ignored `envs/<env>.tfvars` holds it for QA. A
  value there beats `TF_VAR_db_password`, so do not also export one. Staging and prod follow
  their `*.tfvars.example` and keep it out of tfvars, so their hand-over includes step 3b,
  which reads it from `DATABASE_URL` in the latest `poolmaster-<env>-core-api` task
  definition.

The one exception is an environment's very first apply (prod, when it is first built): no
secret exists yet, so that apply creates both. Generate `jwt_secret` with
`openssl rand -base64 48 | tr -d '\n'`, choose `db_password`, export both as `TF_VAR_*`,
and store them in the owner's password manager before applying. Every later apply reuses
them.

If `terraform plan` stops to prompt for a variable, a secret is missing: cancel with
Ctrl-C, never type a new value at the prompt.

## Step 4 — check the plan before applying

The plan ends with `Plan: N to add, M to change, K to destroy`. It is right only when every
resource it lists is on the expected list. Stop, do not apply, and have the owner paste the
plan's resource lines when:

- a resource is listed that the change never touched: someone's applied change is not on
  this checkout, or the state drifted (a console edit). Find which before going on;
- anything is replaced (`-/+`) or destroyed that the change did not mean to;
- `aws_db_instance` shows a password change, or `aws_secretsmanager_secret_version.jwt_secret`
  changes: a secret was not reused (step 3);
- an ECS service shows a task definition change: the services ignore task definition
  changes, so this means the configuration changed under them.

A new core-api task definition revision is expected whenever core-api's environment changes.

## Step 5 — after the apply

1. `rm <env>.plan`. The plan file holds every secret in plain text; `*.plan` is git-ignored
   so it is never committed, but it should not sit on disk either.
2. **Post-check the effect**, not the exit code. Write a check for the change into the
   hand-over, for example:
   - IAM policy: `aws iam get-role-policy --role-name poolmaster-<env>-ecs-task --policy-name poolmaster-<env>-ses-send`
     shows the new statement, or the feature that needed it now works;
   - core-api environment: after the next deploy, the running task's definition carries the
     variable (`aws ecs describe-task-definition --region us-east-2 --task-definition poolmaster-<env>-core-api`);
   - DNS or SES: the record resolves (`dig`), or the SES identity shows the expected status;
   - a second `terraform plan -var-file=envs/<env>.tfvars` says `No changes.`
3. Close the loop on the issue or PR: what was applied, when, to which environment, and the
   post-check result.

## When an apply fails part way

Terraform records what it did create, so the fix is to correct the cause and run steps 4–5
again from a fresh plan; never edit state by hand. A failure that names a resource the
change did not touch is the drift case in step 4, and the same stop applies.
