## Objective

Implement the backend and frontend work for user self-managed account
lifecycle:

- inactivate own account
- delete inactive own account

## Dependencies

- [84-user-account-lifecycle-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/84-user-account-lifecycle-user-cases.md)
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
| 85-002 | 1 | Backend developer: add self-account inactivate API | Not Started | Real product route, not admin-only |
| 85-003 | 1 | Backend developer: add self-account delete API for inactive accounts | Not Started | Must reject delete while active |
| 85-004 | 1 | Backend developer: implement account cleanup behavior | Not Started | Sessions/tokens/preferences/consent/account row handling |
| 85-005 | 1 | Backend developer: add backend validation and contract coverage | Not Started | Unit, integration, functional API, contract verification, API regen |
| 85-006 | 2 | Frontend developer: add header user identity affordance and menu entry to `My Account` | Not Started | Menu may later include Settings, Preferences, and other personal options |
| 85-007 | 2 | Frontend developer: design and implement `My Account` shell | Not Started | Prepare future profile, password, email, and lifecycle sections even if lifecycle lands first |
| 85-008 | 2 | Frontend developer: implement account lifecycle UI inside `My Account` | Not Started | Inactivate first, delete second, strong warning |
| 85-009 | 2 | Frontend developer: add account delete mini-wizard | Not Started | Inline flow with exact email confirmation before enabling DELETE |
| 85-010 | 2 | Frontend developer: add post-delete logout and route handling | Not Started | User should land in signed-out state |
| 85-011 | 2 | Frontend developer: add UI tests and future browser-journey hooks | Not Started | Supports later no-residue E2E cleanup |

## Data-Modeler Review Notes

- Unlike league lifecycle, user lifecycle cannot be implemented truthfully on the
  current model without a schema change.
- The current [User model](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
  has no `isActive`, `status`, or similar lifecycle field. It only stores core
  identity, preferences, and auth metadata.
- The current auth surface in
  [auth-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/auth/auth-service.ts)
  and [auth.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/auth.dto.ts)
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
  - the current self-service session may remain valid long enough to complete the
    immediate delete flow after inactivation
  - delete should revoke refresh tokens and remove user-owned rows that should
    not survive account removal
