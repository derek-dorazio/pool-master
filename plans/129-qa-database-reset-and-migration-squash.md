# Database Reset & Migration History Squash (Local Dev + QA)

**Beads epic:** `pool-master-bwl`

## Purpose

Two related problems, one plan, because doing them in the wrong order means
doing one of them twice:

1. **The migration history is due for a squash.** `packages/core-api/prisma/migrations/`
   currently holds 30 migrations, a lot of it churn from the substrate
   redesign (plan 117) and this golf-admin epic (plan 124) — creates, drops,
   renames, and at least one still-unresolved failure. There is no production
   data anywhere this repo's migrations need to preserve (the "no-data clean
   rework" convention is stated explicitly in several of these migrations
   already, most recently `20260902200000_remove_dead_golf_provider_code`'s
   own header comment). This affects every environment — local dev, QA, and
   CI — since the squashed history becomes the one and only baseline
   everywhere.
2. **QA's database needs a clean reset**, separately from the squash. It
   currently has a stuck/failed migration
   (`20260902110000_add_sport_league_season_roster`, P3018 — see
   `packages/core-api/scripts/repair-sport-league-season-migration.mjs`,
   written but never executed) and, per repeated confirmation this epic,
   holds no data worth preserving. QA is disposable by design, but unlike
   local dev it's a shared remote environment reachable only from inside its
   VPC, so it needs a purpose-built, guarded reset path rather than a bare
   `prisma migrate reset`.

**Local dev is not actually a gap.** `npm run db:reset` already runs
`prisma migrate reset` (drop, recreate, migrate, reseed) against the local
Postgres — that's Prisma's own built-in tool for exactly this, and it's
already safe to run locally today. The only thing the squash changes for
local dev is that this command goes from replaying 30 migrations to replaying
1 — no new tooling needed there, just confirm `db:reset` still works cleanly
against the squashed baseline as part of slice 1's own verification.

Squashing first, then resetting QA against the squashed history, is a single
operation. Resetting QA first against the old 30-migration history and
squashing afterward means resetting QA a second time (Prisma's
`_prisma_migrations` bookkeeping wouldn't match the new single migration name),
so the order in this plan is not arbitrary.

## Decisions locked with the user

| Question | Decision |
|---|---|
| Terraform for the actual drop/recreate? | **No.** Terraform provisions infrastructure (the RDS instance, its VPC/security groups, the ECS task definitions that can reach it) — it is not the tool for a data-plane operation like "drop this database and run migrate deploy." A `local-exec` provisioner shelling out to `psql`/`prisma` fights Terraform's state model for no benefit. |
| Where does Terraform actually fit, then? | It already does the relevant job. `infrastructure/terraform/main.tf` already defines an `aws_ecs_task_definition.migrate` (family `${local.name_prefix}-migrate`) that runs inside the QA VPC with a `DATABASE_URL` pointed at the real QA Postgres and the IAM role to do it. ECS `run-task` supports a **command override** at invocation time — so the reset script needs no new Terraform at all; it reuses this existing task definition with `--overrides` pointing the container at the new script instead of `scripts/run-migrations.mjs`. |
| Squash mechanism? | Prisma has no automated "squash" command. The standard move: delete `prisma/migrations/*`, run `prisma migrate dev --name init` once against an empty database, which diffs empty-vs-`schema.prisma` and emits one genesis migration. That becomes the new baseline everywhere. |
| What do we lose? | The individual migration-by-migration audit trail stops being live in the `migrations/` folder. Still fully recoverable via `git log -- packages/core-api/prisma/migrations/` on commits before the squash — this repo's own `plans/README.md` philosophy ("git history preserves it, no archive folder") already treats this as an acceptable tradeoff for narrative plans, and the same reasoning applies here. |
| One-time squash, or a repeatable operation? | **Repeatable, by explicit user decision (2026-09-14).** We're still in active development; QA (and the migration history itself) holds nothing worth preserving. Rather than squash once and go back to accumulating migrations forever after, this becomes an on-demand "start clean" pipeline: re-squash to a single migration and reset QA against it, as often as wanted. This reframes slice 1 from a one-off manual walkthrough into a script the CI pipeline (slice 3) runs every time. |
| How does the squash land on `main`? | **Direct push, by explicit user decision (2026-09-14).** The workflow commits the regenerated `migrations/` directory straight to `main` as a bot commit — no PR/review step. Chosen deliberately to keep the "start clean" pipeline frictionless for frequent use; acceptable because there are no other collaborators on this repo and QA holds nothing worth protecting against a bad run. If that ever changes (a second contributor, or migrations start needing review), revisit this — a direct push to `main` with no review is real risk to accept knowingly, not a default to keep unexamined. |
| Manual `aws ecs run-task` vs. GitHub Actions for invocation? | **GitHub Actions `workflow_dispatch`, by explicit user decision (2026-09-14).** Resolves the open question that used to be in slice 3 — see the rewritten slice 3 below. |

## Sequencing precondition — read this before starting slice 2

**Do not squash while any branch with a pending, unmerged Prisma migration is
still in flight.** A squash captures whatever `schema.prisma` looks like on
`main` at that exact moment; anything not yet merged has to either land before
the squash or re-generate its own migration against the new single baseline
afterward — avoidable churn either way.

**Status as of 2026-09-14 (verified, not assumed):** epic `pool-master-476` is
closed, all 23 children complete, including every child this precondition
used to name (`qqs`, `za4`, `dyb`, `r11`, `rfy`, `pcd`, `41t`, `z3l`). `main`
is up to date with `origin/main`, working tree clean, no other open PRs (the
one that was open, #76, has since merged — pure test code, never touched
`schema.prisma`). So slice 1 can start today.

**Because slice 1 is now a repeatable operation (see the decision table
above), this precondition can't stay a one-time manual `bd show` check** — the
pipeline will run again later, when the epic-476 snapshot above is stale. The
CI workflow (slice 3) must therefore verify this itself on every run, not rely
on a human having checked beads beforehand: before squashing, check for any
open PR whose diff touches `packages/core-api/prisma/` and fail the run with a
clear message if one exists, rather than silently squashing out from under
in-flight schema work.

## Architecture

### Slice 1 — Squash the migration history

Since this now needs to run repeatedly (not once), write these steps as
`scripts/squash-migrations.mjs` rather than a one-off terminal walkthrough —
matching this repo's `repair-*.mjs` / `reset-qa-database.mjs` convention
(dry-run reporting by default, explicit apply flag) so the CI workflow (slice
3) can invoke it directly and it stays runnable by hand for local
verification too.

1. Ensure `main` is fully up to date and every precondition above is satisfied
   (the CI workflow checks this automatically each run — see the precondition
   section above).
2. Use a disposable local Postgres for the regeneration — not `poolmaster` or
   `poolmaster_test` (those may be in use), a dedicated scratch database
   (`poolmaster_migration_check` already exists and has been used for exactly
   this kind of check this session — drop and recreate it empty first).
3. Before deleting anything, capture a schema-only dump of the *current*
   (30-migration) state for the equivalence check in step 6:
   `pg_dump --schema-only -d poolmaster_migration_check > /tmp/schema-before.sql`
   (after applying the full existing migration history to that scratch DB).
4. `rm -rf packages/core-api/prisma/migrations/*`
5. `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_migration_check npx prisma migrate dev --name init --schema packages/core-api/prisma/schema.prisma`
   against a freshly emptied version of that same scratch database. This
   generates one `migrations/<timestamp>_init/migration.sql` and applies it.
6. **Prove equivalence, don't assume it.** Dump the new single-migration
   schema the same way and diff it against step 3's capture:
   `pg_dump --schema-only -d poolmaster_migration_check > /tmp/schema-after.sql && diff /tmp/schema-before.sql /tmp/schema-after.sql`.
   Expect zero meaningful differences (ordering/comment noise aside) — any
   real diff means the squash dropped or changed something and needs
   investigation before proceeding.
7. Run the full gate suite (`npx jest --config tests/jest.config.js`,
   `npm run test:service:integration:fresh`, `npm run test:service:functional-api:fresh`)
   against the new single-migration path to confirm nothing behavioral moved.
   Also run `npm run db:reset` itself against a local Postgres and confirm it
   completes cleanly against the squashed baseline — this is local dev's
   entire reset story, and it should need zero changes, just confirmation.
8. Commit the new single migration file and the deleted old ones together, in
   one commit, with a clear message explaining what was squashed and why, and
   a pointer to the pre-squash commit SHA for anyone who needs the old history
   (`git log` already preserves it; the commit message just makes it
   findable). In the CI pipeline (slice 3) this is a direct bot push to
   `main` — see the "How does the squash land on `main`?" decision above.

### Slice 2 — `packages/core-api/scripts/reset-qa-database.mjs`

Matches this repo's existing `repair-*.mjs` convention exactly (dry-run by
default, explicit apply flags, hard-coded QA-only guard):

- Refuses to run unless `DATABASE_URL` matches the QA RDS endpoint pattern
  (same `assertQaDatabaseUrl`-style guard as the existing repair scripts).
- Dry-run by default; requires `--apply --confirm-qa-full-reset` to do
  anything. Dry-run mode reports the current database's row counts per table
  (for the record, even though nothing here is being preserved) and the
  current `_prisma_migrations` state.
- **Connecting to drop the database you're connected to doesn't work.**
  The script derives a maintenance connection string from `DATABASE_URL`
  (same host/port/user/password, database name swapped to `postgres`),
  connects there to run the drop/create, then lets the subsequent
  `prisma migrate deploy` subprocess use the original `DATABASE_URL` as-is.
- `DROP DATABASE IF EXISTS <qa_db_name> WITH (FORCE)` if the RDS Postgres
  engine version supports `WITH (FORCE)` (PG13+); otherwise terminate
  existing backends via `pg_terminate_backend` against `pg_stat_activity`
  first, then a plain `DROP DATABASE`. **Verify the QA RDS engine version
  before writing this — don't assume.**
- `CREATE DATABASE <qa_db_name>`.
- Shell out to `prisma migrate deploy` (now just the one squashed migration —
  fast).
- Verify `_prisma_migrations` afterward shows exactly one row, applied,
  not rolled back.

### Slice 3 — CI pipeline: on-demand "QA Clean Slate" GitHub Actions workflow

**Decided 2026-09-14: a `workflow_dispatch`-triggered job, not a manual AWS
CLI command** — the user wants this runnable often, and a CI pipeline gives
an audit trail (who ran it, when) and a repeatable one-click path instead of
someone's shell history. New workflow file, e.g.
`.github/workflows/qa-clean-slate.yml`, triggered only by `workflow_dispatch`
(never on push/schedule — this is an explicit, on-demand action against a
shared environment, not an automatic one).

Single job, run start to finish on every dispatch:

1. **Precondition check.** Fail fast with a clear message if any open PR's
   diff touches `packages/core-api/prisma/` (see the updated "Sequencing
   precondition" section above) — this replaces the one-time manual `bd show`
   check now that the pipeline runs repeatedly.
2. **Squash** — run `scripts/squash-migrations.mjs` (slice 1, now scripted)
   against a disposable Postgres service container in the runner (not QA, not
   local dev). Includes the before/after schema-equivalence diff from slice 1
   step 6; fail the run on any real diff rather than proceeding.
3. **Verify** — run the full gate suite (`jest`, `test:service:integration:fresh`,
   `test:service:functional-api:fresh`) against the freshly-squashed baseline.
   Fail the run here rather than pushing a squash that breaks anything.
4. **Commit and push directly to `main`** — the new single migration file plus
   the deleted old ones, as a bot commit (see the "How does the squash land on
   `main`?" decision above: direct push, no PR, by explicit user choice).
5. **Reset QA.** Reuse the existing `migrate` ECS task definition with a
   command override — no new Terraform:
   ```
   aws ecs run-task \
     --cluster poolmaster-qa-cluster \
     --task-definition poolmaster-qa-migrate \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"migrate","command":["node","scripts/reset-qa-database.mjs","--apply","--confirm-qa-full-reset"]}]}'
   ```
6. **Wait for the reset task and surface logs on failure**, reusing a shared,
   tested script (`scripts/ecs-task-wait-and-print-logs.mjs` or similar)
   rather than inline bash — reused by both this step and the existing
   `migrate-qa` job's "Wait for migration to complete" step, so there's one
   implementation instead of two near-duplicates. A prior local branch
   (`watch-ci-resolve/migrate-qa-diagnostics-2`, since deleted — not merged
   as-is because it had regressed relative to `main`'s current inline bash: it
   hardcoded the CloudWatch log group and guessed the stream-name prefix
   instead of resolving both from the live task definition the way `main`'s
   current step does) is worth mining for two things `main`'s current step
   lacks: retrying the log-stream lookup with backoff (CloudWatch delivery lag
   means a single query can miss freshly-written logs), and unit tests for the
   pure helper functions (`taskIdFromArn`, log-stream-candidate selection,
   failure summarization), matching the existing `node --test` convention used
   by `packages/core-api/scripts/repair-substrate-foundation-migration.test.mjs`.
   Combine: `main`'s dynamic log-group/prefix resolution (keep, it's correct)
   + the retry-with-backoff idea (add) + tests (add) — don't resurrect the
   branch's hardcoded log group.
7. **Reseed QA fixtures** — run `bootstrap-users.mjs` (slice 5) as the pipeline's
   last step, so a dispatch of this workflow always leaves QA fully usable,
   not just reset.

**Confirmation gate — decided 2026-09-16:** the job declares
`environment: qa-reset`, a GitHub Environment configured with **required
reviewers** (the user's own GitHub account). This is a native two-click
GitHub Actions feature, not custom code: dispatching the workflow ("Run
workflow") pauses the job in a "Waiting" state, and it only proceeds after a
reviewer opens the run and clicks "Review deployments" → "Approve and
deploy". A stray click on "Run workflow" alone can't reset anything.

One-time setup this depends on (not part of the workflow YAML itself, done
once in repo settings or via `gh api repos/:owner/:repo/environments/qa-reset`
+ a required-reviewers rule naming the user): create the `qa-reset`
environment before the workflow can be dispatched for real.

### Slice 4 — Retire the now-obsolete repair scripts

Once QA has been reset onto the squashed baseline, `repair-sport-league-season-migration.mjs`
and `repair-substrate-foundation-migration.mjs` (plus their `db:repair:*` npm
aliases) have nothing left to repair — a freshly reset QA has no orphaned rows
and no stuck migration. Delete both scripts, their test file, and the npm
script entries in the same commit that confirms the reset succeeded, not
before (keep them until the reset is actually proven, in case slice 2 or 3
needs another pass).

### Slice 5 — Re-seed QA fixtures

`packages/core-api/scripts/bootstrap-users.mjs` reactivates the durable
fixture users the browser e2e suite and manual QA testing rely on
(`tests/unit/core-api/qa-bootstrap-users-script.test.ts` documents this). A
full reset wipes these too. **Folded into slice 3's pipeline as its final
step** (step 7) rather than a separate manual action — every dispatch of the
CI workflow leaves QA reset *and* usable, not just reset.

## Open questions

1. ~~Does the QA app's runtime DB user actually have `CREATEDB`/`DROP DATABASE`
   privilege?~~ **Resolved 2026-09-14, verified two ways, don't re-derive
   this from memory later without re-checking if the infra changes:** yes.
   `infrastructure/terraform/main.tf:319-320` sets `aws_db_instance.postgres`'s
   `username`/`password` from `var.db_username`/`var.db_password` — Terraform's
   only way to set an RDS master user — and that exact same pair builds
   `local.db_url` (`main.tf:575`), injected as-is into both the app task
   (line 580) and the migrate task (line 720). No separate least-privilege
   Postgres role exists anywhere in this repo's Terraform (grepped for
   `CREATE ROLE`/`CREATE USER`/`GRANT` — none). Live check via
   `aws rds describe-db-instances` confirmed `MasterUsername: poolmaster`,
   engine `postgres 16.13` (comfortably satisfies the PG13+ requirement for
   `DROP DATABASE ... WITH (FORCE)`). **So slice 2 can use the app's existing
   `DATABASE_URL` as-is — no separate master credential/secret to source.**
   Side finding: the QA RDS instance is actually `PubliclyAccessible: true`
   (gated by security group, not by VPC-only routing) — this plan's earlier
   framing ("reachable only from inside its VPC") was slightly inaccurate;
   doesn't change any design decision here, just a correction.
2. ~~Manual `aws ecs run-task` vs. a `workflow_dispatch` CI job?~~ **Resolved
   2026-09-14: CI job.** See slice 3 and the decisions table above.
3. **Does QA hold anything beyond the bootstrap-user fixtures that the team
   would miss** — demo leagues/contests set up for stakeholder walkthroughs,
   anything like that? Still open. Lower stakes now that this becomes a
   repeatable "start clean" pipeline rather than a single irreversible event —
   but still worth a beat of thought before the first dispatch, since every
   run wipes whatever's there at the time.
4. ~~Timing relative to epic 476~~ **Superseded by the "repeatable operation"
   decision above** — epic 476 is closed anyway (verified in the sequencing
   precondition section), and since this is now an on-demand pipeline rather
   than a one-time event, "when to squash" stops being a scheduling question
   and becomes "whenever you dispatch the workflow."
5. ~~Should the `workflow_dispatch` trigger require a typed confirmation
   input?~~ **Resolved 2026-09-16: a GitHub Environment (`qa-reset`) with
   required reviewers**, not a typed input — see slice 3's "Confirmation
   gate" note above. Native two-click GitHub Actions approval, no custom
   validation code needed.

## Out of scope

- Any change to production's database — this plan's reset script (slice 2)
  is QA-only, matching the disposability convention already established for
  QA. The squash (slice 1) is repo-wide by nature (it's the migration
  history every environment replays), but the destructive drop/recreate
  tooling is not.
- Rewriting `migrate-qa`'s existing CI job — it keeps working unchanged
  against the new single-migration history (a `migrate deploy` against an
  already-fully-migrated database is a no-op either way).
- New local-dev tooling — `npm run db:reset` already does the job; this plan
  only needs to confirm it still works post-squash (slice 1, step 7).
- A general-purpose "environment reset" tool for arbitrary future
  environments — QA is the one environment that actually needs a
  purpose-built guarded script; everywhere else already has one.
- A scheduled/cron trigger for the clean-slate pipeline — `workflow_dispatch`
  only. This stays an explicit, on-demand action the user chooses to run,
  never something that fires on its own.
