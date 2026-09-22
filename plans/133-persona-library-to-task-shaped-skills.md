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
| Riley, Sage, Felix, Perry | `/code-review`, `/security-review`, scanners, and Plan 132's disclosure triggers |
| Pam, Tess | Retired as personas. Two pieces of content are worth preserving into `rules/`: Pam's `(Confirmed)` / `(Inferred)` / `(Needs Review)` confidence labels, which are genuinely good spec practice, and Tess's layer-selection heuristic for choosing where a test belongs |
| Piper, Tom | Deleted. Both dormant; `workflow-rules §2` still lists them as lifecycle steps 1 and 3, contradicting the dormancy markers |

**Perry is the one plausible survivor as a subagent.** Its trigger list moves to
`rules/review-triggers.md` per Plan 132, but a deep performance pass on a genuinely
hot-path slice is work `/code-review` does not do. Keeping it costs one file. Flagged in
open questions rather than decided.

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

- **Plan 132** — the roster cannot be settled while five personas are defined as review
  passes. 132's disclosure triggers are the destination for Sage's and Perry's content.
- **Plan 134** — rules files are the salvage destination for persona prohibitions. If 134
  runs first, the destination exists; if this plan runs first, it creates rules content
  that 134 then reorganizes. Prefer 134 first, or accept one reorganization pass.
- **Nothing blocks slice one.** AGENTS.md routing can land immediately.

## Execution Sequence

**First — AGENTS.md conditional routing.** Independent, largest context saving,
reversible. A net improvement even if the rest of this plan were abandoned.

**Second — extract task skills.** Write the task-shaped skills, pulling the layer chains
and invariants out of Brad, Fran, and Dom. This is the slice with real content risk: the
persona files carry nuance worth preserving, and the extraction is a rewrite, not a move.

**Third — delete the personas and the wrapper trees.** Remove `personas/`, `.agents/`,
`.codex/`, and the Claude wrappers for retired roles. Update `AGENTS.md` and
`workflow-rules.md` roster tables and the `§2` lifecycle section.

**Fourth — write the single-tool persona layout ADR**, taking whatever number is next at
that point.

## Open Questions

- **Does Perry survive as a subagent?** Its list moves to triggers either way. The
  question is whether a deep performance pass is worth one file.
- **Where do Pam's confidence labels and Tess's layer heuristic land?** Candidates are a
  small `rules/` addition or folding them into the relevant task skills. They are good
  content and should not be lost with the personas.
- **Does any role framing survive for product work?** Pam maps to a genuinely distinct
  mode — deciding what to build rather than building it. That may be better served by
  plan mode and conversation than by a skill.

## Sources / Prior Decisions

- Plan 111 — Persona Library Restructure (establishes the pattern this plan reverses;
  precedent for outright deletion of a retired persona)
- Plan 132 — Review flow simplification (retires the five reviewer personas)
- Plan 134 — Rules consolidation (salvage destination for persona invariants)
- ADR-0002 — Plans are narrative; deleted after parent epic closes
- ADR-0003 — Tech specs are pre-implementation only
