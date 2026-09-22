# PoolMaster Agent Instructions

`AGENTS.md` is the canonical entry point for coding-agent instructions in this repository.

All agents working in this repo should:

1. Read this file first.
2. Treat the files in `rules/` as the detailed source of truth for architecture, implementation, testing, and workflow requirements.
3. Treat persona playbooks in `personas/` as role-specific execution guides layered on top of the shared rules, not as competing policy sources. Tool-specific wrappers under `.claude/skills/`, `.agents/skills/` (Codex), `.claude/agents/`, and `.codex/agents/` are thin pointers to the authoritative `personas/<name>.md` file; when a persona activates, the tool wrapper instructs the agent to Read the personas file for the full playbook.
4. Keep `CLAUDE.md` as a thin pointer to this file rather than maintaining duplicate policy text elsewhere.

## Non-Negotiables

- **Never modify application code to make a test pass or fail predictably.** No mock data, fake data, fallback sample payloads, hardcoded API responses, synthetic defaults, "test mode" branches, swallowed errors, or test-only code paths in production source. Mocks/fakes/fixtures live exclusively in test code. See `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*. `check-no-mocked-api` enforces this in CI.
- **Defect-fix slices must include a failing test before the fix.** The slice must demonstrate that a test reproducing the defect fails on the broken code, then passes on the fixed code. See `rules/testing-rules.md` §3 *Defect Verification Protocol*.
- **Every test references a use-case, business-rule, or defect ID.** Describe block, test name, or leading comment — see `rules/testing-rules.md` §1A *Test Self-Documentation*.
- Fix the real architecture and contract problems first; only adjust tests after the production behavior is correct.
- Keep OpenAPI, shared DTOs, mappers, generated clients, and frontend/backend usage in sync.
- Update the GitHub issue (status, comments) when working against an existing epic or slice. Plans are narrative only; they do not carry task tables (see `rules/workflow-rules.md` §1, `docs/adr/0002-plans-as-narrative-delete-after-epic-closes.md`, and `docs/adr/0006-github-issues-as-live-task-tracker.md`).
- Keep documentation and rules in sync when architecture, workflow, or testing patterns change.

## Read the Rules Your Task Touches

`rules/` is roughly 280KB. Reading it end to end before a slice is neither possible nor
useful — attention spent there is attention not spent on the change, and a directive nobody
can follow is one that gets ignored wholesale. Read by task shape instead.

The **Non-Negotiables** above apply to every slice regardless of what it touches.

| If the slice… | Read |
|---|---|
| Adds or changes a backend route, service, DTO, or mapper | `service-rules.md` — §4 *DTOs, Mappers, OpenAPI*, §7 *Error Handling*, §11 *Backend Logging*; `architecture-rules.md` §2 *Contract-First API Architecture* |
| Changes the Prisma schema, a domain type, or an enum | `model-change-rules.md`, `domain-model-conventions-rules.md`, then the backend row above |
| Touches `clients/poolmaster` | `react-ui-rules.md` — §3 *API Integration*, §4 *TanStack Query*, §5 *State, Effect, Form*; `ux-rules.md`; `poolmaster-webapp-rules.md` |
| Adds or changes tests | `testing-rules.md` §1A–§1C and §3 always, plus the section for your layer: §4 contract verification, §5 MSW, §6 functional/browser E2E, §9/§9A integration depth and isolation |
| Emits or consumes a domain event | `architecture-rules.md` §4 *Service Topology* (event-bus and idempotency discipline), `testing-rules.md` §8 |
| Defines product behavior, use cases, or screens | `product-requirements-rules.md`, `poolmaster-webapp-rules.md`, `ux-rules.md` |
| Changes process, plans, tracker state, or rules themselves | `workflow-rules.md` — §0 *Document Lifecycle*, §6 *Branching, Review, Merge*; `working-style.md` |
| Touches CI, deployment, or infrastructure | `architecture-rules.md`, `workflow-rules.md` §3 *Required Local Validation Before Push* |
| Is iOS or Android work | `swift-rules.md` / `android-rules.md` — both clients are planned, not built |

**Before any push**, `workflow-rules.md` §3 and `testing-rules.md` §3 define the required
gate set. Those are not optional regardless of task shape.

**If your task isn't on this list**, route by the same principle: read the rules governing
the layer you are changing, plus `testing-rules.md` for whatever you are testing. When a
rule scanner fails, read the section it names — the scanner output *is* the routing hint.

**Rarely needed:** `product-discovery-rules.md` and `technical-specification-rules.md`
govern greenfield discovery and pre-implementation tech-spec artifacts, both dormant in a
mature codebase. Reach for them only when explicitly framing a new product surface.

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
- `personas/archie.md` — Architect (may also be spawned for an architecture read on a PR)
- `personas/quinn.md` — QA/Test Engineer *(invoked as subagent)*
- `personas/riley.md` — Code Reviewer *(invoked as subagent on demand)*
- `personas/sage.md` — Security Reviewer *(invoked when slice touches auth, validation, secrets, or data exposure; see `personas/sage.md` for trigger list)*
- `personas/felix.md` — Frontend Discipline Reviewer *(invoked when slice touches `clients/poolmaster`, frontend tests, frontend rule scanners, shared UI primitives, or React UI rules)*
- `personas/perry.md` — Performance Reviewer *(invoked when slice touches data access, route/list payloads, hot paths, list rendering, new dependencies, or similar performance surfaces)*

**Tool-specific wrappers (thin pointers; do not duplicate persona content):**

- **Claude Code skills:** `.claude/skills/<name>/SKILL.md` — 8 personas (`fran, brad, pam, dom, tess, archie` active; `piper, tom` dormant via `disable-model-invocation: true`).
- **Claude Code subagents:** `.claude/agents/<name>.md` — `quinn`, `riley`, `felix`, and `perry` (isolated-context verification and review reads).
- **Codex skills:** `.agents/skills/<name>/SKILL.md` — same 8 personas; `piper` and `tom` are dormant via `.agents/skills/<name>/agents/openai.yaml` with `allow_implicit_invocation: false`.
- **Codex subagents:** `.codex/agents/<name>.toml` — `quinn.toml`, `riley.toml`, `felix.toml`, and `perry.toml`.

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
- `Riley` / generalist code reviewer *(subagent)*: findings-first review, risk detection. Spawned by the implementer when a slice warrants an independent read.
- `Sage` / security reviewer *(subagent, conditional)*: invoked when the slice touches auth, validation, secrets, or data exposure.
- `Archie` / architect *(also runs as reviewer subagent, conditional)*: in addition to design-time work, invoked at PR time when the slice touches shared contracts, cross-module boundaries, infrastructure, or active plans/ADRs.
- `Felix` / frontend discipline reviewer *(subagent, conditional)*: invoked when the slice touches the PoolMaster web app, frontend tests, frontend rule scanners, shared UI primitives, or React UI rules.
- `Perry` / performance reviewer *(subagent, conditional)*: invoked when the slice touches Prisma queries, route/list payloads, sync/scoring hot paths, frontend list rendering, new dependencies, or similar performance-sensitive surfaces.

Reviewer personas are spawned on demand by the implementing agent, not as numbered gates. The branch → PR → CI → owner-reads → owner-asks-for-merge loop is documented in `rules/workflow-rules.md §6 Branching, Review, and Merge Cadence`; what a PR must disclose is in `rules/review-triggers.md`.

If a role is misassigned during discussion or execution, agents should correct
it proactively and update the relevant persona/rules if the boundary was not
clear enough. The user should not need to police persona ownership in real
time.

Important:

- `AGENTS.md` and `rules/` remain the canonical shared contract.
- Persona files in `personas/` and their thin-pointer wrappers must not redefine or contradict repo-wide policy.
- Cross-cutting workflow requirements such as checking the tracker and validating slices remain required for all agents.
- Frontend implementation should be driven by reviewed plans, generated SDK/types, and documented API contracts rather than backend implementation details.
- Contract meaning, API documentation quality, and model-change implementation remain backend-owned responsibilities.

## Workflow Expectations

- Check whether the work is already tracked in GitHub Issues and/or `plans/`, and update the relevant issues as work starts and finishes. Plans are narrative only — they do not carry task rows.
- At the start of a resumed session, re-read `rules/working-style.md` to restore the expected collaboration style and continuity defaults before implementing.
- When a refactor changes architecture, testing patterns, or developer workflow, update the matching `rules/*.md` files in the same effort.
- Do not maintain competing instruction sets across `AGENTS.md`, `CLAUDE.md`, `rules/`, `personas/`, and the tool-specific wrapper directories.
- Treat `requirements/` and `tech-specs/` as design inputs and handoff artifacts; GitHub Issues is the live execution/refinement tracker and `plans/` remain the narrative execution context.
- **Not every change needs a PR.** Narrative plan updates during execution and trivial doc fixes are direct-push to `main` per `rules/workflow-rules.md §6` *What skips the PR flow*. Substantive plan, rule, ADR, or persona changes still go through the branch + PR flow — and when in doubt, the agent asks the user before pushing direct (per *Substantive plan or rule change — ask before pushing*).

## Documentation Expectations

- Update `README.md`, `docs/DEVELOPER-SETUP.md`, package READMEs, and feature READMEs when the change affects architecture, setup, scripts, endpoints, or tests.
- Update service/module docs when adding or materially changing backend endpoints.
- **Doc updates ride with the code change that triggered them.** When a slice changes user-visible behavior, public API, setup, or tests, the matching doc update lands in the *same* PR — not as a follow-up doc-only PR. The issue is not closeable until both are in the same merged commit. See `rules/workflow-rules.md §6` *Docs ride with code (Definition of Done)*.

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
