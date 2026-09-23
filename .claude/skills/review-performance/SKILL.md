---
name: review-performance
description: Reviewing a change for performance cost — N+1 queries, index support, blocking work on request paths, payload growth, render cost, bundle weight, and cache/polling behavior. Use when reviewing a diff that touches Prisma queries, list or detail endpoints, ingestion/scoring/sync hot paths, frontend list rendering, or new runtime dependencies.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash]
---

# Reviewing for performance

This is a **lens**, not a separate review. `/code-review` looks for correctness; this looks
for cost. Run it in addition when the diff touches a surface below, and skip it entirely
for copy-only, tracker-only, or single-component styling changes — a performance pass on a
diff with no performance surface produces speculative findings, which is worse than no pass.

`rules/review-triggers.md` §2 *The trigger list* → *Performance* defines which conditions
belong in a PR's disclosure. This file is how to look for them.

## What to look for

Work the diff against these eight. They are ordered roughly by how often they bite here.

| Category | The question |
|---|---|
| **N+1** | Does anything run a query per row where a batch or `include` was available? Look for a `.map()` or a loop containing an `await` on a repository call. |
| **INDEX** | Does a new `where`/`orderBy` shape have index support? A new filter column, a new sort, or a new composite ordering is the common miss. |
| **BLOCKING** | Is there synchronous or slow work on a request path — file, network, crypto, or a large in-memory transform inside a handler? |
| **PAYLOAD** | Did a list or detail response grow materially? Does a list endpoint have an upper bound on what it returns? |
| **RENDER** | Avoidable rerenders, unstable keys, expensive derived work computed inline rather than memoized. |
| **BUNDLE** | Does a new dependency increase shipped JS where a local primitive already exists? |
| **CACHE** | Polling and refetch intervals, cache invalidation breadth, missing cache boundaries. A mutation that invalidates far more than it changed is load, not correctness. |
| **HOTPATH** | Repeated work inside ingestion, scoring, sync, or event-bus loops, where the multiplier is data volume rather than request count. |

Backend shapes are governed by `rules/service-rules.md` §5 *Prisma and Persistence*;
frontend shapes by `rules/react-ui-rules.md` §4 *TanStack Query Rules* and §5 *State,
Effect, Form, And Component Rules*.

## Calibrating severity

The temptation is to rate everything HIGH because it is a performance review. Resist it —
a review where everything is urgent is one where nothing gets fixed.

- **CRITICAL** — will take down or effectively disable a primary workflow at realistic data
  volume.
- **HIGH** — a likely material regression on a hot path. An N+1 in a list endpoint, a
  missing index for a new common query, blocking I/O in a handler, a heavy dependency with
  a clear lightweight alternative.
- **MEDIUM** — measurable but localized. Can ride with a follow-up.
- **LOW** — polish, or an optimization worth doing later.

**Prefer evidence over intuition.** The changed query shape, the realistic row count, the
component's render shape, the dependency's size. When you cannot get evidence, say so
explicitly and calibrate *down* — unless the cost is obvious from the code path itself, in
which case say that instead of implying you measured something.

Stating "this looks slow" without naming the mechanism is not a finding. Name the
multiplier: per row, per request, per poll interval, per event.

## Report findings first

Lead with the table. If nothing is worth raising, say `No findings.` — padding a review
with speculative items trains the reader to skim it.

| Severity | Category | Finding | Location |
|---|---|---|---|

## Where this stops

- **Do not block on speculative micro-optimizations.** A hypothetical cost at hypothetical
  volume is a MEDIUM at most, and usually a LOW.
- **Do not demand a benchmark for every change.** Ask for one when the disagreement is
  genuinely about magnitude and the code path is hot.
- **Never propose optimizing by weakening correctness**, authorization, validation, or the
  generated-contract discipline. A faster wrong answer is not a tradeoff; those rules exist
  for reasons a performance pass cannot see.
- **This does not replace a correctness review.** If the diff is also wrong, that is
  `/code-review`'s finding, not this one's — raise it, but do not let a performance lens be
  the only read the change gets.
