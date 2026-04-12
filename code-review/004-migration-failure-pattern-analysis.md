# Code Review 004 — Repeated `migrate-qa` Failures: Pattern Analysis

- **Date:** 2026-04-12
- **Scope:** Root-cause analysis of 3 consecutive failed attempts to fix the `20260411173000_add_league_code` migration in QA
- **HEAD at review:** `4833e15`
- **Failing migration:** `packages/core-api/prisma/migrations/20260411173000_add_league_code/migration.sql`
- **Repair wrapper:** `packages/core-api/scripts/run-migrations.mjs`
- **Reviewer:** Architect Agent

---

## Failure Timeline

| Commit | Approach | Outcome |
|---|---|---|
| Original migration | `LEFT(CONCAT(name, RIGHT(uuid,4)), 16)` | Backfill produced collisions after 16-char truncation; `CREATE UNIQUE INDEX` failed; `_prisma_migrations` row stuck |
| `aea2754` | Added `run-migrations.mjs` repair script (hardcoded for this migration) | Repair UPDATE had `WHERE league_code IS NULL` — but rows were already populated, so UPDATE was a no-op; CREATE UNIQUE INDEX failed again with same dups |
| `c89dc66` | Changed formula to `CONCAT(LEFT(name,11), RIGHT(uuid,5))`; did NOT remove the `WHERE league_code IS NULL` guard | Same failure for same reason |
| `9d7bacd` | Dropped the `WHERE` guard; added `DROP INDEX IF EXISTS` first; new 8+8 split | **Failed again — current incident** |

---

## Part A — Why `9d7bacd` Likely Failed (Ranked Hypotheses)

### Hypothesis 1 (~70%): The repair never ran. The gating predicate now returns `false`.

`hasUnresolvedFailedMigration()` checks for `_prisma_migrations` rows where `finished_at IS NULL AND rolled_back_at IS NULL`.

But `c89dc66`'s repair flow ended in one of two ways:
- **If the c89dc66 repair function threw** at `CREATE UNIQUE INDEX` (most likely): `migrate resolve --applied` was never called. Row remains stuck. 9d7bacd's repair *should* run.
- **If c89dc66's repair somehow completed** (e.g., the `IF NOT EXISTS` on the index made it a no-op because of a casing/quoting mismatch, or some other partial-state shortcut): `migrate resolve --applied` was called → row's `finished_at` was set → 9d7bacd sees migration as resolved → repair branch never executes.

In the second case, `prisma migrate deploy` runs in 9d7bacd, sees the migration as already applied, no-ops it, and either:
- exits 0 (and the failure is downstream — smoke test, service start, follow-on migration), or
- exits non-zero on a *different* migration, at which point `hasUnresolvedFailedMigration` returns `false` and the script throws `"no resolvable failure was found"`.

Either way, the implementer's edits inside `repairLeagueCodeMigration()` are **dead code** if c89dc66 ever called `migrate resolve --applied` against this migration.

**The repair branch is one-shot and self-disabling.** Once `resolve --applied` ran a single time, the agent can never reach that code path again — regardless of what they edit inside it.

### Hypothesis 2 (~15%): Compounding state drift from prior partial repairs

Each failed deploy ran `ADD COLUMN IF NOT EXISTS` and `UPDATE` against QA. If Prisma is not transactionally wrapping the original migration (which the timeline suggests, since rows were left populated after the original "rollback"), every attempt has been mutating the column with whatever formula was current at the time. The 9d7bacd repair may now be racing against state laid down by aea2754 and c89dc66.

### Hypothesis 3 (~10%): Stale image / task definition

The recent commit log shows `9033bfa Use registered QA migrate task in CI` and `4833e15 Fix QA browser auth CSRF flow`, indicating churn around CI plumbing. If `publish-images` did not re-register a new task definition for 9d7bacd, the migrate-qa job may still be running an older container image. Verify the actual image SHA in the executed ECS task.

### Hypothesis 4 (~5%): The 8+8 formula still collides on QA data

Mathematically improbable — `RIGHT(uuid_hex, 8)` gives 32 bits of entropy per row, and v4 UUIDs differ in their last 8 hex chars. Listed for completeness.

### How to Confirm (Stop Guessing)

```sql
-- Run against QA RDS (read-only)
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
FROM _prisma_migrations WHERE migration_name = '20260411173000_add_league_code';

SELECT COUNT(*), COUNT(DISTINCT league_code) FROM leagues;
SELECT league_code, COUNT(*) FROM leagues GROUP BY 1 HAVING COUNT(*) > 1;
SELECT indexname FROM pg_indexes WHERE tablename = 'leagues';
```

Plus the CloudWatch stream `ecs/migrate/<task-id>` for the 9d7bacd task. **No further fix should be authored until this evidence is in hand.**

---

## Part B — Systemic Anti-Patterns the Implementer Agent Keeps Repeating

### 1. Symptom-chasing without state inspection
Each commit changes a formula or adds a statement and re-pushes. None of the fixes interrogate the actual state of `_prisma_migrations`, `pg_indexes`, or duplicate values in QA. The agent is writing code as if QA were stateless.

**Tell them:** Before any further code change, paste the current QA `_prisma_migrations` row, `pg_indexes` for `leagues`, and the count of duplicate `league_code` values. No fix proceeds without observed state.

### 2. Duplicated SQL across migration file and repair script
The backfill formula exists in both `migration.sql` and `run-migrations.mjs`. Each commit edits both. This is a maintenance bomb that has already drifted twice.

**Tell them:** One source of truth. Either the migration is data-free and the repair owns the backfill, or the repair `\i`'s the migration file. Never copy-paste SQL.

### 3. No local reproduction with representative data
Three CI failures suggest zero attempts to seed a local DB with QA-shaped data (collision-prone names, edge UUIDs) and run the repair. CI green on an empty test DB is no evidence at all for a data-migration fix.

**Tell them:** Before pushing again, seed a local `poolmaster_test` with at least two leagues whose names normalize to the same prefix, plus one with an empty sanitized name. Run `node packages/core-api/scripts/run-migrations.mjs` against it. Paste the transcript.

### 4. The repair gate is one-shot and self-defeating
`hasUnresolvedFailedMigration` returns `false` after `resolve --applied` runs once. The agent has been editing the gated code body for three commits without noticing the gate prevents re-entry.

**Tell them:** Either remove the gate and make the repair fully idempotent, or make the gate also detect "marked applied but schema is wrong" (missing index, duplicate values).

### 5. Calling `migrate resolve --applied` before verifying schema correctness
`resolve --applied` is destructive metadata surgery. Once invoked, Prisma will never re-run the migration, and editing the migration file becomes irrelevant for QA. The agent has effectively locked in QA's broken state.

**Tell them:** Never call `migrate resolve --applied` until you have independently verified the schema matches the intended end state (column exists, NOT NULL set, unique index present, no duplicates). Add that verification as a precondition.

### 6. Wrong design: a unique constraint over a derived value of mutable user input
`league_code` is unique, derived from a mutable name, and constrained at the schema level. This is fragile by construction. Truncation collisions are the first symptom; rename collisions and case-change collisions are next.

**Tell them:** A unique stable code should be generated independently of mutable user data — random nanoid with collision-retry, or a sequence-backed slug. Derive-and-truncate is an anti-pattern for uniqueness.

### 7. No exit criteria
Three attempts, no plan that says "if attempt N fails, change the design instead of tweaking the formula." The agent is in a local-minimum loop.

**Tell them:** If a fix for a stuck QA migration fails twice, you are forbidden from writing a third incremental patch. You must (a) write up the actual DB state, (b) propose at least two structurally different approaches, (c) get explicit approval before the next push.

### 8. Idempotency is a property of the script, not of statements
`ADD COLUMN IF NOT EXISTS`, `DROP INDEX IF EXISTS`, etc. make individual statements safe. They do **not** make the composite script idempotent across deploys, because `_prisma_migrations` state and `resolve --applied` are monotone.

**Tell them:** Test idempotency end-to-end. Run the repair twice in a row on a broken DB. Both runs must succeed.

### 9. Production debugging instead of rehearsal
Every fix has been a production experiment. The repo already has a disposable test DB workflow (`ba1bb64`) — it isn't being used for migration rehearsal.

**Tell them:** Migration fixes must be rehearsed against a snapshot or synthetic dataset that approximates QA. No more "push and watch CloudWatch."

---

## Part C — Recommended Path Forward

### Options Compared

| Option | Description | Pros | Cons |
|---|---|---|---|
| **1. Manual DB surgery + redeploy** | SSH to RDS, fix `league_code` values manually, mark migration applied, redeploy | Fast | Doesn't fix the design; broken migration file still in repo |
| **2. Squash with corrective migration** | Add a new migration that assumes the column exists and repairs it | Clean from Prisma's POV | Still doesn't fix the derive-from-mutable-input design |
| **3. Replace derivation strategy** | Drop column, recreate nullable, backfill via app code with nanoid + retry, then constrain | Fixes design | Multi-step rollout |
| **4. Nullable-first, app-code backfill, then constrain** *(recommended)* | Migration 1: add column nullable. App-code one-shot: backfill with retry. Migration 2: NOT NULL + UNIQUE. | Standard Prisma pattern; separates concerns; no repair script needed | Two migrations across two deploys |

### Recommendation: Option 4

**Why:** It separates schema changes (fast, can't fail on data) from data production (retryable, idempotent in app code) from constraint tightening (runs only after data is proven clean). Removes the migration/repair-script duplication entirely. App code can do real collision retry; SQL `UPDATE` cannot.

### Concrete Steps

1. **Triage QA now (manual, one-time):**
   ```sql
   ALTER TABLE leagues DROP COLUMN IF EXISTS league_code;
   UPDATE _prisma_migrations
   SET rolled_back_at = now()
   WHERE migration_name = '20260411173000_add_league_code';
   ```
   Lets Prisma re-run the migration cleanly.
2. **Rewrite the migration** (`20260411173000_add_league_code/migration.sql`) to only:
   ```sql
   ALTER TABLE "leagues" ADD COLUMN "league_code" VARCHAR(16);
   ```
3. **Delete `run-migrations.mjs`** entirely. Use bare `prisma migrate deploy` going forward.
4. **Add an app-code backfill** as a one-shot Node script (or ECS task) that selects rows with `league_code IS NULL`, generates a nanoid per row, and updates with collision retry on unique-violation.
5. **Add a follow-up migration** `20260412xxxxxx_constrain_league_code`:
   ```sql
   ALTER TABLE "leagues" ALTER COLUMN "league_code" SET NOT NULL;
   CREATE UNIQUE INDEX "leagues_league_code_key" ON "leagues"("league_code");
   ```
   Deploy this **only after** the backfill task verifies zero nulls and zero duplicates.
6. **Add a CI post-migrate health check:** query `_prisma_migrations` for any row with `finished_at IS NULL AND rolled_back_at IS NULL` and fail the job if present.
7. **Rehearse on `poolmaster_test`** with collision-prone seed data before pushing.

### Trade-offs

- Option 4 needs two migrations across two CI runs. Slower than a single hotfix, but durable.
- Option 1 (manual surgery) is faster if the priority is "get QA green tonight." Acceptable as a **bridge to Option 4**, not as a replacement for it.

---

## Summary for the Implementer Agent

> You have failed three times because you have been editing code without inspecting state, duplicating SQL across two files, calling `migrate resolve --applied` before verifying the schema is correct, and treating the repair script as a place to keep tweaking a fundamentally wrong design. Stop. Pull the actual QA DB state. Then redesign the column to be nullable-first with app-code backfill and a follow-up constraint migration. Do not push another patch to the existing migration or repair script.

---

## Review Disposition

| Item | Disposition | Reasoning |
|---|---|---|
| Stop guessing and inspect QA state before more migration edits | Agree | This is the strongest point in the review. We should not keep iterating on migration behavior without checking `_prisma_migrations`, duplicate values, and index state in QA first. |
| Add a post-migrate health check for unresolved `_prisma_migrations` rows | Agree | This is a low-risk immediate hardening step and should be part of the runner/CI path now. |
| Do not call `migrate resolve --applied` before verifying the target schema/data state | Agree | This is a real fragility in the current repair approach. The runner should verify the repaired end state before resolving metadata. |
| The repair gate is one-shot and becomes dead code after `resolve --applied` | Agree | This is a valid risk. The runner should detect both unresolved failed rows and the “marked applied but schema still wrong” state. |
| SQL duplicated across migration file and repair script is fragile | Agree | This duplication has already drifted. It is acceptable as a short-term incident bridge, but it should be removed in a follow-up hardening slice. |
| Three failed attempts should trigger an explicit redesign checkpoint | Agree | This should become a workflow expectation for risky migration incidents. |
| CI green on an empty DB proves nothing about a data migration | Agree | Migration rehearsal should use collision-prone synthetic data, not just empty test databases. |
| The current root design is wrong because `league_code` is derived from mutable user input | Partial Agree | This is fair for the backfill path, but less true for normal future creation. The live creation path already generates `leagueCode` in app code with collision retry in `LeagueService.generateLeagueCode()`. The immediate fragility is concentrated in the historical migration/backfill path. |
| Drop the column in QA, roll back the migration, delete `run-migrations.mjs`, and move immediately to a nullable-first two-step redesign | Disagree For Now | That may become the right follow-up architecture, but it is a larger operational change than we should make mid-incident without first inspecting the actual QA state. The immediate priority is to stabilize the current lane with better state verification and fail-fast checks. |
| No more patches to the current migration or repair script | Disagree | Short-term hardening inside the current runner is still justified while QA is blocked. The important constraint is that those changes must now be state-aware and validated, not blind retries. |
