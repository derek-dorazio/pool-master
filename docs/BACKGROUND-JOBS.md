# Background Jobs

A request that starts work it does not wait for hands it to a **background job** (#1439): a row
in `background_jobs`, written in the same transaction as the change that caused it. Any core-api
task claims it, runs it, and retries it on failure; a deploy or a crashed task never loses it.
The code is `packages/core-api/src/modules/background-jobs`.

Recurring work (the lifecycle sweep, the provider loops, the nightly cleanup, the email sender)
stays on its own timer behind a job lock (`rules/architecture-rules.md` §4 *Background jobs run
on one server task*). The job table is for one-off work.

## The job types

| Type | Queued by | Handler | Why a retry is safe |
|---|---|---|---|
| `MANUAL_EVENT_SYNC` | A root admin's event sync (`submitEventSync`, #1441), with the `SUBMITTED` runs in one transaction | `IngestionService.runManualEventSync`: runs each run's feed in turn | It skips every run that is no longer `SUBMITTED`, so a feed an earlier try started never runs twice. A feed that fails is recorded on its run; the job still succeeds |

Adding a type: a value in `BackgroundJobType` (domain enum and Prisma enum, by migration), its
payload schema in `BACKGROUND_JOB_PAYLOADS`, and its handler where index.ts builds the runner.
Both registries are exhaustive over the enum, so a type missing either fails typecheck. Say in
the table above how the handler is idempotent.

## Queueing

`BackgroundJobQueue` checks the payload against its type's schema before anything is written,
so a bad payload fails in the request that made it.

- A job with a cause written elsewhere: `request(type, payload)` builds it, the adapter writing
  the cause writes it in its transaction (`insertBackgroundJobs(tx, …)`), and the caller calls
  `queued()` after the commit. `ProviderSyncRunRepository.createWithJob` is the model.
- A job on its own: `enqueue(type, payload)`.

Either way the queue wakes this task's runner, so on an idle system the job starts at once.

A `dedupeKey` keeps one pending job per subject: an enqueue with a key a queued job holds writes
nothing. Claiming a job clears its key, so a request made while it runs queues a fresh one.

## Running

Every core-api task runs the runner (the separate worker service, #1186, is paused). It polls
every `BACKGROUND_JOB_POLL_MS` (default 1000) and on each wake, claims at most 2 due jobs at a
time with `FOR UPDATE SKIP LOCKED`, and runs each outside any request: its own reads, no request
query budget.

| What happens | The job becomes |
|---|---|
| Claimed | `RUNNING`, one more attempt, leased for 5 minutes |
| The handler finishes | `SUCCEEDED` |
| The handler throws | `QUEUED` again, due 1, 5 then 30 minutes later; on the fourth failure, `FAILED` |
| Its stored payload fails its schema | `FAILED` at once: every try would fail alike |
| Its task stops mid-run | still `RUNNING` until the lease ends, then due again on any task |
| Its leases lapsed on every try | `FAILED` |

On shutdown a task stops claiming and gives its jobs in flight 10 seconds; anything still running
is re-run once its lease ends.

## Logs

Every line carries `action` and the job's id, type and attempt (`docs/LOGGING-OPERATIONS.md`).

| `action` | Level | Meaning |
|---|---|---|
| `backgroundJobs.succeeded` | info | Done, with its `durationMs` |
| `backgroundJobs.retry` | warn | Failed; tried again in `retryInMs` |
| `backgroundJobs.failed` | error | Failed its last try. This is the alert: look at the job's `last_error` |
| `backgroundJobs.invalidPayload` | error | Its payload failed its schema; it never ran |
| `backgroundJobs.abandoned` | error | Its leases kept lapsing |
| `backgroundJobs.runner.failure` | error | A claim or a write failed; the next poll tries again |

## Retention

The nightly cleanup deletes `SUCCEEDED` jobs 7 days after they finish and `FAILED` jobs after
30 days (`BackgroundJobRetention`).

## Testing

Tests drive the real runner, never a "run inline" branch (`rules/testing-rules.md` §1B
*Forbidden Application-Code Patterns*). Unit tests use the in-memory job table in
`tests/support/in-memory-background-jobs.ts` with an injected clock and call `drain()`. The
integration app's runner has no timer: a queued job wakes it, as in the app
(`integrationBackgroundJobs` in `tests/integration/helpers.ts`). Functional tests wait on the
outcome, such as a sync run's status.
