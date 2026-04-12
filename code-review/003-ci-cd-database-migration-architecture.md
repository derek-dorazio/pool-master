# Code Review 003 — CI/CD Pipeline & Database Migration Architecture

- **Date:** 2026-04-11
- **Scope:** Database migration strategy, integration/FAPI test infrastructure, CI/CD pipeline, local dev workflow
- **HEAD at review:** `ef28e77`
- **Reviewer:** Code Review Agent (Architect analysis)

---

## Summary

The project uses Prisma Migrate with a PostgreSQL backend, a disposable `poolmaster_test` database for integration and functional API tests, and a GitHub Actions CI pipeline that provisions a Postgres 16 service container. QA deployments run migrations via an ECS Fargate task using a hardened wrapper script (`run-migrations.mjs`). The current QA migration failure stems from `20260411173000_add_league_code`, whose original backfill strategy can generate duplicate `league_code` values after truncation on real data, leaving the `_prisma_migrations` table in a stuck state that blocks all subsequent migrations. The earlier empty-name / `NULL` path is still a valid edge case to guard against, but it was not the concrete failure observed in QA.

---

## Architecture Overview

### Database Roles

| Database | Purpose | Owner |
|---|---|---|
| `poolmaster` | Local dev (manual feature work) | `postgres:postgres` on localhost |
| `poolmaster_test` | Disposable test DB for integration, FAPI, and coverage runs | `postgres:postgres` locally; `poolmaster:poolmaster` in CI |
| QA RDS | Persistent QA environment | ECS Fargate migration task |

### Migration Execution Paths

| Context | Command | Connection | Notes |
|---|---|---|---|
| Local dev | `npm run db:migrate` | `localhost:5432/poolmaster` | `prisma migrate dev` (interactive, generates SQL) |
| Local test reset | `npm run db:test:reset` | `localhost:5432/poolmaster_test` | `prisma migrate reset --force --skip-seed` |
| Local test migrate | `npm run db:test:migrate` | `localhost:5432/poolmaster_test` | `prisma migrate deploy` |
| CI | `npx prisma migrate deploy` | `localhost:5432/poolmaster_test` (GH Actions service container) | `.github/workflows/ci.yml:66` |
| QA deploy | `node scripts/run-migrations.mjs` | QA RDS via ECS Fargate | `run-migrations.mjs` wraps `prisma migrate deploy` with repair logic |

### Test Suites That Hit the Database

| Suite | Config | DB Connection | Isolation |
|---|---|---|---|
| Data Integration | `tests/integration/jest.config.js` (maxWorkers: 1) | `DATABASE_URL` env var via `PrismaClient()` | `cleanupTestData()` deletes by email pattern `@integration.test` |
| Functional API | `tests/functional/jest.config.js` (maxWorkers: 1) | Shared daemon server + separate `PrismaClient` for cleanup | `cleanupFunctionalData()` deletes by email prefix `functional-<runId>-*` |
| Contract Verification | Runs within integration suite | Same as integration | Same as integration |

---

## Findings

### Review Disposition

| # | Disposition | Reasoning |
|---|---|---|
| 1 | **Revise** | The migration SQL did need correction, but the live QA failure was not caused by `NULL` values from empty sanitized names. CloudWatch logs showed a duplicate-key collision on `league_code`, so this finding should focus on truncation/collision risk rather than `NULL` as the primary root cause. |
| 2 | **Agree** | The repair script is too specific to one migration and does not provide a reusable stuck-migration recovery pattern. |
| 3 | **Partially Agree** | CI using bare `migrate deploy` is not what broke QA; CI runs against a fresh ephemeral database and has been green. A post-migration health check is still useful, but the current QA incident is not evidence that CI itself needs the same repair wrapper. |
| 4 | **Partially Agree** | Transactional backfill migrations are a good practice, but this is a hardening recommendation, not the immediate cause of the observed QA failure. |
| 5 | **Disagree** | Credential differences between local dev and CI are not an architectural problem; they are a convenience/repro detail. The connection string is already configurable through `DATABASE_URL`. |
| 6 | **Agree** | A stuck-migration health check after migration is useful and low risk. |
| 7 | **Agree** | The ECS wait loop can be improved, though it is not the source of the migration failure. |
| 8 | **Disagree** | The log stream naming assumption was not the root issue. The expected CloudWatch stream existed and contained the real Prisma error; the GitHub job simply did not surface it reliably. |
| 9 | **Keep for Later** | Valid local-dev polish, but unrelated to the QA migration incident. |
| 10 | **Partially Agree** | `db:test:migrate` could use better ergonomics, but `poolmaster_test` is intentionally disposable and `db:test:reset` is the preferred recovery path. |
| 11 | **Keep for Later** | This may be worth hardening, but it is a separate FAPI harness concern. |
| 12 | **Keep for Later** | Reasonable cleanup, unrelated to the current CI/CD migration issue. |
| 13 | **Agree** | A data-backed migration validation step would have made this easier to catch before QA. |
| 14 | **Agree** | A generic stuck-migration framework is still a good follow-up after the immediate fix. |
| 15 | **Agree** | The migration file itself needed to be corrected so reset/replay behavior matches the repaired runtime path. |

### Migration Failures

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 1 | **Critical** | `packages/core-api/prisma/migrations/20260411173000_add_league_code/migration.sql` | The original backfill SQL used a truncating `LEFT(CONCAT(name, idSuffix), 16)` shape, which can collapse distinct long league names into the same final `league_code` after truncation. The real QA failure surfaced as `Key (league_code)=(JOURNEYMASTERSPO) is duplicated.` The migration also needed a `COALESCE(..., 'LEAGUE')` fallback for empty sanitized names. |
| 2 | **Critical** | `packages/core-api/scripts/run-migrations.mjs` (full file) | The repair script is **hardcoded to exactly one migration** (`20260411173000_add_league_code`). If any future migration fails and leaves a stuck `_prisma_migrations` row, the repair script cannot help — it will throw on line 89-91 with "no resolvable failure found." There is no generic stuck-migration recovery. |
| 3 | **High** | `.github/workflows/ci.yml:66` | CI runs bare `npx prisma migrate deploy` without a post-migration stuck-state check. This is not what caused the current QA failure, because CI uses a fresh ephemeral database, but it remains a weaker validation pattern than explicitly asserting there are no unresolved `_prisma_migrations` rows after deployment. |
| 4 | **High** | `packages/core-api/prisma/migrations/20260411173000_add_league_code/migration.sql` | The migration is **not wrapped in a transaction**. Prisma runs each migration file as a single statement batch, but PostgreSQL DDL (ALTER TABLE, CREATE INDEX) is transactional. If the migration SQL were wrapped in `BEGIN; ... COMMIT;`, a failure in the backfill UPDATE would roll back the ADD COLUMN, leaving the schema clean for a retry. Without this, a mid-migration failure leaves the schema in a partial state (column exists, but not populated or constrained). |

### CI/CD Pipeline Gaps

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 5 | **High** | `.github/workflows/ci.yml:40-53` | The CI Postgres service container is ephemeral per workflow run, so stuck migrations don't persist across runs. The credential mismatch with local dev is mostly an ergonomics issue rather than an architectural flaw, because local repro already happens through `DATABASE_URL` overrides. |
| 6 | **Medium** | `.github/workflows/ci.yml:66` | No `prisma migrate status` check after `migrate deploy`. If a migration silently fails or is already applied but schema is inconsistent, the pipeline won't detect it. Adding a post-migration health check (query `_prisma_migrations` for any `finished_at IS NULL`) would catch stuck states before tests run. |
| 7 | **Medium** | `.github/workflows/ci.yml:511-602` | QA migration task has a 10-minute timeout (40 polls x 15s). The wait loop makes 40 separate `aws ecs describe-tasks` API calls. If the migration completes in 30 seconds, the pipeline still waits for the next 15-second poll interval. Consider using `aws ecs wait tasks-stopped` for cleaner blocking, then check exit code. |
| 8 | **Medium** | `.github/workflows/ci.yml:587-593` | QA migration log retrieval still depends on the expected ECS/CloudWatch stream naming. In the current incident, the stream did exist and contained the real error, so the missing-log symptom was not caused by a bad prefix assumption. |

### Local Dev & Test Infrastructure Gaps

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 9 | **Medium** | `infrastructure/docker/docker-compose.dev.yml` | No health check on the Postgres service (unlike the full-stack `docker-compose.yml` which has one). The `scripts/dev-start.sh` compensates with a `pg_isready` poll loop, but if tests are run outside of `dev-start.sh`, Postgres may not be ready. |
| 10 | **Medium** | `package.json:19-24` | The `db:test:migrate` command uses `npx prisma migrate deploy`, not the repair wrapper. If a developer's local `poolmaster_test` has a stuck migration, they must either run `db:test:reset` (which drops and recreates everything) or manually fix the `_prisma_migrations` table. The common failure mode: developer runs integration tests, migration fails mid-way, subsequent `npm run test:integration` calls fail until they realize they need `db:test:reset`. |
| 11 | **Medium** | `tests/functional/global-setup.cjs` | If the FAPI daemon server crashes during startup (e.g., migration failure, port conflict), the state file is never written. The setup waits 30 seconds, then fails. But the child process may still be running as a zombie. The teardown reads the state file to find the PID — if no state file, teardown can't kill the process. Next test run may fail with port conflict. |
| 12 | **Low** | `tests/integration/helpers.ts:204-306` | Integration cleanup uses `$executeRawUnsafe()` with string interpolation for WHERE clauses (e.g., `WHERE id IN (${ids.map(i => `'${i}'`).join(',')})`). While these are UUIDs from the test's own creation, the pattern is technically SQL-injection-vulnerable if IDs were ever user-controlled. Should use parameterized queries. |

### Migration Strategy Gaps

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 13 | **High** | General architecture | **No pre-flight migration validation.** Data-dependent migrations (like `league_code` backfill) are tested against an empty CI database, which can never trigger the NOT NULL / COALESCE bug because there are no rows to backfill. The failure only surfaces in QA (or prod) where real data exists. Consider: (a) a CI step that loads representative fixture data before running migrations, or (b) a shadow migration test against a DB snapshot. |
| 14 | **Medium** | General architecture | **No generic migration repair framework.** The `run-migrations.mjs` script handles exactly one migration. A reusable pattern would be: detect any stuck migration, check if the schema changes are already applied (via introspection), and if so, mark the migration as applied. This would prevent future one-off repair scripts. |
| 15 | **Medium** | `packages/core-api/prisma/migrations/20260411173000_add_league_code/migration.sql` | **The migration file still has the bug.** The repair script has the fix (`COALESCE`), but the actual migration SQL does not. If someone runs `prisma migrate reset` (which replays all migrations from scratch), the broken SQL will execute. On an empty DB this is harmless (no rows to backfill), but on a DB with data it will fail. The migration file should be corrected to match the repair script's logic. |

---

## Root Cause Analysis: Why Migrations Kept Failing In QA

```
20260411173000_add_league_code/migration.sql
│
├── Original backfill built league_code as LEFT(CONCAT(normalized_name, id_suffix), 16)
│   └── Distinct long names can collapse to the same final 16-char value after truncation
│
├── Example observed in QA
│   └── Duplicate collision on JOURNEYMASTERSPO
│
├── CREATE UNIQUE INDEX "leagues_league_code_key"
│   └── Fails because duplicate backfilled codes already exist
│
└── _prisma_migrations table:
    └── Row for 20260411173000 has finished_at = NULL, rolled_back_at = NULL
        └── ALL subsequent migrations blocked
            └── prisma migrate deploy exits non-zero
                └── QA deploys fail until the stuck migration is repaired
```

**Why it only failed in QA / with real data:**
- CI uses an empty `poolmaster_test`, so the backfill and unique index creation do not encounter real historical league-name collisions.
- QA has real leagues, and at least two names normalized into the same truncated 16-character code during backfill.
- Empty-name / all-punctuation league names remain a valid edge case, but they were not the concrete failure observed in the QA logs.

---

## Recommendations

### Immediate Fixes (unblock current failures)

1. **Fix the migration SQL file itself** (`migration.sql:7`): Replace `NULLIF(...)` with `COALESCE(NULLIF(...), 'LEAGUE')` to match the repair script. This prevents failures on future `migrate reset` or fresh deployments.

2. **Add a post-migration health check to CI** (`.github/workflows/ci.yml`): After `prisma migrate deploy`, query `_prisma_migrations` for any rows with `finished_at IS NULL AND rolled_back_at IS NULL`. Fail fast with a clear message instead of letting tests run against a broken schema.

3. **Use the repair wrapper in CI**: Replace the bare `npx prisma migrate deploy` on CI line 66 with `node packages/core-api/scripts/run-migrations.mjs`, or (better) always start CI from a `prisma migrate reset --force` to guarantee a clean slate.

### Short-Term Improvements

4. **Add transaction wrapping to data migrations**: For migrations that include data backfills, wrap the SQL in `BEGIN; ... COMMIT;` so failures roll back cleanly instead of leaving partial schema state.

5. **Add a health check to `docker-compose.dev.yml`**: Match the full-stack compose file's Postgres health check so tests started outside `dev-start.sh` wait for Postgres readiness.

6. **Build a generic stuck-migration detector**: Replace the hardcoded `run-migrations.mjs` repair with a script that can detect and resolve any stuck migration by introspecting the actual schema state.

### Longer-Term Architecture

7. **Pre-flight migration testing with data**: Add a CI step that seeds representative data (a few leagues with edge-case names, contests, members) before running `migrate deploy`. This catches data-dependent bugs before they reach QA.

8. **Migration review checklist**: Any migration with a data backfill should document: (a) what happens if the column/value is NULL, (b) what happens on an empty table, (c) what happens if the migration is re-run. Add this to `rules/model-change-rules.md`.
