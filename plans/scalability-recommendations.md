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

## 1. Compute topology and background work

| # | Idea | Ticket | Cost | Benefit | Pri |
|---|---|---|---|---|---|
| 1.1 | Dedicated worker service; API tasks run no jobs | #1186 | S–M, +$10–20 | API CPU/pool isolated from settlement, sync, fan-out; API scales on traffic alone; stops every new API task adding an email sender | **P1** |
| 1.2 | ECS service autoscaling on API (CPU + ALB requests/target), min 2 | — | S, $0 base | Game-day spikes absorbed without a manual deploy | **P1** |
| 1.3 | Generic Postgres job table + worker claim loop (Recommendation 1) | — | M | Durable request → worker handoff; replaces in-process `setImmediate` work that dies with its task | **P1** (with 1.1) |
| 1.4 | Settlement and contest-start emails built by worker | #1387 | S (after 1.3) | Admin transition routes under budget; with 1.3, seconds of delay, not a sweep | P2 |
| 1.5 | Manual event sync runs as a job on the worker | — | S (after 1.3) | Long provider calls and score writes off API tasks; survives a deploy | P2 |
| 1.6 | Event create / clone / import as a job | #1253 (allow-list) | M | Heavy admin writes off the request; route back under budget | P3 |
| 1.7 | Commissioner bulk actions (year-in-review send, invite batches) as jobs | — | S each | Large leagues don't time out the request | P3 |
| 1.8 | Split job types across workers (ingestion vs email) | (out of scope in #1186) | S | Isolation if one job type starves another | P3 |

## 2. Database

| # | Idea | Ticket | Cost | Benefit | Pri |
|---|---|---|---|---|---|
| 2.1 | Performance Insights + `pg_stat_statements` + slow log on prod | #1246 | S, ~$0–10 | Real per-query evidence before tuning anything else | **P1** |
| 2.2 | Volume seed + nightly perf run at prod-like size | #1245 | M | Catches plan flips and scans that tiny QA data hides | **P1** |
| 2.3 | Keep job-lock connection on the direct writer endpoint (never behind a txn pooler/Proxy) | — | S (doc + guard) | Advisory locks stay correct if RDS Proxy or PgBouncer is added | **P1** (note) |
| 2.4 | Aurora Serverless v2 writer + reader; read pool opt-in for never-writing flows | #1156, #1187–#1192 | L, +$50–150 | Read scale-out; writer capacity scales with load | P2 |
| 2.5 | Re-check migration squash before Aurora move | #1188 | S | Clean QA rebuild on Aurora | P2 (with 2.4) |
| 2.6 | Field grid save as one statement | #1308 | S (raw SQL) / M (model) | One admin route under budget; no user-facing gain | P3 |
| 2.7 | Partition or archive append-heavy score tables (stat lines, golf rounds) by season | — | L | Keeps indexes hot after several seasons | P3 |

## 3. Caching

| # | Idea | Ticket | Cost | Benefit | Pri |
|---|---|---|---|---|---|
| 3.1 | Compute live leaderboards once per score write (worker), store a snapshot row with a version; reads serve the snapshot | — | M | Hottest game-day read becomes one PK lookup on every task; no shared cache needed | **P1**–P2 |
| 3.2 | ETag / 304 on polled endpoints keyed by snapshot version | — | S (after 3.1) | 30 s polls of unchanged boards cost no serialization or bandwidth | P2 |
| 3.3 | Long TTL (or no expiry, keyed by settle version) for settled contests, history, trophy room | — | S | Immutable reads stop hitting the DB; pairs with 2.4 | P2 |
| 3.4 | Short TTL cache of the caller's league membership/role for auth checks | — | S | Removes a repeat read from nearly every league-scoped request | P2 |
| 3.5 | AWS WAF rate-based rules at CloudFront/ALB (fleet-wide) instead of only in-memory limits | — | S, ~$10 | Real per-IP limits on login, reset, sign-up regardless of task count | **P1** |
| 3.6 | ElastiCache Redis (shared cache, cross-task invalidation, shared limits) | — | M, +$25–100 | Only if Recommendation 2's triggers fire | P3 |

## 4. Persistence fit

| # | Use case | Store | Ticket | Cost | Benefit | Pri |
|---|---|---|---|---|---|---|
| 4.1 | Core domain (leagues, contests, entries, picks, scores, standings) | Postgres (keep) | — | — | Relational integrity and tenant joins | — |
| 4.2 | Email outbox and send history | Postgres (keep; DynamoDB + TTL optional later) | — | — | Already decided; bodies cleared at 30 d, rows at 13 mo | — |
| 4.3 | Raw provider payloads (`provider_sync_runs.payload_json` / `details_json`) | S3, key on the row; lifecycle to IA/expire | — | S | Keeps the biggest JSON out of the DB and backups | P2 |
| 4.4 | Settled season archives (final boards, history exports) | S3 JSON, served via signed URL | — | M | Cheap immutable history; pairs with 3.3 | P3 |
| 4.5 | Admin uploads (field CSVs) | S3 then job (1.3) | — | S | Large uploads off the request body | P3 |
| 4.6 | Sessions, rate counters, feature flags | Stay as is (JWT + refresh rows; WAF; settings in Postgres) | — | — | No DynamoDB/Redis case | — |

## Suggested order

1. Launch set (P1): 1.1 + 1.3 together, 1.2, 2.1, 3.5, 2.3 note; 2.2 alongside.
2. First real game day: measure with 2.1, then 3.1 (and 3.2).
3. Traffic-driven: 2.4/2.5, 3.3, 3.4, 1.4, 1.5, 4.3.
4. Only on a trigger: 1.6–1.8, 2.6, 2.7, 3.6, 4.4, 4.5.
