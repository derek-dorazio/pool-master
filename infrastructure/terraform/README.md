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

## The ALB Admits CloudFront Only

The ALB security group accepts port 80 from CloudFront's origin-facing prefix list
(`com.amazonaws.global.cloudfront.origin-facing`) and nothing else, so the API is reached through
CloudFront. That list covers every CloudFront distribution, other AWS accounts' included; a
distribution cannot forge the `X-Forwarded-For` entry its own edge appends, so the caller address
below stays honest, and a secret origin header checked by the ALB would close the rest (#860).
core-api relies on this: `TRUSTED_PROXY_HOPS = 2` and `TRUSTED_PROXY_NETWORK = var.vpc_cidr` make
it believe the `X-Forwarded-For` entry the ALB adds, so `request.ip`, which the per-address rate
limits key on, is the real caller (#856). Opening the ALB to anything else would let a caller pick
that address. The prefix list counts as about 55 rules against the group's quota of 60, so keep
it to one rule.

## How Terraform's Task Definition Env Reaches the Service

The ECS services ignore task definition changes (`ignore_changes = [task_definition]`), because
CI deploys every image. The deploy builds each new core-api revision from the family's **latest**
revision and overrides only the image, `NODE_ENV`, `LOG_LEVEL` and `POOLMASTER_ENVIRONMENT`. So a
`terraform apply` that changes core-api's env (for example the SES or `TRUSTED_PROXY_*`
variables) registers a newer revision, and the next deploy (any merge to `main`) carries that env
to the running service. Nothing reaches the service until that deploy.

## Direct QA Database Access

Terraform can also model intentionally approved direct PostgreSQL access when QA operators need it.

- `db_publicly_accessible` controls whether the RDS instance should expose a public endpoint.
- `db_allowed_cidr_blocks` is the allow-list of approved direct client CIDRs for PostgreSQL access.
- Keep both disabled by default and only enable them explicitly in local `envs/*.tfvars` files for environments where that access is truly intended.

## System email (SES)

Terraform owns the SES side of system email for each environment: the sending domain identity
(`qa.<domain_name>` on QA, the bare domain on prod), Easy DKIM, the custom MAIL FROM domain
`bounce.<sending domain>`, SPF and DMARC records in Route 53, and a configuration set that
suppresses addresses that bounced or complained. `docs/EMAIL-DELIVERY.md` describes what each
one is for.

One apply creates all of it. The DKIM CNAMEs are created with a count of three (Easy DKIM always
issues three tokens), so the old two-pass `-target` apply (#120) is no longer needed.

Set `dmarc_report_email` in the environment tfvars to receive DMARC aggregate reports. Leave it
empty to publish DMARC without reports.

After the first apply, by hand in the AWS console (SES, in the environment's region):

1. **Check the identity.** Identities → the sending domain should show DKIM *Successful* and MAIL
   FROM *Successful* within an hour of the records appearing.
2. **Leave the sandbox** (once per AWS account and region). Account dashboard → Request
   production access: mail type *Transactional*, the site URL, and a short description: members
   of office pools get invitations, entry receipts and contest updates; bounces and complaints
   are suppressed through the account suppression list and the app's own records; members can
   turn off notification emails, and smoke users at reserved domains are never emailed. AWS
   usually answers within a day.
3. **Until then**, verify a few tester addresses under Identities, since a sandbox account sends
   only to verified addresses (200 a day, one a second).
4. **Turn email on** from the app, not Terraform: `/manage/settings` → Email. On QA, fill in
   "Only send to" first (`docs/EMAIL-DELIVERY.md`, *Testing on QA Without Emailing Real People*).

### Delivery events (bounces and complaints)

The configuration set publishes delivery, bounce, complaint and reject events to the SNS topic
`<name prefix>-ses-events`, and core-api receives them at `/api/v1/email/ses-events` (it learns the
topic from `SES_EVENTS_TOPIC_ARN`). SNS confirms an https subscription once, when it is created,
and core-api can only answer once its running task has that variable, so subscribing takes two
applies:

1. **Apply with `ses_events_subscribed = false`** (the default). This creates the topic and the
   event destination and adds `SES_EVENTS_TOPIC_ARN` to the core-api task definition.
2. **Let CI deploy core-api** (the next merge to `main`), so the running task has the variable.
3. **Set `ses_events_subscribed = true` and apply again.** SNS posts a confirmation and core-api
   confirms it; the apply waits for that and fails if it doesn't come within a minute. If it
   fails, check core-api's log for `email.deliveryEvent.unverified`, then apply again to send
   another confirmation.

Until step 3, SES still sends; the app just doesn't hear about bounces, and the account
suppression list still stops repeat sends to a bad address.

