# Background jobs on Postgres

**Tracking issue:** #1439 (tickets #1440, #1387, #1441)

Written 2026-11-07 from rows 1.3–1.7 of `plans/scalability-recommendations.md`, agreed with Derek in
the scalability thread. The dedicated worker service (#1186, row 1.1): Derek asked 2026-11-08 for the
code now and no deployment yet, so the `CORE_API_ROLE` flag is built and every environment still runs
`all`, one task doing both.

## What we want

A request that starts work it doesn't wait for hands it to a **durable job**, written in the same
transaction as the change that caused it. Any API task claims and runs it, retries it on failure,
and a deploy or a crashed task never loses it. This replaces in-process `outsideRequest` +
`setImmediate` work, and work done inside admin requests only because there was nowhere else to put it.

## Scope

| Row | Work | Ticket |
|---|---|---|
| 1.3 | The job table, the runner, typed handlers, retention | #1440 |
| 1.4 | Contest-started and final-results emails built by a job, not in the admin request | #1387 |
| 1.5 | Manual event sync runs as a job | #1441 |

Out of scope, and why:
- **1.1 worker service (#1186):** the flag is coded (2026-11-08): `api` tasks start no runner,
  sender or scheduler and wake nothing, `worker` tasks run them all. What is left is Terraform, a
  `core_api_worker` ECS service on the same image with `CORE_API_ROLE=worker`, `desired_count = 1`,
  no load balancer, and `CORE_API_ROLE=api` on the existing service; Derek applies it when he wants
  it on QA. The jobs need no change.
- **1.6 event create / clone / import:** #1253 already brought these routes to a fixed query count; no job is needed.
- **1.7 commissioner bulk actions:** checked. The year-in-review send and the member CSV import
  already read and write in a fixed number of queries and queue their emails to the outbox. No job is needed.
- **1.8 split workers:** closed by Derek; revisit only if job types starve one another.
- **Scheduled jobs** (lifecycle sweep, ingestion, nightly cleanup, email sender) stay timer-driven
  behind the advisory job locks (#1159). The job table is for one-off work.

## Design

### The table

`background_jobs`, one row per job:

- `id` uuid; `type` a Postgres enum `BackgroundJobType` (one value per handler); `payload` Json.
- `status` enum `BackgroundJobStatus`: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`.
- `run_at` (due time), `attempts`, `lease_until`, `last_error` (text, truncated), `created_at`,
  `completed_at`.
- `dedupe_key` nullable, unique. An enqueue with a key that is already queued is a no-op, so one
  pending job per subject (e.g. per contest) coalesces repeats. Claiming clears the key, so a new
  enqueue while the job runs queues a fresh one rather than being lost.
- Index `(status, run_at)` for the claim; the FK-index scanner applies as usual.

### Enqueue

`BackgroundJobs.enqueue(tx, { type, payload, runAt?, dedupeKey? })` takes the caller's transaction
client, so the job commits or rolls back with the write that caused it. The payload is validated
against the type's Zod schema at enqueue, and again at run, so a bad payload fails loudly where it was made.
An enqueue also wakes this task's runner, so a job on an idle system starts within milliseconds
on the task that queued it.

### Handlers

A registry `Record<BackgroundJobType, { payload: ZodSchema; run(payload, ctx) }>`, where `ctx`
carries the logger and the job's id and attempt. Exhaustive over the enum, so a new type without a
handler fails typecheck. Handlers must be idempotent: a retry after a crash mid-run runs them again.
Each one says how it is idempotent (outbox idempotency keys for emails, the sync-run ledger for syncs).

### The runner

- Starts in every core-api task (as the email sender does). It polls every
  `BACKGROUND_JOB_POLL_MS` (default 10000 since 2026-11-08, #1446; env-configurable like the cache TTLs, so test lanes can
  shorten it) and on a local wake.
- Claims up to N due rows with `FOR UPDATE SKIP LOCKED` (a row lock, which Derek allows as raw SQL),
  setting `RUNNING`, `attempts + 1`, `lease_until = now + 5 min`, and clearing `dedupe_key`. Two tasks never
  claim the same job.
- A `RUNNING` row whose lease has passed counts as due again. That is how a crashed or stopped
  task's job is picked up.
- On success: `SUCCEEDED`, `completed_at`. On a throw: back to `QUEUED` with `run_at` pushed 1, 5
  and 30 minutes, then `FAILED` with `last_error` and an error log. The error log is the alert
  hook: no new infrastructure.
- Runs each job `outsideRequest`, with its own read memo and no request query budget.
- On shutdown (`onClose`) it stops claiming and waits for in-flight jobs up to a short grace
  period; anything unfinished is re-run by lease expiry.
- Concurrency per task: a small fixed number (e.g. 2), so a burst of jobs can't take the pool
  that serves requests.

### Retention

The nightly cleanup gains a step: delete `SUCCEEDED` jobs older than 7 days and `FAILED` older than
30 days.

### No test-mode code

Tests drive the real runner. Unit tests inject the clock and call the runner's tick. Functional
tests wait on the outcome (the outbox row, the sync run's status) with the short poll interval. No
"run inline when testing" branch (`rules/testing-rules.md` §1B).

## The two moves

**#1387, contest-started and final-results emails.** The status transition and bracket-result
routes enqueue `CONTEST_STARTED_EMAILS` / `CONTEST_SETTLED_EMAILS` (payload: contest id), with
dedupe key `<type>:<contestId>`, in the transaction that moves the contest. The handler builds and
queues the league's emails exactly as today. The outbox idempotency keys keep a retry from sending twice.
Done when both routes are under the budget of 25 and their entries leave
`tests/functional/query-budget-allow-list.ts`. Trade-off accepted in #1387: the emails go out
seconds after the click instead of during it.

**Manual event sync.** `syncEventData` still writes the `SUBMITTED` sync runs (the ledger
the admin screen shows) and enqueues `MANUAL_EVENT_SYNC` (payload: sync run ids, scope) in the same
transaction. The handler runs `executeSubmittedEventSync`. A run already `IN_PROGRESS` or done is
skipped on retry, so the ledger makes it idempotent. The `outsideRequest(setImmediate(...))` call goes away.

**#1448, settling a finished event's contests.** A COMPLETED or CANCELLED transition writes
`SETTLE_SPORT_EVENT_CONTESTS` (payload: event id, settle time) in the write that moves the event,
and answers. The job sends a cancellation's C7 email and settles each contest with the leaderboard's
ranking (#1455). Each contest settles in its own write and leaves `COMPLETED`, so a retry picks up only
the contests an earlier try did not. The transition route leaves the query-budget allow list.
Leagues will soon hold hundreds of contests, so no per-contest loop stays in a request.

**#1460, settling a decided game's squares contests.** A game's result, a quarter score entered
after it, or its cancellation writes `SETTLE_GAME_CONTESTS` (payload: event, game, decided time) in
the match write's transaction. The job settles the squares contests on that game, reading the game
as it stands then, so a correction made before it runs is the one it settles from.

## Testing

- Unit: claim/lease/retry/backoff/FAILED state machine with an injected clock; dedupe coalescing;
  the claim clearing the key; the exhaustive registry; payload validation at enqueue and run.
- Integration (real Postgres): two runners never run the same job; an expired lease is re-claimed;
  an enqueue inside a rolled-back transaction leaves no job; retention deletes only what it should.
- Functional: each moved route returns before the work and the work lands (emails queued, sync
  run completed); both #1387 routes are under budget; a job that fails three times ends `FAILED` and logs an error.

## Tickets and order

1. **Background job table and runner** (#1440). Lands first and alone: schema, enqueue, registry,
   runner, retention, docs (`docs/` operational note and a `rules/architecture-rules.md` line:
   request-started work goes through a job, not `outsideRequest`).
2. **#1387** and 3. **Manual event sync as a job** (#1441): each after 1, independent of each other.

Rows 3.1's debounced leaderboard rebuild ("Precompute live leaderboard snapshots") can later move
onto this table (a `REBUILD_LEADERBOARD` job with a contest dedupe key and a `run_at` a few seconds
out). It isn't a dependency: that work ships with its own in-process debounce first.
