---
name: fix-broken-ci
description: Diagnosing a red CI run on PoolMaster — find the run that matters, read the failing step, match it against the causes seen before (browser install, the QA smoke's known intermittent, migration timestamps, a stale generated SDK, lint memory, coverage floors, a QA deploy that never stabilized) and fix the cause. Use when someone says CI is broken, main is red, or a PR's checks fail for no obvious reason.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Fixing broken CI

The `release-check` skill says what a failing gate means for the code and why "flake" is a
diagnosis, not a default; read it first. This skill is the triage: which run to look at, the
failures this repository has seen more than once, and the fix for each. The job graph and
every gate are in `docs/CI-AND-QUALITY-GATES.md`.

Never skip, disable or quarantine a test to get green (`rules/testing-rules.md` §1C
*Test-Disable Discipline*), and never change application code to make a test pass
(`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*).

## Step 1 — find the run that matters

- **"CI is broken" usually means main.** Look at main's newest run and every open PR's latest
  run before touching anything. A failure on main and on every PR is main's; a failure on one
  PR is that PR's (`rules/workflow-rules.md` §1 *Know The CI Baseline Before You Start*).
- **Only the newest main run counts.** Re-running an older main run after a newer merge has
  deployed fails "Verify deployed PoolMaster frontend release" every time, because QA now
  serves the newer commit. Never re-run a superseded main run.
- **The tracking issues have the log.** A red main build is reported, with the failing step's
  tail, on the open issue "CI is failing on main"; a red deploy or QA smoke on "QA deploy is
  failing on main". Read the latest comment before opening logs.
- **Name the job and the step.** "service-integration-tests (3/4), step Run integration tests"
  is a diagnosis's start; "CI failed" is not.

## Step 2 — match the known causes

| What fails | Cause | Fix |
|---|---|---|
| "Install Playwright Chromium" runs past its timeout, no test ran | The runner's apt mirror is slow; the install script only reaches apt when a browser library is missing | A re-run is justified (no test ran). If it repeats, read the script's `ldd` output for the missing library |
| QA browser smoke, golden journey act 1 "create 6 players": the first new player's row never appears | A known intermittent with an open issue titled "QA smoke: golden journey act 1 intermittently can't find the six new players"; the local browser job always passes it | Add the run id and its artifact to that issue. Re-run main's newest run once. Never loosen the step's assertion |
| `rules:check:migration-timestamps`, or a deploy's migrate step after two PRs merged | Two branches stamped migrations alike, or a branch's migration sorts before one main already applied | Rename the branch's own, unapplied migration to a timestamp after main's latest. Never rename a migration main has shipped: Prisma records applied migrations by name |
| `api:check` after merging main into a branch | Both sides changed routes, so the committed generated SDK matches neither | `npm run api:refresh` on the merged tree and commit what it writes; never hand-merge the generated files |
| `service - lint` dies with exit 134, "JavaScript heap out of memory" | Lint outgrew CI's heap; local containers have more memory, so it passes locally | Reproduce with `NODE_OPTIONS=--max-old-space-size=4096 npm run lint:service`, then raise the heap in the CI step. Not a flake |
| Backend unit coverage below its floor, though the merged report looks fine | The unit floor is measured with Babel; the merged report uses V8, which runs a few points higher | Read the Babel numbers from the unit job and add tests for the slice's code. A floor is never lowered to let a slice through (`docs/CI-AND-QUALITY-GATES.md` *Coverage thresholds*) |
| `deploy-qa`: "QA ECS service failed to stabilize" | The new task was stopped before passing its health checks: usually a boot slower than the grace period (exit 137, failed ELB health checks), or a crash on start | Read the "Dump ECS stabilization diagnostics" step: it prints the stopped task's last log lines. A crash is a code fix. A slow boot is measured locally by timing the app's `ready()` with auto start disabled; a larger task or grace period is a Terraform change, the user's call, made with the `apply-terraform` skill |
| A red main run whose build jobs are green | Not every red main run is a failed deploy: the QA browser smoke runs after it | Check `deploy-qa` itself before calling the deploy broken |
| DB-backed suites fail locally but not in CI | Two lanes ran against one database at once, or the database is dirty | Run them one at a time and reset with `npm run db:test:reset` (`rules/workflow-rules.md` §3 *Required Local Validation Before Push*) |

Anything else is a real failure until shown otherwise: reproduce it locally on the same commit
before changing anything.

## Step 3 — fix it

1. Branch from main. A failure that is a defect gets a failing test first
   (`rules/testing-rules.md` §3 *Defect Verification Protocol*); a CI-configuration fix gets a
   test where its script has one (`scripts/*.test.mjs`).
2. Run the gate set (`rules/workflow-rules.md` §3 *Required Local Validation Before Push*),
   then open the PR. Say in its body which run failed, why, and how the fix was checked.
3. A failure that is not yours to fix (another PR's, or a provider outage) is reported to the
   user with the run, the step and the cause, not left for the next session to rediscover.
4. If the cause was new, add its row to the table above in the same PR.

## Where this goes wrong

- **Re-running until green.** A re-run is justified only when the job died before a test ran,
  or the same commit passed before.
- **Fixing the newest symptom.** When several runs are red, find the first red one: later
  failures are often the same cause.
- **Calling the deploy broken from a red smoke**, or the smoke broken from a red deploy.
- **Merging over red.** A PR merges green, and main's red is fixed before more merges stack on
  it.
