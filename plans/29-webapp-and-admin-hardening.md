# Plan 29: Webapp and Admin Hardening

## Purpose

Finish removing frontend TODO stubs, duplicate client layers, and placeholder interaction flows so both webapps reflect the generated API contract and only expose features that are actually wired.

## Review Findings Driving This Plan

1. Several user-facing web features still simulate success locally instead of calling the API.
2. Legacy handwritten API clients still exist alongside the generated client and are still referenced by tests.
3. Some frontend hooks still use local contract extensions/casts instead of shared DTOs.
4. Smoke tests still permit known-bad responses in several flows, which reduces signal after deploy.

## Scope

- `clients/web/src/features/**/*`
- `clients/web/src/lib/*`
- `clients/admin/src/lib/*`
- smoke/E2E and relevant unit/integration tests

## Goals

- Remove production UI stubs and TODO-success flows.
- Standardize on the generated client and shared DTOs.
- Remove obsolete manual client wrappers and tests built around them.
- Tighten smoke/E2E assertions once backend/QA behavior is stable.

## Priorities

### Priority 1

Remove UI flows that lie about success:

- fake commissioner actions
- fake join/leave flows
- fake settings mutations for destructive or compliance-sensitive actions

### Priority 2

Eliminate contract drift in the client layer:

- migrate away from handwritten API wrappers
- remove local DTO extensions and unsafe casts
- align tests with the generated client and shared contracts

### Priority 3

Increase deployment confidence once the product flows are real:

- tighten smoke assertions
- add browser coverage for the repaired interaction paths

## Implementation Phases

### Phase 1: Remove fake success flows from user-facing UX

- Audit contest, league, and settings features for `setTimeout`, optimistic-only success toasts, and TODO placeholders.
- Decide case by case whether each feature should be wired to a real API now or hidden until the backend exists.
- Prioritize destructive or trust-sensitive flows first, especially account deletion, self-exclusion, and participation changes.

### Phase 2: Repair or gate contest and league interactions

- Replace commissioner control placeholders with real admin/commissioner actions where backend support exists.
- Replace join/leave placeholders with real mutations, or remove the controls from production surfaces until supported.
- Update feature-state handling so loading, error, and permission states reflect actual server responses.

### Phase 3: Repair settings and profile contract usage

- Replace settings TODO flows with real APIs or explicit disabled states that explain the capability is unavailable.
- Audit hooks and feature helpers for local API-shape extensions that should instead be owned by shared DTOs.
- Expand backend/shared contracts as needed rather than preserving frontend-only type patches.

### Phase 4: Consolidate around the generated client

- Identify remaining imports of handwritten API clients in the web and admin apps.
- Remove or isolate the legacy wrappers so the generated client is the default application path.
- Update affected tests to exercise request wiring through MSW or contract-aligned adapters rather than mocking obsolete wrappers.

### Phase 5: Tighten smoke and browser verification

- Review smoke tests that currently allow broken responses or placeholder success envelopes.
- Tighten those assertions after the underlying backend and frontend flows are real and stable.
- Add browser coverage for logout, scoring-template contest creation, and key settings journeys that are now contract critical.

## Acceptance Criteria

- No production web or admin flow claims success without making a real API call or presenting a clearly disabled state.
- Generated-client usage is the default path for application API access in both apps.
- Frontend hooks and feature modules no longer depend on local DTO extensions where the backend contract should own the shape.
- Tests no longer center on mocking the legacy handwritten client layer.
- Smoke and browser coverage assert the repaired end-to-end behavior for the most important user flows.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| WAH-001 | Contest UX | Replace the fake mutation in [commissioner-controls.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/contests/commissioner-controls.tsx) with real admin/commissioner actions or remove the controls until supported | Not Started | No production UI should claim success after `setTimeout` |
| WAH-002 | League UX | Replace fake join/leave flows in [join-leave-flow.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/leagues/join-leave-flow.tsx) with real API calls or gate/hide the feature | Not Started | Current implementation violates the “no fake success” rule |
| WAH-003 | Settings UX | Replace account deletion, self-exclusion, activity/session reminders, and similar settings TODO flows with real APIs or disable them | Not Started | Start with [account-deletion-card.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/account-deletion-card.tsx), [self-exclusion-dialog.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/self-exclusion-dialog.tsx), and [session-reminder-card.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/session-reminder-card.tsx) |
| WAH-004 | Client Layer | Remove or quarantine legacy handwritten clients in [clients/web/src/lib/api-client.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/lib/api-client.ts) and [clients/admin/src/lib/api-client.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/lib/api-client.ts) | Not Started | The generated client should be the application default; keep legacy wrappers only if strictly needed for isolated migration code |
| WAH-005 | Client Layer | Remove tests that still mock the old manual client layer and migrate them to MSW/generated-client flows where request wiring matters | Not Started | This will raise confidence and reduce contract drift |
| WAH-006 | DTO Alignment | Eliminate remaining local API-facing extensions/casts like [use-profile.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/hooks/use-profile.ts) where the backend contract should own the shape | Not Started | Prefer expanding shared DTOs over local ad hoc API types |
| WAH-007 | Smoke Tests | Tighten smoke tests that currently allow broken responses, including [search-discovery.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/search-discovery.smoke.ts), [scoring-templates.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/scoring-templates.smoke.ts), and [member-management.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/member-management.smoke.ts) | Not Started | Do this after QA/runtime behavior is stable |
| WAH-008 | Browser Tests | Expand E2E to cover auth logout, scoring-template contest creation, and key settings flows once those APIs are real | Not Started | Current browser smoke suite is still light on contract-critical interactions |
