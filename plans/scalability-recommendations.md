# Scalability recommendations for the prod rollout

**Tracking issue:** #1158 (related: #1156 read replicas). Research only; no tickets filed for new rows.

Written 2026-11-06 from a review of `main` at 6af455b. Priority: **P1** = before or at prod launch,
**P2** = when prod traffic shows the need, **P3** = only if a trigger fires. Cost: S < 2 days,
M ≈ 1 week, L > 1 week; $ = monthly AWS spend.

## Where we are

- ECS Fargate, one image, `desired_count` 2 in prod, **no service autoscaling**. Every API task
  also runs every background job: ingestion, lifecycle sweep + notifications, email sender,
  nightly cleanup, settings poll. Postgres session advisory locks (#1159) pick one runner per job;
  the email outbox is claimed with `SKIP LOCKED`.
- Single RDS Postgres 16 (Multi-AZ in prod), Prisma pool sized per task (#1160).
- Caching: CloudFront for public anonymous reads (#1181); per-task in-memory `ReadCache` (30 s)
  for leaderboards, event fields, catalog lists; per-request read memo; `BatchedRead` for N+1.
- Live leaderboards are computed on read; clients poll every 30 s.
- Rate limiting is in-memory per task (`SlidingWindowRateLimiter`).
- Request-started work (`outsideRequest` + `setImmediate`, e.g. manual event sync) runs on the API
  task that took the request and is lost if that task stops.

## Recommendations on the four questions

1. **Job transport: stay on Postgres.** Add one generic job table (same claim pattern as the
   email outbox: `SKIP LOCKED`, lease, retries) for request → worker handoff, polled every 1–2 s
   by the worker. Why: enqueue commits atomically with the business write (no dual-write), zero
   new infra, volumes are tiny (thousands/day, not thousands/s). SQS would need an outbox relay
   anyway to stay atomic; Redis adds a stateful cluster with weaker durability; DynamoDB loses
   the league/contest queries the sweeps use. **Revisit SQS** only if we fan one job out to many
   parallel consumers or adopt Lambda consumers.
2. **Caching: stay local in-memory + CloudFront; no ElastiCache yet.** With 2–4 tasks a 30 s
   per-task cache costs at most N× one computation per key per TTL. The bigger lever is
   computing live leaderboards once per score write (row 3.1), which makes a shared cache
   unnecessary for the hottest read. **Add Redis** when tasks exceed ~6, or we need
   cross-task invalidation (read-after-write across tasks) or fleet-wide rate limits that WAF
   can't express.
3. **Persistence: Postgres stays the system of record.** S3 for large, write-once blobs
   (raw provider payloads, archives). **No DynamoDB use case today**: the outbox was the only
   candidate and Derek kept it on Postgres (2026-10-30).
4. **Lambda: no.** Our background work is DB-heavy; Lambda brings VPC cold starts, connection
   storms against Postgres (needs RDS Proxy, which pins sessions on our advisory locks), and a
   second deploy shape. The worker service (#1186) covers every candidate below.

## 1. Compute and background work

| # | Idea | Ticket | Cost | Issue | Benefit | Pri |
|---|---|---|---|---|---|---|
| 1.1 | Dedicated worker service; API tasks run no jobs | #1186 | S–M, +$10–20 | Every API task runs every background job, so whichever task holds a job lock spends its CPU and connections on settlement, live sync and email while also serving users. | API tasks serve requests only and scale on traffic alone, and adding an API task no longer adds another email sender. | **P1** |
| 1.2 | ECS autoscaling on the API service (CPU and ALB requests per target), minimum 2 | — | S, $0 base | Prod runs a fixed two tasks with no autoscaling, so a game-day spike needs a manual change. | Spikes are absorbed automatically, and capacity drops back after the games end. | **P1** |
| 1.3 | Generic Postgres job table with a worker claim loop | — | M | Work a request starts in the background (such as a manual event sync) runs in memory on that API task and is lost if the task stops or redeploys. | Requests hand work to the worker durably, with retries, in the same transaction as the write that caused it. | **P1** |
| 1.4 | Settlement and contest-start emails built by the worker | #1387 | S (after 1.3) | The admin event transition routes build league emails inside the request and run 27 to 40 queries. | Both routes fit the query budget, and with the job table the emails go out seconds later rather than at the next sweep. | P2 |
| 1.5 | Manual event sync as a worker job | — | S (after 1.3) | A manual sync's provider calls and score writes run on the API task that took the admin's request. | That load moves off the API tasks, and a sync in progress survives a deploy. | P2 |
| 1.6 | Event create, clone and import as a job | #1253 | M | These admin routes do heavy writes inside the request and sit on the query budget allow-list. | The heavy writes move off the request and the routes come back under budget. | P3 |
| 1.7 | Commissioner bulk actions (year in review, invite batches) as jobs | — | S each | Bulk actions scale with league size and run inside the request. | Large leagues can't time out the request. | P3 |
| 1.8 | Split job types across separate workers | (out of scope in #1186) | S | With one worker, a long ingestion run can delay email delivery, or the other way round. | Each job type is isolated from the others; only worth doing if starvation shows up. | P3 |

## 2. Database

| # | Idea | Ticket | Cost | Issue | Benefit | Pri |
|---|---|---|---|---|---|---|
| 2.1 | Performance Insights, pg_stat_statements and a slow query log on prod | #1246 | S, ~$0–10 | We have no per-query evidence from real traffic, only query counts from tests. | Tuning is driven by what prod actually spends time on. | **P1** |
| 2.2 | Volume test data and a nightly performance run at prod-like size | #1245 | M | QA's small data set hides query plans that change at scale and scans that only hurt with many rows. | Those regressions are caught before customers see them. | **P1** |
| 2.3 | Keep the job-lock connection on the direct writer endpoint | — | S (doc and guard) | The job locks are session advisory locks, which break behind a transaction pooler and pin connections behind RDS Proxy. | Locks stay correct if RDS Proxy or PgBouncer is added later. | **P1** |
| 2.4 | Aurora Serverless v2 writer and reader, with an opt-in read pool | #1156, #1187–#1192 | L, +$50–150 | One Postgres instance serves every read and write, and read-only traffic grows with history. | Reads scale out on readers, and the writer's capacity grows and shrinks with load. | P2 |
| 2.5 | Re-check the migration squash before the Aurora move | #1188 | S | Migrations added since the 11-04 squash make a fresh Aurora build slower and noisier. | QA rebuilds cleanly on Aurora. | P2 |
| 2.6 | Save the field grid in one statement | #1308 | S raw SQL / M model | A full grid of new rankings or odds is one update per row and sits over the query budget. | One admin route gets under budget; there is no user-facing gain. | P3 |
| 2.7 | Partition or archive score tables by season | — | L | Stat lines and golf rounds grow every season and their indexes grow with them. | Indexes stay small and hot after several seasons. | P3 |

## 3. Caching

| # | Idea | Ticket | Cost | Issue | Benefit | Pri |
|---|---|---|---|---|---|---|
| 3.1 | Compute each live leaderboard once per score write and store it as a versioned snapshot | — | M | Live leaderboards are computed on read, once per API task every 30 seconds, from every entry, pick and field row. | The heaviest game-day read becomes one lookup on every task, and no shared cache is needed for it. | **P1–P2** |
| 3.2 | ETag and 304 on polled endpoints, keyed by the snapshot version | — | S (after 3.1) | Clients poll every 30 seconds and get the full board back even when nothing changed. | Unchanged polls cost no serialization or bandwidth. | P2 |
| 3.3 | Cache settled contests, history and the trophy room by settle version, with no expiry | — | S | These pages never change after settlement but are read from the database on every view. | Those reads stop hitting the database, which pairs well with the read replicas. | P2 |
| 3.4 | Short-TTL cache of the caller's league membership and role | — | S | Nearly every league request reads the caller's membership to check access. | One repeated read disappears from most requests. | P2 |
| 3.5 | AWS WAF rate-based rules in front of CloudFront and the ALB | — | S, ~$10 | Rate limits are kept in memory per task, so the real limit is the limit times the task count, and a deploy resets it. | Login, password reset and sign-up get real per-IP limits whatever the task count. | **P1** |
| 3.6 | ElastiCache Redis | — | M, +$25–100 | Caches are per task, so a value can be up to one TTL stale on other tasks. | Shared values and immediate invalidation; only worth it past about 6 tasks or when cross-task freshness matters. | P3 |

## 4. Persistence fit

| # | Idea | Ticket | Cost | Issue | Benefit | Pri |
|---|---|---|---|---|---|---|
| 4.1 | Core domain (leagues, contests, entries, picks, scores, standings): keep on Postgres | — | — | This data is relational and every query joins within a league. | Postgres keeps integrity and tenant joins; no other store fits better. | Keep |
| 4.2 | Email outbox and send history: keep on Postgres | — | — | DynamoDB with TTL was considered on 10-30 and set aside. | No change is needed: bodies are cleared at 30 days and rows deleted at 13 months. | Keep |
| 4.3 | Raw provider payloads (sync run payload and details JSON): move to S3, with the key on the row | — | S | Raw provider JSON is the largest data per row and is rarely read after the sync. | The database and its backups stay small, and S3 lifecycle rules expire old payloads cheaply. | P2 |
| 4.4 | Settled season archives: S3 JSON, served by signed URL | — | M | Final boards and history exports are written once and read rarely. | History is cheap to keep forever and pairs with 3.3. | P3 |
| 4.5 | Admin uploads (field CSVs): S3, then a job | — | S | A large upload is parsed inside the request body. | Big uploads no longer tie up an API request. | P3 |
| 4.6 | Sessions, rate counters and feature flags: keep as they are | — | — | JWT with refresh rows, WAF limits and settings in Postgres already cover these. | No DynamoDB or Redis case exists here. | Keep |

## Suggested order

1. Launch set (P1): 1.1 + 1.3 together, 1.2, 2.1, 3.5, 2.3 note; 2.2 alongside.
2. First real game day: measure with 2.1, then 3.1 (and 3.2).
3. Traffic-driven: 2.4/2.5, 3.3, 3.4, 1.4, 1.5, 4.3.
4. Only on a trigger: 1.6–1.8, 2.6, 2.7, 3.6, 4.4, 4.5.
