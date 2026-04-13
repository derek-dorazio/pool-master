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

- `My Account` lifecycle surface
- inactive-first delete UX
- irreversible warning and confirmation
- post-delete sign-out/redirect behavior

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 85-001 | 1 | Product/data-model review of account lifecycle semantics | Not Started | Confirm exact inactive and delete effects on auth/session/account rows |
| 85-002 | 1 | Backend developer: add self-account inactivate API | Not Started | Real product route, not admin-only |
| 85-003 | 1 | Backend developer: add self-account delete API for inactive accounts | Not Started | Must reject delete while active |
| 85-004 | 1 | Backend developer: implement account cleanup behavior | Not Started | Sessions/tokens/preferences/consent/account row handling |
| 85-005 | 1 | Backend developer: add backend validation and contract coverage | Not Started | Unit, integration, functional API, contract verification, API regen |
| 85-006 | 2 | Frontend developer: design and implement `My Account` lifecycle UI | Not Started | Inactivate first, delete second, strong warning |
| 85-007 | 2 | Frontend developer: add post-delete logout and route handling | Not Started | User should land in signed-out state |
| 85-008 | 2 | Frontend developer: add UI tests and future browser-journey hooks | Not Started | Supports later no-residue E2E cleanup |

