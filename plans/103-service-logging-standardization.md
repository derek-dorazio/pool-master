# Plan 103: Service Logging Standardization

## Purpose

Standardize backend service logging around Fastify + Pino so PoolMaster emits
consistent structured logs with request/user/session context, reliable error
logging, redaction, and durable operational signal across the entire service
codebase.

## Scope

- `packages/core-api/src/**`
- `packages/mock-contest-feed-provider/src/**`
- backend runtime logging configuration
- backend request hooks and global error handling
- backend module/service logging backfill
- supporting rules/docs/tests where needed

## Goals

- make QA and production defects diagnosable from backend logs
- standardize on one structured logging envelope and severity policy
- ensure expected negative paths produce `warn` logs and unexpected failures
  produce `error` logs
- ensure request and background-job logs carry useful context
- backfill missing logging across the backend after the platform foundation is
  in place

## Non-Goals

- frontend/browser telemetry
- replacing persisted audit logging
- introducing a full external observability suite in the first pass

## Execution Notes

- This plan is execution-oriented only. Technical truth lives in:
  [platform-logging-observability domain model](/Users/DDorazio/development/Github-Personal/pool-master/tech-specs/features/platform-logging-observability/domain-model.md),
  [api surface](/Users/DDorazio/development/Github-Personal/pool-master/tech-specs/features/platform-logging-observability/api-surface.md),
  and [flows](/Users/DDorazio/development/Github-Personal/pool-master/tech-specs/features/platform-logging-observability/flows.md).
- Platform changes come first. Full backend backfill starts only after the base
  logger pattern, request bindings, redaction, and global error logging exist.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 103-001 | 1 | Add shared Pino/Fastify logger configuration for local, test, QA, and production | Not Started | Establish JSON logs in deployed environments and optional pretty local formatting without changing service behavior. |
| 103-002 | 1 | Add request-context logging bindings (`reqId`, `sessionId`, `userId`, `isRootAdmin`, `ip`, route metadata) | Not Started | Use request-scoped child loggers so handlers/services can log with consistent envelope fields. |
| 103-003 | 1 | Add redaction and serializers for error/header/token safety | Not Started | Redact auth/cookie/token/password fields and keep `err` serialization consistent. |
| 103-004 | 1 | Log handled and unhandled errors in the global error handler using `warn`/`error` policy | Not Started | `4xx` expected negative paths should log at `warn`; unexpected `5xx` should log at `error`. |
| 103-005 | 1 | Replace stray backend `console.*` usage with structured logger calls | Not Started | Keep the surface small and truthful; do not backfill every module yet. |
| 103-006 | 1 | Add focused tests for logger configuration, request-context bindings, and error-handler severity behavior | Not Started | Prove the foundation works before backfill begins. |
| 103-007 | 2 | Instrument auth, account, and league membership flows with policy-compliant logs | Not Started | Success at `info`, parameter tracing at `debug`, expected denials/errors at `warn`/`error`. |
| 103-008 | 2 | Instrument contest management, contest creation, entry, and event-readiness flows | Not Started | Cover the main commissioner/member lifecycle and contest unblocking paths. |
| 103-009 | 2 | Instrument root-admin, ingestion, scheduler, provider sync, and scoring flows | Not Started | High-value operational area after the shared platform logger exists. |
| 103-010 | 3 | Backfill remaining backend services with missing logs that adhere to the policy | Not Started | Explicit service-wide logging backfill lane after platform and high-value modules are done. |
| 103-011 | 3 | Add lower-layer test coverage for critical negative-path logging behavior where feasible | Not Started | Focus on proving warn/error behavior for important failure classes, not snapshotting every log line. |
| 103-012 | 3 | Review CloudWatch searchability and document operational query patterns for QA/prod debugging | Not Started | Close the loop so operators know how to use the logs being emitted. |

## Recommended Slice Order

1. `103-001` through `103-006`
2. `103-009`
3. `103-008`
4. `103-007`
5. `103-010` through `103-012`

## Acceptance Criteria

- backend requests emit structured logs with consistent request/user context
- global errors are logged with correct severity before error envelopes are
  returned
- expected negative paths are logged at `warn`
- unexpected failures are logged at `error`
- high-value service areas use the shared logging policy
- a follow-on explicit backfill lane exists and is tracked until the remaining
  backend codebase is covered
