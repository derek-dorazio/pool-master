# PoolMaster Agent Instructions

`AGENTS.md` is the canonical entry point for coding-agent instructions in this repository.

All agents working in this repo should:

1. Read this file first.
2. Treat the files in `rules/` as the detailed source of truth for architecture, implementation, testing, and workflow requirements.
3. Treat persona playbooks in `personas/` as role-specific execution guides layered on top of the shared rules, not as competing policy sources. Tool-specific wrappers under `.claude/skills/`, `.agents/skills/` (Codex), `.claude/agents/`, and `.codex/agents/` are thin pointers to the authoritative `personas/<name>.md` file; when a persona activates, the tool wrapper instructs the agent to Read the personas file for the full playbook.
4. Keep `CLAUDE.md` as a thin pointer to this file rather than maintaining duplicate policy text elsewhere.

## Non-Negotiables

- Never add mock data, fake data, fallback sample payloads, or hardcoded API responses to application code.
- Fix the real architecture and contract problems first; only adjust tests after the production behavior is correct.
- Keep OpenAPI, shared DTOs, mappers, generated clients, and frontend/backend usage in sync.
- Update Beads state (status, notes) when working against an existing epic or story. Plans are narrative only; they do not carry task tables (see `rules/workflow-rules.md §1` and `docs/adr/0002-plans-as-narrative-delete-after-epic-closes.md`).
- Keep documentation and rules in sync when architecture, workflow, or testing patterns change.

## Read These Files Before Implementing

- `rules/workflow-rules.md`
- `rules/working-style.md`
- `rules/product-discovery-rules.md`
- `rules/architecture-rules.md`
- `rules/product-requirements-rules.md`
- `rules/technical-specification-rules.md`
- `rules/poolmaster-webapp-rules.md`
- `rules/domain-model-conventions-rules.md`
- `rules/service-rules.md`
- `rules/react-ui-rules.md`
- `rules/ux-rules.md`
- `rules/testing-rules.md`
- `rules/model-change-rules.md`
- `rules/swift-rules.md`
- `rules/android-rules.md`

## Purpose of the Rules Files

- `rules/workflow-rules.md`: Beads/plan workflow, execution protocol, and how to keep active slice tracking in sync.
- `rules/working-style.md`: collaboration defaults, communication preferences, and working-session continuity guidance.
- `rules/product-discovery-rules.md`: high-level product-discovery artifacts, Piper's discovery scope, and discovery handoff expectations.
- `rules/architecture-rules.md`: system boundaries, contract-first architecture, generated SDK expectations, and infrastructure assumptions.
- `rules/product-requirements-rules.md`: product requirement artifacts, use-case structure, confidence labels, and handoff floor for requirement work.
- `rules/technical-specification-rules.md`: technical-spec artifact structure, domain/API/flow spec expectations, and handoff floor for technical design work.
- `rules/poolmaster-webapp-rules.md`: single-webapp product rules, role-based behavior, archived-app policy, and functional expectations for the go-forward PoolMaster web app.
- `rules/domain-model-conventions-rules.md`: lifecycle naming, soft-delete vs hard-delete semantics, `status` vs `isActive`, and domain-model consistency conventions.
- `rules/service-rules.md`: backend Fastify, Prisma, DTO, mapper, and OpenAPI requirements.
- `rules/react-ui-rules.md`: PoolMaster React conventions, generated-client usage, and prohibited frontend patterns.
- `rules/ux-rules.md`: standard UX conventions, state communication defaults, and PoolMaster-specific interaction guidance for first-draft web implementation.
- `rules/testing-rules.md`: unit, data integration, contract verification, functional API, frontend-layer, and CI expectations.
- `rules/model-change-rules.md`: required checklist for schema/model changes across persistence, DTOs, services, routes, clients, and tests.
- `rules/swift-rules.md`: iOS guidance.
- `rules/android-rules.md`: Android guidance.

## Persona Playbooks

Persona content lives once in `personas/<name>.md`. Tool-specific thin-pointer wrappers under each tool's canonical directory instruct the agent to Read the personas file for the full playbook. See `plans/111-persona-library-restructure.md` for the full layout and rationale.

**Authoritative persona files (`personas/`):**

- `personas/pam.md` — Product Manager
- `personas/piper.md` — Product Discovery *(dormant)*
- `personas/tom.md` — Technical Specification Creator *(dormant)*
- `personas/dom.md` — Data Modeler
- `personas/tess.md` — Test Planner
- `personas/fran.md` — Frontend Developer
- `personas/brad.md` — Backend Developer
- `personas/archie.md` — Architect
- `personas/quinn.md` — QA/Test Engineer *(invoked as subagent)*
- `personas/riley.md` — Code Reviewer *(invoked as subagent)*

**Tool-specific wrappers (thin pointers; do not duplicate persona content):**

- **Claude Code skills:** `.claude/skills/<name>/SKILL.md` — 8 personas (`fran, brad, pam, dom, tess, archie` active; `piper, tom` dormant via `disable-model-invocation: true`).
- **Claude Code subagents:** `.claude/agents/<name>.md` — `quinn` and `riley` (isolated-context verification/review passes).
- **Codex skills:** `.agents/skills/<name>/SKILL.md` — same 8 personas; `piper` and `tom` are dormant via `.agents/skills/<name>/agents/openai.yaml` with `allow_implicit_invocation: false`.
- **Codex subagents:** `.codex/agents/<name>.toml` — `quinn.toml` and `riley.toml`.

Default responsibility split for common lanes:

- `Piper` / product discovery *(dormant)*: broad product framing, goals, actors, major modules — invoked explicitly for greenfield only
- `Pam` / product manager: refined product requirements, use cases, business rules, screen purpose
- `Tom` / technical specification *(dormant)*: technical design, domain/API/flow specification — invoked explicitly for major new features only
- `Dom` / data modeler: contract-change gate; classifies UI-only vs contract-only vs true model change
- `Tess` / test planner: coverage matrix authorship
- `Archie` / architect: execution slicing, sequencing, infrastructure/cross-cutting architecture
- `Fran` / frontend developer: frontend UX realization and web implementation
- `Brad` / backend developer: backend/domain/API implementation
- `Quinn` / QA/test engineer *(subagent)*: verification execution, regression triage, release confidence reporting
- `Riley` / code reviewer *(subagent)*: findings-first review, risk detection

If a role is misassigned during discussion or execution, agents should correct
it proactively and update the relevant persona/rules if the boundary was not
clear enough. The user should not need to police persona ownership in real
time.

Important:

- `AGENTS.md` and `rules/` remain the canonical shared contract.
- Persona files in `personas/` and their thin-pointer wrappers must not redefine or contradict repo-wide policy.
- Cross-cutting workflow requirements such as checking Beads and validating slices remain required for all agents.
- Frontend implementation should be driven by reviewed plans, generated SDK/types, and documented API contracts rather than backend implementation details.
- Contract meaning, API documentation quality, and model-change implementation remain backend-owned responsibilities.

## Workflow Expectations

- Check whether the work is already tracked in Beads and/or `plans/`, update the relevant Beads items as work starts and finishes. Plans are narrative only — they do not carry task rows.
- At the start of a resumed session, re-read `rules/working-style.md` to restore the expected collaboration style and continuity defaults before implementing.
- When a prior session intentionally paused work, check `docs/SESSION-HANDOFF.md` for the current "resume here" note before choosing the next slice.
- When a refactor changes architecture, testing patterns, or developer workflow, update the matching `rules/*.md` files in the same effort.
- Do not maintain competing instruction sets across `AGENTS.md`, `CLAUDE.md`, `rules/`, `personas/`, and the tool-specific wrapper directories.
- Treat `requirements/` and `tech-specs/` as design inputs and handoff artifacts; Beads is the live execution/refinement tracker and `plans/` remain the narrative execution context.

## Documentation Expectations

- Update `README.md`, `docs/DEVELOPER-SETUP.md`, package READMEs, and feature READMEs when the change affects architecture, setup, scripts, endpoints, or tests.
- Update service/module docs when adding or materially changing backend endpoints.

## Quality Gates Before Commit

Run and pass:

- `npx turbo typecheck --force`
- `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
- `npx jest --config tests/jest.config.js --forceExit`
- `npm run test:service:functional-api`
- `npm run test:poolmaster:unit`

CI-only follow-up signals:

- image/publish workflows

## Repo Map

- `packages/`: backend services and shared packages
- `clients/`: PoolMaster web app and mobile clients
- `tests/`: unit, integration, and functional coverage
- `requirements/`: product discovery inputs, overview artifacts, and refined product requirements
- `tech-specs/`: technical specification artifacts for approved features
- `plans/`: tracked implementation plans
- `rules/`: detailed policy and architecture guidance
- `docs/adr/`: Architecture Decision Records (durable decisions)
- `personas/`: authoritative persona playbooks
- `.claude/skills/`, `.claude/agents/`: Claude Code skill and subagent thin-pointer wrappers
- `.agents/skills/`, `.codex/agents/`: Codex skill and subagent thin-pointer wrappers
- `infrastructure/`: deployment and environment assets
