# PoolMaster — Review Triggers

Every PR body carries a **Review triggers** section under `<!-- review:triggers -->`. It
names what this slice touched that warrants a closer read than a file list gives.

This file covers both halves of that: **§1–§4 are what an author discloses**, and **§5 is
what a reviewer looks for** on the one axis where a checklist genuinely helps. Performance
review is not a separate pass with its own vote — it is part of the ordinary review, run
when the diff has a performance surface and skipped when it does not.

This exists because the repo owner reviews at file-list-and-changeset resolution. That
altitude reliably catches scope creep, unexpected files, and structurally wrong changes. It
is less likely to catch a subtle problem *inside* a hunk that reads plausibly. Triggers
point at those.

The implementer declares them. It knows *why* it made each change; a reviewer has to infer
intent from the diff.

---

## 1. The dividing line: mechanical stays a scanner

**Do not list anything a scanner already catches.** Self-reporting it is strictly weaker —
an agent attesting "I added no fake data" is the same context that would have added it.

Already enforced mechanically, and therefore **not** triggers:

| Concern | Enforced by |
|---|---|
| Fake/mock data in application code | `check-no-mocked-api` |
| Skipped or disabled tests | `check-test-disable-discipline` |
| Env-var fallbacks | `check-no-env-fallbacks` |
| Direct `fetch`/`axios` in the webapp | `no-restricted-globals` / `no-restricted-imports` in `eslint.config.js` |
| Frontend types duplicating generated ones | `check-no-parallel-api-types` |
| Inline query keys, inline theme styles, bare controls | the corresponding `rules:check:*` scanners |
| Generated OpenAPI/SDK staleness | `api:check` |

Triggers cover only what needs **judgement** — things no scanner can infer and a file list
does not reveal.

---

## 2. The trigger list

State the trigger and one line of context. If none apply, write `None.`

### Authorization and data exposure

- A new or changed **mutating route** whose authority guard is not obvious from the diff —
  or that deliberately has none.
- A change to **auth or session middleware**, token issuance, or validation.
- A change to a **role or permission boundary**, including anything that widens what a
  commissioner or member can reach.
- A change that could cross the **league-isolation boundary** — a query, filter, or route
  where one league's data could become reachable from another.
- A response shape that newly exposes a field which was previously internal.

### Data safety

- A **migration that cannot be rolled back** without data loss. Also requires the
  blast-radius disclosure in `workflow-rules.md` §6.
- A **backfill or one-time data operation** against production-shaped data.
- A change to the **provider registry** or anything touching `ALLOW_MOCK_PROVIDERS` — a
  misconfiguration here can silently downgrade an environment to fabricated data.

### Performance

- A query that runs **per row** where a batch or `include` was available.
- A **new query shape** whose index support is unverified.
- A list or detail **payload that grew** materially, or a list endpoint with no upper bound
  on what it returns.
- **Blocking work on a request path** — file, network, or crypto operations in a handler.
- A change to **polling or refetch intervals**, or to cache invalidation behavior.
- A **new runtime dependency**, with a line on why an existing primitive did not suffice.

### Process

- A **defect-fix slice** where the failing test was not written and observed to fail first.
  That is a question the implementer knows the answer to and a reviewer can only infer.
- A slice that **deviates from its plan** or widens beyond its stated scope.
- Something the implementer **considered and deliberately did not fix**, with why.

---

## 3. Calibration is the whole design

**A trigger that fires on most PRs is noise, and noise is worse than nothing** — it trains
the reader to skim a section that looks like coverage.

So triggers are phrased as **conditions, not surfaces**:

- ❌ "Adds a mutating route" — a surface. Fires constantly.
- ✅ "Adds a mutating route whose authority guard is not obvious from the diff" — a
  condition. Should be rare.

**Maintenance rule:** any trigger observed firing on a majority of PRs gets narrowed or
removed. This is standing, not a one-time calibration pass. A trigger list that only grows
is one that stops being read.

---

## 4. What this gate actually guarantees

`check-pr-review-triggers` verifies the section **exists**. It cannot verify the triggers
are accurate or complete — no scanner can read a diff and know what the author was
uncertain about.

So the honest guarantee is: the implementer was prompted to think about it, and wrote down
what it thought. That is weaker than a second reader, and it is why the mechanical half
stays mechanical and why `/code-review` before opening a PR is worth the one command.

Self-disclosure catches the case where the agent knows it did something notable. It does
not catch the case where the agent did not recognise the significance.

### Why this is enforced at CI only

A second gate was once specified: a PreToolUse hook on PR creation that would block a PR
whose body lacked the section, catching it *before* the PR exists rather than after. It was
never built, and in September 2026 it was dropped deliberately rather than left outstanding.

The argument for it was that a creation-time prompt produces disclosure while a CI failure
produces compliance. That does not survive contact with what either gate can actually
check: **both verify presence, not quality.** A blocking hook is satisfied by typing
`None.` exactly as easily as CI is. It buys the same check earlier, not a better one.

Against that, the hook would have had to match every surface a PR can be created from —
`gh pr create` with `--body`, `--body-file`, or a heredoc; the GitHub MCP tool's `body`
field; a raw `curl` POST. **A matcher that silently fails to match is worse than no gate**,
because it manufactures confidence in a check that never ran. That exact failure had
already happened here once, to the tracker reconciliation `Stop` hook, which was keyed to
the `gh` CLI and was therefore inert in every cloud session.

So enforcement is CI-only, by decision rather than by omission. The cost is one CI cycle on
the occasions the section is forgotten. Nothing reaches `main` without it either way.

---

## 5. Reviewing for performance cost

The triggers in §2 say what an author should *disclose*. This says what a reviewer should
*look for* when the diff touches Prisma queries, list or detail endpoints, ingestion /
scoring / sync hot paths, frontend list rendering, or new runtime dependencies.

**Skip it when the diff has no performance surface.** A performance read of a copy-only or
tracker-only change produces speculative findings, and speculative findings are worse than
no findings — they train the reader to skim.

### The eight questions

Ordered roughly by how often they bite here.

| Category | The question to ask the diff |
|---|---|
| **N+1** | Does anything run a query per row where a batch or `include` was available? Look for a `.map()` or loop containing an `await` on a repository call. |
| **INDEX** | Does a new `where` / `orderBy` shape have index support? A new filter column, sort, or composite ordering is the common miss. |
| **BLOCKING** | Synchronous or slow work on a request path — file, network, crypto, or a large in-memory transform inside a handler. |
| **PAYLOAD** | Did a list or detail response grow materially? Does a list endpoint have an upper bound on what it returns? |
| **RENDER** | Avoidable rerenders, unstable keys, expensive derived work computed inline rather than memoized. |
| **BUNDLE** | Does a new dependency increase shipped JS where a local primitive already exists? |
| **CACHE** | Polling and refetch intervals, cache invalidation breadth. A mutation invalidating far more than it changed is load, not incorrectness. |
| **HOTPATH** | Repeated work inside ingestion, scoring, sync, or event-bus loops, where the multiplier is data volume rather than request count. |

Backend shapes are governed by `service-rules.md` §5 *Prisma and Persistence*; frontend
shapes by `react-ui-rules.md` §4 *TanStack Query Rules* and §5 *State, Effect, Form, And
Component Rules*.

### Calibration

The temptation is to rate everything high because it is a performance finding. Resist it —
a review where everything is urgent is one where nothing gets fixed.

- **Critical** — will take down or effectively disable a primary workflow at realistic data
  volume.
- **High** — a likely material regression on a hot path: an N+1 in a list endpoint, a
  missing index for a new common query, blocking I/O in a handler, a heavy dependency with a
  clear lightweight alternative.
- **Medium** — measurable but localized; can ride with a follow-up.
- **Low** — polish, or an optimization worth doing later.

**Prefer evidence over intuition**, and name the multiplier: per row, per request, per poll
interval, per event. "This looks slow" without a mechanism is not a finding. When evidence
is unavailable, say so and calibrate *down* — unless the cost is obvious from the code path,
in which case say that rather than implying a measurement that did not happen.

### Where it stops

- Do not block on speculative micro-optimizations. A hypothetical cost at hypothetical
  volume is a Medium at most, usually a Low.
- Do not demand a benchmark for every change. Ask when the disagreement is genuinely about
  magnitude and the path is hot.
- **Never propose optimizing by weakening correctness, authorization, validation, or
  generated-contract discipline.** A faster wrong answer is not a tradeoff, and those rules
  exist for reasons a performance read cannot see.
