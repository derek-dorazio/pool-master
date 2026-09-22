# PoolMaster — Review Triggers

Every PR body carries a **Review triggers** section under `<!-- review:triggers -->`. It
names what this slice touched that warrants a closer read than a file list gives.

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
| Direct `fetch`/`axios` in the webapp | `check-no-non-sdk-fetch` |
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
