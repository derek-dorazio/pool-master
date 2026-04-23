## Purpose

Define the real user-account lifecycle for PoolMaster:

- active account
- inactive account
- permanently deleted inactive account

This is a product capability for future `My Account` work, and it also
provides the end-state cleanup path for browser E2E-created accounts.

## Design Goals

- Users manage their own account lifecycle through `My Account`.
- Account lifecycle belongs in a user-owned personal area, not in league
  management.
- Inactivation happens before deletion.
- Permanent delete is irreversible and requires explicit confirmation.
- League deletion does not delete users automatically.

## Locked Rules

- Active accounts are not hard-deleted.
- A user must first be inactive before self-delete is allowed.
- Deleting a league does not delete the commissioner or member accounts.
- Users with zero league memberships remain valid accounts until they choose to
  inactivate/delete them.

## Placement And IA

- The app header should show the signed-in user identity, such as
  `Derek Dorazio`.
- The header identity affordance should open a user menu or dropdown.
- That menu may include options such as:
  - `Settings`
  - `Preferences`
  - `My Account`
  - future personal options
- `My Account` is the dedicated home for user-owned account management.
- `My Account` should grow into the surface for:
  - profile management
  - password changes
  - email and personal identity fields
  - account inactivation
  - account deletion

## User Cases

### UA-001: User inactivates their own account

**Actor:** Commissioner or member

**Preconditions**
- User is authenticated
- User account is active

**Flow**
1. User opens `My Account`
2. User chooses `Inactivate account`
3. System explains the account will become inactive
4. User confirms
5. System marks the account inactive

**Expected outcomes**
- User account remains present
- Delete is now eligible as a separate destructive action

### UA-002: User permanently deletes their inactive account

**Actor:** Commissioner or member

**Preconditions**
- User is authenticated
- User account is already inactive

**Flow**
1. User opens `My Account`
2. User chooses `Delete account permanently`
3. System warns that the action is irreversible
4. Delete interaction starts an inline mini-wizard
5. System requires the user to enter their email address exactly
6. Once the confirmation value matches, the delete action becomes enabled
7. User confirms
8. System deletes the account

**Expected outcomes**
- Account is removed
- Auth/session data is removed
- The account can no longer sign in
- User is immediately logged out after successful delete

### UA-003: User attempts to delete an active account

**Actor:** Commissioner or member

**Preconditions**
- User account is active

**Flow**
1. User opens `My Account`
2. Delete is hidden or disabled
3. System directs user to `Inactivate account` first

**Expected outcomes**
- Active account cannot be hard-deleted directly

## Browser E2E Implication

This is the eventual cleanup path for browser-created users:

- commissioner finishes the commissioner journey
- commissioner deletes the inactive league
- member later signs in and deletes their inactive account
- commissioner later signs back in and deletes their inactive account

## UX Guidance

- `Inactivate account` and `Delete account permanently` must be visually
  distinct.
- `Delete account permanently` should use stronger destructive styling, such as
  red color treatment and more ominous visual emphasis.
- Tooltips or adjacent helper copy may explain the difference between
  inactivation and permanent deletion.
- The delete interaction should use an inline mini-wizard rather than a modal
  on top of the `My Account` surface.
- The delete mini-wizard should follow this pattern:
  1. Heading: `Delete account`
  2. Warning text: `This action will delete your account and all related data. This action is irreversible. Are you sure you want to proceed?`
  3. `DELETE` button is initially disabled
  4. Second prompt asks the user to enter their email address to continue
  5. Input validates exact email match
  6. `DELETE` button becomes enabled only after exact match
  7. Delete invokes the real backend delete API
  8. Success state confirms the account was deleted
  9. The app logs the user out and returns them to signed-out context

## Open Questions

- None currently. The placement, confirmation pattern, and post-delete logout
  behavior are now locked for the first slice.

## Future Follow-On Scope

- `My Account` should expand next into:
  - profile editing
  - password change
  - first-pass personal preferences
- That follow-on work is now tracked separately in
  [Plan 93](./93-my-account-profile-password-and-preferences-execution.md)
  so the lifecycle slice does not need to be rediscovered later.
