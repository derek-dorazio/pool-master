# PoolMaster Agent Instructions

`AGENTS.md` is the canonical entry point for coding-agent instructions in this repository.

All agents working in this repo should:

1. Read this file first. Claude Code loads it every session through the `@AGENTS.md` import
   in `CLAUDE.md`; other agents read it directly.
2. Treat the files in `rules/` as the detailed source of truth for architecture, implementation, testing, and workflow requirements. Each rule is stated in exactly one place; everywhere else cites it as `rules/<file>.md §N *Section Name*`.
3. Use the task skills in `.claude/skills/` for the work they name. They sequence a task and point at the rule that governs each step; they do not restate rules.
4. `.claude/rules/` holds a few short, path-scoped reminders that Claude Code injects
   automatically when it opens a matching file — the Non-Negotiables below, at the moment
   they apply. They carry no policy of their own; each one cites the rule it summarises.
5. Keep `CLAUDE.md` as a thin import of this file rather than maintaining duplicate policy text elsewhere.

## Non-Negotiables

- **Never modify application code to make a test pass or fail predictably.** No mock data, fake data, fallback sample payloads, hardcoded API responses, synthetic defaults, "test mode" branches, swallowed errors, or test-only code paths in production source. Mocks/fakes/fixtures live exclusively in test code. See `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*. The `poolmaster/no-mocked-api` ESLint rule enforces the module-mocking half in CI.
- **Defect-fix slices must include a failing test before the fix.** The slice must demonstrate that a test reproducing the defect fails on the broken code, then passes on the fixed code. See `rules/testing-rules.md` §3 *Defect Verification Protocol*.
- **Every test name states the behavior and its expected outcome**, specifically enough that a reader knows what breaking it would mean. No issue, use-case, or business-rule ID is required — that requirement was struck. See `rules/testing-rules.md` §1A *Test Self-Documentation*.
- Fix the real architecture and contract problems first; only adjust tests after the production behavior is correct.
- Keep OpenAPI, shared DTOs, mappers, generated clients, and frontend/backend usage in sync.
- Update the GitHub issue (status, comments) when working against an existing epic or slice. Plans are narrative only; they do not carry task tables (see `rules/workflow-rules.md` §1, `docs/adr/0002-plans-as-narrative-delete-after-epic-closes.md`, and `docs/adr/0006-github-issues-as-live-task-tracker.md`).
- Keep documentation and rules in sync when architecture, workflow, or testing patterns change.

## Read the Rules Your Task Touches

`rules/` is far too large to read end to end before a slice, and doing so is not
useful — attention spent there is attention not spent on the change, and a directive nobody
can follow is one that gets ignored wholesale. Read by task shape instead.

The **Non-Negotiables** above apply to every slice regardless of what it touches.

| If the slice… | Read |
|---|---|
| Adds or changes a backend route, service, DTO, or mapper | `service-rules.md` — §4 *DTOs, Mappers, OpenAPI*, §7 *Error Handling*, §11 *Backend Logging*; `architecture-rules.md` §2 *Contract-First API Architecture*; a GET answering with a list, `testing-rules.md` §9B *Query Scaling Tests* |
| Changes the Prisma schema, a domain type, or an enum | `domain-model-concepts.md`, `model-change-rules.md`, `domain-model-conventions-rules.md`, then the backend row above |
| Adds a sport, a sport league or a contest template (setup) | the `add-sport` skill (a Clutch Card round: `add-clutch-card-league`); `ux-rules.md` §12 *League Pages and Commissioner Tools* item 12 (setup names, defaults, the How to Play and Contest types pages); `architecture-rules.md` §4 *Sport extension*, §6 *Manual-testing seed data goes through the admin API* (each league's last-season test data file) |
| Adds or changes an event page (`/play/...`) or its link preview | the `add-event-page` skill; `ux-rules.md` §13 *Event Pages* |
| Adds or changes a sport photo, a contest type picture or a link preview image | the `update-pictures` skill; `ux-rules.md` §14 *System Email* item 5, §13 *Event Pages* items 6 and 7 |
| Adds or changes a system email | the `add-email` skill; `ux-rules.md` §14 *System Email*; `docs/EMAIL-DELIVERY.md` |
| Touches domain entities, or the ask uses domain words (squad, team, entry, pick, field, release, submit, settle) | `domain-model-concepts.md` — what each entity is, what it is called on screen, and what the verb means in the model |
| Touches `clients/poolmaster` | `react-ui-rules.md` — §3 *API Integration*, §4 *TanStack Query*, §5 *State, Effect, Form*; `ux-rules.md`; `poolmaster-webapp-rules.md` |
| Adds or changes tests | `testing-rules.md` §1A–§1C and §3 always, plus the section for your layer: §4 contract verification, §5 MSW, §6 functional/browser E2E, §9/§9A integration depth and isolation, §9B query scaling |
| Adds a module, port, adapter, mapper, or has one module call another | `architecture-rules.md` §5 *Project Structure and Layer Boundaries*, §4 *Service Topology* (there is no event bus; modules call each other's services) |
| Defines product behavior, use cases, or screens | `poolmaster-webapp-rules.md`, `ux-rules.md` |
| Changes process, plans, tracker state, or rules themselves | `workflow-rules.md` — §0 *Document Lifecycle*, §6 *Branching, Review, Merge*; `working-style.md` |
| Touches CI, deployment, or infrastructure | `architecture-rules.md`, `workflow-rules.md` §3 *Required Local Validation Before Push*; a Terraform change also `workflow-rules.md` §6 *Applying Terraform* and the `apply-terraform` skill |
| Lands a Dependabot PR, changes `.github/dependabot.yml`, or upgrades a dependency | the `dependency-updates` skill; `workflow-rules.md` §3 *Required Local Validation Before Push* |
| Is iOS or Android work | `mobile-rules.md` — one React Native app with Expo, not built or scheduled |
| Is a review of someone else's diff | `review-triggers.md` — §2 for what the author should have disclosed, §5 *Reviewing for performance cost* when the diff has a performance surface |

**Before any push**, `workflow-rules.md` §3 defines the required gate set, and
`testing-rules.md` §3 says what a failing gate means for a test. Neither is optional
regardless of task shape.

**If your task isn't on this list**, route by the same principle: read the rules governing
the layer you are changing, plus `testing-rules.md` for whatever you are testing. When a
rule scanner fails, read the section it names — the scanner output *is* the routing hint.

**Rarely needed:** `product-requirements-rules.md` governs the pre-implementation
definition layers — discovery, refined requirements, tech specs — and is written to be read
as skip-by-default. Most work here is incremental and skips all three; the narrative goes in
the plan file instead. Reach for it, and the `define-a-feature` skill, only when framing a
genuinely new product surface with new actors or domain concepts.

## Task Skills

Guidance is organised by the **task being performed**, not by a role performing it. A role
tells an agent what it is not allowed to know; a task tells it what order to do things in.

| Skill | Use when |
|---|---|
| `add-endpoint` | Adding or changing a Fastify route — the DTO → mapper → route → regenerate → contract-verification chain |
| `model-change` | Changing the Prisma schema, a domain type, or an enum. Classify the blast radius first |
| `add-frontend-feature` | Building anything in `clients/poolmaster` |
| `add-sport` | Making contests possible for a new sport or scoring family: refine, registry entry, scoring family, then reflect on the skill |
| `add-event-page` | Adding an event page and its link preview: settle the offers, seed them by migration, write the copy, draw the preview image, check it on QA |
| `add-email` | Adding or redesigning a system email: settle audience and timing, the key and migration, the renderer from the shared pieces, the notice that queues it, tests, and a preview in a real inbox |
| `update-pictures` | Adding or changing a sport photo, a contest type picture or a link preview image: check, crop, note the source, redraw, and see it live on QA |
| `load-sport-data` | Putting a sport league's real schedule or fields on a site from public sources: gather, cross-check, write the data file, dry run, apply on the user's yes |
| `load-new-season` | Next season's schedules for every sport league at once: take stock of what has published, one file per sport, dry-run together, apply on the user's yes |
| `add-clutch-card-league` | A Clutch Card on a new playoff round: the stat pool league and its three setups by migration, last season's box scores as test data, and the lists that name every round |
| `clutch-card-round` | One playoff round's Clutch Card: load the event and both teams' stars when the matchups are announced, then each game's box score so standings settle |
| `release-check` | Before a push or PR, and when a gate fails |
| `fix-broken-ci` | CI is red: find the run that matters, match the known causes, fix the cause |
| `land-a-pr` | Merging an approved, green PR: trial-merge main, settle generated files and migrations, re-run lint, squash with the right closing keywords, close out |
| `run-local-stack` | Running the whole app in an agent's container with test data, for screenshots, phone-width reviews or the browser E2E suite |
| `apply-terraform` | A change under `infrastructure/terraform` needs applying to an environment: the copy-paste steps the owner runs on their machine, and the post-check |
| `dependency-updates` | The Monday dependency run, or a Dependabot security PR midweek: land each Dependabot PR through the gates, review and merge spacing, set aside an update that breaks, propose new major versions to the owner |

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

- Update `README.md`, package READMEs, and feature READMEs when the change affects architecture, setup, scripts, endpoints, or tests.
- Update service/module docs when adding or materially changing backend endpoints.
- **Doc updates ride with the code change that triggered them.** When a slice changes user-visible behavior, public API, setup, or tests, the matching doc update lands in the *same* PR — not as a follow-up doc-only PR. The issue is not closeable until both are in the same merged commit. See `rules/workflow-rules.md §6` *Docs ride with code (Definition of Done)*.

## Quality Gates Before Commit

The gate list is `rules/workflow-rules.md` §3 *Required Local Validation Before Push* — run
every command on it before pushing. It is deliberately not copied here: five copies of it
once drifted apart. Image and publish workflows are CI-only follow-up signals.

Commits run a staged-files ESLint hook. When it fails, fix the error; never use `--no-verify`. See the
same section, *The pre-commit hook*.

## Repo Map

- `packages/`: backend services and shared packages
- `clients/`: PoolMaster web app and mobile clients
- `tests/`: unit, integration, and functional coverage
- `requirements/`: product discovery inputs, overview artifacts, and refined product requirements
- `tech-specs/`: technical specification artifacts for approved features
- `plans/`: tracked implementation plans
- `rules/`: detailed policy and architecture guidance — the one canonical home per rule
- `docs/`: operational reference (CI, logging, email, domain operations) and `docs/adr/`, the Architecture Decision Records
- `.claude/skills/`: task skills — how this repo does a given kind of work
- `.claude/rules/`: path-scoped Non-Negotiable reminders, auto-loaded by Claude Code
- `infrastructure/`: deployment and environment assets
