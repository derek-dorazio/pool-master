# Platform Logging and Observability — Flows

## 1. Request Flow Logging

1. Fastify accepts a request and assigns or reads a request ID.
2. A request hook derives logging bindings:
   - `reqId`
   - `sessionId`
   - `userId`
   - `isRootAdmin`
   - `ip`
   - `method`
   - `route`
3. Route handlers and downstream services use `request.log`.
4. Successful milestones log at `info`.
5. Verbose parameter/trace events log at `debug`.
6. Expected negative paths log at `warn`.
7. Unexpected thrown failures reach the global error handler and log at
   `error`.
8. Fastify returns the API error envelope to the client.

## 2. Background Job Logging

1. A scheduler, ingestion job, or scoring task starts.
2. A child logger is created from the app logger with job context:
   - `jobType`
   - `providerId`
   - `sport`
   - `eventId`
   - `runId`
3. The job emits:
   - `info` on start and completion
   - `debug` for useful detailed steps when enabled
   - `warn` for expected recoverable negative paths
   - `error` for failed execution
4. Logs flow to stdout and are shipped by ECS/CloudWatch.

## 3. Error Handling Flow

1. A request or background operation throws an error.
2. The logger records:
   - stable `action`
   - human-readable `msg`
   - structured `data`
   - serialized `err`
3. Expected request-side `4xx` errors log at `warn`.
4. Unexpected request-side `5xx` errors log at `error`.
5. Background job failures log at `error`.
6. The API continues returning the normal error envelope shape to clients.

## 4. Cloud Runtime Flow

1. Pino emits structured JSON to stdout.
2. ECS task definitions ship stdout/stderr into CloudWatch Logs.
3. Operators review logs in CloudWatch today.
4. Future error telemetry or external shipping can subscribe to the same JSON
   stream without changing the application logging contract.

## Rollout Strategy

### Phase 1: Platform Foundation

- central logger config
- request-context hook
- global error handler logging
- redaction
- replace obvious `console.*` drift

### Phase 2: High-Value Operational Areas

- auth
- contest create/update
- admin sync and re-ingest
- ingestion/scheduler
- scoring recalculation

### Phase 3: Full Backend Backfill

- remaining service modules adopt the shared logging policy
- missing warn/error/info/debug events are added across negative and success
  paths
- stale ad hoc logging patterns are removed
