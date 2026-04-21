# Platform Logging and Observability — API Surface

This feature has no direct public HTTP API. The relevant surfaces are runtime
logger configuration and request/background execution hooks inside the backend.

## Backend Runtime Surfaces

| Surface | Actor | Request | Response | Notes |
|---|---|---|---|---|
| Fastify app logger config | system | n/a | structured JSON logs to stdout | Pino configuration defines the shared envelope, redaction, serializers, and environment-specific formatting |
| Fastify request logger | backend request lifecycle | automatic | structured request-scoped logs | every request receives child bindings for req/user/session context |
| Global error handler logging | backend request lifecycle | thrown error | log event + HTTP error envelope | warns on expected `4xx`, errors on unexpected `5xx` |
| Background job logger | ingestion/scoring/scheduler/admin tasks | job inputs | structured execution logs | child logger binds job metadata such as provider, sport, and event |

## Required Envelope Fields

Every structured backend log should include:

- `level`
- `time`
- `service`
- `env`
- `reqId` when request-scoped
- `sessionId` when authenticated session exists
- `userId` when authenticated user exists
- `ip` when request-scoped
- `action`
- `msg`

Recommended event-specific field:

- `data`

For errors:

- `err`

## Redaction Rules

At minimum redact:

- authorization headers
- cookies
- passwords
- access tokens
- refresh tokens
- secret-bearing config values if they could be logged accidentally

## Logging Call Shape

Preferred examples:

```ts
request.log.debug({
  action: 'contest.update_configuration',
  data: { contestId, mode: input.mode },
}, 'Updating contest configuration');

request.log.warn({
  action: 'contest.update_configuration.denied',
  data: { contestId, reason: 'contest_locked' },
}, 'Contest configuration update denied');

request.log.error({
  action: 'admin.prepare_sport_sync.failed',
  err,
  data: { sport, providerId },
}, 'Failed to prepare contest-ready sport data');
```

## Explicit Non-Goals

- no custom HTTP endpoint is required to adopt the logging policy
- no log-writing API should be exposed to frontend clients
