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
- A prerequisite identity-model cleanup has been completed:
  - `User.firstName` and `User.lastName` are now required first-class fields
  - `User.displayName` has been removed from the active model and contract
  - sign-up, auth/profile reads, squad default naming, and active test/helpers
    now align to first/last name

## Locked First-Slice Product Decisions

- `My Account` remains a single page for now.
- The header should use a single `Profile` menu entry rather than separate
  `My Account` and `Preferences` entries.
- The first real profile/preferences slice should include:
  - `firstName`
  - `lastName`
  - `timezone`
  - `locale`
  - `timeFormat`
  - `dateFormat`
- Email change is deferred to a later account-security slice.
- Avatar/profile-image work is deferred.
- Password change requires:
  - current password
  - new password
  - confirm new password
- After password change:
  - the current session stays signed in
  - other refresh-token sessions should be revoked
- Account metadata may be shown read-only, including:
  - auth provider
  - `Member since` rendered as a date, not a timestamp, and formatted using
    the user's date-format preference
- Inactive-account `My Account` behavior:
  - the page becomes read-only
  - existing data may still be shown
  - only re-activate and delete flows remain actionable

## Data-Model Review Focus

This plan now includes a likely model review, not just contract work.

The data-modeler must explicitly review:

- adding `firstName` and `lastName` to `User`
- whether `displayName` should be retired from the active `User` model once
  first/last name are available
- whether email-change and username concepts remain deferred

Current direction:

- `firstName` and `lastName` are likely approved additions
- `displayName` is approved for removal from the active `User` model
- username remains deferred
- avatar remains deferred

## Data-Modeler Review Notes

- `User` currently persists `displayName` but does not persist `firstName` or
  `lastName`.
- The current PoolMaster registration UI already collects `firstName` and
  `lastName`, but the auth contract collapses them into `displayName` before
  persistence. That is now a confirmed model/contract mismatch.
- The clean next-step model is:
  - add first-class `User.firstName`
  - add first-class `User.lastName`
  - keep `timezone`, `locale`, `timeFormat`, and `dateFormat` on `User`
- remove `displayName` from the active model and contract now, while the repo
  still has effectively no real user data beyond bootstrap seed state
- Recommended migration safety rule:
  - use a one-time aggressive migration/backfill for the bootstrap user and any
    residual test rows, then treat `firstName` and `lastName` as required
- This means Plan 93 does require a real schema/model change before backend
  implementation starts.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 93-001 | 1 | Product review of first-pass `My Account` scope | Done | Locked first slice to profile, password, and formatting preferences on a single `Profile` page. Email change, username, and avatar remain deferred. |
| 93-002 | 1 | Data-modeler review of account profile/password/preferences surface | Done | Approved direction: add required first-class `firstName` and `lastName`, keep existing preference fields, and remove `displayName` from the active `User` model while the data footprint is still minimal. |
| 93-002a | 1 | Backend/model prerequisite: align active identity model to first/last-name contract | Done | Added required `User.firstName` and `User.lastName`, removed `displayName`, updated seed/auth/profile/squad consumers, refreshed generated artifacts, and passed the full backend verification gate. |
| 93-003 | 1 | Backend developer: add truthful self-service profile update API(s) | Done | Added `PUT /api/v1/account/profile` for first-name/last-name updates and refreshed DTO/OpenAPI/SDK output. |
| 93-004 | 1 | Backend developer: add truthful self-service password-change API | Done | Added `POST /api/v1/account/password` with current-password validation, confirmation matching, and revocation of other refresh sessions while keeping the current session usable. |
| 93-005 | 1 | Backend developer: add first-pass preferences API for approved fields only | Done | Added `PUT /api/v1/account/preferences` for `timezone`, `locale`, `timeFormat`, and `dateFormat` only. |
| 93-006 | 1 | Backend developer: add backend validation and tests | Done | Added unit, integration, contract, and functional coverage for profile, preferences, password change, and the inactive/read-only rules. |
| 93-007 | 2 | Frontend developer: replace the profile/preferences scaffold with real `Profile` sections | Done | `Profile` now includes editable name fields, account summary, and real preferences sections backed by the generated client. |
| 93-008 | 2 | Frontend developer: implement password-change UX in `Profile` | Done | Added password-change UX on the `Profile` page with success/error handling and clear separation from lifecycle actions. |
| 93-009 | 2 | Frontend developer: implement inactive-account read-only `Profile` behavior with re-activate affordance | Done | Inactive accounts are read-only, expose reactivation, and keep delete as the only destructive path. |
| 93-010 | 2 | Frontend developer: add UI tests and browser-journey hooks | In Progress | Component/UI coverage is in place; broader browser-journey expansion remains deferred to the E2E lane after the rest of the league/user feature work settles. |
