## Objective

Implement the backend and frontend work for user self-managed account
lifecycle:

- inactivate own account
- delete inactive own account

## Dependencies

- [84-user-account-lifecycle-user-cases.md](./84-user-account-lifecycle-user-cases.md)
- future `My Account` UI planning/work

## Backend Deliverables

- self-inactivate account API
- self-delete inactive account API
- account/session cleanup behavior
- contract docs + DTO/OpenAPI regeneration
- backend tests for inactive-first delete rules

## Frontend Deliverables

- header user identity affordance and user menu entry to `My Account`
- `My Account` shell for future profile/password/account management
- `My Account` lifecycle surface
- inactive-first delete UX
- inline irreversible delete mini-wizard
- post-delete sign-out/redirect behavior

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 85-001 | 1 | Product/data-model review of account lifecycle semantics | Done | Current `User` has no lifecycle field, so this plan requires a schema/model change before backend implementation. Recommended first slice: add persistent user activity state (for example `isActive`) to support inactive-first delete without abusing auth/session rows as lifecycle state. Hard delete can still remove the user row entirely later. |
| 85-002 | 1 | Backend developer: add self-account inactivate API | Done | Added `POST /api/v1/account/inactivate`. Inactivation now sets `User.isActive=false`, revokes refresh tokens, returns the updated account profile, and blocks new login attempts. |
| 85-003 | 1 | Backend developer: add self-account delete API for inactive accounts | Done | Added `DELETE /api/v1/account`. Delete rejects active accounts, requires exact email confirmation, and clears auth cookies on success. |
| 85-004 | 1 | Backend developer: implement account cleanup behavior | Done | First slice hard-deletes only when no league/squad memberships or league/squad ownership remain, then removes refresh tokens, preferences, notifications, consent, invitations, audit references, and the user row. |
| 85-005 | 1 | Backend developer: add backend validation and contract coverage | Done | Added schema migration, shared DTOs, OpenAPI/SDK refresh, unit coverage, contract verification, functional API coverage, and inactive-user auth/session validation. |
| 85-006 | 2 | Frontend developer: add header user identity affordance and menu entry to `My Account` | Done | Header now uses a real signed-in account menu with `My Account`, `Settings`, and `Preferences` placement. |
| 85-007 | 2 | Frontend developer: design and implement `My Account` shell | Done | Added the `My Account` home with lifecycle live first and future profile/password/preferences scaffolding in place. |
| 85-008 | 2 | Frontend developer: implement account lifecycle UI inside `My Account` | Done | Real inactivate flow is wired against the backend and updates signed-in session state immediately. |
| 85-009 | 2 | Frontend developer: add account delete mini-wizard | Done | Inline wizard uses exact email confirmation before enabling `DELETE`. |
| 85-010 | 2 | Frontend developer: add post-delete logout and route handling | Done | Success path exits through signed-out routing after the user acknowledges delete completion. |
| 85-011 | 2 | Frontend developer: add UI tests and future browser-journey hooks | Done | Added component tests for inactivate, email confirmation gating, and delete success behavior to support future no-residue E2E cleanup. |
| 85-012 | 3 | Data-modeler/backend cleanup: align active account DTO/profile contract to the real user model | Done | Removed the synthetic `avatarUrl` field from the active user profile DTO, exposed the actually persisted `timeFormat` and `dateFormat` fields, and aligned constrained account/profile choices to shared enums across auth, account, and root-admin user detail surfaces. |
| 85-013 | 3 | Data-modeler/backend cleanup: remove dormant `UserLocalePreference` scaffolding and overlapping source-of-truth drift | Done | Removed the unused `UserLocalePreference` table/type/docs references, added the drop-table migration, and kept active account preference fields on `User` as the single current source of truth. |

## Data-Modeler Review Notes

- Unlike league lifecycle, user lifecycle cannot be implemented truthfully on the
  current model without a schema change.
- The current [User model](../packages/core-api/prisma/schema.prisma)
  has no `isActive`, `status`, or similar lifecycle field. It only stores core
  identity, preferences, and auth metadata.
- The current auth surface in
  [auth-service.ts](../packages/core-api/src/modules/auth/auth-service.ts)
  and [auth.dto.ts](../packages/shared/dto/auth.dto.ts)
  also exposes no user lifecycle state, and there is no existing inactive-user
  behavior to reuse.
- Therefore:
  - `85-002` through `85-005` should not begin until the schema/model change is
    designed and approved.
  - The clean first-slice model change is a persistent user activity field such
    as `User.isActive`.
  - Permanent delete can still remain a true hard delete of the user row after
    the account is already inactive.
- Recommended behavior direction for later implementation:
  - inactive users should not be able to start new authenticated sessions
  - the current access-token session may remain valid long enough to complete the
    immediate delete flow after inactivation
  - delete should revoke refresh tokens and remove user-owned rows that should
    not survive account removal
- Approved first-slice backend rule:
  - inactivation revokes refresh tokens so session extension stops immediately
  - the already-issued access token may continue until expiry, allowing the
    user to proceed directly into delete
- Implemented backend notes:
  - `User.isActive` is now the persisted account lifecycle field
  - auth profile and root-admin user surfaces now expose `isActive` rather than
    a synthetic status label, keeping the shared contract aligned with the new
    domain-model convention
