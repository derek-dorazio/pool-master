## Purpose

Define the product behavior for commissioner-managed league lifecycle actions:

- inactivate league
- permanently delete inactive league

These are real product capabilities first. They also become the primary cleanup
mechanism for browser E2E over time.

## Design Goals

- Keep commissioner lifecycle actions in commissioner-owned product flows, not
  root-admin-only tools.
- Keep league management anchored to the existing tile-based league list rather
  than hiding lifecycle behind unrelated admin surfaces.
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

## Placement And IA

- The current tile-based league list remains the primary overview of a user's
  leagues.
- Each league tile should expose a commissioner-facing `Manage League` action.
- `Manage League` opens a commissioner management modal, similar in spirit to
  the create-league modal.
- The modal should be structured for future growth with tabs such as:
  - `Details`
  - `Icon`
  - `Settings`
  - `Lifecycle`
- The first lifecycle slice may implement only the management shell and the
  `Lifecycle` tab, but the modal should be designed to grow into the full
  league management surface.

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
- `Delete league permanently` should be visually distinct from
  `Inactivate league` through color, iconography, and stronger warning styling.
  It should feel more dangerous and more final.
- Tooltips or adjacent helper copy may explain the difference between
  inactivation and permanent deletion.
- `Delete league permanently` should only be shown or enabled after inactive
  state.
- The delete interaction should use an inline mini-wizard inside the lifecycle
  surface rather than a modal-on-top-of-a-modal.
- The delete mini-wizard should follow this pattern:
  1. Heading: `Delete league`
  2. Warning text: `This action will delete this league and all related data. This action is irreversible. Are you sure you want to proceed?`
  3. `DELETE` button is initially disabled
  4. Second prompt asks the commissioner to enter the real `leagueCode`
  5. Input validates exact `leagueCode` match
  6. `DELETE` button becomes enabled only after exact match
  7. Delete invokes the real backend delete API
  8. Success state confirms the league was deleted
  9. Exit action returns the user to the non-league context
- Confirmation input should use the real `leagueCode`, not a generic checkbox
  or generic confirmation phrase.
- League home and related commissioner/member surfaces should present truthful
  inactive/read-only state once a league is inactive.

## Browser E2E Implication

This lifecycle is the eventual cleanup path for the commissioner browser
journey:

1. sign up commissioner
2. create league
3. use future commissioner features
4. inactivate league
5. delete league with typed `leagueCode`

## Future Follow-On Scope

- The same `Manage League` modal is expected to expand later to support:
  - editing league details
  - updating league icon
  - broader league settings
  - future commissioner management actions beyond lifecycle
- League member-management should later add:
  - commissioner promotion/demotion UI
  - commissioner handoff guidance before a commissioner leaves
  - enforcement that the last commissioner cannot leave until another
    commissioner exists
- That follow-on work is now tracked separately in
  [Plan 92](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/92-league-management-details-and-identity-execution.md)
  so lifecycle cleanup does not need to be rediscovered as league-management
  feature work continues.
- Commissioner role-management and handoff work is further tracked in
  [Plan 96](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/96-league-member-role-management-and-commissioner-handoff.md).

## Open Questions

- None currently. The delete semantics, placement, and confirmation pattern are
  now locked for the first slice.
