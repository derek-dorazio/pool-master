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

## Sequencing precondition — read this before starting slice 2

**Do not squash while any other epic-476 slice with a pending, unmerged Prisma
migration is still in flight.** A squash captures whatever `schema.prisma`
looks like on `main` at that exact moment; anything not yet merged has to
either land before the squash or re-generate its own migration against the
new single baseline afterward — avoidable churn either way. Before starting
slice 2, run `bd show pool-master-476` and confirm every remaining open child
(`qqs`, `za4`, `dyb`, `r11`, `rfy`, `pcd`, `41t` if not yet done, `z3l`) either
doesn't touch `schema.prisma` or has already merged to `main`. `pcd` (Clone
Season) is the one most likely to need a fresh check — it's plausible it needs
no new migration (reuses existing season/tournament creation paths), but
verify against its actual merged diff, don't assume.

## Architecture

### Slice 1 — Squash the migration history

1. Ensure `main` is fully up to date and every precondition above is satisfied.
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
8. Commit the new single migration file and the deleted old ones together,
   in one commit, with a clear message explaining what was squashed and why,
   and a pointer to the pre-squash commit SHA for anyone who needs the old
   history (`git log` already preserves it; the commit message just makes it
   findable).

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

### Slice 3 — Invocation path

No new Terraform. Reuse the existing `migrate` ECS task definition with a
command override:

```
aws ecs run-task \
  --cluster poolmaster-qa-cluster \
  --task-definition poolmaster-qa-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["node","scripts/reset-qa-database.mjs","--apply","--confirm-qa-full-reset"]}]}'
```

Open question for the user (see below) — run this as a one-off manual AWS CLI
command, or add a small `workflow_dispatch`-triggered job to
`.github/workflows/ci.yml` for an audit trail (who ran it, when, from CI logs
rather than someone's shell history)?

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
full reset wipes these too — run this script against the reset QA database as
the last step, before considering QA "ready" again.

## Open questions

1. **Does the QA app's runtime DB user actually have `CREATEDB`/`DROP DATABASE`
   privilege**, or is it a least-privilege user scoped to objects inside the
   `poolmaster` database only? RDS's master user has this by default, but if
   the app connects as a narrower-scoped user, slice 2 needs the master
   credential instead of the app's normal `DATABASE_URL`, which changes how
   the ECS task override in slice 3 needs to source its connection string
   (a separate secret, not the app's existing `DATABASE_URL`). Verify before
   writing slice 2, don't assume.
2. **Manual `aws ecs run-task` vs. a `workflow_dispatch` CI job for slice 3** —
   your call. The manual path ships faster; the CI path leaves an audit trail
   and matches how `migrate-qa` already runs from CI on every push to main.
3. **Does QA hold anything beyond the bootstrap-user fixtures that the team
   would miss** — demo leagues/contests set up for stakeholder walkthroughs,
   anything like that? Worth a quick check with whoever else uses QA before
   slice 2 actually executes (slice 1 and the script-writing in slice 2 don't
   touch QA at all and can proceed regardless).
4. **Timing relative to epic 476** — this plan's sequencing precondition
   already covers the mechanical requirement (no pending unmerged migrations).
   Separately: do you want to squash right after `3dg` lands, or wait until
   the whole epic closes (fewer total moving parts to re-verify against,
   longer wait)? No strong recommendation either way from the technical side —
   this is a scheduling preference.

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
