## Objective

Implement the next self-service `My Account` features beyond lifecycle:

- profile editing
- password change
- first-pass personal preferences

## Dependencies

- [84-user-account-lifecycle-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/84-user-account-lifecycle-user-cases.md)
- [85-user-account-lifecycle-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/85-user-account-lifecycle-execution.md)

## Planning Notes

- The current `My Account` page has truthful lifecycle behavior, but profile,
  password, and preferences are still explicit scaffolding.
- There are no approved backend APIs yet for profile update, password change,
  or preferences management.
- This must remain a backend-first workflow. Frontend form work should follow
  a reviewed backend contract rather than inventing request shapes locally.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 93-001 | 1 | Product review of first-pass `My Account` scope | Pending | Decide which profile fields, password flow, and preferences are truly needed in the next slice. |
| 93-002 | 1 | Data-modeler review of account profile/password/preferences surface | Pending | Confirm whether existing `User` fields are sufficient and whether any additional account contract or model changes are needed. |
| 93-003 | 1 | Backend developer: add truthful self-service profile update API(s) | Pending | Include DTO/OpenAPI/SDK refresh. |
| 93-004 | 1 | Backend developer: add truthful self-service password-change API | Pending | Cover current-password validation, auth/session behavior, and tests. |
| 93-005 | 1 | Backend developer: add first-pass preferences API for approved fields only | Pending | Use existing account fields where possible and avoid speculative settings. |
| 93-006 | 1 | Backend developer: add backend validation and tests | Pending | Cover contract, auth, and data-integrity rules. |
| 93-007 | 2 | Frontend developer: replace the profile/preferences scaffold with real `My Account` sections | Pending | Implement only after backend/API work is complete. |
| 93-008 | 2 | Frontend developer: implement password-change UX in `My Account` | Pending | Keep lifecycle actions visually distinct from profile/password actions. |
| 93-009 | 2 | Frontend developer: add UI tests and browser-journey hooks | Pending | Extend component coverage and set up later E2E expansion. |

