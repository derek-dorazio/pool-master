# PoolMaster — Workflow Rules

## 0. Document Lifecycle (Governing Rule)

> **One source of truth per concept. Working documents are deleted when the work ships. Durable decisions become ADRs. Git history is the archive.**

The repository uses layered artifacts. Each artifact has a clear lifetime and a single canonical purpose. Do not duplicate content across layers — reference instead.

### Durability tiers

| Tier | Artifact | Lifetime | Purpose |
|---|---|---|---|
| Permanent | `rules/*.md`, `personas/*.md`, `docs/adr/*.md`, `AGENTS.md` | Months–years | How we build here; who does what; why we chose durable patterns |
| Feature-life | `requirements/product-requirements/features/<feature>/` | Weeks–months (during active feature development) | Product intent for a *major* feature; retire/delete when the feature stabilizes |
| Slice-life | `plans/NN-*.md` | Days–weeks (a single feature reorg or major effort) | Narrative execution context paired with a Beads epic; **deleted** when the parent epic closes |
| Pre-implementation | `tech-specs/features/<feature>/` | Up to ship | Technical framing before implementation; **deleted** when the implementation lands |
| Live | `.beads/issues.jsonl` | Hours–days | Current task state, dependencies, slice list, status |

### Governing rules

1. **One canonical home per concept.** If you're writing the same thing in two files, pick one and link from the other. Business rules live in `requirements/.../business-rules.md`. Task status and task lists live in Beads. Architecture decisions live in `rules/` or `docs/adr/`. The generated SDK + domain types are the API contract. The code + tests are the behavioral spec.
2. **Short-lived artifacts reference long-lived ones, never the reverse.** Plans reference rules, not vice versa. Beads notes reference plans, not vice versa.
3. **Delete on ship, don't archive.** When a plan's parent Beads epic closes, the plan file is deleted in the same commit (or the next cleanup slice). When a tech spec's implementation lands on main, the spec is deleted. Git preserves history; `git show <sha>:path/to/file` retrieves any prior version. Archival directories are anti-patterns — files in the tree get read.
4. **Capture durable decisions as ADRs.** Decisions that outlast a single slice (architectural choices, cross-cutting patterns, hard boundaries) are written as Architecture Decision Records in `docs/adr/`. Once accepted, ADRs are immutable; supersede with a new ADR rather than editing.
5. **Rules absorb what plans learn.** If a plan introduces a durable pattern (a new convention, a hard boundary, a reusable approach), update `rules/` or write an ADR in the same effort. Don't leave the pattern only in the plan — it will be deleted when the epic closes.

---

## 1. Plans and the Beads Tracker

### Plans are narrative; Beads is live task state

- **A plan file** (`plans/NN-*.md`), when the effort warrants one, is the narrative companion to a Beads epic: scope, rationale, architecture, site maps, tile mappings, open questions, references. Plans do **not** contain task tables.
- **The Beads epic** (`pool-master-<suffix>`) owns the task list as child stories, with labels, dependencies, statuses, and notes.
- When a plan exists, it carries a one-line header at the top referencing its parent Beads epic; the Beads epic links back to its plan in its description or notes.

### Pick the right shape: story / epic / plan + epic

Not every effort needs all three artifacts. Match the shape to the work.

- **One Beads story, no epic, no plan.** Single-slice work: a typo fix, a small bug fix, a one-file refactor, a routine dependency bump, a single follow-up. The story description and notes carry all the context needed.
- **One Beads epic + child stories, no plan file.** Small efforts (≈2–3 slices) with no architectural narrative: a contained CRUD addition, a small targeted refactor, a couple of related cleanup slices. The epic description carries scope and sequencing; each child story carries its own slice context.
- **Plan file + Beads epic + child stories.** Major efforts: feature reorgs, new feature areas with site maps, cross-cutting refactors, multi-persona coordination, anything that benefits from diagrams, authority models, tile-to-destination mappings, or a "settled decisions" section.

Promote a small effort to a plan file when:

- It grows past about three slices.
- A non-obvious architectural choice is being made.
- Multiple personas are coordinating (e.g., Pam confirms scope, Dom locks the model, Brad implements, Fran consumes).
- The narrative would benefit from a Mermaid diagram, site map, or structured pattern explanation.
- You catch yourself wanting to write more than a couple of paragraphs in a Beads description — that paragraph wants to be a markdown file.

When in doubt, start small (story-only or epic-only). It's cheaper to add a plan file later than to delete an empty one.

### Plan file structure

A plan file typically contains:

- **Beads epic:** link/ID to the parent epic (e.g. `pool-master-upa`)
- **Purpose** — why this plan exists
- **Governing principles** — link to relevant rules/memory/ADRs
- **Site map / structural references** (where applicable)
- **Architecture or pattern narrative** (authority models, URL structures, etc.)
- **Tile → destination mapping** (for reorgs; these are structural, not status)
- **Open questions** (unresolved product/contract calls)
- **Backend contract questions** (handoff to Brad)

What a plan file does **not** contain:

- Task tables with slice numbers, status columns, or Done markers
- Duplicated rule text or persona responsibilities
- Per-slice completion notes (those live in the Beads story closing notes)

### Beads is the canonical task state

- Every active slice is a Beads story (child of a plan's epic).
- Status transitions (open → in_progress → closed/deferred) happen in Beads as work starts and completes.
- Slice context, scope changes, and closeout notes go in the Beads story's notes field.
- When a slice closes, the plan file is not edited — the Beads closeout captures the execution record. The plan file is updated only when scope, architecture, or open questions change.

### When a plan dies

- When the parent Beads epic closes (all child stories closed or deferred), the plan file is **deleted** in a cleanup commit.
- Durable patterns/decisions the plan established must be codified in `rules/` or `docs/adr/` before deletion. A plan that introduced a new convention without updating rules/ADRs is not ready to be deleted.
- git preserves the deleted file; it can be retrieved via `git log` / `git show` if historical context is needed.
- Do **not** move completed plans to `plans/archive/`. Archive directories grow and get read; deletion is the enforcement mechanism.

### Beads conventions: epics, stories, sizing, naming

**Epics vs stories.** A Beads epic represents a major effort (a feature reorg, a new feature area, a cross-cutting refactor). Each child story is a single committable, validatable slice — typically one commit. If a "story" naturally needs more than one commit, it's actually two stories.

**Sizing.** Aim for stories that close in 1–3 hours of focused work and produce one coherent commit. Layer-granularity is the default unit (schema + migration is one story; service + repo is another; DTOs are another; mappers are another; route schemas are another; each test layer is a separate story when meaningful coverage is being added). Bundle layers in one story only when the layers are trivially small.

**Naming.**
- Epics: short imperative noun phrase that names the effort. Examples: "Root admin elevation", "Test data hygiene", "Contest event feed integration". Avoid date prefixes, internal version numbers, or references to the plan file number — Beads IDs are stable and the plan file may be deleted later.
- Stories: short imperative phrase describing what the slice produces. Each story title should make sense without reading the parent epic.

### Beads conventions: scope of use

- Use one Beads epic per active feature lane or cross-module initiative.
- Use child stories for refinement questions, design decisions, implementation slices, and verification/review slices.
- For multi-question refinement threads, prefer Beads decision/task items with stable IDs over renumbered ad hoc chat bullets.
- Keep the resolved truth in `requirements/`, `tech-specs/`, or `plans/` as appropriate; do not let Beads become the only durable home for product or technical decisions.
- When a Beads-tracked question is resolved, update the corresponding document in the same effort or immediately after.
- When a plan already exists for the lane, keep the plan narrative in sync with the Beads state for material milestones and direction changes.

### Beads conventions: labels

Apply labels generously — they're how filtered queries (`bd list --label …`) stay useful as the issue list grows.

Standard label families:

- **Layer:** `layer/schema`, `layer/service`, `layer/dto`, `layer/mapper`, `layer/route`, `layer/test-unit`, `layer/test-integration`, `layer/test-fapi`, `layer/test-e2e`, `layer/ui`, `layer/infra`, `layer/docs`.
- **Persona:** `persona/brad`, `persona/fran`, `persona/dom`, `persona/archie`, `persona/tess`, `persona/quinn`, `persona/riley`. Indicates who is best positioned to execute or review.
- **Risk / scope:** `risk/high` (touches shared contract, schema, infra, auth), `risk/refactor` (no behavior change but broad blast radius), `risk/migration` (data migration / backfill), `cross-cutting` (effects multiple modules).
- **Workflow:** `blocked/external` (waiting on a third party), `blocked/decision` (waiting on a product call), `cleanup` (debt removal, no new behavior), `defect` (bug-fix story — see Defect Verification Protocol in `rules/testing-rules.md` §3).

A story with 0–3 labels is normal. Don't turn labels into a taxonomy exercise; they should help future filtering, not document everything.

### Beads conventions: dependencies

Use Beads `blocks` / `blocked_by` to make execution order machine-readable rather than only narrating it in the plan.

- Declare a dependency when a story genuinely cannot start until another closes (e.g., DTO depends on schema; UI depends on regenerated SDK).
- Do **not** declare a dependency for "should be done in this order for cleanliness" — that's narrative, and belongs in the plan file or in the story description.
- Cross-epic dependencies are allowed and useful. A slice in Epic A blocked by a slice in Epic B is the right way to model genuine coupling between efforts.
- Circular dependencies are a smell. If two stories block each other, one of them is sized wrong — split it.

### Beads conventions: story notes

The Beads notes field is the slice's execution record. Two notes per story is the working norm.

**Starting note** (added when status flips to `in_progress`):

- Planned approach: which files will change, which patterns will be applied, which contract surfaces are touched.
- Risk callouts: anything the slice is being asked to be careful about.
- Validation plan: which gates will be run, which test layers will be added or updated, and which use-case / defect IDs the new tests will reference.

**Closing note** (added when status flips to `closed`):

- Files changed (paths only — diffs live in git).
- Decisions made: any non-obvious technical call that future readers should understand.
- Gates run: explicit list of validation commands and their results.
- For defect-fix slices: an explicit note that the failing test was observed to fail on the broken code before the fix landed (see `rules/testing-rules.md` §3 *Defect Verification Protocol*).
- Residual risk: anything left for follow-up, ideally with the new story ID that will own it.
- Spillover: if the slice touched files outside its declared scope, name them.

The closing note is the canonical post-ship execution record for the slice. Plan files do not capture this — they're narrative-only.

### Beads conventions: deferred, closed, reopened

- **`closed`** — work done; gates pass; commit landed.
- **`deferred`** — work was scoped but consciously dropped from this epic. Add a closing note explaining why and pointing at the future story (if any) that picks it up.
- Reopening a closed story is allowed when the closeout turns out to be wrong (e.g., a hidden regression surfaces). Add a note that says why it's being reopened and what changed in the original validation story.
- A story that is "blocked, not deferred" stays `in_progress` (or `open`) with a `blocked/*` label and a note explaining what it's waiting on.

### Beads ↔ commit and PR linkage

- Reference the Beads story ID in the commit message footer: `pool-master-NNN`. This makes `git log --grep="pool-master-NNN"` the canonical way to find the slice's commits.
- Reference the parent epic ID in the PR description.
- For defect-fix slices, also reference the defect ID in the failing test's traceability comment per `rules/testing-rules.md` §1A.
- Do not put commit SHAs into Beads notes — `git log --grep` is more durable than a frozen SHA list, especially after rebases or squash merges.

### Concurrent agents and JSONL conflict resolution

`.beads/issues.jsonl` is line-oriented; merge conflicts are common when multiple agents edit Beads state in parallel.

- Prefer running `bd` CLI commands rather than hand-editing `issues.jsonl`. The CLI keeps the file canonical.
- When two agents update overlapping stories, the second-to-merge resolves by re-running the equivalent `bd` command on the merged result, not by hand-merging the JSONL.
- Do not commit a partially-resolved JSONL — re-export from `bd` after resolving so the committed state matches the tracker's view.

### bd CLI quick reference

Routine operations:

- `bd list --status open` — what's available to start.
- `bd list --status in_progress` — what's currently underway (worth checking before starting a new slice, especially with multiple agents).
- `bd show pool-master-NNN` — full story detail including notes.
- `bd note pool-master-NNN "..."` — append a note to a story.
- `bd start pool-master-NNN` / `bd close pool-master-NNN` — status transitions.
- `bd dep add pool-master-A blocked-by pool-master-B` — declare a dependency.

See `bd help` for the full surface.

### Slice Execution Rules

- Keep one execution slice per commit unless the user explicitly approves bundling multiple slices together.
- Report every changed file in the final handoff for a slice. Do not summarize a broader file set as if it were narrower.
- If slice work exposes adjacent-slice files or tasks, stop and report that spillover instead of bundling it into the same commit.
- Coverage threshold changes are main-thread coordination work. Worker slices must not raise or lower thresholds on their own.
- Update Beads state only for the exact slice being worked. Do not flip unrelated stories to `in_progress` or `closed`.
- Close a Beads story only when the exact scoped work is complete and validated. Partial work stays `in_progress`.
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

Before marking any slice `Done`, reconcile the live Beads tracker so it matches
the actual repo state. A slice is not complete if the code, tests, and commit
history say "finished" but the corresponding Beads item still reads like active
unfinished work.

**Beads Reconciliation Gate:**
- [ ] The exact Beads item for the slice has been reviewed at closeout time
- [ ] The item has been moved to the correct end state:
  - `closed` if the scoped work is complete
  - `deferred` if the remaining work is intentionally postponed
  - `pinned` only if it is a durable ongoing behavior rather than a normal task
- [ ] If scope changed during implementation, the Beads title/notes were updated
      before closing or deferring it
- [ ] Parent epics or umbrella items were reviewed so they do not remain `open`
      merely because no one reconciled the child status
- [ ] The final slice handoff explicitly states which Beads moved to `closed`,
      `deferred`, or remain active and why

Common failure modes to avoid:

- finishing implementation but forgetting to close the corresponding Beads item
- leaving workflow/process items as plain `open` tasks when they are really
  ongoing behaviors or already-adopted rules
- leaving outdated task wording in place after the architecture direction has
  changed
- allowing CI firefighting or adjacent follow-up work to skip the tracker
  reconciliation step

The default rule is simple: if a slice is done enough to commit and announce as
complete, it is done enough to reconcile in Beads during the same slice.

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
- [ ] Every new test references a use-case ID, business-rule ID, or defect ID per `rules/testing-rules.md` §1A *Test Self-Documentation*
- [ ] For defect-fix slices: a failing test reproducing the defect was written *before* the fix and observed to fail on the broken code, per `rules/testing-rules.md` §3 *Defect Verification Protocol* (record the observation in the Beads closing note)
- [ ] No application code was modified to make a test pass — no fakes, fallbacks, hardcoded responses, "test mode" branches, or synthetic defaults were added to production paths, per `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*
- [ ] No `.skip` / `.todo` / `xit` / `it.fails` / `describe.skip` markers were introduced without a `SKIP: pool-master-NNN` comment and a real Beads story tracking the un-skip, per `rules/testing-rules.md` §1C *Test-Disable Discipline*
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

When a feature requires coordinated work across multiple layers (schema, service, DTOs, mappers, route schemas, unit tests, integration tests, contract verification), each layer is its own checkbox in the Slice Completion Checklist above. For substantial multi-layer slices, break the work into multiple Beads stories — one per layer — so progress and blockers are visible in the live tracker.

A slice is only complete when every applicable layer has been validated, not when the "hard part" (schema + service) lands.

### Slice Retrospective

After each completed feature slice, do a brief retrospective before moving on
to deeper adjacent work.

The retrospective should:

- identify any workflow friction, coordination overhead, or avoidable rework
- recommend any process or tooling change that would make future slices more
  efficient
- record durable workflow changes in `rules/` or `docs/` when the team agrees
  they should persist beyond the current session

Keep the retrospective short and high signal. The goal is to improve the
project workflow steadily without turning every slice closeout into a long
ceremony.

### CI/CD Baseline Check

Before starting a new feature or implementation slice, confirm the current
CI/CD baseline first.

The goal is to avoid inheriting unrelated red builds or stale failures and then
mistaking them for regressions introduced by the new slice.

Required behavior:

- check the current relevant CI/CD status before new implementation work begins
- do not start stacking new feature slices on top of a red `main` baseline
  unless the active work is explicitly to fix that red baseline
- if existing failures are already present, call that out explicitly before
  coding starts
- distinguish clearly between:
  - pre-existing failures
  - failures introduced by the new slice
- do not let builders or follow-on implementers assume inherited failures came
  from their work unless the new slice actually caused them

### Plan Deletion And Durable-Decision Capture

- Plans are execution tools, not long-lived policy documents. Durable rules belong in `rules/` or `docs/adr/`, not in active plans.
- When the parent Beads epic closes (all child stories closed or deferred), the plan file is **deleted** in the same commit (or an immediately following cleanup commit).
- Before deleting a plan, verify that durable patterns, conventions, or boundaries the plan introduced have been codified in `rules/` (for patterns) or `docs/adr/` (for cross-cutting decisions). A plan that introduced durable guidance without updating those layers is not ready to delete.
- Do **not** move plans to an archive directory. Git preserves deleted files; archives just replicate the clutter problem under a different name.
- For historical context, rely on `git log` and `git show`. If a specific decision warrants permanent attention, write an ADR.

---

## 2. Rule and Documentation Maintenance

Rules are part of the codebase contract.

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

PoolMaster's default feature lifecycle is:

1. Product Discovery — `Piper`
2. Product Requirements — `Pam`
3. Technical Specification — `Tom` with `Dom`
4. Test Planning — `Tess`
5. Design Plans — `Archie`
6. Execution Planning — `Archie`
7. Implementation — `Brad`, `Fran`, and supporting personas
8. QA Verification — `Quinn`
9. Code Review — `Riley`

Artifact hierarchy (with lifetimes; see §0 Document Lifecycle):

- `requirements/reference/` = seed discovery materials (feature-life; delete when obsolete)
- `requirements/product-overview/` = Piper discovery artifacts (feature-life; retire after major feature stabilizes)
- `requirements/product-requirements/features/<feature>/` = Pam's refined product-requirement bundle for **major** features (feature-life; retire or trim after stabilization)
- `tech-specs/features/<feature>/` = Tom's pre-implementation technical framing (pre-implementation only; **deleted when implementation ships**)
- `plans/NN-*.md` = narrative companion to a Beads epic (slice-life; **deleted when parent Beads epic closes**)
- `.beads/issues.jsonl` = live task state (tasks, dependencies, status, notes)
- `docs/adr/` = Architecture Decision Records (permanent; immutable once accepted)

Skip the requirements bundle and tech spec for small/incremental work. Those artifacts are high-leverage for major new features, but they become overhead for work that fits entirely inside an already-documented feature or a narrow improvement. Capture that work's narrative directly in the plan file.

Do not treat `requirements/` or `tech-specs/` as replacements for Beads task state. When implementation is underway, Beads is canonical for status.

### Webapp Rebuild Direction

The go-forward web frontend is the single role-based PoolMaster app.

- New web implementation work should target `clients/poolmaster`.
- Do not spend implementation effort keeping `clients/web` or `clients/admin` current with new plans once the rebuild plan is active.
- `clients/web` may be used as reference material for planning, layout ideas, and feature discovery until it is archived, but implementation agents should not treat it as an active delivery target.
- `clients/admin` is being removed rather than modernized into a separate long-lived app.
- If a frontend plan or slice is intended for the new app, keep the work isolated to the PoolMaster app and update related build/test/CI wiring in the same effort.

### Product Design Workflow For PoolMaster Webapp Planning

When an agent is acting in a product-design or product-manager capacity for the
PoolMaster web app, the agent must not jump straight from rough ideas into UI
implementation assumptions.

Required workflow:

1. Capture the product idea in a plan or use-case companion under `plans/`.
2. Write explicit user/use cases for the flow before implementation begins.
3. Before proposing fields, steps, or page actions, perform a current-truth
   review using:
   - the active product plans for the feature
   - current shared domain types
   - current DTO/OpenAPI contract
   - current implemented routes and role behavior
   Distinguish clearly between:
   - active product truth
   - backend contract surface that is not yet approved product UX
   - archived or superseded design ideas used only as historical reference.
4. Include open functional questions, decisions, and assumptions that still need
   confirmation.
5. At the end of the design review, explicitly surface any implied backend or
   model changes required by the proposed webapp behavior, including:
   - Prisma/model changes
   - migrations or backfills
   - new DTOs or API routes
   - backend auth/session or invitation-flow changes
   Confirm those backend implications with the user before implementation
   begins.
   When those implications suggest a true model change, route them through the
   data-modeler and have the review explicitly check
   [domain-model-conventions-rules.md](./domain-model-conventions-rules.md)
   before backend implementation begins.
6. If the current contract appears to expose retired, stale, or no-longer-valid
   fields for the feature, do not design around them silently. Call out the
   mismatch explicitly as:
   - product scope differs from backend capability, or
   - backend cleanup/documentation debt still exists.
   Route that mismatch to the data-modeler/backend workflow instead of treating
   it as approved UX input.
7. Propose the browser E2E flows that should eventually prove the designed
   behavior end to end.
8. Review those use cases, questions, backend implications, and proposed E2E
   flows with the user
   before locking the design
   direction into implementation work.
9. Once reviewed, treat the agreed E2E flows as planned implementation work for
   the related webapp plan rather than leaving them as optional follow-up ideas.
10. Treat the reviewed use-case document as the companion for later UI planning
   and execution slices.
11. As new PoolMaster webapp pages or functions are implemented, decide whether
   the current reviewed Playwright journeys should be extended or whether the
   new behavior needs a new browser journey. Do not leave newly delivered
   user-facing webapp behavior outside the browser-journey plan by default.
12. For browser-E2E planning, prefer commissioner/member/public lifecycle flows
    over root-admin or test-only shortcuts. If cleanup or setup appears to need
    privileged APIs, first ask whether the real product lifecycle should own
    that behavior instead.

This is especially required for:

- landing and onboarding flows
- route and navigation design
- league/home context behavior
- commissioner and member UX entry points
- invite and join flows
- modal/wizard workflow design
- post-deploy browser E2E coverage for the designed flows

Do not assume that an early scaffold or placeholder page defines the final
product flow. For PoolMaster webapp design, plans should be use-case driven and
confirmed with the user before implementation expands.

### Persona Playbooks

- Persona playbooks live under `personas/<name>.md` as the single authoritative source of persona content, with tool-specific thin-pointer wrappers under `.claude/skills/`, `.claude/agents/`, `.agents/skills/` (Codex), and `.codex/agents/`. See Plan 111 for the full layout and the thin-pointer pattern (no symlinks, no build step — each wrapper carries minimal frontmatter + a MUST-Read instruction pointing at `personas/<name>.md`).
- Personas scope role-specific workflows: product management, backend implementation, data modeling, frontend implementation, test planning, architecture/platform work, and code review. Piper (product discovery) and Tom (technical specification) are dormant — only invoked explicitly for greenfield / major-feature framing.
- These playbooks are execution aids, not replacement policy sources.
- `AGENTS.md` and `rules/` remain canonical.
- Formal persona names remain the canonical workflow language in plans, rules,
  and handoffs. Nicknames are optional shorthand for prompts, logs, worker
  updates, and conversational references.
- When a nickname is used, it must map to exactly one formal persona and must
  not replace the formal responsibility definition.
- If a new persona is added later, assign a unique nickname in the persona file
  and add it to the table below rather than inventing ad hoc shorthand in
  worker prompts.
- When persona framing is helpful for user clarity, progress updates and final
  handoffs should identify the primary persona(s) responsible for the current
  slice using formal persona names or approved nicknames.
- Persona tags are workflow framing, not proof that separate delegated agents
  actually ran. Do not imply independent execution that did not happen.
- Use persona labeling as an aid for substantial work, design reviews, or
  multi-role slices. It is optional for tiny or purely conversational replies.

Current persona nickname map:

| Formal Persona | Nickname | Notes |
|---|---|---|
| Product Discovery | Piper | High-level product framing, PRD shaping, and discovery handoff |
| Product Manager | Pam | Product/use-case clarification and review |
| Technical Specification Creator | Tom | Technical spec baseline and feature handoff |
| Data Modeler | Dom | Model and contract impact classification |
| Test Planner | Tess | Coverage planning and test-matrix authorship |
| Backend Developer | Brad | Service, DTO, OpenAPI, and test implementation |
| Frontend Developer | Fran | PoolMaster web UI and browser-flow delivery |
| QA/Test Engineer | Quinn | Verification strategy, regression detection, and test-lane ownership |
| Architect | Archie | Design plans, execution planning, and platform work |
| Code Reviewer | Riley | Findings-first review and risk detection |
- Cross-cutting workflow requirements remain mandatory for all personas,
  including:
  - checking for active plans
  - updating the Beads story state for the exact slice worked
  - validating work before marking slices done
  - updating docs and rules when the change affects them
- Plan shaping, slice sequencing, and progress reconciliation are responsibilities shared across the active implementation personas and the user. Beads owns live task state; plans own narrative. No single persona owns "project management" as a discrete role — the old project-manager persona was retired because its responsibilities were fully subsumed by Beads (task state) and the narrative-only plan convention (no task tables to reconcile). See Plan 111 for the retirement rationale.

### Frontend / Data Model / Backend Handoff Rules

- Frontend implementation should normally work from:
  - reviewed plans and use-case companions
  - generated SDK operations
  - generated request/response types
  - documented OpenAPI summaries/descriptions
- Frontend agents must not answer contract ambiguity by treating backend
  implementation code as the working spec.
- If frontend work reveals a possible shared-contract, DTO, or model change,
  stop and route that question through the `data-modeler` persona first unless
  the change is already explicitly reviewed and obviously backend-owned.
- The `data-modeler` persona classifies whether the request is:
  - UI-only
  - contract-only
  - a real model/domain/persistence change
- The data-modeler review must happen before backend implementation begins on
  any feature where model, DTO, contract, or persistence impact is plausible.
  Do not skip directly from frontend/product discovery to backend coding when
  that classification step is still unresolved.
- If the change is not obvious and clear from the reviewed plan, confirm the
  backend/model implication with the user before implementation continues.
- Backend/shared changes discovered during frontend work must be implemented by
  the backend developer persona, not by the frontend developer persona.
- For a feature slice that requires both backend/shared contract changes and
  frontend changes, the required sequence is:
  1. backend persona completes the contract/model/API work
  2. backend persona runs the required backend validation gates
  3. backend persona regenerates/exports OpenAPI, SDK, and types
  4. frontend persona begins consuming the exported contract
  Do not overlap those responsibilities in a way that makes frontend build
  against an intended-but-not-yet-exported contract.
- If the frontend developer has a contract question, ask the backend developer
  persona for the answer instead of reading backend code directly.
- When such a question reveals a contract documentation gap, the backend
  developer must fix that documentation gap as part of the handoff, not merely
  answer the question once.
- Backend slices that change API contracts must include that documentation-gap
  repair in the same slice rather than leaving it as follow-up cleanup.
- Product ambiguity belongs with the user. Contract ambiguity belongs with the
  backend developer. Model-impact classification belongs with the data-modeler.

---

## 2A. Source-Of-Truth Priority

- `rules/` and `docs/adr/` are the authoritative durable guidance.
- Active `plans/` files are authoritative narrative context for work in flight; they are paired with a Beads epic that owns task state.
- `.beads/issues.jsonl` is the canonical source for task status, dependencies, and slice lists.
- For product intent: `requirements/product-requirements/features/<feature>/` is authoritative for *major* features while they are active; for code/behavioral contract, generated SDK/types + code + tests are authoritative; active plan prose never overrides either.
- Treat `docs/` as reference material only unless an active rule or ADR explicitly promotes a doc as current source of truth.
- If any document conflicts with the currently valid `rules/` + ADRs + active plan + generated contract, follow the governing layer and treat the stale doc as pending cleanup.

---

## 3. Required Local Validation Before Push

Before pushing code that could trigger CI, agents must run the full local quality gate set first unless the user explicitly approves skipping a gate for a narrow reason.

Required local pre-push commands:

1. `npx turbo typecheck --force`
2. `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
3. `npx jest --config tests/jest.config.js --forceExit`
4. `npm run test:service:functional-api`
5. `npm run test:poolmaster:unit`
6. `npm run test:coverage:service:merged`
7. `npm run test:coverage:poolmaster:unit`

Rules:

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

Use Beads directly. The canonical queries:

- `bd list` — currently open and in-progress issues across all epics
- `bd show <issue-id>` — full context for one issue, including the parent epic's plan reference
- `bd show <epic-id>` — an epic's children; use this to see the slice list for a plan

Do not maintain a list of "active plan prefixes" in this rule file — that list drifts. Active plans are exactly the files currently present in `plans/`. Each of those plans links to its Beads epic in its header; the epic's children are the live tasks.

If a plan exists without an associated Beads epic, that is a drift bug to fix: either create the epic or delete the plan.

---

## 6. Branching, Review, and Merge Cadence

This project uses a **branch-per-Beads-story** flow with implementing-agent self-review via Riley. Auto-merge on clean Riley findings is the default for solo work.

### Branch convention

- One branch per Beads child story. Name: `pool-master-NNN-<short-slug>` where `NNN` is the story ID and `<short-slug>` is a 2–5 word kebab-case description (e.g., `pool-master-142-contest-archive-validation`, `pool-master-198-fix-status-null-on-archive`).
- Branch off the current `main` HEAD at slice start. Do not stack branches unless the dependency is genuine (and modeled in Beads `blocked_by`).
- Never push directly to `main`. The branch + PR + Riley + auto-merge loop is the only path.

### Implementing-agent slice closeout protocol

When an implementing persona (Brad, Fran, Archie, Dom, etc.) finishes a slice, the closeout sequence is:

1. **Verify the slice-completion checklist** in §1 — gates run, traceability comments present, defect protocol satisfied (if applicable), no app-code fakes added.
2. **Run all required local gates** (`rules/testing-rules.md §3`). Do not push on a "likely green" assumption.
3. **Commit** with the Beads story ID in the footer: `pool-master-NNN`. One slice = one commit (squash later in the PR if multiple working commits exist).
4. **Push the branch** to origin.
5. **Open a PR** with `gh pr create`. Title: short imperative summary. Body: link to the parent Beads epic, the slice's Beads story (`pool-master-NNN`), one-paragraph context, and the gates that were run. For defect-fix slices, the PR body must explicitly state that the failing test was observed to fail before the fix landed.
6. **Spawn Riley** as a subagent using the canonical spawn prompt below — Riley's review quality depends on what you pass.
7. **Read Riley's findings table.** Then:
   - **Zero blocker-severity findings** (CRITICAL or HIGH) → `gh pr merge --squash --delete-branch`. Close the Beads story with a closing note per §1 *Beads conventions: story notes*. Return to the user with a summary.
   - **Any blocker-severity findings** → **do not merge**. Surface the findings to the user, await direction (fix-and-re-review, merge-anyway-with-justification, or park).

The implementing agent — not Riley — owns the merge decision. Subagents stay in the "findings only" lane.

### Riley spawn prompt

Riley runs in isolated context and sees nothing that the implementing agent has not explicitly passed. A sloppy spawn prompt produces a sloppy review and uncalibrated severities — which then defeats the auto-merge gate.

The spawn prompt must include all of the following, in this order:

1. **Slice intent (one paragraph).** What this slice was supposed to do, in product terms. Not "I changed these files" — *why*.
2. **Parent Beads epic ID and slice's Beads story ID.** Both with a link back. Riley uses these to read the epic and story descriptions and notes.
3. **Diff scope.** The exact command to read the changes: `git diff origin/main...HEAD` for a branch, or the PR URL when one exists. Mention the file count and rough size so Riley can flag "scope too large to review honestly" instead of pretending.
4. **Use-case / business-rule / defect IDs covered.** The specific IDs from `requirements/.../use-cases.md`, `requirements/.../business-rules.md`, or the defect Beads story. Riley audits coverage against these IDs, not against a vague feature name.
5. **For defect-fix slices: an explicit "failing test before fix" claim.** State that the failing test was observed to fail on the broken code before the fix landed, and point to the commit or PR-body line that proves it.
6. **Rules and specs Riley should audit against.** The relevant `rules/*.md` files, the active plan if one exists, and any tech-spec under `tech-specs/features/<feature>/` that this slice implements. Default set always includes `rules/workflow-rules.md`, `rules/testing-rules.md`, and the layer-specific rules (`rules/service-rules.md` for backend slices, `rules/react-ui-rules.md` for frontend slices).
7. **Known concerns the implementing agent already identified.** Anything you noticed but consciously chose not to fix in this slice (and why), or anything you're uncertain about. Naming concerns up front prevents Riley from "discovering" them as findings and lets it focus elsewhere.
8. **Severity calibration reminder.** A one-line pointer to `personas/riley.md §Severity Calibration` so Riley honors the auto-merge gate (zero CRITICAL/HIGH = merge).
9. **Expected output.** The findings table format, ordered by severity, with categories from `personas/riley.md`. Tell Riley to flag inability-to-evaluate explicitly rather than guessing.

Boilerplate template (copy and fill in):

```text
You are Riley. Audit this slice for merge readiness per the auto-merge gate
in rules/workflow-rules.md §6. Read personas/riley.md before starting.

Slice intent:
  <one paragraph: what this slice was supposed to do and why>

Parent epic: pool-master-<EPIC>
Slice story: pool-master-<STORY>

Diff scope:
  git diff origin/main...HEAD
  (~<N> files, ~<L> lines changed)

Use-case / business-rule / defect IDs covered:
  - UC-<ID> — <description>
  - BR-<ID> — <description>
  - pool-master-<DEFECT-ID> — <description>   (defect-fix slices only)

Defect-fix observation (defect-fix slices only):
  The failing test reproducing pool-master-<DEFECT-ID> was observed to fail
  on the broken code before the fix landed. Evidence: <commit SHA / PR body line>.

Rules to audit against:
  - rules/workflow-rules.md (slice completion checklist, §6)
  - rules/testing-rules.md (§1A traceability, §3 defect protocol, §1B
    forbidden patterns, §1C test-disable discipline)
  - rules/<layer>-rules.md
  - <plan or tech-spec path if applicable>

Known concerns I (the implementing agent) already identified:
  - <concern + why I left it / how it's bounded>

Severity calibration reminder:
  Honor personas/riley.md §Severity Calibration. The auto-merge gate is
  zero CRITICAL/HIGH = merge; padding severity defeats the gate.

Expected output:
  Findings table per personas/riley.md, ordered by severity, with
  categories. Flag inability-to-evaluate explicitly.
```

If you cannot fill in any of fields 1–6, the slice is not ready for review yet — go back and finish it, or surface the gap to the user.

### Auto-merge gate

The auto-merge rule is binary on Riley's severity output:

- **CRITICAL** or **HIGH** findings → block merge.
- **MEDIUM** or **LOW** findings → may merge; the implementing agent files follow-up Beads stories for items worth tracking and notes the deferral in the closing note.

Riley's severity calibration (per `personas/riley.md`) is what makes this gate work. If a finding is genuinely a blocker, it must be CRITICAL or HIGH — not MEDIUM with a strong recommendation.

### When the user must be paused for approval

Even on a clean Riley pass, pause and request explicit user approval before merging when:

- The slice contains a **destructive database migration**: `DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN` on a column with existing data, type narrowing on a populated column, adding `NOT NULL` to an existing column without a backfilled default, or any migration that cannot be rolled back without data loss.
- The slice contains a **data backfill, data migration script, or any one-time data-modifying operation** that runs against production-shaped data.
- The slice has any other **non-reversible production effect**: deleting production records, retiring an API endpoint with active consumers, removing a feature flag that gated production behavior, deleting a published artifact, or invalidating cached state at scale.
- The slice changes shared contracts (DTOs, OpenAPI, generated SDK exports).
- The slice changes infrastructure, CI/CD, deployment, or auth boundaries.
- The slice deletes a plan file or retires a feature surface.
- The slice modifies `rules/`, `docs/adr/`, or `personas/`.
- The user has explicitly asked for a checkpoint.

Auto-merge is a frictionless default for ordinary slice work; cross-cutting, process-affecting, or non-reversible changes still warrant a human read.

For migration / backfill / non-reversible slices specifically, the pause request must include: what the operation does, what data it touches, what the rollback plan is (or "none — this is one-way"), and whether a dry-run was performed. Riley flagging a migration as "looks fine" is **not** a substitute for this pause.

### When the agent must NOT auto-merge regardless of Riley output

- The local gate set was incomplete or any required gate was skipped.
- The PR description does not include the Beads story ID.
- For defect-fix slices: the failing-test-before-fix observation is not present in the slice history or PR body.
- Riley reported any inability to evaluate (e.g., scope too large, missing context, ambiguous spec). Surface to the user instead.

### Branch lifecycle

- Open branches stay short-lived (hours to days). A branch that has been open longer than the Beads story has been `in_progress` is a sign the work has stalled — close or split it.
- After merge, `--delete-branch` removes the remote branch. The local branch can be deleted with `git branch -d pool-master-NNN-<slug>` once switched back to `main`.
- Reopened stories spawn a new branch with the same `pool-master-NNN-` prefix and a new slug; do not reuse a merged branch.
