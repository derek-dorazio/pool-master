# Read replicas for read-only queries

**Tracking issue:** #1156

Written 2026-10-28 for Derek's review. No code yet. The questions at the end each carry the
answer this plan takes; a "yes" to all of them is enough to start.

## What we want

Much of the product only reads: the trophy room and league history, completed contests and
events, the marketing and event pages, the sport catalog, and the content of every email and
notification. As customer data piles up, those reads are what grow. A read replica is a second
database that Postgres keeps as a live copy of the main one. Sending those reads to it takes load
off the main database, and later we add more replicas (or move to Aurora) to scale out further
without touching the code again.

The plan gives core-api a second connection pool, the **read pool**, and a small, explicit way
for code to say "this read can come from the replica".

## How core-api reaches the database today

- One `PrismaClient` (Prisma 6.19), built in `buildApp` in `packages/core-api/src/index.ts` and
  shared through the `fastify.prisma` decoration. Every module gets it through `getAppPrisma`
  (about 40 call sites), and every repository adapter in `src/adapters` takes it in its
  constructor.
- One `DATABASE_URL`, set by Terraform in the task definition's `common_env`.
- Services often mix reads and writes. The cup service both lists cups and crowns them; the
  history service builds on it. Splitting the code into "read" and "write" services would touch
  most of the backend.
- Background work (the lifecycle scheduler's notification sweeps, the email sender, ingestion)
  runs outside any request, on the same client.
- Every email goes through the outbox, whose `idempotency_key` is unique. That matters below.

## The design

### Two pools, one client object

core-api builds two Prisma clients:

- the **primary**, from `DATABASE_URL`, as today;
- the **reader**, from a new `DATABASE_READ_URL`, through Prisma's `datasourceUrl` option.

`fastify.prisma` stays one object of type `PrismaClient`, so no adapter, service or wiring file
changes. It is a thin routing wrapper (a JavaScript `Proxy`) over the two clients:

- **Writes always go to the primary.** `create`, `update`, `upsert`, `delete`, the `...Many`
  forms and `$executeRaw`.
- **Transactions always run on the primary.** `$transaction` goes straight to the primary client,
  and the `tx` its callback receives is the primary's own, so every read inside a transaction is
  on the primary too.
- **Reads go to the primary unless the code around them asked for the replica.** `findUnique`,
  `findFirst`, `findMany`, `count`, `aggregate`, `groupBy` and `$queryRaw` check a request-scoped
  context (Node's `AsyncLocalStorage`), which holds a `ReadSource` enum value, `PRIMARY` or
  `REPLICA`. With no context, the answer is `PRIMARY`.
- **Once code writes inside a replica scope, the rest of that scope reads the primary**, so a
  read that follows its own write always sees it.

The default is the primary everywhere. Nothing moves to the replica until a ticket below opts it
in, which keeps each move small, reviewable and easy to back out.

We considered Prisma's official `@prisma/extension-read-replicas`. It does the opposite: it sends
every read to the replica unless code asks for the primary. In this codebase that would move
login, permission checks, the entry form right after a save, and every scheduler's "already
done?" check onto a copy that can lag. Question 1 asks Derek to confirm opt-in.

### How code opts in

One function, in `src/core/read-source.ts`:

```ts
readFromReplica(request, () => history.getSummary(leagueId))
```

- A **route handler** wraps the service call it wants on the replica. Permission checks run in
  `preHandler` hooks before the handler, so they still read the primary: a member removed a
  moment ago is refused at once, not after the replica catches up.
- **Background work** passes `null` for the request and wraps only its read-heavy part, such as
  assembling a standings email's leaderboard and recipient list.
- The function is the one place that decides. It returns `PRIMARY` when the read-your-writes
  window is open (below), when the replica is unhealthy, or when the kill switch is off. Every
  call logs the source it chose at debug level, and the request log line carries `readSource`
  (`rules/service-rules.md` §11 *Backend Logging*).

A lint rule keeps `readFromReplica` out of `$transaction` callbacks, where it would mean nothing.

### Read your own writes

A replica usually trails the primary by well under a second, but "usually" is not good enough
right after a person changes something. A commissioner crowns a cup and the page refetches it; it
must not show the cup uncrowned.

After any successful `POST`, `PUT`, `PATCH` or `DELETE`, core-api sets a cookie,
`poolmaster_recent_write`, with `Max-Age` of 5 seconds (the `readYourWritesSeconds` setting).
While a request carries it, `readFromReplica` reads the primary. The browser drops the cookie on
its own, so no clocks are compared. It carries no secret: forging it only sends that person's
reads to the primary.

### Replica health and the kill switch

- **Lag check.** Every 10 seconds core-api reads the primary's `pg_current_wal_lsn()` and the
  replica's `pg_last_wal_replay_lsn()`. If the replica has not yet replayed a position the
  primary reached more than `maxLagSeconds` ago (10 by default), the replica is unhealthy and
  every read goes to the primary until it catches up. Each change of state logs one warning.
  When the read pool points at the primary itself (no replica), `pg_last_wal_replay_lsn()` is
  null and the check reports healthy with no lag.
- **Unreachable replica.** A query on the replica that fails because the connection failed
  (Prisma `P1001`, `P1017`) marks the replica unhealthy and runs once more on the primary, with a
  warning. Other errors are raised as usual. This is a real answer from the real database, not a
  substitute, so it sits inside `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*.
  Question 7 asks Derek to confirm it.
- **Kill switch.** A new app settings group, `READ_REPLICA_CONFIG` in `platform_runtime_configs`
  (`routingEnabled`, `maxLagSeconds`, `readYourWritesSeconds`), editable from the root admin
  settings screen. Turning `routingEnabled` off sends every read to the primary within one
  settings refresh, with no deploy.

### The read pool is read-only everywhere, including tests

A real replica refuses writes on its own. So that a write in a replica scope fails in every other
environment too, `DATABASE_READ_URL` always opens read-only sessions:

- with a replica: the replica's endpoint;
- without one (local, CI, and any environment that has not turned a replica on): the primary's
  endpoint with `options=-c default_transaction_read_only=on`, so Postgres rejects any write on
  that pool. (Ticket 1 confirms Prisma 6 passes `options` through; if it does not, the same
  effect comes from a reader role created with `ALTER ROLE ... SET default_transaction_read_only
  = on`.)

`DATABASE_READ_URL` is required. core-api refuses to start without it, as it does without
`DATABASE_URL`. There is no "single pool" mode, so every environment runs the same code path, and
adding a replica later is only a change to where that URL points.

Each URL sets `connection_limit` and `application_name` (`core-api` and `core-api-read`) so the
pools are sized on purpose and visible in `pg_stat_activity`.

## What moves to the replica

The first moves are the ones Derek named, where a second of staleness cannot be seen:

| Area | Routes or work | Notes |
|---|---|---|
| Marketing and catalog | `GET /event-pages`, `/event-pages/:sport/:pageSlug`, `/sports`, `/sport-leagues` (list, detail, affiliations), `/contest-config-templates`, `/plans` | Changed only by root admins and migrations. |
| Trophy room and history | `GET /history/summary`, `/trophies`, `/records`, `/squads/:squadId`, `/squads/:squadId/years`, `/contests`; `GET /championship`, `/championship/:year`; `GET /cups` list, seasons, detail, squad points, projection | Not `GET /history/year-review`: the commissioner sends it and the page reads it back. |
| Completed contests | `GET /contests/:contestId`, its entries and all four leaderboards, **when the contest is settled** | The handler reads the contest's status on the primary (one row by key), then reads the heavy part from the replica only if it is settled. Open and live contests stay on the primary. |
| Completed events | event detail, matches, results and participants for events that are final | Same rule: status on the primary, the rest from the replica once final. |
| Email and notification content | the notification sweeps' assembly: leaderboards, member lists, contest summaries, the weekly digest, year in review | See below. |

**What stays on the primary:** sign-in and sessions, permission checks, anything the person is
editing (entries, picks, squads, invitations, settings), open and live contests, the email
sender's claim of outbox rows, ingestion, and every scheduler's decision about what is due.

**Notifications in detail.** A sweep first decides what is due ("this round finished, no email
yet"), then builds the email, then queues it. Only the build moves to the replica. If a lagging
replica made a sweep think an email was not yet queued, queueing it again hits the outbox's unique
`idempotency_key` on the primary and is skipped; ticket 4 adds a test that proves a duplicate
queue is a quiet no-op, not an error. Standings emails already wait
`EMAIL_CONFIG.standingsBufferMinutes` after their moment, far longer than any healthy lag.

**Live leaderboards** are probably the biggest read load of all on a busy Sunday, but they are
not on Derek's list and a live board is where staleness would show. Question 8 proposes moving
them only after a week of QA lag numbers.

**The replica does not fix slow queries.** It is a physical copy with the same indexes. N+1
patterns and missing indexes, which the parallel performance scan is looking for, cost the same on
a replica; fixing them comes first and helps both.

## Terraform

Derek applies from his Mac with the `apply-terraform` skill.

- New variables `db_read_replica_enabled` (default false) and `db_read_replica_instance_class`.
- `aws_db_instance.postgres_replica`, `count = var.db_read_replica_enabled ? 1 : 0`, with
  `replicate_source_db = aws_db_instance.postgres.identifier`, the same security group, encrypted,
  no backups of its own, `skip_final_snapshot = true`. It needs no name, user or password; those
  come from the primary. The source keeps backups on (QA already keeps 1 day), which RDS
  requires.
- `local.db_read_url`: the replica's endpoint when enabled, otherwise the primary's endpoint with
  the read-only option. It goes into `common_env` as `DATABASE_READ_URL` beside `DATABASE_URL`.
  When the production plan moves `DATABASE_URL` into Secrets Manager, `DATABASE_READ_URL` moves
  with it.
- Alarms in `monitoring.tf`: `ReplicaLag` over 30 seconds for 5 minutes, and replica CPU and
  connections, matching the primary's.
- An output with the replica endpoint, and `scripts/db-tunnel.sh` learns a `--replica` flag so
  Derek's read-only IDE connection can use the replica and leave the primary alone.

**Order matters once.** The core-api change that requires `DATABASE_READ_URL` can deploy only
after the task definition has it. So ticket 1's Terraform part (the variable pointing at the
primary, read-only) is applied to QA before ticket 1 merges. Turning on the replica afterwards is
one `tfvars` line and an apply; core-api picks up the new URL on its next deploy.

Creating a replica from a single-AZ source takes a snapshot, which briefly slows the primary's
disk; on QA nobody will notice. On Multi-AZ prod the snapshot comes from the standby.

**Cost.** A `db.t4g.micro` replica on QA is about $12 a month; a `db.t4g.small` on prod about $25
to $30, the same as its primary.

## Testing

Per `rules/testing-rules.md` §1A–§1C; nothing below changes application code for a test.

- **Unit, the router.** With two fake clients (test code only): a read inside `readFromReplica`
  reaches the replica; outside it, the primary; a write always the primary; a read after a write
  in the same scope, the primary; `$transaction` and its `tx`, the primary; the cookie, an
  unhealthy replica and the kill switch each send reads to the primary.
- **Unit, the health check.** Lag computed from the two positions; null replay position on a
  non-replica counts as healthy; a connection error marks unhealthy and retries once on the
  primary.
- **Integration and functional, every opted-in route.** CI and local runs set
  `DATABASE_READ_URL` to the test database with `default_transaction_read_only=on`. Every
  existing integration and functional test of an opted-in route therefore runs its reads through
  a read-only pool: one write slipping into a replica scope fails the suite with Postgres's
  "cannot execute ... in a read-only transaction". One integration test proves exactly that
  failure, so the guard cannot quietly stop working.
- **Integration, settled versus live.** A settled contest's leaderboard reads the read pool
  (asserted by `application_name` in the query log), a live contest's reads the primary.
- **QA, a real replica.** After the replica is on, watch `ReplicaLag` for a week of game days and
  check the read pool in `pg_stat_activity`. The browser E2E suite runs against it unchanged.

## Tickets

Sub-issues of #1156, created once Derek answers the questions.

1. **The read pool and the router.** `DATABASE_READ_URL` (required, in `types/process-env.d.ts`,
   `.env.example`, CI and the npm scripts), the second client, the routing proxy,
   `AsyncLocalStorage` and `ReadSource`, `readFromReplica`, the read-your-writes cookie, the lint
   rule, the router's unit tests and the read-only integration test, plus the Terraform variable
   pointing at the primary read-only (applied to QA before merge). New sections in
   `rules/architecture-rules.md` (how reads are routed) and `rules/service-rules.md` (how a
   route opts in). No route opts in yet.
2. **Marketing, catalog, trophy room and history on the replica.** The first two rows of the
   table. Small, and the first real use.
3. **Completed contests and events on the replica.** The status-then-replica rule for contest,
   entries, leaderboards and final events.
4. **Email and notification content on the replica.** The sweeps' assembly steps, and the
   duplicate-queue test.
5. **Replica health and the kill switch.** The lag check, the connection-error retry, the
   `READ_REPLICA_CONFIG` settings group on the root admin screen.
6. **The replica in Terraform.** The resource, the URL switch, alarms, output, the tunnel flag,
   README and `docs/DATABASE-ACCESS.md`; Derek applies to QA.

Ticket 1 goes first. Tickets 5 and 6 can run beside 2 to 4. Ticket 5 must merge before ticket 6 is
applied, so a lagging real replica is never read without the lag check in place.

## Questions, with the answer this plan takes

1. **Opt in, or everything reads the replica by default?** *Recommendation: opt in.* Default to
   the primary and move named reads over. Defaulting to the replica (Prisma's official extension)
   gets more load off sooner but makes every read in the app a possible stale read, including
   permission checks and "already sent?" checks.
2. **RDS read replica or Aurora?** *Recommendation: an RDS read replica now.* It is cheap, prod
   is not deployed, and the code only knows one read URL. Aurora gives one reader endpoint over
   up to 15 replicas, lag in milliseconds and automatic reader scaling, but its smallest instance
   costs about twice ours. Revisit when we need a second replica; moving then is a snapshot
   restore and a URL change, no code.
3. **Does QA get a real replica?** *Recommendation: yes,* about $12 a month, so routing and lag
   are proven on real replication before prod. Without one, QA's read pool points at the primary
   read-only, which still proves no write slips through but not the lag handling.
4. **Does prod launch with a replica?** *Recommendation: no.* Launch with the read pool on the
   primary (read-only), and turn the replica on with one `tfvars` line when the primary's CPU or
   connections approach their alarms. Saves about $25 to $30 a month until traffic needs it. If
   you would rather have the headroom from day one, it is the same line at launch.
5. **How long after a person's own change do their reads stay on the primary?**
   *Recommendation: 5 seconds,* as an app setting.
6. **How far behind may the replica fall before reads go back to the primary?**
   *Recommendation: 10 seconds,* as an app setting.
7. **If the replica cannot be reached, retry on the primary?** *Recommendation: yes,* once, with
   a warning, and mark the replica unhealthy. The alternative is an error page for history and
   marketing pages while the replica restarts.
8. **Move live leaderboards to the replica later?** *Recommendation: yes, but as a separate
   ticket after a week of QA lag numbers,* since a live board is where staleness would show and
   probably the biggest read load on a game day.
9. **Point your read-only IDE connection at the replica once it exists?** *Recommendation: yes,*
   so a heavy ad-hoc query never slows the live site.
