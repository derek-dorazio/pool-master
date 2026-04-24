# Plan 111 — Persona Library Restructure for Claude Code + Codex Portability

**Beads epic:** `pool-master-7p5` — see `bd show pool-master-7p5` for live slice state, child stories, and status. This plan is the narrative companion; task tracking lives in Beads.

## Purpose

Reshape the `agents/` persona library so persona content is **portable across Claude Code and Codex** without duplication. Both tools now support skills and subagents as first-class features (see Sources below), but with different directory conventions and (for subagents) different file formats. This plan adopts a thin-pointer pattern that keeps persona content in a single neutral location and puts tool-specific wrappers in each tool's canonical directory.

Secondary goal: retire the Parker (project-manager) persona, whose responsibilities have been fully subsumed by Beads (task state) + the narrative-only plan convention (no plan rows to reconcile) + the delete-on-ship rule for plans (no archival to manage).

## Governing Principles

- **One source of truth per concept** (`rules/workflow-rules.md §0 Document Lifecycle`, ADR-0002). The persona's playbook content lives in exactly one file.
- **Beads is canonical for task state** (ADR-0001). Plans, persona wrappers, and related artifacts reference Beads but never duplicate status.
- **Short-lived artifacts reference long-lived ones, never the reverse.** Wrappers reference personas; personas are authoritative.
- **Delete when the work is done** (ADR-0002). Parker's playbook is deleted outright (not dormant-preserved) because its content actively conflicts with the new Beads-canonical workflow.

## Target File Layout

```
repo/
├── AGENTS.md                         # Lists personas via personas/ paths; both tools read this
├── personas/                         # Source of truth for all persona content
│   ├── fran.md                       # Frontend developer
│   ├── brad.md                       # Backend developer
│   ├── pam.md                        # Product manager
│   ├── dom.md                        # Data modeler
│   ├── tess.md                       # Test planner
│   ├── archie.md                     # Architect
│   ├── quinn.md                      # QA/Test engineer (subagent in both tools)
│   ├── riley.md                      # Code reviewer (subagent in both tools)
│   ├── piper.md                      # Product discovery (DORMANT)
│   └── tom.md                        # Technical spec creator (DORMANT)
│
├── .claude/                          # Claude Code
│   ├── skills/
│   │   ├── fran/SKILL.md             # Thin wrapper: frontmatter + read-personas-fran instruction
│   │   ├── brad/SKILL.md
│   │   ├── pam/SKILL.md
│   │   ├── dom/SKILL.md
│   │   ├── tess/SKILL.md
│   │   ├── archie/SKILL.md
│   │   ├── piper/SKILL.md            # disable-model-invocation: true
│   │   └── tom/SKILL.md              # disable-model-invocation: true
│   └── agents/
│       ├── quinn.md                  # Claude subagent wrapper (markdown + YAML frontmatter)
│       └── riley.md
│
├── .agents/                          # Codex skills
│   └── skills/
│       ├── fran/SKILL.md             # Thin wrapper — same body as Claude wrapper
│       ├── brad/SKILL.md
│       ├── pam/SKILL.md
│       ├── dom/SKILL.md
│       ├── tess/SKILL.md
│       ├── archie/SKILL.md
│       ├── piper/
│       │   ├── SKILL.md
│       │   └── agents/openai.yaml    # allow_implicit_invocation: false (dormancy)
│       └── tom/
│           ├── SKILL.md
│           └── agents/openai.yaml
│
└── .codex/                           # Codex subagents
    └── agents/
        ├── quinn.toml                # TOML format (Codex-specific)
        └── riley.toml
```

## The thin-pointer pattern

Each tool-specific wrapper contains only:

1. **Required frontmatter** for that tool (Claude's YAML fields or Codex's equivalents).
2. **A short body** that instructs the agent to `Read personas/<name>.md` before acting, plus a non-authoritative quick summary for discovery.

Example wrapper body (same content works in both `.claude/skills/fran/SKILL.md` and `.agents/skills/fran/SKILL.md`):

```markdown
---
name: fran
description: PoolMaster frontend developer persona. The full playbook lives at personas/fran.md — read that file before acting.
<tool-specific fields>
---

# Fran — Frontend Developer (stub)

**Authoritative persona playbook:** [`personas/fran.md`](../../../personas/fran.md).

**Before acting as this persona, you MUST Read `personas/fran.md` and treat its contents as governing for the duration of the work.** The summary below is for routing/discovery only — it does not substitute for the full playbook.

## Quick summary (not authoritative)

- Short bullets…
```

**Reliability tradeoff (accepted):** in rare cases an agent may skim the summary without following the pointer to read the full persona. Mitigated by strong imperative wording, placing the pointer instruction early in the body, and keeping the summary intentionally short. If reliability issues surface later, individual personas can be promoted from thin-pointer to symlink without disrupting the overall structure.

## Per-persona shape

| Persona | Source in `personas/` | Claude Code | Codex | Status |
|---|---|---|---|---|
| Fran | `personas/fran.md` | `.claude/skills/fran/SKILL.md` (active) | `.agents/skills/fran/SKILL.md` (active) | Primary executor (frontend) |
| Brad | `personas/brad.md` | `.claude/skills/brad/SKILL.md` (active) | `.agents/skills/brad/SKILL.md` (active) | Primary executor (backend) |
| Pam | `personas/pam.md` | `.claude/skills/pam/SKILL.md` (active) | `.agents/skills/pam/SKILL.md` (active) | Product manager |
| Dom | `personas/dom.md` | `.claude/skills/dom/SKILL.md` (active) | `.agents/skills/dom/SKILL.md` (active) | Data modeler (contract gate) |
| Tess | `personas/tess.md` | `.claude/skills/tess/SKILL.md` (active) | `.agents/skills/tess/SKILL.md` (active) | Test planner |
| Archie | `personas/archie.md` | `.claude/skills/archie/SKILL.md` (active) | `.agents/skills/archie/SKILL.md` (active) | Architect |
| Piper | `personas/piper.md` | `.claude/skills/piper/SKILL.md` **(dormant)** | `.agents/skills/piper/SKILL.md` + `agents/openai.yaml` **(dormant)** | Greenfield-only |
| Tom | `personas/tom.md` | `.claude/skills/tom/SKILL.md` **(dormant)** | `.agents/skills/tom/SKILL.md` + `agents/openai.yaml` **(dormant)** | Major-feature-only |
| Quinn | `personas/quinn.md` | `.claude/agents/quinn.md` **(subagent)** | `.codex/agents/quinn.toml` **(subagent)** | QA verification pass |
| Riley | `personas/riley.md` | `.claude/agents/riley.md` **(subagent)** | `.codex/agents/riley.toml` **(subagent)** | Code review pass |

**Parker removed** — responsibilities fully subsumed by Beads (task state tracking), narrative-only plans (no rows to reconcile), workflow-rules.md slice-completion checklist (drift detection), and ADR-0002 deletion rule (no archival to manage).

## Active vs dormant semantics

- **Active skills** auto-route based on the `description` field and are invocable via `/slash`. Pam, Fran, Brad, Dom, Tess, Archie.
- **Dormant skills** only fire when explicitly invoked by the user (`/piper`, `/tom`). They don't auto-route. In Claude Code this is `disable-model-invocation: true` in the frontmatter; in Codex this is `allow_implicit_invocation: false` in an optional `agents/openai.yaml` inside the skill directory.
- **Subagents** (Quinn, Riley) are explicit-only in both tools and get isolated context windows. Claude uses markdown+YAML format; Codex uses TOML. Content from `personas/quinn.md` is referenced from both wrappers via the same pointer pattern.

## Execution sequence

- **Slice A** (Beads `pool-master-7p5.1`) — remove Parker. Delete `agents/project-manager.md`, update `AGENTS.md` (two references), update `rules/workflow-rules.md` (nickname table row + project-manager paragraph).
- **Slice B** (Beads `pool-master-7p5.2`) — create `personas/` library with authoritative content for the 10 remaining personas. Create all tool-specific wrappers (`.claude/skills/`, `.agents/skills/`, `.claude/agents/`, `.codex/agents/`). Old `agents/*.md` stays in place during this slice so nothing mid-flight breaks.
- **Slice C** (Beads `pool-master-7p5.3`) — delete the remaining `agents/*.md` files now that wrappers + `personas/` are live. Update `AGENTS.md` and `rules/workflow-rules.md` references to point to `personas/` and the new wrapper paths. Close the parent epic.

## Open questions

None blocking. The thin-pointer reliability tradeoff is accepted; if real-world usage shows agents skipping the pointer read, individual personas can be promoted to symlinks (zero setup cost per persona) without changing the overall structure.

## Sources / prior ADRs

- [Claude Code Skills](https://code.claude.com/docs/en/skills.md) and [Subagents](https://code.claude.com/docs/en/subagents.md)
- [Codex Agent Skills](https://developers.openai.com/codex/skills) and [Codex Subagents](https://developers.openai.com/codex/subagents)
- ADR-0001 — Beads as live task tracker
- ADR-0002 — Plans are narrative; deleted after parent Beads epic closes
- ADR-0003 — Tech specs are pre-implementation only
