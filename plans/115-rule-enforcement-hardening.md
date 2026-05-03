# Plan 115: Rule-Enforcement Hardening (Post-Review)

**Beads:** `pool-master-1y8` — see `bd show pool-master-1y8` for live slice state. Task tracking lives in Beads; this plan is the narrative companion.

**Inputs:**
- `pool-master-rop` — the 2026-05-02 cross-stack code-review epic (8 thematic sub-epics, 67 file-anchored defects).
- `rules/*.md` — the entire current rule set (architecture, service, react-ui, testing, workflow, model-change, domain-model-conventions, ux, poolmaster-webapp).

## Purpose

PoolMaster's `rules/` directory contains thorough, well-thought-out guidance covering most of the failure modes that surfaced in the 2026-05-02 review. **The rules already forbid most of these patterns.** And yet 67 defects exist, distributed across the backend, frontend, and integration boundary, in code that was reviewed and merged.

This plan documents the diagnostic finding — that the rules are detection-poor, not knowledge-poor — and proposes 24 specific rule changes that convert prose bans into automated gates, fill the gaps in coverage, tighten escape hatches, and harden the workflow's reliance on Riley.

## Governing principles

- `rules/workflow-rules.md §0` Document Lifecycle — rules are durable; this plan is short-lived and gets deleted when the parent epic closes.
- `rules/architecture-rules.md §6` — "Architecture rules must describe the codebase that actually exists, not an aspirational future state." Today the rules describe an aspirational state. This plan moves them toward the actual state by making the aspirational pieces enforceable.
- `rules/workflow-rules.md §4` — "Strengthen rules when a refactor reveals a repeated failure mode." This plan is the formal application of that principle to the 2026-05-02 findings.

## Root cause analysis

After reading the full rule set against the 67 defects, the failures fall into five distinct causes. Most defects map to more than one cause.

### Cause 1 — Bans are prose, not gates

The rules contain explicit, named bans for many of these patterns. Each ban exists as **English text**; none is enforced by an automated check.

| Defect (rop child) | Already banned by | Why it shipped |
|---|---|---|
| 30+ tests use `vi.mock('@/lib/api')` (rop.4) | `react-ui-rules.md §7 Banned Test Patterns` lists this exact pattern | No ESLint rule, no CI grep |
| Inline `prisma.*` in `routes.ts` (rop.9) | `service-rules.md §10` lists the grep pattern | "Scan changed files" is presented as a developer habit, not a script |
| `additionalProperties: true` (rop.28) | `service-rules.md §10` | Same |
| `.map((` in handlers (rop.27) | `service-rules.md §10` | Same |
| `SuccessSchema` for domain data | `service-rules.md §10` | Same |
| Stale generated SDK (rop.17) | `architecture-rules.md §2`: "OpenAPI generation must be treated as part of the build contract" | `api:refresh` and `api:validate` exist as commands; neither is wired into a blocking CI gate |
| Tests without UC/BR/defect IDs (rop.10, rop.21) | `testing-rules.md §1A` | No grep, no lint |
| `as unknown as` in app code (rop.25, rop.32) | `service-rules.md §1`, `react-ui-rules.md §3` | TypeScript strict mode does not detect these casts |
| `.skip` without a Beads story | `testing-rules.md §1C` describes the grep verbatim | The grep "belongs in the lint or a dedicated test:no-undocumented-skips script" — but no such script exists |

The pattern is identical across every row: the rule names the offense and tells the developer to grep for it. Nothing automatically enforces the grep. On any individual slice, missing the grep is invisible. Across hundreds of slices, the misses accumulate into 67 defects.

### Cause 2 — Some patterns aren't covered by any rule

A second class of defects falls through gaps in the rule coverage entirely.

| Defect (rop child) | Closest rule | The gap |
|---|---|---|
| Provider registry hardcoded to `mock-contest-feed` (rop.5) | `architecture-rules.md §3` (no mock data) | The rule covers data; not factories that name a single allowed mock provider id |
| Synthetic zero-score returned for missing entries (rop.6) | `testing-rules.md §1B` | Listed under "to make a test pass," but the production-side fabrication is not called out independent of tests |
| Bare `<button>`/`<input>` despite shared components (rop.50, rop.51) | `react-ui-rules.md §5` says "prefer reusable components" | "Prefer" is not "must"; no detection mechanism |
| 12× duplicated `extractErrorMessage` (rop.19) | None | No rule requires checking for an existing helper before adding a new one |
| `useEffect` mirrors server query data into form state (rop.20) | `react-ui-rules.md §5` | The general "no useEffect for derived state" rule exists; the specific overwrite-on-refetch hazard for forms is not named |
| Stat-event recalc with no dedup or backpressure (rop.12) | `architecture-rules.md §4` | Says "at-least-once" but does not require idempotency or per-key serialization for state-mutating subscribers |
| Outer transaction missing on contest recalc loop (rop.11) | None | No explicit atomicity rule for event-driven recalc loops |
| UTC-only timing math (rop.38) | None | No timezone rule |
| Pagination as tech debt (rop.40 + epic rop.77) | None | No rule forbids pagination — and no rule mandates the functional-filter alternative. Per project owner direction (2026-05-02), pagination is being eliminated as tech debt across the entire API surface, not standardized. Story B5 codifies the no-pagination direction. |
| Index-as-key in `shared/ui` (rop.62) | None | Not mentioned anywhere |
| Giant page files: 935/1112/816 LOC (rop.49) | `react-ui-rules.md §5` "prefer reusable" | No threshold or trigger |
| 713-LOC dead modal `manage-league-modal.tsx` (rop.48) | `workflow-rules.md §0` "Delete on ship" | Applies to plans/specs, not production source files |

### Cause 3 — Escape hatches that get exploited

Several rules contain softening clauses that became the gap.

- `service-rules.md §4` says modules `config` and `health` are exempt from the mapper requirement. Eight modules ship without mappers, suggesting the exemption was treated as extensible rather than narrow. The rule does say "creating one is part of the slice — not deferred cleanup" but no slice catches the gap because the §10 grep is procedural.
- `testing-rules.md §1A` allows a "rule reference" fallback when "use-case-style traceability does not apply." Many backend tests exploit this fallback or skip the comment entirely; ~30 files ship with no IDs of any kind.
- `react-ui-rules.md §5` says "prefer reusable page sections/components." `manage-league-modal.tsx` is 713 LOC of dead code partly because no rule made it a slice failure to leave a 700-line component unused.
- `service-rules.md §7` says domain-specific error codes are required "when the domain reason is known." Handlers fall back to `BAD_REQUEST` because nothing forces a typed error code on the class itself.

### Cause 4 — Rules describe forward state, not legacy state

The rule set looks forward — "before commit," "in changed files," "in the same slice." Nothing mandates a periodic full-codebase audit. Defects like the 120 inline `isRootAdmin` checks (rop.41) and the 13 `as any` casts in one file (rop.32) accumulated over many slices because each individual slice was small enough to slip past §10's pre-commit grep — even if the grep had been enforced, which it wasn't.

The 2026-05-02 review itself was the first cross-stack audit in this codebase. There is no rule scheduling the next one.

### Cause 5 — Riley is a backstop that often isn't run

Most of the rules ultimately defer enforcement to the Riley persona:
- `testing-rules.md §1B`: "Riley flags any instance as a CRITICAL finding and blocks merge."
- `testing-rules.md §1A`: "Riley and Quinn rely on these references."
- `workflow-rules.md §6`: "Spawn Riley as a subagent."

Riley is invoked **by the implementing agent.** On a small team, that gate gets skipped under time pressure. The presence of 67 defects in code that all merged through `main` is direct evidence that Riley was not a reliable backstop.

## Worked example — how a single defect slipped through

To make Cause 1 concrete: defect `pool-master-rop.4` ("Generated SDK is mocked away with `vi.mock('@/lib/api')` in 30+ frontend tests").

The relevant rule, `rules/react-ui-rules.md §7 Banned Test Patterns`, says verbatim:

> - `vi.mock('@/lib/api-client')` or equivalent module-level replacement of the runtime API client for new tests

The first test file that violated this presumably looked like the right call — fast, isolated, no MSW boilerplate. It passed review. The second file copied the pattern from the first because that's how patterns propagate. By the time there were five files, the pattern was the codebase's de facto convention. By the time there were 30, no one was reviewing for it because "we always mock `@/lib/api` in tests" was tribal knowledge.

The chain of misses:
1. The rule existed in `rules/react-ui-rules.md §7` from the start.
2. The first slice to introduce `vi.mock('@/lib/api', ...)` violated the rule.
3. Riley was either not spawned for that slice, or did not catch it.
4. No CI check failed.
5. The pattern propagated through 29 more slices.
6. The 2026-05-02 review was the first time the pattern was named as a defect.

The fix in this epic — story A1 — is a literal grep script (`scripts/check-no-mocked-api.sh`) wired into pre-commit and CI. It would have failed on slice #1.

This pattern repeats across the 67 defects with different rule sections playing the same role.

## Categorization rationale

The 24 stories group into five categories based on what kind of change each one is. The categorization is what determines the order in §"Order of operations" below.

### §A — Automation gates (8 stories: A1–A8)

Each story is a single script or ESLint rule. They are **independent of each other** and can land in any order. They are also independent of any rule-text change — the rule already says don't do the thing; the script just makes the rule fail loudly.

These should land first because (a) they are mechanical, (b) they immediately stop new debt from accumulating, and (c) the cleanup epics that follow can be measured against them ("this PR's grep must pass before merge").

### §B — New rule sections (10 stories: B1–B10)

Each story is one new section or sub-section in a rule file. These cover the patterns no current rule addresses (Cause 2 above). They are **conceptually independent** but can be grouped for review:

- **Backend architecture:** B1 (provider registry), B2 (event-driven mutation), B3 (no synthetic lookups), B4 (typed error class), B5 (list envelope), B6 (timezone)
- **Frontend:** B7 (shared-component adoption), B8 (form-state hazard), B9 (page decomposition threshold)
- **Workflow:** B10 (delete dead source)

These are **the most reviewable** stories — they're prose additions to existing rule files, and the user can accept/reject/refine each one independently. The work here is mostly editorial.

### §C — Tighten escape-hatch language (4 stories: C1–C4)

Each story removes a softening clause from an existing rule (Cause 3 above). These are tiny edits — usually a single sentence — but each one materially changes how strict the rule is read. They should land **after** B (the new sections) because some of them reference the new sections.

### §D — Periodic review obligation (1 story: D1)

Adds a "Periodic Cross-Stack Review" section to `workflow-rules.md` (Cause 4). Solo story; lands at any point.

### §E — Riley enforcement (1 story: E1)

Modifies `workflow-rules.md §6` to make Riley non-optional and detectable (Cause 5). Solo story; depends on B10 / D1 conceptually but can land independently.

## Order of operations

```
1. Land §A (A1–A8) first.
   - Stops new debt from accumulating before cleanup begins.
   - Independent of every other rule-text change.
   - Each gate is one slice; the eight can run in parallel if reviewers are willing.
   - Recommended initial wave: A1, A2, A3, A5, A6, A7 — these are highest-leverage
     and lowest-noise. Defer A4 (test traceability) and A8 (useEffect mirror)
     until baseline false-positive rates are recorded, since both have parsing
     risk.

2. Land §B (B1–B10) next.
   - Larger conceptual additions; review one rule section at a time.
   - Each is a single rule-file edit. B4 and B9 must land before their §C
     dependents (C3 → B9, C4 → B4).

3. Land §C (C1–C4) after the §B sections they reference.
   - Prose-only, low-risk.
   - C3 depends on B9 (page-decomposition threshold).
   - C4 depends on B4 (typed error class discipline).
   - C1 and C2 are independent and can land alongside §B.

4. Land §D and §E last.
   - Both are workflow-rules edits.
   - E1b (Riley marker) is blocked by E1a (confirm/establish branch+PR-only
     flow as actually enforced) — see Open Question #5.
```

While §A is in flight, **do not start any of the eight thematic cleanup epics** under `pool-master-rop.68–.75`. The cleanup needs the gates to prevent regressions while it runs.

### Enforcement layer

CI is the authoritative gate for every §A check. Pre-commit hooks are an optional developer convenience that can be added later — they can be bypassed with `--no-verify`, their installation drifts across machines, and they must not be the only place a rule is enforced. When a §A story's acceptance criteria mention pre-commit, treat it as "may also run pre-commit," never "pre-commit instead of CI."

## Open questions

1. **Pre-commit hook installer.** Where does the project want the pre-commit hook bundle to live? Options: `husky` + `lint-staged`, raw `.git/hooks/pre-commit` shell script with a `scripts/install-hooks.sh` setup. If the team uses multiple environments, the husky path is more reliable; if every developer is the same person, the shell script is simpler. **Decision deferred to the user.**

2. **Severity of fail-on-new-occurrences scripts.** A4 (test traceability) and similar scripts that confront a backlog need a strategy: fail the build immediately (forces sweep before any further merges), warn-only initially (collects the backlog count), or threshold-based ("CI fails if the offender count goes up"). Recommend **warn-only for first slice; convert to fail-on-new in a second slice once the baseline count is known.** Confirm with user.

3. **ESLint plugin for shared-component adoption (A7).** Banning bare `<button>` outside `features/shared/ui/` is doable with `no-restricted-syntax` JSX selector. Banning subtler patterns like "use the local `Input` not a raw input wrapped in a `FormField`" requires either a custom rule or a project-specific ESLint plugin. **Recommend keeping A7 narrow** (block bare `<button>`, `<input>`, `<textarea>` outside `features/shared/ui/`) and treating richer patterns as Riley territory.

4. **Page-decomposition threshold (B9).** 400 LOC and 5 mutations are draft numbers. The current giants (935/1112/816 LOC) are obvious outliers; 400 LOC is a meaningful tightening without constraining ordinary feature pages. **Confirm threshold values with user before landing B9.**

5. **The "Riley invocation marker" CI gate (E1) presumes a PR-only workflow.** If direct pushes to `main` still happen in this repo, mandating a PR-body marker describes a world that doesn't exist. **E1 is therefore split into:**
   - **E1a** — confirm and enforce branch+PR-only flow (no direct pushes to `main`). This is the precondition. It may already be the case in practice; if so, this story is a confirmation + a CI/branch-protection check.
   - **E1b** — add the Riley findings marker requirement on top. Blocked-by E1a.

   The marker mechanism itself: a literal HTML comment `<!-- riley:findings -->` in every PR description, grepped via a `gh pr view --json body` CI step. Alternative (Riley as a bot account that posts a comment) is more complex. Recommend the marker approach for E1b.

## Backend contract questions

None — this plan does not change any backend domain model, DTO, or contract surface.

## Risk and reversibility

All 24 stories are reversible. Each one is either:
- a new file (script, ESLint rule) that can be removed with a `git revert`, or
- a rule-text edit that can be reverted via the same mechanism.

The riskiest stories are §A scripts that fail-on-existing-occurrences before the cleanup epics close. Mitigation: each §A script lands as **warn-only first**, the cleanup epics close, then a follow-up slice flips to fail-on-new. This adds 8 follow-up slices but de-risks the rollout.

## Validation plan

Each story closes when:
- the rule file is updated (or the script/lint rule is added) and committed;
- the relevant CI configuration (if any) reflects the change;
- if the change introduces an automated check, the check has been run on `main` and the output recorded in the closing note.

When the parent epic closes (all 24 stories in `closed` or `deferred`), this plan file is **deleted** per `workflow-rules.md §0`. The durable artifacts are the rules themselves.
