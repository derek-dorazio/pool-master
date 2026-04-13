## Purpose

Define the product behavior for commissioner-managed league lifecycle actions:

- inactivate league
- permanently delete inactive league

These are real product capabilities first. They also become the primary cleanup
mechanism for browser E2E over time.

## Design Goals

- Keep commissioner lifecycle actions in commissioner-owned product flows, not
  root-admin-only tools.
- Make inactivation the normal visible action.
- Make hard delete possible only after the league is already inactive.
- Require strong irreversible-delete confirmation.
- Deleting a league removes league-owned data and relationships, but does not
  delete user accounts.

## Locked Rules

- Active leagues are not hard-deleted.
- A league must be inactive before permanent delete is allowed.
- Permanent delete must warn that the action is irreversible.
- Commissioner must enter the `leagueCode` to confirm delete intent.
- League delete removes:
  - memberships in that league
  - invitations
  - squads and squad memberships
  - contests and contest-owned descendants
  - commissioner action items
  - commissioner audit log
  - other league-owned rows
- League delete does **not** delete commissioner or member user accounts.

## User Cases

### LL-001: Commissioner inactivates a league

**Actor:** Commissioner

**Preconditions**
- Commissioner belongs to the league
- League is active

**Flow**
1. Commissioner opens league management
2. Commissioner chooses `Inactivate league`
3. System explains that the league will become read-only/inactive
4. Commissioner confirms
5. System marks the league inactive
6. League home and related surfaces show inactive/read-only state

**Expected outcomes**
- League remains visible to commissioners
- League stops behaving as an active working league
- Delete is now eligible as a second, more destructive action

### LL-002: Commissioner permanently deletes an inactive league

**Actor:** Commissioner

**Preconditions**
- Commissioner belongs to the league
- League is already inactive

**Flow**
1. Commissioner opens inactive league management
2. Commissioner chooses `Delete league permanently`
3. System warns:
   - all league history and league-owned data will be removed
   - the action is irreversible
4. System requires commissioner to type the `leagueCode`
5. Commissioner enters the correct `leagueCode`
6. Commissioner confirms delete
7. System deletes the league and all league-owned data
8. System routes the commissioner to a non-league context such as `/welcome`

**Expected outcomes**
- League no longer exists
- All league-owned relationships and child rows are removed
- User accounts remain
- If a user now has zero league memberships, they simply have no leagues; they
  are not auto-deleted

### LL-003: Commissioner attempts to delete an active league

**Actor:** Commissioner

**Preconditions**
- League is active

**Flow**
1. Commissioner opens league management
2. Delete action is hidden or disabled
3. System directs the commissioner toward `Inactivate league` first

**Expected outcomes**
- Active league cannot be hard-deleted directly

### LL-004: Commissioner enters the wrong confirmation code

**Actor:** Commissioner

**Preconditions**
- League is inactive
- Delete dialog is open

**Flow**
1. Commissioner types the wrong `leagueCode`
2. Commissioner attempts to confirm

**Expected outcomes**
- Delete is rejected
- League remains intact
- UI explains that the confirmation code must match exactly

## UX Guidance

- `Inactivate league` should be the primary lifecycle-management action.
- `Delete league permanently` should be visually more dangerous and only shown
  after inactive state.
- Confirmation copy should be plain and explicit:
  - `Are you sure you want to permanently delete this league and all history? This process is irreversible.`
- Confirmation input should use the real `leagueCode`, not a generic checkbox.

## Browser E2E Implication

This lifecycle is the eventual cleanup path for the commissioner browser
journey:

1. sign up commissioner
2. create league
3. use future commissioner features
4. inactivate league
5. delete league with typed `leagueCode`

## Open Questions

- None currently. The delete semantics and confirmation rule are now locked.
