# Migration Squash & QA Reset (Repeatable)

**Tracking issue:** #83 (migrated from `pool-master-bwl`)

## Purpose

We are still in heavy cleanup of the code and data model, so migrations pile
up fast — `packages/core-api/prisma/migrations/` holds 66 of them, much of it
churn (creates, drops, renames, and repair workarounds for a stuck QA
migration). None of that history protects any data: QA holds nothing of value,
and there is no staging or prod database. So the model is **"start fresh,
whenever we want"**:

1. **Squash** — replace the whole migration history with one migration that
   creates the current `schema.prisma` from an empty database, plus the small
   amount of data the app needs to run.
2. **Reset QA** — wipe QA's database and apply that one migration.

Both are scripted, because this will happen repeatedly during the cleanup, not
once.

Local dev needs no new tooling: `npm run db:reset` (`prisma migrate reset`)
already wipes and rebuilds the local database, and simply replays one
migration instead of 66.

## Decisions

| Question | Decision |
|---|---|
| One-time or repeatable? | **Repeatable.** Scripted so it can run as often as the cleanup needs. |
| Where does the squash run? | **Locally, on a branch**, via `npm run db:squash`. The result lands on `main` through an ordinary reviewed PR. Supersedes the earlier design (2026-09-14) that squashed inside a CI workflow and bot-pushed to `main` — more machinery than a solo, in-development repo needs, and it removed review from a change to every environment's baseline. |
| How is the migration generated? | `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`. Non-interactive and needs no database, unlike `prisma migrate dev`, which can prompt or offer to reset. |
| How is QA reset? | **A `workflow_dispatch` GitHub Actions workflow**, gated by a `qa-reset` GitHub Environment with required reviewers (the repo owner), so dispatch alone can't reset anything. It reuses the existing `poolmaster-qa-migrate` ECS task definition with a command override — no new Terraform. |
| How is the database wiped? | `prisma migrate reset --force --skip-seed`, which drops everything in the database's schema and applies the migrations shipped in the image. No drop/recreate of the database itself, so no maintenance connection is needed. The QA app's DB user is the RDS master user (verified 2026-09-14 against `main.tf` and `aws rds describe-db-instances`), so it has the privileges this needs. |
| Staging / prod? | **Neither has a database today** (confirmed 2026-09-28). Nothing to reset or baseline there. See "When this stops being free" below. |
| What do we lose? | The per-migration history in `migrations/`. It stays recoverable via `git log -- packages/core-api/prisma/migrations/`; each squash commit names the pre-squash SHA. |

## Architecture

### Squash script — `packages/core-api/scripts/squash-migrations.mjs`

Run as `npm run db:squash` on a branch, against a local Postgres. Steps:

1. Refuse to run with a dirty git working tree, so the result is a clean,
   reviewable diff.
2. Rebuild the scratch database `poolmaster_migration_check` (never
   `poolmaster` or `poolmaster_test`, which may be in use) from the **current**
   migration history, and capture the rows of the seeded tables (see below).
3. Delete `prisma/migrations/*` (keeping `migration_lock.toml`) and generate
   `<timestamp>_init/migration.sql` with `prisma migrate diff` as above.
4. Append `packages/core-api/prisma/required-seed-data.sql` to the new
   migration.
5. Rebuild the scratch database from the new single migration and compare the
   seeded tables' rows against step 2. Fail on any difference — it means the
   seed file is stale.
6. Print next steps: run the gate suite, open a PR, and after it deploys,
   dispatch the QA reset workflow. Also print the branch rule below.

A full `pg_dump --schema-only` before/after comparison is not required.
Renamed tables leave legacy constraint and index names in the old history that
a fresh generation names differently, so that diff is noisy, and `schema.prisma`
is the source of truth anyway. The gate suite (`npx jest --config
tests/jest.config.js`, `npm run test:service:integration:fresh`,
`npm run test:service:functional-api:fresh`) plus `npm run db:reset` is the
proof.

#### Required seed data

Generating from `schema.prisma` produces structure only; data rows that
migration history put in place are lost unless re-appended. They live in
`packages/core-api/prisma/required-seed-data.sql`, a permanent checked-in
file outside `prisma/migrations/` so a squash never deletes it. It is
appended to the generated migration, so `prisma migrate deploy` applies it
with the DDL — no separate seed step.

**Seed from the current data, never from the original `INSERT`s.** Later
migrations can `UPDATE` or `DELETE` rows an earlier migration inserted, so
copying an old migration's `INSERT` text brings back stale or deleted data.
The seed is the rows as they exist after the full pre-squash history has been
applied. Which rows count:

- **Included:** rows that migration history itself creates (and later
  migrations may have modified) and that the app needs at runtime to function
  on an otherwise empty database — reference/definitional data and
  system-owned records that code or required FKs depend on.
- **Excluded:** test, fixture, or demo data (those belong to
  `bootstrap-users.mjs` and the test suites), and one-time backfills that copy
  existing rows between tables (nothing to copy on a fresh database).
- **Identifying them:** on each squash, audit the pre-squash history for
  data-writing statements (`INSERT`, `UPDATE`, `DELETE`) and determine which
  rows survive on a freshly migrated database. Don't rely on a list recorded
  here; it goes stale as soon as a migration touches that data. The script's
  step 5 check catches any drift the audit misses.

#### Branch rule after a squash

A branch that added a migration before a squash merged carries a timestamp
older than the new `init`, so Prisma would try to apply it first and fail.
After a squash merges, any branch with its own migration deletes it and
regenerates it against the new baseline.

### QA reset — `.github/workflows/qa-reset.yml`

`workflow_dispatch` only (never on push or schedule), `environment: qa-reset`.
One job:

1. Run the existing `poolmaster-qa-migrate` task definition (latest revision,
   so it carries the image with the squashed migrations) with a command
   override running `node scripts/reset-qa-database.mjs --apply`.
2. Wait for the task and print its CloudWatch logs with
   `scripts/ecs-task-wait-and-print-logs.mjs`, the same helper
   `deploy-migrate-qa` uses (added for #191).
3. Roll the new release out: because migrations gate the rollout, the squash
   push's `deploy-qa` job was skipped when its migration failed. Re-run that
   CI run's failed jobs (or push again) once the reset succeeds.

`packages/core-api/scripts/reset-qa-database.mjs` is a thin wrapper so the
override is one command and the destructive step is guarded:

- Refuses to run unless `DATABASE_URL` looks like the QA RDS endpoint (same
  guard as the existing `repair-*.mjs` scripts' `assertQaDatabaseUrl`).
- Dry-run by default (reports `_prisma_migrations` state and per-table row
  counts); `--apply` required to act.
- Runs `prisma migrate reset --force --skip-seed`, verifies
  `_prisma_migrations` shows exactly the migrations in the image, all applied,
  then runs `scripts/bootstrap-users.mjs` so QA is usable, not just empty.

One-time setup outside the YAML: create the `qa-reset` GitHub Environment with
the repo owner as required reviewer.

### Normal QA migrations — `packages/core-api/scripts/run-migrations.mjs`

After a squash merges, the automatic `deploy-migrate-qa` step will fail —
and, since migrations gate the rollout, `deploy-qa` will not deploy — until
the reset runs, because QA still records the old migration
names. Make that failure self-explanatory: when `_prisma_migrations` lists
migrations that don't exist in the image, fail with "QA's migration history
doesn't match this build — run the Reset QA database workflow" rather than
Prisma's raw error.

Also remove the one-off repair logic for `20260411173000_add_league_code`
and the `SCRIPTED_REPAIRS` entries (substrate foundation, sport-league
season), which reference
migrations that no longer exist after the first squash — leaving a plain
`prisma migrate deploy` plus the check above.

### Retire the repair scripts

After the first QA reset succeeds, delete
`repair-sport-league-season-migration.mjs`,
`repair-substrate-foundation-migration.mjs`, its test file, and the
`db:repair:*` npm scripts in both `package.json` files.

## Order of operations for each squash

1. On a branch: `npm run db:squash`, run the gate suite, open a PR, merge.
2. The normal `main` pipeline publishes the new image; `deploy-migrate-qa`
   fails with the "needs reset" message (expected), so `deploy-qa` does not
   roll out and QA keeps running the previous release.
3. Dispatch **Reset QA database**, approve it; QA is wiped, migrated, and has
   its fixture users back.
4. Re-run the squash push's failed CI jobs so `deploy-qa` rolls the new
   release out.

## Dependency: #191

#191 made `deploy-migrate-qa` fail on every `main` push since 2026-09-02 with
no retrievable logs. Its fix supplies what this plan builds on:
`scripts/ecs-task-wait-and-print-logs.mjs` (the shared wait-and-print-logs
helper the reset workflow reuses), a pipeline where migrations gate the
rollout (`deploy-publish-images` → `deploy-migrate-qa` → `deploy-qa`), and
`run-migrations.mjs` picking scripted repairs through `selectScriptedRepair`.
Confirm #191 is closed before the first reset.

## When this stops being free

This whole approach relies on no database holding data worth keeping. The
first time a staging or prod database is created, squashing is no longer a
wipe: any environment with real data would instead need the new baseline
marked applied (`prisma migrate resolve --applied <init>`) after proving its
schema matches, and the reset workflow must never be pointed at it. Revisit
this plan before creating either environment.

## Out of scope

- Any destructive tooling for environments other than QA.
- A scheduled or automatic trigger for the reset — it stays an explicit,
  approved action.
- New local-dev tooling — `npm run db:reset` already covers it.
