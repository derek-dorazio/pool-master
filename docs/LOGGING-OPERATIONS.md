# Logging Operations

PoolMaster backend services emit structured JSON logs to `stdout` through
Fastify/Pino. ECS ships those logs to CloudWatch Logs. This document is the
operator-facing quick guide for using that data in QA, staging, and production.

## Runtime Scope

This logging contract applies to runtime backend services:

- `packages/core-api/src/**`
- `packages/mock-contest-feed-provider/src/**`

It does not treat one-off scripts or archived frontend code as part of the
runtime logging surface. Remaining `console.*` usage in scripts is intentional
and out of scope for service diagnostics.

## Log Envelope

Typical fields in a runtime log event:

```json
{
  "level": "WARN",
  "ts": "2026-04-22T13:32:50.697Z",
  "service": "core-api",
  "env": "qa",
  "version": "24672605785",
  "reqId": "req-7q",
  "sessionId": "ff012e7f-e1d9-4697-91b3-930f2690d523",
  "userId": "90632501-9401-4fc0-92f7-c7deaa2a1288",
  "isRootAdmin": true,
  "ip": "127.0.0.1",
  "method": "POST",
  "route": "/api/v1/admin/providers/sync/:sport",
  "action": "admin.prepareSportSync.noProviders",
  "data": {
    "sport": "UFC"
  },
  "msg": "Sport sync preparation failed because no providers were registered"
}
```

Key fields:

- `level`
  `DEBUG`, `INFO`, `WARN`, `ERROR`, or `FATAL`
- `service`
  runtime source like `core-api` or `mock-contest-feed-provider`
- `reqId`
  request-scoped correlation id when the event is request-driven
- `sessionId`
  stable non-secret auth session id
- `userId`
  authenticated user id when available
- `isRootAdmin`
  whether the request is operating as the root-admin surface
- `route`
  normalized route pattern, not raw full URL
- `action`
  stable machine-searchable event name
- `data`
  structured branch-specific context

## Severity Policy

- `DEBUG`
  function entry/exit, parameter bindings, decision checkpoints
- `INFO`
  successful happy-path milestones
- `WARN`
  expected negative branches like validation failures, not found, denied, or
  invalid state transitions
- `ERROR`
  unexpected failures where the process continues
- `FATAL`
  unrecoverable startup or process-ending failures

## Recommended Log Levels By Environment

Set `LOG_LEVEL` explicitly per environment:

- local development: `info`
- QA defect investigation: `debug`
- routine QA validation: `info`
- staging: `warn`
- production: `warn`

The code supports overrides through `LOG_LEVEL`. Prefer explicit environment
configuration rather than relying on defaults.

## CloudWatch Usage

Each ECS task definition ships runtime logs to CloudWatch Logs. Use Logs
Insights against the relevant service log group.

Recommended workflow:

1. narrow by deploy window or incident time
2. filter on `level`, `action`, `route`, `reqId`, `sessionId`, or `userId`
3. pivot from a failing request log into the surrounding branch logs using
   `reqId`

## Logs Insights Queries

### Recent warnings and errors

```sql
fields @timestamp, level, service, action, route, msg
| filter level in ["WARN", "ERROR", "FATAL"]
| sort @timestamp desc
| limit 100
```

### Follow one request

```sql
fields @timestamp, level, reqId, action, route, msg, data
| filter reqId = "req-7q"
| sort @timestamp asc
```

### Follow one user session

```sql
fields @timestamp, level, sessionId, userId, action, route, msg
| filter sessionId = "ff012e7f-e1d9-4697-91b3-930f2690d523"
| sort @timestamp asc
```

### Root-admin activity

```sql
fields @timestamp, level, userId, route, action, msg, data
| filter isRootAdmin = true
| sort @timestamp desc
| limit 100
```

### Contest or draft problems

```sql
fields @timestamp, level, action, route, msg, data.contestId, data.entryId
| filter data.contestId = "CONTEST_ID_HERE"
| sort @timestamp asc
```

### Provider sync and ingestion failures

```sql
fields @timestamp, level, service, action, msg, data.providerId, data.sport, data.eventId
| filter action like /provider|ingestion|sync/
| filter level in ["WARN", "ERROR", "FATAL"]
| sort @timestamp desc
| limit 200
```

### Find repeated invalid branches

```sql
stats count(*) as occurrences by action, route, msg
| filter level = "WARN"
| sort occurrences desc
| limit 50
```

## Debugging Tips

- Start with `WARN` and `ERROR`; only widen to `INFO` or `DEBUG` when the
  timeline is unclear.
- Use `reqId` for one request and `sessionId` for multi-request user journeys.
- Use `action` over raw message text whenever possible; `action` is designed to
  stay stable even when message wording evolves.
- Prefer `data.*` fields for business identifiers like `contestId`,
  `providerId`, `sport`, or `entryId`.

## Current Completion Status

The service-wide logging rollout is complete for runtime backend services.
Future work, if needed, should be additive:

- external observability platforms
- dashboards/alerts built on top of CloudWatch
- script logging cleanup outside runtime service scope
