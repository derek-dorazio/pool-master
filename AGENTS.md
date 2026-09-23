# PoolMaster Agent Instructions

`AGENTS.md` is the canonical entry point for coding-agent instructions in this repository.

All agents working in this repo should:

1. Read this file first.
2. Treat the files in `rules/` as the detailed source of truth for architecture, implementation, testing, and workflow requirements.
3. Use the task skills in `.claude/skills/` for the work they name. They sequence a task and point at the rule that governs each step; they do not restate rules.
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
| Is a review of someone else's diff | `review-triggers.md` — §2 for what the author should have disclosed, §5 *Reviewing for performance cost* when the diff has a performance surface |

**Before any push**, `workflow-rules.md` §3 and `testing-rules.md` §3 define the required
gate set. Those are not optional regardless of task shape.

**If your task isn't on this list**, route by the same principle: read the rules governing
the layer you are changing, plus `testing-rules.md` for whatever you are testing. When a
rule scanner fails, read the section it names — the scanner output *is* the routing hint.

**Rarely needed:** `product-discovery-rules.md` and `technical-specification-rules.md`
govern greenfield discovery and pre-implementation tech-spec artifacts, both dormant in a
mature codebase. Reach for them only when explicitly framing a new product surface.

## Task Skills

Guidance is organised by the **task being performed**, not by a role performing it. A role
tells an agent what it is not allowed to know; a task tells it what order to do things in.

| Skill | Use when |
|---|---|
| `add-endpoint` | Adding or changing a Fastify route — the DTO → mapper → route → regenerate → contract-verification chain |
| `model-change` | Changing the Prisma schema, a domain type, or an enum. Classify the blast radius first |
| `add-frontend-feature` | Building anything in `clients/poolmaster` |
| `release-check` | Before a push or PR, and when a gate fails |

Each skill is a sequence and a set of traps. The authoritative policy stays in `rules/`,
and skills cite it as `rules/<file>.md §N *Section Name*`. A skill must not point at a plan,
an issue, an ADR, or a source line number — all four disappear or drift, and
`rules:check:skill-references` enforces it. The reasoning is in `workflow-rules.md` §2
*Skills cite rules, and nothing that can disappear*.

### Reviewing

Review is one pass with up to three lenses, applied only when the diff has the matching
surface:

- `/code-review` — correctness, the general pass
- `review-triggers.md` §5 — performance cost
- `review-triggers.md` §6 — security
- `review-triggers.md` §7 — architectural fit

`/security-review` covers general security classes; §6 covers what is specific to this
codebase. What a PR must *disclose* is `review-triggers.md` §1–§4, which is a different
question from what a reviewer looks for.

Important:

- `AGENTS.md` and `rules/` remain the canonical shared contract.
- Skills sequence work; they do not redefine or contradict repo-wide policy.
- Cross-cutting workflow requirements such as checking the tracker and validating slices remain required for all agents.
- Frontend implementation should be driven by reviewed plans, generated SDK/types, and documented API contracts rather than backend implementation details.
- Contract meaning, API documentation quality, and model-change implementation remain backend-owned responsibilities.

## Workflow Expectations

- Check whether the work is already tracked in GitHub Issues and/or `plans/`, and update the relevant issues as work starts and finishes. Plans are narrative only — they do not carry task rows.
- At the start of a resumed session, re-read `rules/working-style.md` to restore the expected collaboration style and continuity defaults before implementing.
- When a refactor changes architecture, testing patterns, or developer workflow, update the matching `rules/*.md` files in the same effort.
- Do not maintain competing instruction sets across `AGENTS.md`, `CLAUDE.md`, `rules/`, and `.claude/skills/`.
- Treat `requirements/` and `tech-specs/` as design inputs and handoff artifacts; GitHub Issues is the live execution/refinement tracker and `plans/` remain the narrative execution context.
- **Not every change needs a PR.** Narrative plan updates during execution and trivial doc fixes are direct-push to `main` per `rules/workflow-rules.md §6` *What skips the PR flow*. Substantive plan, rule, ADR, or persona changes still go through the branch + PR flow — and when in doubt, the agent asks the user before pushing direct (per *Substantive plan or rule change — ask before pushing*).

## Documentation Expectations

- Update `README.md`, `docs/DEVELOPER-SETUP.md`, package READMEs, and feature READMEs when the change affects architecture, setup, scripts, endpoints, or tests.
- Update service/module docs when adding or materially changing backend endpoints.
- **Doc updates ride with the code change that triggered them.** When a slice changes user-visible behavior, public API, setup, or tests, the matching doc update lands in the *same* PR — not as a follow-up doc-only PR. The issue is not closeable until both are in the same merged commit. See `rules/workflow-rules.md §6` *Docs ride with code (Definition of Done)*.

## Quality Gates Before Commit

Run and pass:

- `npx turbo typecheck --force`
- `npm run lint` (runs eslint at `--max-warnings 0` plus the theme-token scanner)
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
- `.claude/skills/`: task skills — how this repo does a given kind of work
- `infrastructure/`: deployment and environment assets
