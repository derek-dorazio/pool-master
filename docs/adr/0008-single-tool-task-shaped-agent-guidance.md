# ADR 0008: Agent Guidance Is Task-Shaped and Single-Tool

- **Status:** Accepted
- **Date:** 2026-09-23

## Context

This repo carried thirteen role personas modelling a software team — product manager,
architect, data modeler, test planner, backend developer, frontend developer, QA, and five
reviewers — each defined once under `personas/<name>.md` and surfaced through thin-pointer
wrappers in four tool-specific directories: `.claude/skills/`, `.claude/agents/`,
`.agents/skills/` (Codex), and `.codex/agents/`.

Both halves were reasonable when adopted, and both stopped paying for themselves. This ADR
records why, because the reasoning lived only in a plan file, and plans are deleted when
their parent epic closes (ADR-0002).

**Role personas** answered 2024–2025 model behavior: models drifted off task, invented API
shapes, and lost the thread on long work. A persona saying "you are the frontend developer,
do not read backend source, route contract questions through the backend developer" kept a
weaker model anchored.

**The four-copy layout** answered a real portability problem: Claude Code and Codex both
support skills and subagents, with different directory conventions and file formats. One
neutral content location plus minimal per-tool wrappers avoided four copies of each
playbook. The accepted cost was that a wrapper's summary might be skimmed without following
the pointer to the full text.

### What changed

**Role personas partition knowledge a current model is better off holding at once.** The
frontend persona forbade reading backend source. That barrier existed because a weaker model
reading backend code would copy implementation details into the frontend. A current model
reading the same code correctly infers the contract *and* notices when the OpenAPI
description contradicts it. The barrier now prevents the second thing while no longer being
needed for the first.

**The portability premise expired.** Codex is not in use here. Four directory trees were
being maintained for one runtime.

**The wrappers were a fifth copy in practice.** Each carried a "quick summary (not
authoritative)" for discovery, which drifted from the playbook it summarised — the exact
duplication the pattern was adopted to prevent.

## Decision

**Agent guidance is organised by the task being performed, not by a role performing it, and
lives in exactly one directory: `.claude/skills/<name>/SKILL.md`.**

`personas/`, `.agents/`, `.codex/` and `.claude/agents/` are deleted.

The distinction that matters: **a role tells an agent what it is not allowed to know; a task
tells it what order to do things in.** Sequencing is the part that transfers; partitioning
is the part that cost more than it protected.

### Where the content went

| Was | Is |
|---|---|
| Backend, frontend, data-modeler personas | `add-endpoint`, `model-change`, `add-frontend-feature` skills |
| The data modeler's classification step | Step 1 of `model-change` — a decision point, not a handoff |
| QA persona | `release-check` skill |
| Five reviewer personas | `/code-review`, `/security-review`, the scanners, and `review-triggers.md` §5–§7 |
| Architect's design-plan structure | `workflow-rules.md` §1 *Plan file structure* |
| Architect's two architectural invariants | `architecture-rules.md` §4 *Architectural Rules* |
| Product manager's confidence labels | Already in `product-requirements-rules.md` §3 |
| Test planner's layer selection | Already in `testing-rules.md` §2 |

Review became **one pass with up to three optional lenses** — performance, security,
architectural fit — rather than numbered passes each casting a vote. A lens is applied when
the diff has that surface and skipped otherwise, and skipping is the common case.

### Skills cite rules; they do not restate them

`rules/` stays the canonical policy home, because it has a non-agent audience: human
contributors, `AGENTS.md`, the PR template, and CI scanners that name rule sections in their
failure output. Skills carry the sequence and the traps, and cite policy as
`rules/<file>.md §N *Section Name*`.

A skill must not cite anything that can disappear — an issue, a plan, a tech spec, an ADR,
or a source line number. `scripts/check-skill-references.mjs` enforces this; the reasoning
is in `workflow-rules.md` §2.

## Consequences

**Reintroducing a second runtime means re-extracting content.** This is the real cost, and
it is accepted. The wrapper pattern is cheap to reinstate from git history if Codex or
another tool comes back, and maintaining it speculatively for a runtime nobody uses is not.

**Role language is gone from the rules.** Thirty-six nicknames across five rule files were
replaced with the role each denoted — "the product-requirements bundle" rather than "Pam's
bundle". Rules that named a persona whose definition had been deleted would have been a
dangling reference that still read as valid prose.

**Reviewer identity disappears from PR reviews.** The persona header and per-persona vote
are gone. A review is a review; its findings stand or fall on content. The repo's actual
gate was never the vote — it is CI plus the owner reading the changeset — so nothing that
was load-bearing was removed.

**Discovery now depends on skill descriptions rather than a roster.** A persona could be
invoked by name; a skill triggers on its description matching the work. That is intended —
guidance should arrive because the task matches, not because someone remembered a name — but
a badly-worded description is now a discoverability bug.

## Alternatives Rejected

**Keep the personas, drop only the extra runtimes.** This was the smaller change and it
addresses the maintenance cost without addressing the knowledge-partitioning cost. The
barrier in the frontend persona is the clearest example: a single-tool layout would have
preserved it intact.

**Move `rules/` into skills as bundled `references/`.** Rejected because it would create
copies rather than remove them. Bundled references are per-skill, and several rule files are
needed by more than one skill — so shared policy would be duplicated per skill, or one skill
would point into another's folder. `rules/` also has a non-agent audience that a directory
under `.claude/` would not serve.

**Keep one reviewer as a subagent for deep passes.** Considered for the performance
reviewer, on the grounds that an isolated context window buys a more thorough read. Rejected
because it answers a cost question ("worth one file?") when the real question is whether a
performance review is role-shaped or task-shaped. It is a lens, now `review-triggers.md` §5.

**Promote wrappers from thin pointers to symlinks.** The original plan's own fallback if
agents skimmed the summary instead of following the pointer. Moot once the multi-runtime
premise went, and it would have preserved the role shape regardless.
