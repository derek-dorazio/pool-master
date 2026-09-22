# Plan 134 — Rules Consolidation: Prohibitions over Inventories

**Tracking issue:** #133

## Purpose

Shrink `rules/` by applying one sorting principle:

> **Rules that describe what *exists* rot and are redundant — a frontier model reads
> `package.json` and the filesystem. Rules that describe what must *never happen* are
> gold, because that information exists nowhere else.**

`rules/` is 268KB across 15 files. A meaningful fraction is inventory — stack tables,
directory trees, library lists — that duplicates machine-readable truth and goes stale.
The prohibitions and invariants buried among it are the highest-value content in the
repo and are currently hard to find.

## Governing Principles

- **One canonical home per concept** (`workflow-rules.md §0`).
- **Rules describe the codebase that exists** (`architecture-rules.md §6`) — a rule that
  has drifted is worse than no rule, because it is read as current.
- **Durable decisions become ADRs**, not rule sections.

## Triggering Findings

**Inventory has already rotted.** `docs/DEVELOPER-SETUP.md` describes the PoolMaster web
app as "React + Vite + MUI". The app actually runs Radix primitives + shadcn-style
components + Tailwind, as `architecture-rules.md §1` correctly states and
`clients/poolmaster/package.json` confirms. Two documents disagree, and the one a new
contributor reads first is the wrong one. This is precisely the failure
`architecture-rules.md §6` warns against.

**`architecture-rules.md` is roughly 40% durable decisions, 60% inventory.** §1's stack
tables and §5's project structure restate `package.json` and `ls`. The iOS and Android
tables describe clients that do not exist yet.

**"No mock data" has two homes.** `architecture-rules.md §3` and `testing-rules.md §1B`
both own it, against `§0`'s one-canonical-home rule.

**A decision is filed as a rule.** `architecture-rules.md §2`'s validity-matrix guidance
(code vs DB, with criteria, tradeoffs, and a worked example) is textbook ADR shape sitting
in a rules file.

**`workflow-rules.md` mixes policy with runbooks.** This finding was written when the file
was 1093 lines and carried a Beads JSONL rebase recipe (~50 lines) and a GitHub App setup
runbook alongside durable process rules. Plans 132 and 139 have since removed both, so
re-measure before acting on the length argument.

## Key Decisions

### 1. Keep the prohibitions and invariants, verbatim where they are good

These stay, and should be easier to find afterward, not harder:

- **`testing-rules.md §1B`** — forbidden application-code patterns. The single
  highest-value section in the repo: it targets a real, well-documented agent failure
  mode, enumerates it concretely, and is scanner-enforced.
- **`testing-rules.md §1C`** — test-disable discipline.
- **`testing-rules.md §3`** — defect verification protocol.
- **`testing-rules.md §4`** — contract verification via `.safeParse()` on live responses.
  "Do not rely on TypeScript alone to prove runtime payload shape correctness" is exactly
  right and widely misunderstood.
- **`testing-rules.md §5`** — MSW rules and the ban on `vi.mock('@/lib/api-client')`.
- **`architecture-rules.md §2`** — the contract-first chain. The spine of the repo.
- **`architecture-rules.md §4`** — event-driven mutation discipline: idempotency under
  at-least-once delivery, explicit transaction boundaries, per-aggregate serialization.
  Genuinely non-obvious and documented nowhere else.

### 2. Delete the inventories

- `architecture-rules.md §1` — backend/frontend/infra stack tables.
- `architecture-rules.md §5` — project structure tree.
- The iOS and Android stack tables — speculative documentation for unbuilt clients.

What replaces them is a short pointer: the stack is what `package.json` says, and the
structure is what the filesystem says.

### 3. Dedupe "no mock data"

`testing-rules.md §1B` is the better-written of the two and is scanner-enforced. It
becomes canonical. `architecture-rules.md §3` collapses to a cross-reference, retaining
only the *Provider and Adapter Registry Discipline* subsection, which is genuinely
architectural and not covered by §1B.

### 4. Validity matrix becomes an ADR

The code-vs-DB matrix guidance moves out of `architecture-rules.md §2` into an ADR, with
its criteria and tradeoffs intact. It is a decision with rationale, not a rule.

### 5. Fix the DEVELOPER-SETUP drift

Correct the MUI reference. Audit the rest of that file against reality in the same slice —
where one inventory has drifted, others likely have.

### 6. Decompose `workflow-rules.md`

- ~~The Beads JSONL rebase recipe moves to `docs/`~~ — **done**: the tracker migration deleted it outright
  along with the tracker it served.
- ~~The GitHub App setup runbook leaves with Plan 132.~~ — **done**.
- What remains is durable process: document lifecycle, plan/tracker conventions, slice
  completion, branching and merge.

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 132** removes the App runbook; sequencing this after it avoids editing a section
  that is about to be deleted.
- ~~**Plan 139** determines whether the rebase recipe is relocated or deleted.~~ Settled: it
  was deleted outright with the tracker it served (ADR-0006), so there is nothing here to
  relocate.
- **Plan 133** uses `rules/` as the salvage destination for persona invariants. Running
  134 first means that destination is already organized.
- **Plans 136, 137, 138** all edit `testing-rules.md`. This plan does not restructure that
  file beyond the §1B dedupe, specifically to avoid collision — but see *Open Questions*.

## Execution Sequence

**First — inventory deletion.** `architecture-rules.md §1`, `§5`, and the mobile tables.
Low risk, immediately reduces the reading surface.

**Second — DEVELOPER-SETUP drift fix and audit.** Independent, and worth doing early since
it is actively misleading.

**Third — dedupe and relocate.** `§3` collapse to cross-reference; validity matrix to its
own ADR, taking whatever number is next when it is written.

**Fourth — `workflow-rules.md` decomposition.** After Plan 132 and ideally after 139, so
each removed section is removed once.

## Open Questions

- **Does `testing-rules.md` need its own consolidation pass?** At 954 lines it has the
  same inventory-versus-prohibition split, but three other plans are already queued
  against it. A fourth would collide. The alternative is folding a structural pass into
  Plan 136, which is already restructuring the layer sections.
- **How short should `rules/` get?** The principle sorts content but does not set a
  target. Worth deciding whether the goal is "remove the rot" or "get to a size a model
  reliably reads end to end," which are different endpoints.

## Sources / Prior Decisions

- Plan 132 — Review flow simplification (removes the App runbook)
- Plan 133 — Persona to task-shaped skills (salvages invariants into `rules/`)
- ADR-0006 — GitHub Issues as the live task tracker (**landed**; removed the rebase recipe and the `bd` quick reference)
- ADR-0002 — Plans are narrative; deleted after parent epic closes
