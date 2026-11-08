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
| `CONTEST_STARTED_EMAILS` | Each contest that goes live (`EventLifecycleService`, #1387), with its move to `ACTIVE`. Payload: the contest and the event that started it; dedupe key `CONTEST_STARTED_EMAILS:<contestId>` | `ContestEmailJobs.contestStarted`: reads the contest and event again and queues "Contest is live" (E1) to the league | Each email's outbox idempotency key is the contest, the event and the person, so a retry queues only what an earlier try did not |
| `CONTEST_SETTLED_EMAILS` | Each contest that completes (`ContestSettlementService`, #1387), with its move to `COMPLETED`. Payload: the contest; dedupe key `CONTEST_SETTLED_EMAILS:<contestId>` | `ContestEmailJobs.contestSettled`: reads the final places frozen at settlement and queues "Final results" (F1 to F3); a contest no longer completed is skipped | As above, keyed by the contest and the person |

Adding a type: a value in `BackgroundJobType` (domain enum and Prisma enum, by migration), its
payload schema in `BACKGROUND_JOB_PAYLOADS`, and its handler where index.ts builds the runner.
Both registries are exhaustive over the enum, so a type missing either fails typecheck. Say in
the table above how the handler is idempotent.

## Queueing

`BackgroundJobQueue` checks the payload against its type's schema before anything is written,
so a bad payload fails in the request that made it.

- A job with a cause written elsewhere: `request(type, payload)` builds it, the adapter writing
  the cause writes it in its transaction (`insertBackgroundJobs(tx, …)`), and the caller calls
  `queued()` after the commit. `ProviderSyncRunRepository.createWithJob` is the model; a
  contest's status move takes its jobs as `ContestStatusTransition.jobs`, given the contests
  that moved.
- A job on its own: `enqueue(type, payload)`.

Either way the queue wakes this task's runner when it runs one (see *Running*), so on an idle
system the job starts at once; on an `api` task the job waits for a worker's poll, within
`BACKGROUND_JOB_POLL_MS`.

A `dedupeKey` keeps one job waiting for its first try per subject: an enqueue with a key such a
job holds writes nothing. Claiming a job clears its key for good, so a request made while it runs,
or while it waits to be retried, queues a fresh one.

## Running

Which core-api tasks run the runner is their role, `CORE_API_ROLE` (#1186):

| Role | Serves requests | Runs the background work | A queued email or job |
|---|---|---|---|
| `all` (unset; QA and local dev) | yes | yes | wakes this task's sender or runner |
| `api` | yes | no | waits for a worker's poll |
| `worker` | yes, but behind no load balancer: only health checks reach it | yes | from its own work, wakes it; from an API task, found by its poll |

The background work is the job runner, the email sender, the event lifecycle sweep, nightly
cleanup and provider ingestion (still also gated by `AUTO_START_SCHEDULER`). A worker's email
sender polls every second rather than every 15, since an API task's email never wakes it. An
unknown role stops the task at startup. The advisory job locks (#1159) hold in every role, so
old and new workers overlapping in a deploy run each scheduled job once. No environment runs
`api` or `worker` yet: the worker's ECS service is not in Terraform.

The runner polls every `BACKGROUND_JOB_POLL_MS` (default 1000) and on each wake, claims at most 2 due jobs at a
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
| A try outlives its lease and another task claims it | the newer attempt's outcome: each mark is fenced to the attempt that claimed it, so the late one writes nothing |

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
| `backgroundJobs.claimLost` | warn | A try outran its lease and the job was claimed again; this try's outcome was not written, the newer attempt's stands |
| `backgroundJobs.runner.failure` | error | A claim or a write failed; the next poll tries again |

## Retention

The nightly cleanup deletes `SUCCEEDED` jobs 7 days after they finish and `FAILED` jobs after
30 days (`BackgroundJobRetention`).

## Testing

Tests drive the real runner, never a "run inline" branch (`rules/testing-rules.md` §1B
*Forbidden Application-Code Patterns*). Unit tests use the in-memory job table in
`tests/support/in-memory-background-jobs.ts` with an injected clock and call `drain()`. The
integration app's runner has no timer: a queued job wakes it, as in the app
(`integrationBackgroundJobs` in `tests/integration/helpers.ts`). `deliverQueuedIntegrationEmail`
drains the app's jobs first, and `holdingBackgroundJobs` holds them back while a test counts a
request's own statements. Functional tests wait on the outcome, such as a sync run's status.
