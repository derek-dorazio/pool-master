## Purpose

Define the real user-account lifecycle for PoolMaster:

- active account
- inactive account
- permanently deleted inactive account

This is a product capability for future `My Account` work, and it also
provides the end-state cleanup path for browser E2E-created accounts.

## Design Goals

- Users manage their own account lifecycle through `My Account`.
- Inactivation happens before deletion.
- Permanent delete is irreversible and requires explicit confirmation.
- League deletion does not delete users automatically.

## Locked Rules

- Active accounts are not hard-deleted.
- A user must first be inactive before self-delete is allowed.
- Deleting a league does not delete the commissioner or member accounts.
- Users with zero league memberships remain valid accounts until they choose to
  inactivate/delete them.

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
4. System requires explicit confirmation
5. User confirms
6. System deletes the account

**Expected outcomes**
- Account is removed
- Auth/session data is removed
- The account can no longer sign in

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

## Open Questions

- Exact confirmation UX for account delete can be finalized later in the `My Account` design slice.
