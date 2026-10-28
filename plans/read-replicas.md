# Read replicas for read-only queries

**Tracking issue:** #1156

Written 2026-10-28; revised the same day after Derek's review (Aurora Serverless v2; no lag or
fallback machinery; only flows that never write go to the reader). No code yet. The questions at the end
each carry the answer this plan takes.

## What we want

Much of the product only reads: the trophy room and league history, completed contests and
events, the marketing and event pages, the sport catalog, and the content of every email and
notification. As customer data piles up, those reads are what grow. We move the database to
**Aurora PostgreSQL**: one writer instance and one or more reader instances over the same shared
storage. Aurora gives a **reader endpoint** that spreads connections over every reader, so adding
readers later scales reads out with no change to the app.

core-api gets a second connection pool, the **read pool**, on the reader endpoint, and a small,
explicit way for a read-only flow to say "read this from the reader".

## Decided with Derek

- **Aurora, not RDS read replicas.** Readers share the writer's storage, so they trail it by
  milliseconds (AWS quotes typically under 100 ms) instead of seconds, and one reader endpoint
  covers as many readers as we add.
- **Aurora Serverless v2 on QA and prod.** Each instance grows and shrinks its capacity with
  load, between a floor and a ceiling we set, instead of being a fixed size.
- **QA is single-AZ with no reader.** It is only for testing; prod gets the reader.
- **No read-your-writes window and no fallback.** No cookie, no lag check, no retry on the
  writer. A reader that is down is Aurora's to replace, as with any database outage.
- **Only flows that never write go to the reader.** Any workflow that writes and then reads stays
  entirely on the writer. That is what makes the millisecond lag invisible: no reader flow ever
  looks for a change it just made itself.

## How core-api reaches the database today

- One `PrismaClient` (Prisma 6.19), built in `buildApp` in `packages/core-api/src/index.ts` and
  shared through the `fastify.prisma` decoration. Modules get it through `getAppPrisma` (about
  40 call sites), and every repository adapter in `src/adapters` takes it in its constructor.
- One `DATABASE_URL`, set by Terraform in the task definition's `common_env`, pointing at a plain
  RDS instance (`aws_db_instance.postgres`).
- Services often mix reads and writes. The cup service both lists cups and crowns them; the
  history service builds on it. Splitting the code into "read" and "write" services would touch
  most of the backend.
- Background work (the notification sweeps, the email sender, ingestion) runs outside any
  request, on the same client.

## What Aurora needs from the app

Aurora PostgreSQL speaks the same protocol as Postgres 16, and the schema uses no extensions, so
Prisma, the migrations and every query run unchanged against the writer. Beyond Terraform, the
app needs only three things:

1. **The read pool and the opt-in** (next section). Without it, everything keeps working on the
   writer and the readers sit idle: Aurora does not send reads to a reader by itself.
2. **Sized pools.** Each URL sets `connection_limit` and `application_name` (`core-api`,
   `core-api-read`). Today the pool size is Prisma's default, about 3 connections on a Fargate
   task; ticket #1160 of the performance audit sets it, and this plan reuses that setting for the
   read pool.
3. **Nothing for failover.** When the writer fails, Aurora promotes a reader and moves the
   cluster endpoint to it in about 30 seconds. Queries in flight fail and Prisma reconnects, the
   same as a Multi-AZ failover on RDS today.

One property to know about: the reader endpoint balances **connections**, not queries. Prisma
opens its pool when the task starts and keeps those connections, so a reader added later gets
traffic only as tasks restart (every deploy restarts them). That is fine while readers are added
by hand. If we later want Aurora to add readers automatically under load, RDS Proxy in front of
the reader endpoint rebalances on its own; question 3 parks that for later.

## The design

### Two pools, one client object

core-api builds two Prisma clients:

- the **writer**, from `DATABASE_URL` (the cluster endpoint), as today;
- the **reader**, from a new `DATABASE_READ_URL` (the reader endpoint), through Prisma's
  `datasourceUrl` option.

`fastify.prisma` stays one object of type `PrismaClient`, so no adapter, service or wiring file
changes. It is a thin routing wrapper (a JavaScript `Proxy`) over the two clients:

- **Writes and transactions always go to the writer.** `create`, `update`, `upsert`, `delete`,
  the `...Many` forms, `$executeRaw` and `$transaction` (whose `tx` is the writer's own).
- **Reads go to the writer unless the code around them asked for the reader.** `findUnique`,
  `findFirst`, `findMany`, `count`, `aggregate`, `groupBy` and `$queryRaw` check a scope held in
  Node's `AsyncLocalStorage`, a `ReadSource` enum value, `WRITER` or `READER`. With no scope, the
  answer is `WRITER`.

Nothing moves to the reader until a ticket below opts it in.

### How code opts in

One function, in `src/core/read-source.ts`:

```ts
readFromReader(() => history.getSummary(leagueId))
```

- A **route handler** of a read-only flow wraps its service call. Permission checks run in
  `preHandler` hooks before the handler, so they stay on the writer.
- **Background work** wraps only its read-only part, such as assembling a standings email's
  leaderboard and recipients.
- The request log line carries `readSource` (`rules/service-rules.md` §11 *Backend Logging*).

**A write inside `readFromReader` is a bug, and it fails loudly.** The reader endpoint only takes
reads, so Postgres rejects the write with "cannot execute ... in a read-only transaction". That
is how the "never writes" rule is kept without anyone having to remember it.

### The read pool is read-only in every environment

Aurora readers refuse writes on their own. Local runs and CI have no reader, so there
`DATABASE_READ_URL` is the same database with `options=-c default_transaction_read_only=on`, and
Postgres rejects writes on that pool the same way. (Ticket 1 confirms Prisma 6 passes `options`
through; if it does not, a reader role with `ALTER ROLE ... SET default_transaction_read_only =
on` does the same.)

`DATABASE_READ_URL` is required: core-api refuses to start without it, as it does without
`DATABASE_URL`. There is no single-pool mode, so every environment runs the same code. Pointing
`DATABASE_READ_URL` at the writer is the off switch if we ever need one, with no code change.

## What moves to the reader

Only flows that never write:

| Area | Routes or work | Notes |
|---|---|---|
| Marketing and catalog | `GET /event-pages`, `/event-pages/:sport/:pageSlug`, `/sports`, `/sport-leagues` (list, detail, affiliations), `/contest-config-templates`, `/plans` | Changed only by root admins and migrations. |
| Trophy room and history | `GET /history/summary`, `/trophies`, `/records`, `/squads/:squadId`, `/squads/:squadId/years`, `/contests`; `GET /championship`, `/championship/:year` | Not `GET /history/year-review`: the commissioner sends it and the page reads it back. |
| Completed contests | `GET /contests/:contestId`, its entries and all four leaderboards, **when the contest is settled** | The handler reads the contest's status on the writer (one row by key), and reads the heavy part from the reader only if it is settled. Open and live contests stay on the writer. |
| Completed events | event detail, matches, results and participants for events that are final | Same rule: status on the writer, the rest from the reader once final. |
| Email and notification content | the notification sweeps' assembly: leaderboards, member lists, contest summaries, the weekly digest, year in review | Only the build of the email. Deciding what is due and queueing it stay on the writer. |

**What stays on the writer:** sign-in and sessions, permission checks, anything a person edits
and then sees (entries, picks, squads, invitations, settings), cups (a commissioner crowns one and
the page reads it back), open and live contests, the email sender, ingestion, and every
scheduler's decision about what is due.

**Live leaderboards** are probably the biggest read load on a busy Sunday. They never write, so
with Aurora's lag they could move too; question 2 asks.

**The reader does not fix slow queries.** It reads the same storage with the same indexes. The
N+1 patterns and missing indexes the performance audit (#1158) found cost the same on a reader;
fixing them comes first and helps both.

## Terraform

Derek applies from his Mac with the `apply-terraform` skill.

- `aws_rds_cluster.postgres` (engine `aurora-postgresql`, version 16, encrypted, the same subnet
  group and security group, deletion protection and final snapshot on prod) replaces
  `aws_db_instance.postgres`.
- Serverless v2: the cluster's `serverlessv2_scaling_configuration` sets the floor and ceiling
  in Aurora capacity units (one ACU is about 2 GB of memory and matching CPU), from new variables
  `db_min_capacity` and `db_max_capacity`. QA: 0.5 to 2. Prod: 0.5 to 4 to start (question 1).
- **QA has no reader** (`db_reader_count = 0`): it is for testing, so it stays in one availability
  zone with the writer alone. Its reader endpoint then lands on the writer, and the read-only
  option on `DATABASE_READ_URL` still makes every reader flow fail on a write, which is what the
  tests need. To try a real reader on QA for a day, set `db_reader_count = 1` and apply.
- `aws_rds_cluster_instance` for the writer, and `var.db_reader_count` more for the readers
  (`count`), each with instance class `db.serverless`. `db_instance_class` and
  `db_allocated_storage` go away: Aurora storage grows by itself. On prod the reader goes in a different availability zone from
  the writer. **On prod the reader is also the failover target**, so it replaces the Multi-AZ
  standby the production plan budgets for rather than adding to it. The reader sits in promotion
  tier 1, so its capacity never drops below the writer's and it is ready to take over at full
  size.
- `local.db_url` uses the cluster endpoint; a new `local.db_read_url` uses the reader endpoint
  with the read-only option (with no readers, Aurora's reader endpoint lands on the writer, and the
  option keeps that pool read-only all the same). Both go in `common_env`; when the production plan moves `DATABASE_URL` into Secrets Manager,
  `DATABASE_READ_URL` moves with it.
- `monitoring.tf`: the CPU, storage and connections alarms move from the instance to the cluster
  and instances (`FreeLocalStorage` in place of `FreeStorageSpace`, since Aurora storage grows by
  itself), plus `AuroraReplicaLag` over 1 second as a health signal.
- `outputs.tf` gives both endpoints. `scripts/db-tunnel.sh` gets a `--reader` flag, so Derek's
  read-only IDE connection reads a reader and leaves the writer alone. `docs/DATABASE-ACCESS.md`
  and the Terraform README follow.

**Moving QA.** QA holds no real data, and its events and fields are all checked in, so QA starts
fresh rather than copying the old database (Derek, 2026-10-28):

1. Apply the Terraform: it creates the empty Aurora cluster and deletes the RDS instance.
2. Run the **Reset QA database** workflow: it runs every migration (which also load the
   reference data, such as sports, contest setups and event pages) and creates the fixture users,
   root admin included.
3. Run **Load sport data** for the events and fields QA should carry.
4. Recreate the hand-made `poolmaster_readonly` role for the IDE (`docs/DATABASE-ACCESS.md` has
   the statement).

QA is only for testing (Derek, 2026-10-28), so nothing else carries over: QA starts on the code
defaults for every app setting (a root admin turns email on again when a test needs it), and
leagues, contests, accounts and events made by hand are not kept. Every sport data file loaded
on QA is in the repo (checked 2026-10-28), and "Load all test data" with test participants
rebuilds the test leagues.

**Squashing the migrations in the same move.** With no prod database yet and QA starting empty,
nothing anywhere needs the 207 migrations' history, so they become one baseline migration
(Derek, 2026-10-28). It must keep the reference data the migrations insert (sports, sport leagues,
contest setups, event pages, email templates), not just the tables. The proof: run the old chain
on one empty database and the baseline on another, then compare `pg_dump` of both, schema and
data, which must match exactly. `rules:check:migration-timestamps` and the schema drift check
pass on the result.

The baseline cannot deploy onto the old QA database (its migration history would not match), so
the order is: apply the Terraform (QA's database is now empty), merge the squash (the deploy's
migrate step builds the empty cluster from the baseline), then Reset QA and Load sport data.
Any open PR that adds a migration rebases onto the baseline, so the squash merges when no such PR
is mid-review.

**Prod** starts on Aurora when the production epic (#917) is applied; the production plan's
database rows change to match in the same PR as the Terraform.

**Order matters once.** The core-api change that requires `DATABASE_READ_URL` deploys only after
the task definition has it, so the Terraform ticket is applied to QA before ticket 1 merges.

**Cost.** Serverless v2 bills about $0.12 per ACU per hour, plus storage and I/O. At the floor
of 0.5 ACU an instance costs about $44 a month: QA, with its writer alone, idles at about $44,
and prod's writer and reader at about $90, rising only while load needs more. Each ACU held around the clock adds about $88 a
month per instance; the ceiling caps the bill (at 4 ACU, about $350 a month per instance flat
out). QA today is one `db.t3.micro` at about $13; the production plan assumed about $60 for
Multi-AZ RDS on prod.

Aurora can also pause an instance at 0 ACU when nothing is connected, but core-api's schedulers
and email sender keep connections open all day, so QA would never pause; the floor is 0.5.

## Testing

Per `rules/testing-rules.md` §1A–§1C; nothing below changes application code for a test.

- **Unit, the router.** With two fake clients (test code only): a read inside `readFromReader`
  reaches the reader; outside it, the writer; a write and a `$transaction` always the writer.
- **Integration and functional, every opted-in route.** CI and local runs set
  `DATABASE_READ_URL` to the test database read-only. Every existing test of an opted-in route
  therefore reads through a read-only pool, and a write that slips into a reader scope fails the
  suite. One integration test proves that failure, so the guard cannot quietly stop working.
- **Integration, settled versus live.** A settled contest's leaderboard reads the read pool
  (asserted by `application_name`), a live contest's reads the writer.
- **QA on Aurora.** The browser E2E suite runs unchanged; `pg_stat_activity` shows the
  `core-api-read` connections on the read-only pool.

## Tickets

Sub-issues of #1156, created once Derek answers the questions.

1. **Aurora in Terraform, and the QA move.** The cluster, writer, readers, both URLs, alarms,
   outputs, the tunnel flag, README, `docs/DATABASE-ACCESS.md`, the production plan's database
   rows, and the fresh-start steps for QA. Derek applies; nothing in the app changes yet
   (`DATABASE_READ_URL` is set but unread).
2. **Squash the migrations into one baseline.** The `pg_dump` comparison above in the PR body.
   Merges right after ticket 1 is applied to QA, then Reset QA and Load sport data.
3. **The read pool and the router.** `DATABASE_READ_URL` required (in `types/process-env.d.ts`,
   `.env.example`, CI and the npm scripts), the second client, the routing proxy, `ReadSource`
   and `readFromReader`, the unit tests and the read-only integration test. New sections in
   `rules/architecture-rules.md` (how reads are routed) and `rules/service-rules.md` (when a
   flow may opt in: it never writes). No route opts in yet. Can be built beside tickets 1 and 2;
   merges after ticket 1 is applied.
4. **Marketing, catalog and history on the reader.** The first two rows of the table.
5. **Completed contests and events on the reader.** The status-then-reader rule.
6. **Email and notification content on the reader.** The sweeps' build steps.

Tickets 4 to 6 can run in parallel once ticket 3 merges.

## Questions, with the answer this plan takes

Settled with Derek: Aurora, Serverless v2 on QA and prod, QA single-AZ with no reader and a fresh start (no snapshot), the migrations squashed in the same
move, no
read-your-writes or fallback machinery, write-then-read flows on the writer.

1. **How high may prod's capacity go?** The ceiling caps both performance and the bill.
   *Recommendation: 4 ACU per instance to start* (about 8 GB of memory each, at most about $350 a
   month per instance flat out), raised when CloudWatch shows instances sitting at it.
2. **Move live leaderboards to the reader too?** They never write and are the heaviest game-day
   read. *Recommendation: yes, as ticket 7 after tickets 4 to 6,* once QA shows the reader
   working.
3. **Automatic reader scaling (Aurora adds readers under load)?** *Recommendation: not now.*
   Serverless v2 already grows each reader; add readers by hand with `db_reader_count`, and
   revisit with RDS Proxy when one reader at its ceiling is not enough.
4. **Point your read-only IDE connection at the reader?** *Recommendation: yes,* so a heavy
   ad-hoc query never slows the writer.
