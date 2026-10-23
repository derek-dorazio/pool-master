# Production environment

**Tracking issue:** #917

**Status:** design decided 2026-10-23; implementation on hold until Derek wants prod.

Written 2026-10-23 for Derek's ask: a plan for creating a production instance of Poolmaster. Today
only QA exists (https://qa.ultimateofficepoolmanager.com, us-east-2, redeployed on every merge to
`main`); the bare domain serves nothing. This plan covers the Terraform environment, the domain
and certificates, the SES sending domain, secrets, how a release reaches prod, backups,
monitoring, cost and how prod gets its data. It changes no infrastructure. The open questions
are in section 12, each with a recommendation. Derek accepted every recommendation on
2026-10-23, so sections 1 to 11 describe the decided design.

---

## TL;DR

- **Most of prod is already written.** The Terraform takes `environment = "prod"` and already
  gives prod no hostname prefix, Multi-AZ RDS with deletion protection and a final snapshot, two
  core-api tasks, 30-day logs, a bare-domain SES identity and no mock provider. There is a
  `prod.tfvars.example`, a `prod` state key, and a `Deploy to Environment` workflow that promotes
  a QA image.
- **The deploy workflow is not safe to use as it is.** It never runs migrations, never ships the
  webapp, and checks the rollout far less than QA's deploy does. It has to be rewritten before
  the first prod deploy (section 5).
- **A handful of Terraform fixes come first:** the database password sits in plain task
  definition env, alarms go to an SNS topic nobody subscribes to, an unused admin CloudFront
  distribution would publish `prod-admin.<domain>`, and `www.` goes nowhere (section 2).
- **Prod deploys only when Derek presses the button.** QA stays auto-deployed; prod promotes a
  commit QA has already run, with a GitHub approval, a snapshot before migrations, and a
  read-only smoke check after.
- **No staging.** QA plays that part (question 1).
- **About $140 a month to start**, about $170 with Multi-AZ (section 10).
- **Prod data:** reference data arrives through migrations on the first deploy; the root admin
  is created once; real schedules and fields go in through the admin API. No test data, and
  nothing is ever copied from QA.

---

## 1. What exists today

| Piece | QA today | What the Terraform already does for prod |
|---|---|---|
| Hostname | `qa.<domain>`, admin `qa-admin.<domain>` | `<domain>`, admin `prod-admin.<domain>` |
| Network | VPC, 2 public + 2 private subnets, one NAT gateway | same, separate VPC |
| core-api | 1 Fargate task, 0.25 vCPU / 512 MB | 2 tasks, 0.5 vCPU / 1 GB (`prod.tfvars.example`) |
| Database | `db.t3.micro`, 20 GB, single-AZ, 1-day backups, public endpoint allow-listed | `db.t3.small`, 50 GB, Multi-AZ, 7-day backups, deletion protection, final snapshot, private only |
| Webapp | S3 + CloudFront, release prefixes, `index.html` flipped per deploy | same, separate bucket and distribution |
| Email | SES identity `qa.<domain>`, sandbox, "Only send to" list | identity on the bare domain, same configuration set and SNS events |
| Secrets | JWT in Secrets Manager; DB password inside `DATABASE_URL` env | same |
| Alarms | 7 CloudWatch alarms to SNS topic `poolmaster-qa-alerts` (no subscriber) | same |
| Logs | 7 days | 30 days |
| Mock sports feed | yes | no |
| Deploy | CI on every `main` push: images, migrate task, rollout with checks, webapp, browser smoke | `deploy.yml` (manual): image promotion and core-api rollout only |

Two things the app already does that matter for running two tasks: the email outbox's sender
claims rows so two tasks never send the same email, and the 5-minute event lifecycle sweep
relies on the outbox's idempotency key. Rate limits are per task, so two tasks double the
effective limit, which their callers accept. QA has never run two tasks, so slice P1 sets QA to
two tasks for a few days to prove it before prod depends on it.

## 2. Terraform

Prod uses the same root module with `envs/prod.backend.hcl` (state key `prod/terraform.tfstate`
in the existing state bucket and lock table) and an untracked `envs/prod.tfvars` copied from the
example. Changes before the first apply, all in one PR (slice P1), each behaving the same on QA
unless it says otherwise:

1. **`DATABASE_URL` as a secret.** Today the password is in the task definition's plain env,
   readable by anyone who can describe a task definition and copied into every revision CI
   registers. Store the full URL in a Secrets Manager secret (`<prefix>-database-url`) and pass it
   through `secrets` / `valueFrom` on core-api and migrate, the way `JWT_SECRET` already works.
   The deploy jobs copy the latest revision, so the change carries through on the next deploy.
   **The master password moves out of tfvars too.** Terraform generates it (`random_password`, 32
   characters) and keeps it in a Secrets Manager secret (`<prefix>-db-password`) that the URL
   secret is built from, so `TF_VAR_db_password` and the `db_password` variable go away and
   nobody types or stores it. QA's current password is weak and lives in a local tfvars file, so
   the same apply rotates QA's to a generated one; the next QA deploy picks up the new URL.
2. **`db_multi_az` and `db_backup_retention_days` variables** in place of the hard-coded
   `environment == "prod"` checks, so question 2 is one line in tfvars. Prod: 14 days of
   backups. Deletion protection and the final snapshot stay prod-only.
3. **`db_instance_class` default `db.t4g.small` for prod** (Graviton, about 10% cheaper than t3
   for the same size). Postgres 16 stays.
4. **`alarm_email` variable** that subscribes an address to the alerts topic, plus the new
   alarms in section 8 and an AWS Budgets alert.
5. **Remove the admin bucket and distribution.** There is no admin client: the root admin
   screens live under `/manage` in the webapp, and no workflow deploys to the admin bucket. On
   prod it would publish an empty `prod-admin.<domain>`. Removing it from QA too (same PR)
   deletes `qa-admin.<domain>`, which serves nothing today.
6. **`www.<domain>` redirects to `<domain>`** (prod only): a second alias on the webapp
   distribution and a CloudFront function that answers 301 for the `www` host. The wildcard
   certificate already covers `www`.
7. **`core_api_desired_count` variable** (prod 2, QA 2 for the proving period, then back to 1).
8. **The QA reset script refuses any database that is not QA.** It ships in the same image prod
   runs; today only the `--confirm-qa-reset` flag stops it. It should also read the target's
   `POOLMASTER_ENVIRONMENT` and stop unless it is `qa`.
9. **Fill `prod.tfvars.example`:** `core_api_log_level = "info"`, `dmarc_report_email`,
   `alarm_email`, `ses_events_subscribed = false`, the variables above.

`db_publicly_accessible` stays `false` on prod; question 5 covers how Derek reaches it.

## 3. Domain, DNS and certificates

The Route 53 zone `ultimateofficepoolmanager.com` already exists and QA's records live in it.
Prod's apply adds, in the same zone:

- `ultimateofficepoolmanager.com` and `www.` → the prod webapp distribution (alias records).
- Its own `*.<domain>` + `<domain>` ACM certificate in us-east-1 for CloudFront. Each
  environment's state already creates one; the DNS validation CNAME is the same for both and the
  record uses `allow_overwrite`, so QA's validation keeps working.
- The SES records in section 4.

Before the apply, list the zone's records to confirm nothing already sits on the bare domain,
`www`, `_dmarc` or `bounce` (`aws route53 list-resource-record-sets --hosted-zone-id
Z020704038X1AEGE6QNM9`). The registrar must point at Route 53's name servers, which QA proves.

## 4. Email (SES)

- **Identity:** the bare domain, `noreply@ultimateofficepoolmanager.com`, with Easy DKIM, MAIL FROM
  `bounce.<domain>`, and DMARC on `_dmarc.<domain>`. One apply creates them; DKIM shows
  *Successful* within the hour.
- **DMARC** starts at `p=none` with reports to `dmarc_report_email`. After about four weeks of
  clean reports, move to `p=quarantine` (a one-line Terraform change). QA's subdomain has its own
  `_dmarc` record, so it is unaffected.
- **Sandbox:** production access is account-wide per region, and the request for us-east-2 is
  already pending. Once AWS grants it, prod can email anyone; until then prod can only send to
  verified addresses, which is fine for the soft launch.
- **Bounce and complaint events** take the documented two applies: apply with
  `ses_events_subscribed = false`, deploy, then set it `true` and apply again.
- **Turn email on in the app**, prod's `/manage/settings` → Email, with "Only send to" empty.
  App settings live in prod's own database, so every settings group starts at the code defaults
  and is reviewed once at launch (section 9).

## 5. Release and deploy flow

QA keeps deploying on every merge. Prod gets a rewritten **Deploy to production** workflow
(slice P2), started by hand from GitHub Actions:

1. **Input:** a commit SHA, defaulting to the one QA is running now (read from QA's `/version`
   inside the job, or the last green `main` run). The job refuses a SHA whose `main` run did not
   pass `deploy-qa` and the QA browser smoke, so prod only ever gets what QA has run.
2. **Approval:** the job runs in a GitHub Environment `prod` with Derek as required reviewer, and
   the job summary lists the PRs merged since the SHA prod is on, so the approval screen says
   what is shipping.
3. **Promote the image** from QA's ECR repository to prod's by digest, not rebuilt, so prod runs
   the bytes QA tested.
4. **Snapshot the database** (`aws rds create-db-snapshot`, wait for available) when the release
   brings new migrations. About two minutes on a small database.
5. **Run the migrate task** and wait for it, as `deploy-migrate-qa` does, using the existing
   `ecs-task-wait-and-print-logs.mjs`. A failed migration stops the deploy before any rollout.
6. **Roll out core-api** with the same checks `deploy-qa` has: the service reports the new task
   definition, rollout state `COMPLETED`, and the diagnostics dump on failure.
7. **Build the webapp at the same SHA** with `POOLMASTER_ENVIRONMENT=prod` and `VITE_LOG_LEVEL=info`,
   upload it to a release prefix in the prod bucket, flip `index.html`, invalidate CloudFront.
   The webapp bakes its environment in at build time, so it cannot be promoted from QA's bucket.
8. **Smoke prod read-only:** `/api/health`, `/version` returns the deployed SHA, the home page
   and sign-in page load. QA's `@smoke` journey creates and deletes leagues and users, so it
   never runs against prod.

**Credentials.** CI uses one long-lived access key for QA. The prod job should instead assume a
prod-only IAM role through GitHub OIDC, trusted only for the `prod` environment, so a QA job or a
pull request cannot touch prod. Part of slice P2.

**Rollback.** Re-run the workflow with the previous SHA. That is safe as long as migrations stay
additive (add first, remove in a later release), which is already how the repo writes them. If a
migration itself is the problem, restore the snapshot from step 4 (section 7).

**Hotfix.** A fix still merges to `main`, deploys to QA, then goes to prod with the same button.
No release branches.

## 6. Secrets

| Secret | Where it lives | Notes |
|---|---|---|
| `jwt_secret` | Secrets Manager `poolmaster-prod-jwt-secret` | New random value (`openssl rand -base64 48`), never QA's. Changing it signs everyone out. |
| DB master password | Secrets Manager `poolmaster-prod-db-password`, and inside `poolmaster-prod-database-url` | Generated by Terraform; never typed, never in tfvars. |
| JWT, for future applies | Derek's password manager | Every prod apply needs `TF_VAR_jwt_secret` set to the existing value. |
| Root admin password | set once at bootstrap, then changed in the app | Never committed, unlike QA's fixture. |
| CI | GitHub `prod` environment: OIDC role ARN only | No prod keys or passwords in GitHub. |

Terraform state holds these values too; the state bucket is already encrypted and private.

## 7. Database backups and restore

- **Automated backups with point-in-time restore**, kept 14 days (free up to the database's
  size). Restore to any second in that window.
- **A manual snapshot before every deploy that migrates** (section 5); kept until the next one,
  so the last two are always there.
- **Deletion protection and a final snapshot** on destroy (already in Terraform).
- **One restore drill before launch:** restore to a new instance from point in time, connect,
  count rows, delete it. Written up as a short runbook in `docs/`.
- **No cross-region copy for now.** It protects against losing all of us-east-2, which is not a
  risk worth the cost at this size; it is a one-resource addition later.

## 8. Monitoring

Existing alarms (ALB 5xx, latency, ECS CPU and memory, RDS CPU, storage, connections) stay, now
with Derek's address subscribed. Add:

- **Uptime:** a Route 53 health check on `https://<domain>/api/health` every 30 seconds, alarming
  after 3 failures. It also catches CloudFront and DNS problems the ALB alarms cannot see.
- **Running tasks below desired** for 5 minutes (ECS service).
- **ALB unhealthy hosts > 0** for 5 minutes.
- **RDS CPU credit balance low** (t-class instances throttle when it runs out).
- **SES reputation:** bounce rate above 2% and complaint rate above 0.05%, well under the 5% and
  0.1% where AWS starts reviewing the account.
- **Email outbox failures:** a log metric filter on the sender's failed-send log line, alarming
  on more than 5 in an hour.
- **AWS Budgets:** email at 80% and 100% of the monthly budget (question 7).

Logs stay in CloudWatch for 30 days; the Logs Insights queries in `docs/LOGGING-OPERATIONS.md`
work on prod by swapping the log group. A third-party error tracker is out of scope.

## 9. Data and launch

**Reference data** (sports, sport leagues, contest templates, defaults) is in migrations, so the
first deploy's migrate task creates it. Nothing else is loaded automatically.

**Root admin:** a one-time run of `bootstrap-users.mjs` against prod with a single account and a
password from a workflow input that is masked in the log (slice P3). Derek changes it on first
sign-in. No test users.

**Sport schedules and fields:** real, current-season data files from the `load-sport-data` skill,
loaded through prod's admin API by the `Load sport data` workflow with a `prod` target added
(slice P3). On prod it refuses test data files, `all_test_data`, test slates and
`with_participants`; dry run stays the default, and apply runs on Derek's yes. Admins can also
enter events on the Manage screens. QA's database is never copied to prod.

**App settings:** go through every group on `/manage/settings` once (email on, sender name,
rates, notification defaults), since prod starts from code defaults.

**Launch order:**

1. Merge P1 (Terraform) and P2 (deploy workflow); P3 and P4 can follow before data loading.
2. Derek runs `terraform init -backend-config=envs/prod.backend.hcl` and `terraform apply
   -var-file=envs/prod.tfvars` with a new `TF_VAR_jwt_secret` set. This is the step that starts the bill.
3. Push a bootstrap image tag to prod's ECR (the README's bootstrap step), so the first service
   can start.
4. Run Deploy to production with QA's current SHA: migrations create the reference data.
5. Bootstrap the root admin, review settings, load the current season's sport data.
6. SES second apply (`ses_events_subscribed = true`).
7. Restore drill; check every alarm has a confirmed email subscription.
8. Soft launch: Derek's own league, a few invited friends. Open signups once question 6's items
   are in.

## 10. Cost

On-demand us-east-2 prices, per month, before taxes; traffic at launch is small enough that data
transfer, CloudFront, S3, SES and Route 53 queries come to a few dollars.

| Item | Single-AZ start | With Multi-AZ |
|---|---|---|
| RDS `db.t4g.small` + 50 GB gp3 | ~$30 | ~$60 |
| Fargate, 2 tasks × 0.5 vCPU / 1 GB | ~$36 | ~$36 |
| NAT gateway (hourly + small data) | ~$35 | ~$35 |
| Application Load Balancer | ~$18 | ~$18 |
| Public IPv4 (NAT, ALB) | ~$11 | ~$11 |
| CloudWatch logs, Container Insights, alarms, health check | ~$8 | ~$8 |
| Secrets Manager, KMS, S3, CloudFront, SES, backups | ~$4 | ~$4 |
| **Total** | **~$140** | **~$170** |

QA's bill is unchanged apart from a few days at two tasks (about $9 a month while it lasts). The
biggest fixed cost after the database is the NAT gateway; replacing it with VPC endpoints or
public-subnet tasks saves about $35 a month in each environment, a later ticket if the bill
matters.

## 11. Slices

- **P1 Terraform readiness:** section 2 items 1 to 9 and section 8's alarms. QA applied and
  proved at two tasks; no prod apply yet.
- **P2 Deploy to production workflow:** section 5, OIDC role, the GitHub `prod` environment,
  removal of `staging` from the workflow (question 1).
- **P3 Prod data tools:** bootstrap the root admin on prod; `Load sport data` prod target with
  its refusals.
- **P4 Runbook:** `docs/` page for applying prod, deploying, rolling back, restoring and the
  restore drill; Terraform README updated.
- **Launch:** section 9's order, run by Derek with a thread alongside.

---

## 12. Questions (answered 2026-10-23: every recommendation accepted)

1. **Staging environment?** The Terraform and workflows mention one that has never existed.
   *Recommendation:* no staging. QA already runs every commit before prod gets it, and a third
   environment costs about $90 a month to sit idle. Remove `staging` from the deploy workflow and
   delete `staging.tfvars.example` and its backend file.
2. **Database: single-AZ or Multi-AZ at launch?** Multi-AZ keeps the site up through an AWS
   zone failure (a minute of failover) and doubles the database cost (~$30 more a month).
   *Recommendation:* single-AZ with 14-day point-in-time restore at launch; turn on Multi-AZ
   (one tfvars line, no downtime) once leagues outside friends and family depend on it.
3. **How do releases reach prod?** *Recommendation:* Derek presses Deploy to production in
   GitHub Actions and approves it, as often as he likes, defaulting to whatever QA runs. The
   alternative, an automatic nightly promotion of QA's last green commit, removes a step but
   ships things nobody looked at on QA.
4. **Which address gets alarms and budget emails?** *Recommendation:* a Gmail alias such as
   `derek.dorazio+poolmaster-alerts@gmail.com`, kept in the untracked `prod.tfvars`, so a filter
   can sort them. The same for DMARC reports.
5. **How does Derek query the prod database?** *Recommendation:* no public endpoint on prod. Use
   an SSM port-forwarding tunnel (no open port, signed in with Derek's AWS login) and a separate
   read-only database user for the IDE, so a stray query cannot change data. PR #920 adds the
   SSM host and `scripts/db-tunnel.sh` for QA; prod reuses them (P1 adds the host to prod, P4's
   runbook points at the tunnel) and adds the read-only user.
6. **What must exist before strangers sign up?** The app has no Terms of Service or Privacy
   Policy page, and AWS's SES review and app stores tend to ask for one. *Recommendation:* soft
   launch with Derek's own leagues first; add short Terms and Privacy pages (a separate ticket)
   before inviting anyone else. *Decided:* later, tracked in #921.
7. **Monthly budget alert?** *Recommendation:* $200 for prod, alerts at 80% and 100%. It is an
   email, not a cap.
8. **How does real sport data get onto prod?** *Recommendation:* the `Load sport data` workflow
   gains a prod target that takes only real current-season files, dry run first, applied on
   Derek's yes, the same way QA loads them today. Not a database copy, and not entered by hand
   except for one-off corrections.
