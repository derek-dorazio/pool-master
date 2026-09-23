# Plan 133 — Persona Library to Task-Shaped Skills

**Tracking issue:** #132

## Purpose

Replace role-shaped personas with task-shaped skills, and collapse the four-copy persona
layout to one.

The repo carries 13 role personas modelling a software team — product manager, architect,
data modeler, test planner, backend dev, frontend dev, QA, and five reviewers. That
pattern was a sensible response to 2024–2025 model behavior: models drifted off task,
invented APIs confidently, and lost the thread on long work, and role scaffolding kept
them anchored.

It has not survived contact with frontier models, for a specific reason: **role personas
partition knowledge the model is better off holding all at once.** `personas/fran.md`
forbids reading backend source and requires routing contract questions "through Brad."
That barrier existed because a weaker model reading backend code would cargo-cult
implementation details into the frontend. A current model reading the same code correctly
infers the contract *and* notices when the OpenAPI description is wrong. The barrier now
costs more than it protects.

## Governing Principles

- **One canonical home per concept** (`workflow-rules.md §0`, ADR-0002). Persona content
  currently exists in up to four copies.
- **Sequence steps, don't partition knowledge.** Task-shaped guidance tells the model what
  order to do things in; role-shaped guidance tells it what it is not allowed to know.
- **Delete on ship, don't archive.** Retired personas are deleted outright, as Parker was
  in Plan 111.
- **The valuable content is the invariant, not the role.** Fran's "never invent API
  shapes" and Brad's "never ship schema without DTO and mapper" are prohibitions that
  belong in rules; the role wrapper around them adds nothing.

## Key Decisions

### 1. Task-shaped decomposition replaces role-shaped

| Role-shaped (current) | Task-shaped (target) |
|---|---|
| "You are Brad, the backend developer, your responsibilities are…" | "Adding an endpoint: Zod DTO → mapper → route with operationId/summary/tags → `api:refresh` → contract-verification case" |
| Triggers on persona invocation | Triggers on the work itself |
| Partitions knowledge across roles | Sequences steps within a task |
| 13 files describing who does what | A handful describing how this repo does things |

Target skill set, approximately:

- `add-endpoint` — the backend layer chain, from Zod DTO through contract verification
- `model-change` — schema, migration, domain types, DTOs, mappers, routes, SDK,
  frontend consumers, tests. Absorbs Dom's classification step as a decision point rather
  than a handoff to a role.
- `add-frontend-feature` — generated SDK usage, query-key factory, mutation cache
  behavior, state ownership, theme tokens, form patterns
- `release-check` — the gate set and what to do when a gate fails

The exact set is settled during execution; the principle is that each skill names a task
a person actually performs, not a job title.

### 2. Roster disposition

| Persona | Becomes |
|---|---|
| Brad, Fran | `add-endpoint`, `add-frontend-feature`, `model-change` skills |
| Dom | A decision point inside `model-change`, not a role |
| Archie | Plan mode plus `workflow-rules §1`, which already specifies plan structure |
| Quinn | The gate commands and `/run`; failure triage is debugging |
| Riley, Sage, Felix | `/code-review`, `/security-review`, scanners, and `rules/review-triggers.md` |
| Perry | `rules/review-triggers.md` — §2 for *when* (already there), §5 for *how* (added) |
| Pam, Tess | Retired as personas. Two pieces of content are worth preserving into `rules/`: Pam's `(Confirmed)` / `(Inferred)` / `(Needs Review)` confidence labels, which are genuinely good spec practice, and Tess's layer-selection heuristic for choosing where a test belongs |
| Piper, Tom | Deleted. Both dormant; `workflow-rules §2` still lists them as lifecycle steps 1 and 3, contradicting the dormancy markers |

~~**Perry is the one plausible survivor as a subagent.**~~ **Decided: Perry does not
survive.** Keeping it would have been keeping a persona, which contradicts the whole plan —
the question was framed as "is this pass worth one file?" when it should have been "is this
role-shaped or task-shaped?" A performance review is a task.

The content splits cleanly, and half of it was already salvaged:

- **When to look** — already in `rules/review-triggers.md` §2, converted from surfaces to
  conditions. Nothing to move.
- **How to look** — the eight finding categories, the severity calibration, the
  evidence-over-intuition discipline, and the limits (no speculative micro-optimizations,
  never optimize by weakening correctness or authorization) became
  `rules/review-triggers.md` §5 *Reviewing for performance cost*.

  It was briefly a `review-performance` skill, which was the wrong vehicle: a skill has to
  be invoked, so it would have been a separate pass in practice even without a separate
  vote. `/code-review` is built-in and not repo-owned, so there is nothing to fold into
  there — the way to make performance part of the ordinary review here is to put it where a
  reviewer already reads. `review-triggers.md` is that place, and it now owns both halves:
  §1–§4 what an author discloses, §5 what a reviewer looks for. `AGENTS.md` routes to it.
- **The role wrapper** — the nickname, the "Pass 6" framing, the vote format, the
  `> _Perry review · …_` header — deleted, carrying nothing.

### 3. Collapse the layout to a single tool

Plan 111 introduced the thin-pointer pattern (`personas/<name>.md` authoritative, wrappers
in `.claude/skills/`, `.claude/agents/`, `.agents/skills/`, `.codex/agents/`) for one
stated reason: portability across Claude Code and Codex. That rationale no longer holds.

Skill content moves into `.claude/skills/<name>/SKILL.md` directly. `personas/`,
`.agents/`, and `.codex/` are deleted.

This reverses a durable structural decision and warrants **a new ADR** — referred to
throughout this plan set as the *single-tool persona layout* ADR — recording both the
single-tool collapse and the role-to-task shift. Plan 111 is deleted when its epic closes,
so the reasoning needs a permanent home.

**Its number is assigned when it is authored, not here.** ADR numbers are sequential and
claimed at creation; any ADR written between now and this slice takes the next one. A plan
that hard-codes a number is stale the moment that happens. Refer to proposed ADRs by name.

Accepted tradeoff: reintroducing a second runtime later means re-extracting content. Real
but deferred, and the pattern is cheap to reinstate from git history.

### 4. Route rule reading conditionally

`AGENTS.md` currently instructs every agent to read 15 rule files before implementing —
roughly 268KB, or about 70k tokens. The directive is either ignored (rules unenforced) or
obeyed (a third of the context window spent before work begins).

It moves to task-shaped routing: a backend slice names the three or four files that
actually govern it. The non-negotiables stay unconditional and up front, since they are
short and universal.

This is the highest-leverage change in the plan and is independent of every other slice
in it.

## Data Model / API Surface Implications

None.

## Dependencies

- **The review-flow simplification (landed)** — the roster cannot be settled while five personas are defined as review
  passes. 132's disclosure triggers are the destination for Sage's and Perry's content.
- **Plan 134** — rules files are the salvage destination for persona prohibitions. If 134
  runs first, the destination exists; if this plan runs first, it creates rules content
  that 134 then reorganizes. Prefer 134 first, or accept one reorganization pass.
- **Nothing blocks slice one.** AGENTS.md routing can land immediately.

## Execution Sequence

**First — AGENTS.md conditional routing.** ✅ **Landed** (`a287d85`). The 15-file mandate is
replaced by the *Read the Rules Your Task Touches* table.

**Second — extract task skills.** ✅ **Landed.** Four skills written:
`.claude/skills/{add-endpoint,model-change,add-frontend-feature,release-check}/SKILL.md`.

Deliberately **sequence-and-route, not restatement.** `rules/` already carries the
substance — `service-rules.md §4` has the backend chain, `react-ui-rules.md` has the
frontend discipline, `domain-model-conventions-rules.md` has the model language. Copying any
of it into a skill would recreate the multi-copy problem this plan exists to end. Each skill
says what order to do things in, what breaks when a step is skipped, and which rule section
is authoritative.

Dom's classification step became Step 1 of `model-change` — a decision point, not a handoff,
exactly as Decision 2 specifies. Fran's Implementer Self-Check became the self-check section
of `add-frontend-feature`. Brad's chain became `add-endpoint`.

**Third — delete the personas and the wrapper trees.** ✅ **Landed.** `personas/` (13),
`.agents/`, `.codex/`, `.claude/agents/` (4) and eight `.claude/skills/` wrappers removed.
`check-skill-references` wired into `rules:check`, which it could not be while the wrappers
existed.

Deliberately **not** done in the same slice as the extraction: while both exist, the
extraction is reviewable against its source. Delete first and the review question becomes
"is anything missing?" with nothing to compare against.

**Three personas carried content with no home, found by reading them rather than trusting
the roster table.** Codify-before-delete required salvaging it first:

- **Archie** — two architectural invariants stated nowhere else: dependency direction
  (`packages/shared` must never import from `packages/core-api`, and no cycles) and
  deferred-work hygiene (no `TODO` markers in merged code). Both added to
  `architecture-rules.md` §4. Its PR-review lens became `review-triggers.md` §7.
- **Sage** — a substantial, repo-specific security checklist: authority preHandlers at the
  route boundary rather than inline, league-isolation on list endpoints, error envelopes
  leaking internals, `ALLOW_MOCK_PROVIDERS` gating. Became `review-triggers.md` §6.
- **Perry** — became `review-triggers.md` §5 in the previous slice.

Riley, Felix and Quinn needed no salvage: Riley's two scans are already scanner-enforced,
Felix's discipline list is the self-check in `add-frontend-feature`, and Quinn's lanes are
`release-check`.

**36 persona nicknames across five rules files** were replaced with the role they denote
(`Pam's bundle` → `the product-requirements bundle`). Leaving them would have left rules
referring to roles whose definitions had just been deleted — the same dangling-concept
problem as a dead file pointer, harder to spot.

**Fourth — write the single-tool persona layout ADR.** ✅ **Landed** as
[ADR-0008](../docs/adr/0008-single-tool-task-shaped-agent-guidance.md). It records both
reversals — multi-runtime thin-pointer → single tool, and role-shaped → task-shaped — plus
the original rationale for each, since that reasoning lived only in `plans/111` and plans do
not survive their epic.

`plans/111` is deleted with it, which was the last open item in `plans/141` (#139).

Also recorded there and worth not re-litigating: `rules/` stays where it is rather than
moving into skills as bundled `references/`, because references are per-skill and several
rule files serve more than one skill — bundling would create copies rather than remove them,
and `rules/` has a non-agent audience that a directory under `.claude/` would not serve.

## Open Questions

- ~~**Does Perry survive as a subagent?**~~ **Resolved: no.** See Decision 2. The question
  was mis-framed as a cost question; the right one was whether a performance review is a
  role or a task. It is a task, and it is now `review-performance`.
- ~~**Where do Pam's confidence labels and Tess's layer heuristic land?**~~ **Resolved: both
  are already in `rules/` and neither needs salvaging.** `product-requirements-rules.md §3
  Confidence Labels` carries `(Confirmed)` / `(Inferred)` / `(Needs Review)` with the same
  default rule Pam states. `testing-rules.md §2 Test Layers` carries the backend and frontend
  layer tables Tess's heuristic selects from. Checked both before writing anything, which is
  why this slice adds no new `rules/` content — the salvage step was a no-op, and inventing
  content to satisfy it would have created the duplication this plan exists to remove.
- **Does any role framing survive for product work?** Pam maps to a genuinely distinct
  mode — deciding what to build rather than building it. That may be better served by
  plan mode and conversation than by a skill.

## Sources / Prior Decisions

- Plan 111 — Persona Library Restructure (establishes the pattern this plan reverses;
  precedent for outright deletion of a retired persona)
- `rules/workflow-rules.md §6` + `rules/review-triggers.md` — the landed review-flow simplification (retired the five reviewer personas)
- Plan 134 — Rules consolidation (salvage destination for persona invariants)
- ADR-0002 — Plans are narrative; deleted after parent epic closes
- ADR-0003 — Tech specs are pre-implementation only
