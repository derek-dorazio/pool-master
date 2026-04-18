# PoolMaster Agent Instructions

`AGENTS.md` is the canonical entry point for coding-agent instructions in this repository.

All agents working in this repo should:

1. Read this file first.
2. Treat the files in `rules/` as the detailed source of truth for architecture, implementation, testing, and workflow requirements.
3. Treat persona playbooks in `agents/` as role-specific execution guides layered on top of the shared rules, not as competing policy sources.
4. Keep `CLAUDE.md` as a thin pointer to this file rather than maintaining duplicate policy text elsewhere.

## Non-Negotiables

- Never add mock data, fake data, fallback sample payloads, or hardcoded API responses to application code.
- Fix the real architecture and contract problems first; only adjust tests after the production behavior is correct.
- Keep OpenAPI, shared DTOs, mappers, generated clients, and frontend/backend usage in sync.
- Update plan task tables in `plans/` when working against an existing plan.
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

- `rules/workflow-rules.md`: plan tracking, execution protocol, and how to update plan task status.
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

The `agents/` directory contains optional role-scoped playbooks for common kinds of work:

- `agents/product-manager.md`
- `agents/product-discovery.md`
- `agents/technical-specification-creator.md`
- `agents/project-manager.md`
- `agents/data-modeler.md`
- `agents/test-planner.md`
- `agents/frontend-developer.md`
- `agents/backend-developer.md`
- `agents/qa-test-engineer.md`
- `agents/architect.md`
- `agents/code-reviewer.md`

Use these playbooks to focus the workflow for that role.

Important:

- `AGENTS.md` and `rules/` remain the canonical shared contract.
- `agents/` files must not redefine or contradict repo-wide policy.
- Cross-cutting workflow requirements such as checking plans, updating task rows, and validating slices remain required for all agents, not just the project-manager persona.
- Frontend implementation should be driven by reviewed plans, generated SDK/types, and documented API contracts rather than backend implementation details.
- Contract meaning, API documentation quality, and model-change implementation remain backend-owned responsibilities.

## Workflow Expectations

- Check whether the work is already tracked in `plans/`, and update the relevant task rows as work starts and finishes.
- When a refactor changes architecture, testing patterns, or developer workflow, update the matching `rules/*.md` files in the same effort.
- Do not maintain competing instruction sets across `AGENTS.md`, `CLAUDE.md`, `rules/`, and `agents/`.
- Treat `requirements/` and `tech-specs/` as design inputs and handoff artifacts; active execution tracking still belongs in `plans/`.

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
- `infrastructure/`: deployment and environment assets
