# PoolMaster — Workflow Rules

## 0. Document Lifecycle (Governing Rule)

> **One source of truth per concept. Working documents are deleted when the work ships. Durable decisions become ADRs. Git history is the archive.**

The repository uses layered artifacts. Each artifact has a clear lifetime and a single canonical purpose. Do not duplicate content across layers — reference instead.

### Durability tiers

| Tier | Artifact | Lifetime | Purpose |
|---|---|---|---|
| Permanent | `rules/*.md`, `.claude/skills/**/SKILL.md`, `docs/adr/*.md`, `AGENTS.md` | Months–years | How we build here; who does what; why we chose durable patterns |
| Permanent, local | Code comments at the implementation site | Life of the code | Why *this* code is shaped this way — hidden constraints, non-obvious invariants, mechanisms that would surprise a reader |
| Permanent | Top-level `requirements/product-requirements/*.md` — `domain-concepts.md`, `roles-and-actors.md`, `navigation-and-entry-points.md`, `glossary.md` | Months–years | What is *true* about the product: domain invariants, actors, information architecture. Durable despite the directory name — a relocation to a home named for what they are is tracked, not yet done |
| Feature-life | `requirements/product-requirements/features/<feature>/` | Weeks–months (during active feature development) | Product intent for a *major* feature; retire/delete when the feature stabilizes |
| Slice-life | `plans/NN-*.md` | Days–weeks (a single feature reorg or major effort) | Narrative execution context paired with a tracking issue; **deleted** when the parent epic issue closes |
| Pre-implementation | `tech-specs/features/<feature>/` | Up to ship | Technical framing before implementation; **deleted** when the implementation lands |
| Live | GitHub Issues | Hours–days | Current task state, slice list, status. Not a file in this repo — see `§1` |

### Governing rules

1. **One canonical home per concept.** If you're writing the same thing in two files, pick one and link from the other. Business rules live in `requirements/.../business-rules.md`. Task status and task lists live in GitHub Issues. Architecture decisions live in `rules/` or `docs/adr/`. The generated SDK + domain types are the API contract. The code + tests are the behavioral spec.
2. **Short-lived artifacts reference long-lived ones, never the reverse.** Plans reference rules, not vice versa. Issue comments reference plans, not vice versa.
3. **Delete on ship, don't archive.** When a plan's parent epic issue closes, the plan file is deleted in the same commit (or the next cleanup slice). When a tech spec's implementation lands on main, the spec is deleted. Git preserves history; `git show <sha>:path/to/file` retrieves any prior version. Archival directories are anti-patterns — files in the tree get read.
4. **Capture durable decisions as ADRs.** Decisions that outlast a single slice (architectural choices, cross-cutting patterns, hard boundaries) are written as Architecture Decision Records in `docs/adr/`. Once accepted, ADRs are immutable; supersede with a new ADR rather than editing.
5. **Rules absorb what plans learn.** If a plan introduces a durable pattern (a new convention, a hard boundary, a reusable approach), update `rules/` or write an ADR in the same effort. Don't leave the pattern only in the plan — it will be deleted when the epic closes.
6. **Delete-on-ship applies to production source too.** When a replacement UI,
   route, service, helper, or workflow ships, remove the superseded production
   source in the same slice unless a follow-up issue explicitly owns the
   retirement. Dead source files are not harmless; future agents read and copy
   them.
7. **Route knowledge to where its reader will already be standing.** Code
   comments are a first-class layer of this model, not an afterthought below
   `rules/` and `docs/adr/`. Each layer answers a different question for a
   different reader:
   - **Code comment** — *why is this code like this?* Read by whoever opens the
     file, which is exactly the person positioned to break it.
   - **`rules/*.md`** — *what do I do?* Read by someone doing work in this area,
     and only if they remember the rule exists.
   - **Top-level `requirements/product-requirements/*.md`** — *what is true about
     the product?* Domain invariants, actors, information architecture. Read by
     someone who needs to know how the product behaves, independent of how it is
     built. (These files are durable despite living under a directory named for
     inputs. Relocating them to a directory named for what they are is tracked
     separately and does not change their durability.)
   - **`docs/adr/*.md`** — *why is the system like this?* Read by someone
     questioning the approach, including the alternatives that were rejected.

   Three cuts separate these:

   **Comment vs rule** — does the knowledge constrain code that **exists** or code
   that **has not been written yet**? A comment can only reach the former. "Always
   use the shared logger" is a rule; it governs files not yet created. "This
   interceptor must run before X because Y" is a comment; it governs this file.

   **Rule vs product truth** — does it say *how we build* or *what is true*? "Prefer
   a new page over another tile" is a build convention, so it is a rule. "A user
   belongs to a league if and only if they own a team in it" is a fact about the
   product that would hold under any implementation, so it belongs with the
   product-truth layer. Invariants, actors, and deliberate absences live there;
   an absence — "there is no league-level Members page" — is invisible in code and
   has nowhere else to go.

   **Anything vs an ADR** — did you reject a viable alternative? The rejection is
   the value, and no other layer has somewhere to put it.

   Prefer a comment when the constraint is bounded by specific files someone must
   open to break it, and tests catch violation. Prose in `rules/` that describes
   one mechanism in one place is the weakest option available: nobody doing
   feature work will read it, and it drifts silently because nothing forces a
   revisit. A comment versions with the code and appears in every diff that
   touches it.

---

## 1. Plans and the Issue Tracker

### Plans are narrative; GitHub Issues is live task state

- **A plan file** (`plans/NN-*.md`), when the effort warrants one, is the narrative companion to a tracking issue: scope, rationale, architecture, site maps, tile mappings, open questions, references. Plans do **not** contain task tables.
- **The tracking issue** owns the task list as sub-issues, with statuses and comments.
- When a plan exists, it carries a one-line header at the top referencing its tracking issue (`#NN`); the issue links back to its plan in its body.

### Pick the right shape: issue / epic / plan + epic

Not every effort needs all three artifacts. Match the shape to the work.

- **One issue, no epic, no plan.** Single-slice work: a typo fix, a small bug fix, a one-file refactor, a routine dependency bump, a single follow-up. The issue body and its comments carry all the context needed.
- **One epic issue + sub-issues, no plan file.** Small efforts (≈2–3 slices) with no architectural narrative: a contained CRUD addition, a small targeted refactor, a couple of related cleanup slices. The epic body carries scope and sequencing; each sub-issue carries its own slice context.
- **Plan file + epic issue + sub-issues.** Major efforts: feature reorgs, new feature areas with site maps, cross-cutting refactors, anything that benefits from diagrams, authority models, tile-to-destination mappings, or a "settled decisions" section.

Promote a small effort to a plan file when:

- It grows past about three slices.
- A non-obvious architectural choice is being made.
- The narrative would benefit from a Mermaid diagram, site map, or structured pattern explanation.
- You catch yourself wanting to write more than a couple of paragraphs in an issue body — that paragraph wants to be a markdown file.

When in doubt, start small (issue-only or epic-only). It's cheaper to add a plan file later than to delete an empty one.

### Plan file structure

A plan file typically contains:

- **Tracking issue:** `#NN` — the parent epic issue
- **Purpose** — why this plan exists
- **Governing principles** — link to relevant rules/ADRs
- **Site map / structural references** (where applicable)
- **Architecture or pattern narrative** (authority models, URL structures, etc.)
- **Tile → destination mapping** (for reorgs; these are structural, not status)
- **Open questions** (unresolved product/contract calls)

What a plan file does **not** contain:

- Task tables with slice numbers, status columns, or Done markers
- Duplicated rule text
- Per-slice completion notes (those live in the issue's closing comment)

### GitHub Issues is the canonical task state

- Every active slice is a sub-issue of its plan's epic issue.
- Status transitions happen on the issue as work starts and completes: assign it when starting, close it when done.
- Slice context, scope changes, and closeout notes go in issue comments.
- When a slice closes, the plan file is not edited — the issue's closing comment captures the execution record. The plan file is updated only when scope, architecture, or open questions change.

### When a plan dies

- When the parent epic issue closes (all sub-issues closed), the plan file is **deleted** in a cleanup commit.
- Durable patterns/decisions the plan established must be codified before deletion, in whichever layer fits per `§0` governing rule 7: `rules/` for conventions that constrain code not yet written, `docs/adr/` for decisions with rejected alternatives, or a **code comment at the canonical implementation site** for a mechanism that is fully encapsulated and test-guarded. A plan that introduced a new convention without codifying it somewhere is not ready to be deleted.
- A well-placed code comment satisfies this requirement. It is often the *better* choice for a self-contained mechanism: `rules/` prose describing one implementation in one place is read by nobody doing feature work and drifts silently, while a comment is read by whoever opens the file and moves with the code. See `packages/shared/openapi/nullable-to-3-1.ts` for the reference example.
- git preserves the deleted file; it can be retrieved via `git log` / `git show` if historical context is needed.
- Do **not** move completed plans to `plans/archive/`. Archive directories grow and get read; deletion is the enforcement mechanism.

### Tracker conventions: epics, slices, sizing, naming

**Epics vs slices.** An epic issue represents a major effort (a feature reorg, a new feature area, a cross-cutting refactor). Each sub-issue is a single committable, validatable slice — typically one commit. If a "slice" naturally needs more than one commit, it's actually two slices.

**Sizing.** Aim for slices that close in 1–3 hours of focused work and produce one coherent commit. Layer-granularity is the default unit (schema + migration is one slice; service + repo is another; DTOs are another; mappers are another; route schemas are another; each test layer is a separate slice when meaningful coverage is being added). Bundle layers in one slice only when the layers are trivially small.

**Naming.**
- Epics: short imperative noun phrase that names the effort. Examples: "Root admin elevation", "Test data hygiene", "Contest event feed integration". Avoid date prefixes, internal version numbers, or references to the plan file number — issue numbers are stable and the plan file may be deleted later.
- Slices: short imperative phrase describing what the slice produces. Each title should make sense without reading the parent epic.

### Tracker conventions: scope of use

- Use one epic issue per active feature lane or cross-module initiative.
- Use sub-issues for refinement questions, design decisions, implementation slices, and verification/review slices.
- Keep the resolved truth in `requirements/`, `tech-specs/`, or `plans/` as appropriate; do not let the tracker become the only durable home for product or technical decisions.
- When a tracked question is resolved, update the corresponding document in the same effort or immediately after.
- When a plan already exists for the lane, keep the plan narrative in sync with the tracker for material milestones and direction changes.

### Tracker conventions: labels

**The repo has no label taxonomy yet, on purpose.** The Beads migration created none — the
original label strings are preserved as plain text inside each migrated issue body, so
nothing was lost, and a tracker this size does not need filtering to be legible.

Create a label the first time a query actually needs one, not in advance. If a family does
become worth creating, these are the ones the Beads history proved useful:

- **Layer:** `layer/schema`, `layer/service`, `layer/dto`, `layer/mapper`, `layer/route`, `layer/test-unit`, `layer/test-integration`, `layer/test-fapi`, `layer/test-e2e`, `layer/ui`, `layer/infra`, `layer/docs`.
- **Risk / scope:** `risk/high` (touches shared contract, schema, infra, auth), `risk/refactor` (no behavior change but broad blast radius), `risk/migration` (data migration / backfill), `cross-cutting` (affects multiple modules).
- **Workflow:** `blocked/external` (waiting on a third party), `blocked/decision` (waiting on a product call), `cleanup` (debt removal, no new behavior), `defect` (bug-fix slice — see Defect Verification Protocol in `rules/testing-rules.md` §3), `deferred` (consciously dropped scope).

`persona/*` labels are **not** carried forward — they encoded a role-shaped assignment model
the repo no longer uses.

An issue with 0–3 labels is normal. Don't turn labels into a taxonomy exercise; they should help future filtering, not document everything.

### Tracker conventions: dependencies

This is the one place the move off Beads lost capability, and it is worth naming rather
than papering over. Beads had first-class, queryable `blocks` / `blocked_by`. Plain GitHub
Issues does not: sub-issues model *parent/child*, not *ordering*.

So dependencies are prose, written where a reader will hit them:

- State the blocker in the blocked issue's body: `Blocked by #NN — <one line on why>`. GitHub
  renders the cross-link and shows the blocker's open/closed state inline, which covers the
  common case of "can I start this yet".
- Declare a dependency only when a slice genuinely cannot start until another closes (e.g.,
  DTO depends on schema; UI depends on regenerated SDK). "Should be done in this order for
  cleanliness" is narrative — that belongs in the plan file.
- Cross-epic dependencies are allowed and useful. A slice in Epic A blocked by a slice in
  Epic B is the right way to model genuine coupling between efforts.
- Circular dependencies are a smell. If two issues block each other, one of them is sized
  wrong — split it.

**If dependency order ever becomes load-bearing enough that prose stops working**, that is
the signal to adopt a GitHub Project with a relationship field — not the signal to build a
side-file tracker.

### Tracker conventions: issue comments

An issue's comments are the slice's execution record. Two comments per slice is the working norm.

**Starting comment** (added when work begins):

- Planned approach: which files will change, which patterns will be applied, which contract surfaces are touched.
- Risk callouts: anything the slice is being asked to be careful about.
- Validation plan: which gates will be run, and which test layers will be added, updated or **deleted** — see `rules/testing-rules.md` §1D, which makes deletion the default when the code under a test is going away. No use-case or defect ids are required.

**Closing comment** (added when the issue is closed):

- Files changed (paths only — diffs live in git).
- Decisions made: any non-obvious technical call that future readers should understand.
- Gates run: explicit list of validation commands and their results.
- For defect-fix slices: an explicit note that the failing test was observed to fail on the broken code before the fix landed (see `rules/testing-rules.md` §3 *Defect Verification Protocol*).
- Residual risk: anything left for follow-up, ideally with the new issue number that will own it.
- Spillover: if the slice touched files outside its declared scope, name them.

The closing comment is the canonical post-ship execution record for the slice. Plan files do not capture this — they're narrative-only.

### Tracker conventions: closed, deferred, reopened

- **Closed as `completed`** — work done; gates pass; commit landed.
- **Closed as `not planned` + `deferred` label** — work was scoped but consciously dropped. Add a closing comment explaining why and pointing at the future issue (if any) that picks it up.
- Reopening a closed issue is allowed when the closeout turns out to be wrong (e.g., a hidden regression surfaces). Add a comment saying why it's being reopened and what changed in the original validation.
- An issue that is "blocked, not deferred" stays open with a `blocked/*` label and a comment explaining what it's waiting on.

### Issue ↔ commit and PR linkage

- Reference the issue number in the commit message footer: `#NN`. GitHub links the commit onto the issue automatically.
- Put a closing keyword in the **PR body**, not in individual commits: `Closes #NN`. The issue then closes when the PR merges, which is the point at which the work is actually live.
- Reference the parent epic in the PR description alongside the slice's own issue.
- For defect-fix slices, also reference the defect ID in the failing test's traceability comment per `rules/testing-rules.md` §1A.

**Historical `pool-master-<suffix>` IDs.** Commit messages and test traceability comments
written before the migration still carry Beads IDs. They remain valid as
historical references — `git show <sha>:.beads/issues.jsonl` recovers any record, closed or
open — and they are deliberately **not** rewritten. Every migrated issue names its original
ID in its body, so searching the tracker for a `pool-master-` suffix resolves the mapping.

### Slice Execution Rules

- Keep one execution slice per commit unless the user explicitly approves bundling multiple slices together.
- Report every changed file in the final handoff for a slice. Do not summarize a broader file set as if it were narrower.
- If slice work exposes adjacent-slice files or tasks, stop and report that spillover instead of bundling it into the same commit.
- Coverage threshold changes are main-thread coordination work. Worker slices must not raise or lower thresholds on their own.
- Update tracker state only for the exact slice being worked. Do not close unrelated issues.
- Close a slice's issue only when the exact scoped work is complete and validated. Partial work stays open.
- A slice is not finished while any relevant required local test suite for that
  slice is still failing.
- "Implementation complete" without green relevant local validation is still
  `In Progress`, not `Done`.
- Defect-remediation slices must include an automated regression proof that
  would fail under the buggy behavior, then rerun the required broader local
  gates before the slice can move to `closed`.
- Targeted validation does not override the required repo gate set. When the
  rules call for full unit, functional, coverage, typecheck, or lint gates,
  those gates must be run even if focused nearby tests already passed.
- If a slice is pushed after only focused validation and CI then fails in a
  required gate that was skipped locally, treat that as a workflow miss in the
  slice closeout, not as an acceptable CI discovery pattern.
- Do not bypass required local database validation by making manual non-migration
  schema changes directly in the database. If a migration does not apply
  locally, fix the migration path or the local test-database state before
  treating the slice as validated.
- If code cleanup resolves a previously logged plan finding, reconcile that plan
  finding in the same or immediately following slice. Do not leave active plans
  implying drift that no longer exists in the codebase.

### Slice Completion Checklist (Required Before Marking Done)

Before marking any slice `Done`, reconcile the tracker so it matches the actual
repo state. A slice is not complete if the code, tests, and commit history say
"finished" but the corresponding issue still reads like active unfinished work.

**Tracker Reconciliation Gate:**
- [ ] The exact issue for the slice has been reviewed at closeout time
- [ ] The issue has been moved to the correct end state:
  - closed as `completed` if the scoped work is complete
  - closed as `not planned` with a `deferred` label if the remaining work is
    intentionally postponed
  - left open with a `blocked/*` label if it is waiting on something external
- [ ] If scope changed during implementation, the issue title/body was updated
      before closing it
- [ ] The parent epic was reviewed so it does not remain open merely because no
      one reconciled the sub-issue status
- [ ] The final slice handoff explicitly states which issues were closed,
      deferred, or remain active and why

The `Stop` hook (`.claude/hooks/check-tracker-reconciliation.mjs`) surfaces issue
numbers referenced by this session's commits that are still open. It is a
reminder, not a gate — it cannot tell a genuinely-unfinished issue from one the
PR will close on merge.

Common failure modes to avoid:

- finishing implementation but forgetting to close the corresponding issue
- leaving workflow/process items open as plain tasks when they are really
  ongoing behaviors or already-adopted rules
- leaving outdated task wording in place after the architecture direction has
  changed
- allowing CI firefighting or adjacent follow-up work to skip the tracker
  reconciliation step

The default rule is simple: if a slice is done enough to commit and announce as
complete, it is done enough to reconcile in the tracker during the same slice.

Before marking any backend slice task `Done`, run through this checklist for every domain object or endpoint touched by the slice. This checklist enforces the layer-completeness requirements from `rules/model-change-rules.md` and `rules/service-rules.md` as execution gates, not just reference material.

**Schema & Domain:**
- [ ] Prisma schema updated (if model changed)
- [ ] Migration generated (if schema changed)
- [ ] Shared domain types/enums updated in `packages/shared/domain/`

**DTOs & Mappers:**
- [ ] Explicitly confirm whether the domain/model changes require DTO/request/response updates. Default assumption: yes.
- [ ] Zod request DTO exists in `packages/shared/dto/<module>.dto.ts` for every request body
- [ ] Zod response DTO exists in `packages/shared/dto/<module>.dto.ts` for every response
- [ ] Mapper file exists at `packages/core-api/src/mappers/<module>.mapper.ts` with named export functions
- [ ] Handlers call mapper functions — no inline `.map()` transformations in route or handler files

**Route Schemas:**
- [ ] Every route uses `zodToJsonSchema()` for request and response schemas — no inline `{ type: 'object', properties: ... }` JSON objects
- [ ] No route uses `SuccessSchema` or `passthroughResponseSchema` for endpoints returning domain data
- [ ] Every route has `operationId`, `summary`, and `tags`
- [ ] Changed backend/shared contract work also satisfies the contract-documentation checklist from `rules/service-rules.md`

**Tests:**
- [ ] Unit test exists for service logic
- [ ] DB integration test covers create, read, update, delete/inactivate, findById for new/changed domain objects
- [ ] Contract-verification case added to `contract-verification-web.integration.ts`, `contract-verification-root-admin.integration.ts`, or an equivalent contract-verification suite for every new/changed endpoint
- [ ] Coverage on changed files ≥ 80% statements
- [ ] Positive documented use cases affected by the slice are covered at an
      appropriate automated layer
- [ ] Negative/error/permission use cases affected by the slice are covered at
      an appropriate automated layer
- [ ] Every new test's name states the behavior and expected outcome; defect-fix tests reference their issue number, per `rules/testing-rules.md` §1A *Test Self-Documentation*
- [ ] For defect-fix slices: a failing test reproducing the defect was written *before* the fix and observed to fail on the broken code, per `rules/testing-rules.md` §3 *Defect Verification Protocol* (record the observation in the issue's closing comment)
- [ ] No application code was modified to make a test pass — no fakes, fallbacks, hardcoded responses, "test mode" branches, or synthetic defaults were added to production paths, per `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*
- [ ] No `.skip` / `.todo` / `xit` / `it.fails` / `describe.skip` markers were introduced — there is no marker that exempts one — per `rules/testing-rules.md` §1C *Test-Disable Discipline*
- [ ] If the slice instruments logging or branches, each identified positive
      and negative branch is covered by a truthful automated test at the
      appropriate layer
- [ ] Logging/branch slices assert branch outcomes, not log message strings
- [ ] Branches that were not testable at the start of the slice were refactored
      or isolated enough to make their logic testable
- [ ] Misshaped or untyped errors discovered during branch coverage work were
      normalized to architectural standards in the same slice
- [ ] Every required local gate for the slice was actually run; targeted checks
      were not used as a substitute for the broader required suite

**OpenAPI:**
- [ ] `npm run api:refresh` succeeds
- [ ] `npm run api:validate` succeeds

**Docs and rules (ride with code):**
- [ ] Every doc update triggered by this slice is in *this* PR, not a follow-up. Triggers include: README change, skill update, rule cross-reference, API doc revision, setup-guide line, ADR cross-link.
- [ ] Standalone doc-only PRs are not used as a workaround for "I forgot to update the README" — the doc update belongs with the code change that triggered it (per `§6 Docs ride with code`).
- [ ] If the slice changed architecture, testing patterns, or developer workflow, the matching `rules/*.md` files were updated in the same diff (per `§2 Rule and Documentation Maintenance`).
- [ ] If the slice deviates from an active plan, the plan file was updated in the same diff or the deviation was explicitly noted in the issue's closing comment.

A slice that lands the schema and service logic correctly but skips DTOs, mappers, or tests is `In Progress`, not `Done`.

For user-facing or workflow-heavy slices, "tests" also means the team can
explain where the end-to-end use case is proven:

- unit/data integration/contract coverage may prove sub-layers
- functional API should prove the API-facing user journey
- browser E2E should prove at least one truthful connected UI workflow when the
  released feature is intended to be browser-usable

If no automated layer currently proves the documented positive and negative use
cases for the released behavior, the slice is not complete enough to deploy.

For backend/shared contract slices, "complete" also means the documentation
surface is complete enough for frontend consumption:

- route descriptions are updated where behavior is not obvious
- DTO/object descriptions exist for changed payloads
- field semantics are described where names alone are not enough
- any backend explanation that frontend needed has been pushed back into the
  contract source instead of left as one-off tribal knowledge
- stale or retired request/response fields have been removed or explicitly
  justified, not merely re-described

For model-change slices, "tests" includes not only production-facing test files
but also the support code that makes those suites truthful:

- factories
- builders
- repository mocks
- seeded test fixtures
- route/setup helpers
- SDK/client test helpers

If CI or local validation shows those layers still encode the retired model
shape, treat that as an incomplete implementation slice rather than unrelated
test cleanup.

### Slice Deliverables

When a feature requires coordinated work across multiple layers (schema, service, DTOs, mappers, route schemas, unit tests, integration tests, contract verification), each layer is its own checkbox in the Slice Completion Checklist above. For substantial multi-layer slices, break the work into multiple sub-issues — one per layer — so progress and blockers are visible in the tracker.

A slice is only complete when every applicable layer has been validated, not when the "hard part" (schema + service) lands.

### After A Slice: Fix The Rule, Not Just The Occurrence

Keep this short — the point is a habit, not a ceremony.

When a slice surfaces friction, avoidable rework, or a defect class:

- **If it violated a rule that already exists**, the rule is not being enforced. Add
  automation — a scanner, a lint rule, a tighter checklist — rather than only fixing the
  one occurrence. A rule nothing checks is a suggestion.
- **If it exposed a rule gap**, update the matching `rules/*.md` file in the same effort, or
  open an issue for the rule change. Durable workflow changes belong in `rules/` or
  `docs/adr/`, not in a slice's closing comment.
- **If the same pattern keeps appearing across slices**, track the cleanup as an epic so it
  is remediated in a batch rather than as isolated one-off defects.

Per-slice validation catches what a slice broke. This catches what the slices are
collectively drifting toward, and it is worth a deliberate look after a large refactor, a
batch of features, or any stretch where repeated defects suggest the rules are not holding.

### Know The CI Baseline Before You Start

Check the relevant CI status before starting implementation, so an inherited red build is
not mistaken for a regression the new slice introduced.

- Do not stack new slices on a red `main` unless fixing that red is the work.
- If failures already exist, say so before coding starts, and keep pre-existing failures
  distinct from ones the slice caused.

### Plan Deletion And Durable-Decision Capture

- Plans are execution tools, not long-lived policy documents. Durable rules belong in `rules/` or `docs/adr/`, not in active plans.
- When the parent epic issue closes (all sub-issues closed or deferred), the plan file is **deleted** in the same commit (or an immediately following cleanup commit).
- Before deleting a plan, verify that durable patterns, conventions, or boundaries the plan introduced have been codified in `rules/` (for patterns) or `docs/adr/` (for cross-cutting decisions). A plan that introduced durable guidance without updating those layers is not ready to delete.
- Do **not** move plans to an archive directory. Git preserves deleted files; archives just replicate the clutter problem under a different name.
- For historical context, rely on `git log` and `git show`. If a specific decision warrants permanent attention, write an ADR.

**A drift scan is a shortlist, never a decision.** The `Stop` hook
(`.claude/hooks/check-tracker-reconciliation.mjs`) reports plans whose tracking issue is
closed, plans declaring no tracking issue, and open issues referenced by the branch's
commits. It anchors on the plan's `**Tracking issue:** #NN` declaration line, which is the
only reliable signal — an earlier version scanned for the first tracker ID anywhere in the
header and silently truncated nested IDs, reporting a plan as belonging to a *different*,
still-open epic. It produced that wrong answer twice before anyone fixed the instrument.

So: open the plan's header and read its declared issue before acting on any deletion the
scan suggests. The hook reports; it never deletes.

**The generalisable half:** noting a tool's defect is not fixing it. The first truncation
was spotted, corrected by hand for that one plan, and the scan was left alone — so it
produced the same error on the very next input. A one-off correction to one result leaves
the instrument free to repeat itself.

---

## 2. Rule and Documentation Maintenance

Rules are part of the codebase contract.

### What belongs in a rule

**A rule that describes what *exists* rots. A rule that describes what must *never happen*
is the only kind that carries information found nowhere else.**

That is the sorting principle, and it is worth applying every time a rule file grows. A
model reads `package.json`, `schema.prisma` and the filesystem directly — a table restating
them is a second source of truth that drifts silently and is always the less reliable one.
What a manifest cannot express is the part worth writing: a prohibition, an invariant, a
deliberate absence ("we considered X and do not use it"), or a trap that reads as plausible
code.

Applied to `rules/architecture-rules.md` this removed 63 lines of stack tables and directory
trees while keeping every decision. Expect a similar ratio elsewhere.

Two corollaries:

- **Before collapsing two sections that "both mention X", read both.** Overlapping subject
  matter is not shared ownership. Two rules can name the same concept and each carry
  something the other does not, and a collapse then deletes content while looking like a
  dedupe.
- **Measure before acting on a size argument.** A file's length is evidence of nothing on
  its own, and section-size estimates written from memory are routinely inverted.

### Retiring an enforcement script

Moving a check from `scripts/check-*.mjs` to an ESLint rule, or deleting it outright, has
three failure modes that all look like success. Each of these was learned by committing it.

- **A test spawns the script you deleted.** Before deleting any `scripts/check-*.mjs`,
  audit *every* scanner name referenced under `tests/` against what still exists on disk,
  in one pass. Grepping only for the scanner currently in hand is how this recurred **four
  times** — the fourth after the lesson was already written down, because the audit was
  scoped to the wrong set.
- **The replacement is narrower than what it replaced, silently.** `npm run lint` globs
  `packages/` and `clients/`, not `tests/`. A rule migrated into `eslint.config.js` alone
  is listed, passes, and checks nothing wherever the lint command does not reach. Compare
  the replacement's actual file set against the scanner's walk roots, not against its
  intent.
- **A green gate over zero findings proves nothing.** When both the old scanner and the new
  rule sit at zero, "it passes" is compatible with the rule matching nothing at all. Verify
  with **planted violations and line-level diffs** between old and new. Every migration that
  did this found a discrepancy; the shapes a line-based regex misses — a chain split across
  lines, a lowercase name, a computed access, an assignment operator instead of a binary one
  — are not hypothetical.

The same three apply in reverse to a rule you write fresh: plant the violation, confirm it
fires, and confirm the shapes you meant to allow stay silent.

### This file is deliberately not split

`workflow-rules.md` is long, and splitting it has been proposed and **rejected**. The
argument was that it mixed durable policy with runbooks; the runbooks were removed for
unrelated reasons, and what remains is durable process.

The concrete ground for keeping it whole: **it is consumed sectionally, not read end to
end.** `AGENTS.md` routes to §0, §1, §3 and §6 individually by task shape. Splitting would
rewrite the path in every cross-reference across `rules/`, `AGENTS.md` and the PR template
while giving the reader the same experience.

Rejected alternatives, recorded so they are not re-raised: extracting §1's tracker
conventions into a separate file, extracting §2 on the argument that rule maintenance has a
different reader than product work, and trimming §1's Slice Completion Checklist — the last
of which addresses duplication rather than length and remains open on its own merits.

### Skills cite rules, and nothing that can disappear

A skill in `.claude/skills/` outlives the work that produced it, so anything it cites has
to outlive it too. A pointer to something that has since been deleted is worse than no
pointer at all: it still reads as authoritative, and the reader cannot tell whether the
guidance moved or was abandoned.

The durable target is **`rules/<file>.md §N *Section Name*`**. Include the section name —
numbers get renumbered, and a bare number then points confidently at the wrong section.

A skill must not cite:

| Not this | Because |
|---|---|
| A GitHub issue number | Issues close, and a closed issue explains nothing to a later reader |
| `plans/NN-*.md` | Deleted when the parent epic closes (ADR-0002) |
| `tech-specs/**` | Deleted when the implementation ships (ADR-0003) |
| A feature directory under `requirements/` | Retired when the feature stabilizes |
| An ADR | Permanent, but a decision's rationale is not a work instruction. Put the instruction in a rule and let the rule carry the ADR link |
| A source file line number | Drifts on the next edit above it. Name the file and the symbol |

When the thing worth citing is transient, **state the content directly in the skill
instead.** A trap is worth two sentences of explanation; it is not worth a pointer to the
ticket where someone once argued about it.

`scripts/check-skill-references.mjs` enforces this. Fenced code blocks are exempt, so a
skill can demonstrate a format — a test name, a `SKIP:` marker — without the placeholder
being read as a live pointer.

This applies to skills specifically. `rules/` files may name a directory as policy (a rule
about `requirements/` has to say `requirements/`); what they must not do is point at a
*specific* transient artifact.


When a refactor changes architecture, API usage, testing patterns, or generated-client workflow:

- update the relevant file in `rules/` in the same change
- do not leave stale rules behind for a future cleanup
- prefer tightening rules after a painful refactor so the same mistake is harder to repeat

Examples that require rule updates:

- moving frontend API access to the generated `hey-api` client
- changing OpenAPI generation/validation workflow
- replacing manual-client tests with MSW
- removing obsolete UI or endpoint patterns

### Feature Delivery Lifecycle

Most work is: **plan narrative → implement → verify → review**. That is the whole lifecycle
for incremental work, and incremental work is the common case here.

A *major* new feature — new actors, new domain concepts, a new product surface — adds a
definition pass in front of it: discovery, refined requirements, and a technical spec. Those
are governed by `product-requirements-rules.md` §0, which is written to be read as
skip-by-default, and the authoring workflow is the `define-a-feature` skill.

Do not run the definition pass on work that fits inside an existing feature. Capture that
narrative in the plan file.

Artifact lifetimes for every layer are in §0 *Document Lifecycle* above. The two that matter
most often:

- `plans/NN-*.md` — narrative companion to an epic issue; **deleted when the epic closes**
- GitHub Issues — live task state, always

`requirements/` and `tech-specs/` are never a substitute for tracker state. Once
implementation is underway, GitHub Issues is canonical for status.

### Webapp Direction

The web frontend is a single role-based application: `clients/poolmaster`. The rebuild it
replaced is finished — `clients/admin` is gone and the old web app is reference material
under `clients/_archived/`, not a delivery target. Do not split functionality across
multiple React apps. The full statement is `architecture-rules.md` §1 *One web application*.

### Task Skills

Guidance is organised by the **task being performed**, not by a role performing it. The
distinction matters: a role tells an agent what it is not allowed to know, and a task tells
it what order to do things in. Role scaffolding was a reasonable answer to models that
drifted off-task and cargo-culted implementation details across boundaries; it costs more
than it protects now, because partitioning knowledge across roles prevents a model from
noticing the contradiction between two layers it can see at once.

- Task skills live in `.claude/skills/<name>/SKILL.md` — one copy, no wrappers. There is no
  `personas/` tree, no `.agents/`, and no `.codex/`; the multi-runtime thin-pointer layout
  was retired along with the personas it carried.
- A skill sequences work and names the traps. It cites policy as
  `rules/<file>.md §N *Section Name*` rather than restating it, so there is one canonical
  home per rule. See §2 *Skills cite rules, and nothing that can disappear*.
- `AGENTS.md` and `rules/` remain canonical. A skill that contradicts a rule is a bug in the
  skill.

Review is one pass with up to three lenses, applied only when the diff has the matching
surface: `/code-review` for correctness, and `rules/review-triggers.md` §5, §6 and §7 for
performance, security and architectural fit. Skipping a lens is the common case.

Cross-cutting workflow requirements remain mandatory regardless of which skill is in play:

- checking for active plans
- updating the issue state for the exact slice worked
- validating work before marking slices done
- updating docs and rules when the change affects them

Plan shaping, slice sequencing, and progress reconciliation are shared between the agent and
the user. The tracker owns live task state; plans own narrative. Nothing owns "project
management" as a discrete role — that responsibility is fully subsumed by the tracker and by
the narrative-only plan convention, which leaves no task tables to reconcile.

### Layer Handoff Within a Slice

The generated SDK and its exported types are the frontend's contract. Backend source is
readable — a current model reading it infers the contract correctly and notices when the
OpenAPI description contradicts it — but it is not the *spec*. When the SDK does not
describe what the frontend needs, the gap is in the contract documentation, and the fix
belongs in the contract source (route summary, description, tags, DTO field and enum
descriptions) in the same slice that surfaced it. Answering the question once and leaving
the documentation gap is not a fix.

**Ordering within a slice that spans both layers:** the contract change lands and is
exported before frontend work consumes it. Building against an intended-but-unexported
contract means rewriting when it arrives, and it hides whether the contract is right.

**Classify before implementing.** When work implies a shared-contract, DTO, or persistence
change, decide which it is — no change, contract-only, or a true model change — before
starting. Getting that wrong in the optimistic direction is the expensive failure: treating
an unclear implication as "probably frontend-only" means discovering the model change
halfway through the UI work. If the classification is not obvious and clearly supported by
the reviewed plan, confirm with the user first. The sequence is in the `model-change` skill;
the conventions it must satisfy are `domain-model-conventions-rules.md`.

**Where ambiguity goes:** product ambiguity to the user. Contract ambiguity is resolved by
reading the contract and fixing its documentation. Model-impact classification is a decision
made in the slice, not a handoff.

## 2A. Source-Of-Truth Priority

- `rules/` and `docs/adr/` are the authoritative durable guidance.
- Active `plans/` files are authoritative narrative context for work in flight; they are paired with an epic issue that owns task state.
- GitHub Issues is the canonical source for task status and slice lists.
- For product intent: `requirements/product-requirements/features/<feature>/` is authoritative for *major* features while they are active; for code/behavioral contract, generated SDK/types + code + tests are authoritative; active plan prose never overrides either.
- Treat `docs/` as reference material only unless an active rule or ADR explicitly promotes a doc as current source of truth.
- If any document conflicts with the currently valid `rules/` + ADRs + active plan + generated contract, follow the governing layer and treat the stale doc as pending cleanup.

---

## 3. Required Local Validation Before Push

Before pushing code that could trigger CI, agents must run the full local quality gate set first unless the user explicitly approves skipping a gate for a narrow reason.

Required local pre-push commands:

1. `npx turbo typecheck --force`
2. `npm run lint` (runs eslint at `--max-warnings 0` plus the theme-token scanner)
3. `npx jest --config tests/jest.config.js --forceExit`
4. `npm run test:service:functional-api`
5. `npm run test:poolmaster:unit`
6. `npm run test:coverage:service:merged`
7. `npm run test:coverage:poolmaster:unit`
8. `npm run rules:check`
9. `npm run api:check`
10. `npm run api:validate`

Rules:

- **Items 8-10 are unconditional, not "only if API contracts changed."** `api:check` boots
  the app in-process to export OpenAPI, so anything touching application *bootstrap* fails
  it with no contract change at all — a required env var added to the logger did exactly
  that. The CI `lint-and-typecheck` job runs `rules:check`, `api:check`, `api:validate`,
  `lint` and `typecheck`; running three of those five locally and pushing is how a red
  build gets discovered in CI rather than before it.

- Treat these as pre-push gates, not optional follow-up checks.
- Do not rely on GitHub CI to discover basic lint, unit, or integration failures that could have been caught locally.
- Do not push backend changes on a "likely green" assumption. The local gate
  must actually pass first.
- Do not intentionally skip required backend gates and defer that validation to
  CI.
- Treat coverage threshold enforcement as part of the required local gate once thresholds are configured; do not defer coverage regressions to GitHub CI.
- Retired smoke suites and browser E2E must not be reintroduced into the active gate set unless an active plan explicitly restores them.
- If a gate is blocked by local environment constraints, state that clearly before pushing.
- When the slice includes a model change, a passing subset is not enough. The
  push is blocked until every impacted suite in the gate set has been rerun or
  otherwise explicitly accounted for, including failures caused by stale test
  infrastructure rather than production code.
- For backend/service changes, the default is simple: no push until lint,
  typecheck, unit, data integration, FAPI, and merged service coverage have
  passed locally. If API contracts changed, `api:refresh` and `api:validate`
  must also pass first.
- Do not classify a slice as “frontend only” if it changes any shared or
  backend-owned contract layer, including:
  - `packages/shared/domain/**`
  - `packages/shared/dto/**`
  - generated OpenAPI / generated `hey-api` outputs
  - backend mappers
  - backend route schemas
  - backend services that shape client-facing payloads
  Those slices are backend-impacting and must satisfy the full backend gate
  before push even if the user-facing feature is primarily in the webapp.
- If a DB-backed backend gate fails only because the Codex sandbox cannot reach
  the local database, rerun that exact command outside the sandbox before
  pushing. Do not treat the sandbox failure as permission to skip the gate.
- For repeated migration incidents in shared environments, stop after two failed
  repair attempts and inspect the real database/task state before pushing a
  third code tweak. Do not use CI as a blind migration experiment loop.

---

## 4. Do Not Preserve Bad Patterns

Do not protect obsolete architecture with inertia.

- Remove or replace stale tests that enforce retired code paths.
- Remove dead endpoints and no-op UI instead of keeping them “for later.”
- Strengthen rules when a refactor reveals a repeated failure mode.

---

## 5. Finding Tasks

Query GitHub Issues. An agent with the GitHub MCP tools uses `list_issues` /
`issue_read`; from a shell it is `gh`:

- `gh issue list` — currently open issues across all epics
- `gh issue view <NN>` — full context for one issue, including its parent epic's plan reference
- `gh issue view <NN>` on an epic — its sub-issues; use this to see the slice list for a plan

Do not maintain a list of "active plan prefixes" in this rule file — that list drifts. Active plans are exactly the files currently present in `plans/`. Each of those plans links to its tracking issue in its header; that issue's sub-issues are the live tasks.

If a plan exists without an associated tracking issue, that is a drift bug to fix: either create the issue or delete the plan. The `Stop` hook checks for this.

---

## 6. Branching, Review, and Merge Cadence

This project uses a **branch-per-slice** flow reviewed by a person. The loop is:

> branch → PR → CI → **the repo owner reads the changeset** → the owner asks for the merge

There is no bot approval step. Branch protection on `main` sets
`required_approving_review_count: 0`; CI and the rule scanners are the automated merge
signal, and the human read is the judgement one.

**The agent does not merge on its own initiative.** It opens the PR, reports what it did,
and stops. Merge happens when the owner asks for it, after their own read.

### What skips the PR flow

Not every commit needs a branch and PR. The carve-out below covers changes that are pure
metadata, narrative, or trivial maintenance — direct-push to `main` is the default for
these paths. The CI rule scanners fire on pushes to `main` as well as on PRs, so the
carve-out does not bypass them; it exists to keep small bookkeeping out of the PR queue.

**Direct-push lane (no PR):**

- `plans/<NN>-*.md` — narrative plan files updated *during* execution: mid-slice notes,
  status updates, deferred-section additions, completion notes. New plan files of
  substantial size should land with their first slice (see *Docs ride with code* below);
  trivial plan housekeeping pushes direct.
- `requirements/` and `tech-specs/` artifacts under active design discussion (before
  implementation begins).
- Trivial typo, link, or formatting fixes anywhere in `docs/` or `rules/` that do not change
  rule meaning.

**Optional PR for substantive plan/doc changes.** When a plan or doc change is large enough
to warrant a second pair of eyes — a brand-new ADR, a workflow-rules rewrite, a
multi-section rule addition, a coordinated cross-doc update — open a PR so the diff is
reviewable in one place.

Examples that warranted PRs in this repo's history:

- Workflow-rules additions that introduce new branching or review semantics.
- A new ADR with cross-cutting impact.

Examples that did not warrant PRs:

- Closing an issue with a closing comment.
- Updating a plan with a mid-execution status note.
- Fixing a broken cross-reference in a rule file.
- Adding a session-handoff "resume here" note.

### Substantive plan or rule change — ask before pushing

Before pushing a non-trivial plan, rule, or ADR change directly to `main`, the agent **must
ask the user** whether to PR it or push direct. Phrasing:

> "This <plan / rule / ADR> change is substantive enough that you may want it to go through
> PR review — should I open a branch + PR, or push direct?"

Substantive triggers (any of these → ask):

- Changing the **meaning** of an existing rule (not just refining wording, fixing a typo, or
  updating a cross-reference).
- Adding a **new rule section** that future slices will be audited against.
- Creating a **new ADR** or modifying a published one.
- **Rewriting a process** (workflow steps, review flow, branching convention, slice
  closeout).
- Any change a **future agent will read as canonical guidance** rather than as ephemeral
  execution notes.

The cost of asking once is low; the cost of silently pushing a process change that should
have been reviewed is high — process changes propagate through every future slice, and
reverting them after the fact is awkward.

### Docs ride with code (Definition of Done)

When a code slice triggers a doc update — README change, rule cross-reference, API doc
revision, setup-guide line — the doc update lands in the **same PR** as the code change.
The issue for that slice is not closeable until both are in the same merged commit.

Why this matters:

- Standalone doc-only PRs add overhead and break the connection between the change and its
  rationale.
- Doc updates filed as separate stories drift — the code merges and the doc-update story
  sits open until it is stale or forgotten.
- A reader looking at the PR for a code change should see the doc update next to the code,
  not have to chase a follow-up PR.

Standalone doc-only PRs are reserved for the *substantive plan/doc* cases above. They are
**not** a workaround for "I forgot to update the README in the code slice."

### Branch convention

- One branch per slice. Name: `issue-NNN-<short-slug>` where `NNN` is the issue number and
  `<short-slug>` is a 2–5 word kebab-case description (e.g.
  `issue-118-scores-only-header-guard`).
- Workflow-infrastructure slices with no issue use a descriptive name without the number
  prefix.
- Branch off the current `main` HEAD at slice start. Do not stack branches unless the
  dependency is genuine.
- Never push directly to `main` except for the direct-push lane carve-out above.

### Review triggers in the PR body

Every PR body carries a **Review triggers** section under the literal HTML comment
`<!-- review:triggers -->`. CI enforces its presence via
`npm run rules:check:pr-review-triggers`.

The section names what the slice touched that warrants a closer read. This exists because
the owner reviews at file-list-and-changeset resolution, and that is exactly the altitude at
which "this adds a mutating route with no authority preHandler" is most useful — it says
where to zoom in.

`rules/review-triggers.md` holds the trigger list and the rule for maintaining it. The
dividing line: **anything a scanner can detect stays a scanner** — self-reporting it would
be strictly weaker, since the agent attesting is the same context that would have written
the problem. Triggers cover only what needs judgement.

**Blast-radius disclosure is mandatory, not a trigger.** When a slice carries any of the
following, the PR body must say so explicitly, with what it touches and whether rollback is
possible:

- A **destructive database migration**: `DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN` on a
  populated column, type narrowing, or adding `NOT NULL` without a backfilled default.
- A **data backfill or one-time data-modifying operation** against production-shaped data.
- Any other **non-reversible production effect**: deleting production records, retiring an
  endpoint with active consumers, removing a feature flag gating production behavior.

A reviewer scanning a file list will not infer `DROP COLUMN` from a migration filename. For
these specifically, state what the operation does, what data it touches, the rollback plan
(or "none — this is one-way"), and whether a dry-run was performed.

### Slice closeout protocol

When an agent finishes a slice:

1. **Verify the slice-completion checklist** in §1 — gates run, traceability present, defect
   protocol satisfied if applicable, no app-code fakes added.
2. **Run all required local gates** (`rules/testing-rules.md` §3). Do not push on a "likely
   green" assumption. CI is now the primary automated merge signal, which raises the cost of
   a red push.
3. **Commit** with the issue number in the footer (`#NN`). One slice = one commit where
   practical. Keep closing keywords out of the commit — they belong in the PR body, so the
   issue closes on merge rather than on push.
4. **Push the branch.**
5. **Open a PR** with `gh pr create`. Title: short imperative summary. Body: `Closes #NN`
   for the slice's issue, the parent epic, one-paragraph context, the gates that were run,
   and the `<!-- review:triggers -->` section. For defect-fix slices, state explicitly that
   the failing test was observed to fail before the fix landed.
6. **Report and stop.** Summarize the change and what the triggers flag. Do not merge.

Merge happens when the owner asks. At that point the agent runs
`gh pr merge --squash --delete-branch`. The `Closes #NN` keyword closes the issue on merge;
the agent still adds the closing comment per §1, since the keyword records *that* it closed,
not *what happened*.

Running `/code-review` before opening the PR is a good habit rather than a rule: it costs
one command and puts findings where the owner is already looking.

### Branch lifecycle

- Open branches stay short-lived (hours to days). A branch open longer than its story has
  been in progress is a sign the work has stalled — close or split it.
- **The remote branch is deleted on merge automatically.** The repo has
  `delete_branch_on_merge: true` set at the repo level, so any merge cleans up the head
  branch. Verify with `gh api repos/derek-dorazio/pool-master --jq '.delete_branch_on_merge'`.
- **CLI merges should still pass `--delete-branch` explicitly.** The repo-level setting is
  the safety net for UI merges and any case where the flag is forgotten.
- The local branch can be deleted with `git branch -d <branch>` once switched back to `main`.
- Reopened stories spawn a new branch; do not reuse a merged one.
