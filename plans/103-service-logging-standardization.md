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
- ensure every meaningful positive and negative branch in the service tier is
  both logged and proven by automated tests at the correct lower layer

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
- This rollout is a `log + prove` initiative, not a logging-only pass. Every
  worker slice must:
  - inventory the positive and negative branches in its owned code
  - add `debug`, `info`, `warn`, `error`, and `fatal` logs according to the
    severity rules below
  - verify that each branch is covered by a truthful unit or DB-backed
    integration test
  - add missing tests, refactor for testability where needed, and repair
    misshaped/untyped errors encountered during the pass
- Do not assert log message strings in automated tests. Tests must assert the
  natural branch outcomes:
  - typed exceptions
  - specific API error envelopes/codes
  - specific return values/state transitions
  - persistence-layer results
- Branch coverage work is expected across:
  - route/handler layer
  - mapping/translation layer
  - business/service layer
  - persistence/repository/query layer
- Local and QA development will typically run at `INFO`, occasionally `DEBUG`
  during defect investigation. Staging and production should assume `WARN` as
  the normal deployed floor, so `info` and `debug` must still be semantically
  correct even if often suppressed there.

## Severity Policy

- `debug`
  - function/service entry and exit points
  - parameter bindings and decision checkpoints
  - verbose step-by-step diagnostics that are useful only when troubleshooting
- `info`
  - successful happy-path milestones and completed business operations
- `warn`
  - expected negative branches:
    - validation failures
    - permission denials
    - not-found outcomes
    - invalid business-state transitions
    - recoverable degraded conditions
- `error`
  - unexpected exceptions
  - failed request handling
  - failed job execution where the process continues
- `fatal`
  - unrecoverable startup failures
  - process-ending failures
  - daemon/scheduler conditions where service health cannot be maintained and
    termination/restart is the correct response

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 103-001 | 1 | Add shared Pino/Fastify logger configuration for local, test, QA, and production | Completed | Shared logger config now sets structured JSON envelope metadata and level formatting for `core-api`; local pretty transport remains deferred until explicitly needed. |
| 103-002 | 1 | Add request-context logging bindings (`reqId`, `sessionId`, `userId`, `isRootAdmin`, `ip`, route metadata) | Completed | Request-scoped child loggers now bind truthful request/user/admin context. `sessionId` now comes from a first-class persisted auth session identifier carried in the access-token `sid` claim, not from secret token material. |
| 103-003 | 1 | Add redaction and serializers for error/header/token safety | Completed | Core logger foundation now redacts auth, cookie, token, and password fields before logs leave the service. |
| 103-004 | 1 | Log handled and unhandled errors in the global error handler using `warn`/`error` policy | Completed | Global error handler now logs expected `4xx` paths at `warn` and unexpected `5xx` failures at `error` before sending the error envelope. |
| 103-005 | 1 | Replace stray backend `console.*` usage with structured logger calls | Completed | Known backend `console.*` drift in admin audit fallback and standings rollup was removed in favor of shared structured logging. |
| 103-006 | 1 | Add focused tests for logger configuration, request-context bindings, and error-handler severity behavior | Completed | Added unit coverage that proves logger config metadata/redaction presence plus `warn`/`error` severity behavior in the global error path. |
| 103-007 | 2 | Instrument auth, account, and league membership flows with policy-compliant logs | Completed | Added branch-aware `debug`/`info`/`warn` logging plus unit, functional, and contract proof across auth/account handlers and league-membership permission paths. |
| 103-008 | 2 | Instrument contest management, contest creation, entry, and event-readiness flows | Completed | Contest management, contest/history lifecycle, standings, events, participants, and readiness flows now emit structured branch logs with matching unit and integration coverage. |
| 103-009 | 2 | Instrument root-admin, ingestion, scheduler, provider sync, and scoring flows | Completed | Root-admin/provider routes, ingestion scheduler, scoring, notifications, and operational reads now follow the shared logging policy with lower-layer proof. |
| 103-010 | 2 | Build a branch inventory and use-case-to-test matrix for each owned service slice | Completed | Worker-owned slices reviewed route, mapper/translation, service, and persistence branches directly in-code; the resulting branch inventory is expressed through the added logging coverage and owned test additions rather than a separate standalone matrix artifact. |
| 103-011 | 2 | Add or refactor lower-layer tests so every identified branch has truthful proof | Completed | Added/refined unit, integration, contract, and functional coverage across the owned slices until the full repo gate set passed with the new branch instrumentation in place. |
| 103-012 | 2 | Normalize misshaped/untyped errors discovered during branch coverage work | Completed | The pass corrected stale/stubbed tests, fixed history typing drift, and normalized route/service error handling where branch-proof work exposed shape inconsistencies. |
| 103-013 | 3 | Backfill remaining backend services with missing logs that adhere to the policy | In Progress | Final sweep is split into explicit child slices: `me8.5.2` admin support + auth/account services is complete; remaining child slices are `me8.5.3` contest-scoring + participant valuation helpers and `me8.5.4` draft/scoring engines + mock-provider operational flows. |
| 103-014 | 3 | Review CloudWatch searchability and document operational query patterns for QA/prod debugging | Not Started | Tracked as `me8.5.5` after the final code backfill slices land. |

## Worker Slice Strategy

Use parallel workers only with disjoint ownership and the same required
workflow in every slice.

Recommended slice ownership:

- `103-A`
  auth, account, consent, and session-related routes/services/mappers/tests
- `103-B`
  leagues, invitations, squads, member/owner flows, permissions, and tests
- `103-C`
  contest management, contests, drafts, standings/history-facing lifecycle
  services, mappers, and tests
- `103-D`
  events, participants, event readiness, and contest-ready field/persistence
  support
- `103-E`
  root-admin, ingestion, scheduler, provider sync, scoring, notifications, and
  operational services/tests
- `103-F`
  final repo-wide sweep for unmapped remaining modules, error normalization,
  CloudWatch/query documentation, and gap closure

Every worker slice must:

- inventory branches before changing code
- instrument each branch with the correct log level
- add or repair tests for each branch
- run the owned test classes after instrumentation/refactor work
- run the full required local repo gates before commit/push
- close or update the matching Beads item during slice closeout

## Recommended Slice Order

1. `103-001` through `103-006`
2. `103-010` through `103-012` as branch-inventory/test-proof scaffolding
3. `103-009`
4. `103-008`
5. `103-007`
6. `103-013` through `103-014`

## Acceptance Criteria

- backend requests emit structured logs with consistent request/user context
- global errors are logged with correct severity before error envelopes are
  returned
- expected negative paths are logged at `warn`
- unexpected failures are logged at `error`
- unrecoverable startup/process failures use `fatal` where appropriate
- high-value service areas use the shared logging policy
- routes, mappers, business logic, and persistence logic all have branch-aware
  logging instrumentation
- each identified positive and negative branch is covered by a truthful unit or
  DB-backed integration test
- tests assert natural branch outcomes rather than log strings
- branches that were not testable at the start of the pass have been refactored
  or isolated enough to make their logic testable
- misshaped or untyped errors discovered during the pass are normalized to the
  repo's architectural error standards
- a follow-on explicit backfill lane remains tracked until the remaining
  backend codebase is covered
