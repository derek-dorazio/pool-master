# ADR 0005: Cross-Tier Log Correlation via Client Trace/Request IDs

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

PoolMaster's webapp (browser) and core-api (Fastify) are two independent log
producers. Before this decision, there was no way to find "everything that
happened for this one user action" across both tiers — a backend log line for
a request had no link back to the browser session or the specific call that
triggered it, and the browser had no durable log destination at all (no
console access in production, no error tracker, no `window.onerror` capture).

This was designed and implemented as part of `plans/102-webapp-logging-observability.md`
(now deleted per ADR-0002 — the parent Beads epic `pool-master-hwt` closed).
This ADR exists specifically because the mechanism is durable, cross-cutting
infrastructure with a real design rationale (why two IDs, why sessionStorage,
why one shared log group), and that rationale would otherwise be lost when
the plan file is deleted.

**This ADR intentionally does not restate the mechanism as a behavioral rule
for feature developers** (contrast with `rules/*.md`). Feature code has no
seam that touches this system: headers are attached by one interceptor,
client log context is resolved by one logger singleton, and backend binding
happens in one Fastify plugin — never per-route, never per-feature. There is
nothing for a rule to guard against drifting, because there is no place
feature code could plausibly reimplement or bypass it. The audience for this
document is whoever next modifies the correlation plumbing itself, not
whoever is building a feature. Matching code comments live at the three
canonical implementation points (`clients/poolmaster/src/lib/api.ts`,
`packages/core-api/src/core/logger.ts`, `packages/core-api/src/modules/client-logs/service.ts`)
for anyone editing those files directly; this ADR is the fuller version for
someone who needs the "why," not just the "what."

## Decision

Two identifiers, with distinct scopes, join logs across tiers:

- **`X-Client-Trace-Id`** — one value per browser tab, generated on first use
  via `crypto.randomUUID()` and held in `sessionStorage`
  (`clients/poolmaster/src/lib/logger/client-trace-id.ts`). Identifies "this
  tab's session" across every request it makes. Attached to every outbound
  API call by the `client.interceptors.request.use(...)` interceptor in
  `clients/poolmaster/src/lib/api.ts` — not by feature code.
- **`X-Client-Request-Id`** — one value per outbound call, generated fresh
  each time. Identifies one specific request end-to-end. Attached by the same
  interceptor.

On the backend, `buildRequestLogBindings` in `packages/core-api/src/core/logger.ts`
reads both headers into the request-scoped child logger (`clientTraceId`,
`clientRequestId` fields), so every backend log line for that request carries
them automatically via `request.log.child(bindings)` — no per-route wiring.

The frontend logger (`clients/poolmaster/src/lib/logger/`) stamps the same
`clientTraceId` on every client-side log entry and batches them to
`POST /api/v1/client-logs`. The backend handler
(`packages/core-api/src/modules/client-logs/service.ts`) re-emits each entry
through the request-scoped logger at the level the client requested, tagged
`data.source: 'client'`, landing in the **same** CloudWatch log group as
backend logs (`/ecs/${name_prefix}/core-api`) — there is no separate
frontend-only log group.

To trace one user action across both tiers: filter CloudWatch Insights on
`clientTraceId` (spans the whole tab session) or `clientRequestId` (one
call). Filter on `data.source = "client"` to isolate browser-originated
entries within the shared group.

## Consequences

**Positive**

- Any backend or frontend log line can be joined to its counterpart with one
  filter, with zero per-feature instrumentation cost.
- No new CloudWatch infrastructure was needed — the client-logs endpoint
  reuses the existing core-api log group and retention policy.
- The mechanism is fully encapsulated: three implementation files, guarded by
  their own unit/integration tests (`logger.test.ts`, header-interceptor
  tests, `client-logs-handler.test.ts`). Feature code cannot break it by
  omission because feature code never participates in it.

**Tradeoffs / new constraints**

- `X-Client-Trace-Id` resets on tab close (sessionStorage, not localStorage)
  by design — a closed tab starts a new "session" rather than accumulating an
  ever-growing trace across unrelated browsing sessions. This means trace IDs
  cannot be used to correlate across a user closing and reopening a tab; that
  is an accepted limitation, not a gap to fix.
- Client-originated log entries share a log group and retention policy with
  backend logs (`data.source: 'client'` is the only distinguishing tag). If a
  future need arises for different retention or a dedicated alerting profile
  for client logs, that requires a deliberate infra change (a second log
  group or a subscription filter) — not assumed here.
- A third cross-tier identifier should not be added without the same
  scoping question this ADR answers for the existing two (tab-scoped vs.
  request-scoped) — otherwise the correlation story becomes ambiguous about
  which ID to filter on for a given question.

## Alternatives considered

- **Direct browser-to-CloudWatch shipping (Kinesis/Firehose).** Rejected: no
  such pipe exists, and exposing unauthenticated write IAM to the browser was
  not acceptable. Routing through core-api keeps correlation simple (the
  backend already owns request-scoped logging) and requires no new AWS
  surface.
- **A single combined trace ID instead of trace + request.** Rejected: a
  tab-scoped ID alone can't isolate one specific call among many from the
  same tab; a request-scoped ID alone can't answer "show me everything this
  session did." The two answer different questions and are cheap to carry
  together.
- **A dedicated frontend CloudWatch log group.** Rejected for the first
  implementation: `data.source: 'client'` on the shared group gives instant
  correlation with zero new infrastructure. Splitting later remains a
  one-file terraform change if retention/alerting needs diverge.
