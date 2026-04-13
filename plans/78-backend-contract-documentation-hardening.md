# Plan 78: Backend Contract Documentation Hardening

## Purpose

Raise the quality of backend API contract documentation so frontend developers
can implement against reviewed plans, generated SDK/types, and OpenAPI docs
without needing to inspect backend implementation code.

## Problem Statement

The repo already exports OpenAPI and generates the shared SDK, but contract
documentation quality is uneven:

- many routes have `summary` but no `description`
- DTO and field meaning is sometimes only obvious from backend service code
- frontend implementation questions can still require backend spelunking
- backend/shared changes discovered during UI work have not always been routed
  cleanly through a contract-first workflow

This plan turns the new workflow rules into a concrete documentation-improvement
program.

## Scope

- `packages/core-api/src/modules/**/routes.ts`
- `packages/shared/dto/**`
- `packages/shared/domain/**`
- `packages/core-api/src/mappers/**`
- OpenAPI export and generated SDK/type artifacts where documentation should
  surface downstream
- role handoff between `agents/data-modeler.md` and
  `agents/backend-developer.md`

## Goals

- Every actively used PoolMaster endpoint should have enough contract
  documentation for frontend implementation without backend code-reading.
- DTOs and important fields should explain purpose and semantics where names
  alone are insufficient.
- The data-modeler persona should classify backend/model implications before
  frontend work crosses the shared-contract boundary.
- The backend developer persona should own documentation-gap closure as part of
  normal API work.

## Non-Goals

- Rewriting the API surface solely for documentation polish
- Building a hosted Swagger UI or Redoc experience immediately
- Documenting deferred/retired surfaces before active PoolMaster flows

## Working Approach

1. Inventory the current OpenAPI quality for active PoolMaster flows.
2. Prioritize auth, leagues, invitations, members, contests, and other active
   frontend-consumed surfaces.
3. Have the data-modeler review each domain for:
   - missing semantics
   - unclear model implications
   - places where frontend could misinterpret lifecycle or state
4. Have the backend developer add or improve:
   - route summaries
   - route descriptions
   - tags
   - DTO/object descriptions
   - field descriptions
   - enum/value explanations
5. Refresh and validate OpenAPI so the generated SDK stays aligned.
6. Update the plan notes with the documentation coverage achieved per domain.

## Acceptance Criteria

- Active PoolMaster endpoints consumed by the current frontend have reviewed
  summaries, tags, and descriptions where behavior is not obvious.
- High-value DTOs and fields used by the frontend have descriptive semantics in
  the contract source.
- Backend developer workflow explicitly treats documentation gaps as defects to
  close, not tribal knowledge to explain ad hoc.
- The data-modeler persona is used to classify backend/model implications when
  frontend requests cross the contract boundary.
- `npm run api:refresh` and `npm run api:validate` pass after each domain batch.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 78-001 | 1 | Inventory current OpenAPI contract documentation quality for active PoolMaster endpoints and identify the first remediation batches | Not Started | Start with auth, leagues, invitations, members, contests, and any active `/league/<leagueCode>` support APIs. |
| 78-002 | 1 | Have the data-modeler review active PoolMaster domains and record where frontend semantics are unclear without backend code-reading | Not Started | Capture unclear lifecycle, status, and state semantics that should be fixed in contract docs. |
| 78-003 | 2 | Improve auth and onboarding contract docs in route schemas and DTOs | Not Started | Include register, login, refresh, logout, current-user, and invite-entry related auth semantics. |
| 78-004 | 2 | Improve leagues, invitations, and members contract docs in route schemas and DTOs | Not Started | Focus on league code, invite preview/acceptance, membership roles, activity state, and selector-driving payload semantics. |
| 78-005 | 2 | Improve contests and other active league-scoped contract docs in route schemas and DTOs | Not Started | Sequence this after the active onboarding/league-home surfaces are documented. |
| 78-006 | 3 | Refresh and validate OpenAPI after each domain batch and confirm generated SDK/docs surface the improved contract text | Not Started | Use `npm run api:refresh` and `npm run api:validate` as the documentation export gate. |
| 78-007 | 3 | Add a durable backend review checklist or helper guidance for future contract-documentation completeness | Not Started | Keep future API work from regressing into summary-only documentation. |
| 78-008 | 3 | Decide whether a human-readable Swagger/Redoc publication step is worth adding after the contract source quality is improved | Not Started | Defer until the underlying OpenAPI quality is strong enough to justify a published docs surface. |
