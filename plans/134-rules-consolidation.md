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

**`architecture-rules.md` is roughly 40% durable decisions, 60% inventory.** ~~As written.~~
**Measured before slice 1 and the ratio is inverted:** of 309 lines, inventory was §1 (67)
plus §5 (32) = 99, or **32%** — durable was §2 (68) + §3 (40) + §4 (71) + §6 (7) = 186, or
60%. The sections named are still the right ones and the iOS/Android tables are still
speculative for clients that do not exist, but the payoff was ~99 lines, not a rewrite of
the file. Recorded because the original figure was being quoted as a reason to prioritise
this plan.

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

### 3. Dedupe "no mock data" — **corrected: one bullet, not a section collapse**

~~`architecture-rules.md §3` collapses to a cross-reference, retaining only the *Provider
and Adapter Registry Discipline* subsection.~~ **That would have deleted content that
exists nowhere else.** Both sections were read before acting:

- **`architecture-rules.md §3`** bans shipping fake data to users. It carries four
  TanStack/runtime anti-patterns (`initialData: mockData`, `queryFn: async () => mockData`,
  `catch { return mockData }`, `if (NODE_ENV === 'development') return mockData`) and the
  positive instruction *"surface loading/error/empty UI states; do not hide the defect with
  fake data."* None of that is in §1B.
- **`testing-rules.md §1B`** bans bending production code to accommodate tests. Its list is
  test-pressure shaped — "test mode" branches, suppressed errors, branches that exist solely
  to fail under test — and its escalation ladder ("the conclusion is never: modify the
  production code to make the test pass") has no equivalent in §3.

They are two different rules that overlap on **one bullet**: where test doubles are allowed
to live. §1B states it with exact paths; §3 restated it loosely. So §3 drops that one bullet
and cross-references §1B for it, and both sections survive. Two lines changed instead of a
section deleted.

The general lesson, worth carrying to the rest of this plan: *"these two files both mention
X"* is not the same as *"these two files both own X."* Read both before collapsing either.

### 4. Validity matrix becomes an ADR

The code-vs-DB matrix guidance moves out of `architecture-rules.md §2` into an ADR, with
its criteria and tradeoffs intact. It is a decision with rationale, not a rule.

### 5. Fix the DEVELOPER-SETUP drift

Correct the MUI reference. Audit the rest of that file against reality in the same slice —
where one inventory has drifted, others likely have.

### 6. Decompose `workflow-rules.md` — **re-founded; the original argument no longer holds**

- ~~The Beads JSONL rebase recipe moves to `docs/`~~ — **done**: the tracker migration deleted it outright
  along with the tracker it served.
- ~~The GitHub App setup runbook leaves with the review-flow simplification.~~ — **done**.
- What remains is durable process: document lifecycle, plan/tracker conventions, slice
  completion, branching and merge.

**Measured after both predecessors landed. The file is 944 lines, down from 1093, and the
runbooks really are gone — but the length did not go with them:**

| Section | Lines |
|---|---:|
| §0 Document Lifecycle | 72 |
| **§1 Plans and the Issue Tracker** | **391** |
| **§2 Rule and Documentation Maintenance** | **220** |
| §2A Source-Of-Truth Priority | 10 |
| §3 Required Local Validation | 51 |
| §4 Do Not Preserve Bad Patterns | 9 |
| §5 Finding Tasks | 14 |
| **§6 Branching, Review, Merge Cadence** | **167** |

§1 and §6 alone are 558 lines — 59% of the file. The largest single block, §1's Slice
Completion Checklist (~130 lines), was read: it is durable process, not a runbook.

**So the mixing-policy-with-runbooks premise is now false, and decomposition needs a
different justification or none.** The honest remaining argument is narrower: §1 has grown
to nineteen `###` subsections and is a file's worth of tracker convention living inside a
general workflow file. That may still be worth splitting — but it is an argument about one
section's growth, not about the file being a policy/runbook mixture.

**Decided: deliberately not done. The file stays whole.**

The premise was that the file mixes policy with runbooks. Plans 132 and 139 removed both
runbooks for unrelated reasons, so the reason to split went with them. What is left is 967
lines of durable process, which is a different situation from 967 lines where some of it did
not belong.

Splitting was rejected on one concrete ground: **the file is consumed sectionally, not read
end to end.** `AGENTS.md` routes to `workflow-rules.md` §0, §1, §3 and §6 individually by
task shape. Splitting would rewrite the path in every cross-reference across `rules/`,
`AGENTS.md` and the PR template while giving the reader the same experience — motion without
improvement.

Rejected alternatives, recorded so this is not re-raised: extracting §1's tracker
conventions into a `tracker-rules.md` (~250 lines, same routing cost); extracting §2 on an
audience argument (rule maintenance has a different reader than product work); and trimming
the 130-line Slice Completion Checklist, which addresses duplication rather than length and
is worth considering on its own merits later.

**One thing to watch rather than act on.** The Slice Completion Checklist's layer sections
now overlap the `add-endpoint` and `model-change` skills. Three artifacts touch the backend
layer chain: `service-rules.md` §4 states it, the checklist verifies it, the skills sequence
it. That is defensible — state, verify and sequence are different jobs — but it is where
drift will appear first. The checklist was audited for existing drift when this was decided
and none was found.

## Data Model / API Surface Implications

None.

## Dependencies

- ~~**The review-flow simplification** removes the App runbook~~ — landed; the runbook is
  already gone from `docs/CI-AND-QUALITY-GATES.md`.
- ~~**Plan 139** determines whether the rebase recipe is relocated or deleted.~~ Settled: it
  was deleted outright with the tracker it served (ADR-0006), so there is nothing here to
  relocate.
- **Plan 133** uses `rules/` as the salvage destination for persona invariants. Running
  134 first means that destination is already organized.
- **Plans 136, 137, 138** all edit `testing-rules.md`. This plan does not restructure that
  file beyond the §1B dedupe, specifically to avoid collision — but see *Open Questions*.
- **#158 is a fourth `testing-rules.md` collision**, added after this plan was written. It
  asks whether the `SKIP: #NN` marker convention in §1C survives at all; if it lands option
  (b), §1C changes substantially. This plan does not touch §1C, so the collision is
  merge-order only — but it is no longer a three-way overlap.

## Execution Sequence

**First — inventory deletion.** ✅ **Landed.** `architecture-rules.md §1` replaced with
*Stack Decisions*: the five stack tables are gone (the stack is what `package.json`,
`tsconfig.base.json` and `schema.prisma` say), and what survives is the part a manifest
cannot express — the deliberate absences (no external queue, no Redis), the single-web-app
prohibitions, and a note that the Swift/Android rules describe clients that do not exist.
`§5`'s directory tree is gone; its *Structural Rules* subsection stays, since those are
constraints the filesystem cannot state.

**Second — DEVELOPER-SETUP drift fix and audit.** ✅ **Landed.** The MUI reference was one
line inside an ASCII directory tree at `docs/DEVELOPER-SETUP.md:410`, now corrected to
Radix/shadcn + Tailwind. The rest of that file (493 lines) was audited against reality as
this decision instructs: Node ≥ 20 matches `engines`, PostgreSQL 16 / port 5432 / the
`DATABASE_URL` forms all match, and there are zero surviving Beads references. **Nothing
else had drifted** — the "where one inventory has drifted, others likely have" expectation
did not hold here, which is worth recording so the audit is not repeated.

**Third — dedupe and relocate.** ✅ **Landed.** `§3` dedupe reduced to one bullet per the
correction in Decision 3. The validity matrix moved to
[ADR-0007](../docs/adr/0007-small-validity-matrices-live-in-code.md) with its criteria,
tradeoffs and rejected alternatives intact; `§2` keeps a pointer plus the one genuine
prohibition (a matrix is a domain catalog, not a write permission).

**Fourth — `workflow-rules.md` decomposition.** ⏸ **Deferred.** Both predecessors landed,
but they removed the thing that justified this step — see Decision 6. Needs a decision on
the re-founded argument, and it overlaps `plans/142`.

## Result of slice 1

`rules/architecture-rules.md`: **309 → 246 lines**, with every durable decision retained and
one new ADR. Net reading-surface reduction across `rules/` is smaller than this plan
originally implied, for the reason recorded under *Triggering Findings*.

## Open Questions

- **Does `testing-rules.md` need its own consolidation pass?** At 954 lines it has the
  same inventory-versus-prohibition split, but three other plans are already queued
  against it. A fourth would collide. The alternative is folding a structural pass into
  Plan 136, which is already restructuring the layer sections.
- **How short should `rules/` get?** The principle sorts content but does not set a
  target. Worth deciding whether the goal is "remove the rot" or "get to a size a model
  reliably reads end to end," which are different endpoints.

## Sources / Prior Decisions

- `rules/workflow-rules.md §6` + `rules/review-triggers.md` — the landed review-flow simplification (removed the App runbook)
- Plan 133 — Persona to task-shaped skills (salvages invariants into `rules/`)
- ADR-0006 — GitHub Issues as the live task tracker (**landed**; removed the rebase recipe and the `bd` quick reference)
- ADR-0002 — Plans are narrative; deleted after parent epic closes
