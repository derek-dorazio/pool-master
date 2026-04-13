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
| 78-001 | 1 | Inventory current OpenAPI contract documentation quality for active PoolMaster endpoints and identify the first remediation batches | Done | Active auth, league, invitation, and member-management routes were inventoried. Main gap found: summaries/tags existed, but route descriptions and DTO semantic descriptions were sparse or missing. |
| 78-002 | 1 | Have the data-modeler review active PoolMaster domains and record where frontend semantics are unclear without backend code-reading | Done | First review identified the load-bearing ambiguities for current frontend work: auth token/cookie semantics, invite preview vs accept flow, league code vs internal ID, membership-role meaning, and inactive-league behavior on list/detail surfaces. |
| 78-003 | 2 | Improve auth and onboarding contract docs in route schemas and DTOs | Done | Added route descriptions plus DTO/object/field descriptions for register, login, refresh, logout, forgot-password, callback, and current-user. The generated SDK now carries richer auth operation docs. |
| 78-004 | 2 | Improve leagues, invitations, and members contract docs in route schemas and DTOs | Done | Added route descriptions and DTO semantics for league list/detail/settings, invitation preview/acceptance, invite-link endpoints, invitation records, member roles, inactive-league state, and selector-driving league code usage. Also replaced the inline invitation-accept body with a shared DTO schema. |
| 78-005 | 2 | Improve contests and other active league-scoped contract docs in route schemas and DTOs | Done | Completed a full active-surface sweep across the remaining backend modules and shared contract files. Route descriptions now cover contests, drafts, standings, scoring, events, ingestion, history, notifications, squads, participant APIs, admin APIs, account consent, and platform-config endpoints. Shared DTO/domain semantics were added so the generated OpenAPI and SDK surface can serve as the frontend-facing spec. |
| 78-006 | 3 | Refresh and validate OpenAPI after each domain batch and confirm generated SDK/docs surface the improved contract text | Done | `npm run api:refresh` and `npm run api:validate` passed. Spot checks confirmed the new route descriptions now appear in both `packages/shared/generated/openapi.json` and `packages/shared/generated/hey-api/sdk.gen.ts`. |
| 78-007 | 3 | Add a durable backend review checklist or helper guidance for future contract-documentation completeness | Not Started | Keep future API work from regressing into summary-only documentation. |
| 78-008 | 3 | Decide whether a human-readable Swagger/Redoc publication step is worth adding after the contract source quality is improved | Not Started | Defer until the underlying OpenAPI quality is strong enough to justify a published docs surface. |
