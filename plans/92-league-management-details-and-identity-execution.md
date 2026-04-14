## Objective

Implement the next commissioner-managed league features beyond lifecycle:

- edit league details
- manage league identity/icon
- define the first truthful league-management settings surface

## Dependencies

- [82-league-lifecycle-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/82-league-lifecycle-user-cases.md)
- [83-league-lifecycle-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/83-league-lifecycle-execution.md)

## Planning Notes

- The current `Manage League` modal has scaffolded `Details`, `Icon`, and
  `Settings` tabs, but there is no approved backend contract yet for those
  slices.
- This must remain a backend-first workflow. Do not implement the frontend
  forms until the backend surface and model review are complete.
- Start clean. If a proposed league field or setting is speculative, remove it
  instead of preserving it.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 92-001 | 1 | Product/data-model review of league details, icon, and first-pass settings | Pending | Decide which league identity/settings fields are real current product truth and which should remain deferred. |
| 92-002 | 1 | Data-modeler review of required backend/model changes | Pending | Confirm whether details/icon/settings can use existing league fields or need new schema/contract work. |
| 92-003 | 1 | Backend developer: add truthful commissioner APIs for approved league details/settings | Pending | Include DTO/OpenAPI/SDK refresh and no speculative settings bag. |
| 92-004 | 1 | Backend developer: add backend validation and tests | Pending | Cover update rules, commissioner access, and inactive-league behavior where relevant. |
| 92-005 | 2 | Frontend developer: implement real `Details` tab editing against the backend contract | Pending | Replace the current scaffold with an editable commissioner form once the backend is ready. |
| 92-006 | 2 | Frontend developer: implement approved `Icon` flow | Pending | Only if product/design and backend support are ready; otherwise leave explicit scaffold in place. |
| 92-007 | 2 | Frontend developer: implement first-pass `Settings` tab for approved settings only | Pending | Do not add speculative controls. |
| 92-008 | 2 | Frontend developer: add UI tests and browser-journey hooks for league management | Pending | Extend UI coverage without re-expanding E2E prematurely. |

