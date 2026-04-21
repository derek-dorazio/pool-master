# Platform Logging and Observability — Domain Model

## Purpose

Define the first-pass logging model for PoolMaster backend services so request
flows, background jobs, admin operations, and failures emit consistent
structured events that are searchable in CloudWatch and compatible with future
log shipping or error telemetry.

## Core Concepts

### Log Event

A log event is a structured JSON record emitted to stdout through Pino/Fastify.
It is not a database record and not an end-user feature. It is an operational
artifact.

### Request Context

Request-scoped context should be attached to every request logger via Fastify
child loggers or equivalent bindings.

First-pass required context:

- `reqId`
- `sessionId`
- `userId`
- `isRootAdmin`
- `ip`
- `method`
- `route`

Optional context when available:

- `leagueId`
- `contestId`
- `entryId`
- `providerId`
- `eventId`

### Background Execution Context

Background jobs and non-request code should bind equivalent execution context
through child loggers.

First-pass examples:

- `jobType`
- `providerId`
- `sport`
- `eventId`
- `runId`

### Log Level Policy

The repo-wide log level semantics are:

- `debug`
  function calls, parameter bindings, diagnostic state transitions, and other
  verbose details that help trace execution without indicating a problem
- `info`
  meaningful lifecycle milestones, successful major operations, startup,
  ingestion summaries, sync completion, and other normal business/system events
- `warn`
  expected negative paths such as authorization denial, validation failure,
  missing-but-expected resources, and invalid business-state transitions
- `error`
  unexpected exceptions, failed background jobs, unhandled request failures,
  and `5xx` conditions

### Error Payload

Errors should be logged using the standard Pino `err` field so the serializer
captures:

- `type`
- `message`
- `stack`
- additional enumerable error properties such as `code`

### Structured Data Payload

Additional event-specific fields should be logged under a predictable `data`
object rather than spread indiscriminately across the root envelope.

## Ownership

| Concept | Owner |
|---|---|
| Log envelope structure | backend runtime/platform |
| Request-scoped bindings | Fastify hooks / logger helpers |
| Error severity policy | backend architecture rules |
| Audit persistence | existing DB-backed audit services |
| CloudWatch shipping | infrastructure / ECS task definition |

## Explicit Non-Goals

- This spec does not replace persisted audit logging.
- This spec does not define frontend/browser telemetry yet.
- This spec does not require Sentry, Datadog, or OpenTelemetry in the first
  pass.
- This spec does not make logs the source of truth for domain behavior; logs
  remain observability artifacts only.
