## Objective

Design the first league-creation wizard for the PoolMaster web app before implementing the commissioner create-league flow.

## Why This Exists

The first-time commissioner journey is now:

1. land on the login/register page
2. self-register
3. land on the normal authenticated app home
4. create the first league from that landing page

We intentionally stopped before implementing league creation so the wizard can be designed deliberately instead of growing ad hoc out of the current scaffold.

This plan assumes the broader home-shell and routing model from [plans/76-league-home-and-league-context-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/76-league-home-and-league-context-user-cases.md).

## Scope

In scope:

- define the modal-based league creation wizard launched from the authenticated landing page
- decide the minimum first-release steps, fields, validation, and success behavior
- document commissioner-first assumptions for the first-run create-league journey
- capture open UX and product questions before implementation

Out of scope:

- implementing the wizard UI
- implementing additional league-management flows
- invitation/member onboarding flows after league creation
- detailed members-page and invite-members flows after league creation

Post-create member-management follow-up lives in
[plans/79-league-members-and-invitations-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/79-league-members-and-invitations-user-cases.md).

## Resolved Decisions

1. First-release field set:
   - league name
   - league code
   - description (optional)
2. `leagueCode` is the explicit persisted route field and must be submitted in
   `CreateLeagueRequest`.
3. The frontend may suggest `leagueCode` from the entered league name, but the
   backend must not generate it.
4. The suggestion should be seeded on exit from the league-name field and stop
   auto-changing once the user edits `leagueCode` directly.
5. First release is private-only and invite-led.
   - `visibility` should not be exposed in the wizard UI for v1
6. `sport` is not a league property and must not appear in the create-league
   wizard or create-league contract.
7. Season selection is deferred until later setup.
8. Invite policy is deferred to league settings / later invitation work.
9. First version should become a small wizard instead of a single flat modal.
10. The modal launches over the current authenticated page and leaves the page
   visible behind it.
11. Success routes directly into `/league/<leagueCode>`.
12. Closing the modal resets its draft values in the first version.
13. Commissioner membership is created automatically as part of league creation.
14. The review/confirmation step should preview the future join path:
   - `/league/<leagueCode>/join`
   Detailed invitation/member-management follow-up lives in
   [plans/79-league-members-and-invitations-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/79-league-members-and-invitations-user-cases.md).

## First-Release UX Shape

- launch path:
  - zero-league `/welcome` empty state
  - header league-selector `Create league` action
- modal title:
  - `Create your league`
- supporting copy:
  - concise commissioner-first guidance, not placeholder or fake preview text
- step 1:
  - `League name`
  - `League code`
  - `Description (optional)`
- step 2:
  - review / confirmation
  - future join-link preview
- primary CTA:
  - `Create league`
- secondary CTA:
  - `Cancel`

## Validation Rules

- `League name`
  - required
  - trimmed
  - client-side validation should mirror backend contract bounds
- `League code`
  - required
  - uppercase letters and numbers only
  - 3 to 16 characters
  - globally unique
  - immutable after creation
- `Description`
  - optional
  - max 500 characters
- submit is disabled while the mutation is pending
- server errors render inside the modal using the shared error message extractor
- review step must preserve entered values and support editing
- on success:
  - invalidate/refetch league list state
  - update recent-league cookie to the created league
  - route to `/league/<leagueCode>`

## Backend / API Implications

- no new persisted league model field is required because `leagueCode` already
  exists and is the intended route field
- backend contract cleanup is required before the real wizard implementation:
  - add `leagueCode` as a required create-league request field
  - remove stale create-league request fields that are not part of current
    product truth, including `sport`
  - remove private-only v1 fields from the public create wizard contract where
    they should not be user-configurable
- backend must validate `leagueCode`; it must not generate it

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Review the commissioner-first create-league journey against active product goals | Self-register -> `/welcome` -> create league remains the primary first-run path |
| Done | Define the wizard steps, fields, and validation rules | First release should become a 2-step wizard with `name`, explicit required `leagueCode`, optional `description`, review/confirmation, and no user-facing visibility choice in v1 |
| Done | Decide the success destination and the empty-state-to-wizard transition | Launch from `/welcome` empty state and header selector; success routes directly to `/league/<leagueCode>` |
| Done | Write the implementation-ready UX and API assumptions | `leagueCode` is explicit and frontend-suggested, `sport` is not a league property, and private/invite-led behavior is implicit for v1 |
| Not Started | Clean the backend create-league contract so exported DTO/OpenAPI/SDK match the approved wizard fields | Remove stale request fields, add required `leagueCode`, refresh OpenAPI/SDK, and validate before frontend wizard work begins |
| Not Started | Replace the current single-step create-league modal with the approved 2-step wizard | Must wait for backend contract cleanup and regenerated SDK/types first |

## First Implementation Slice Status

The primitive first implementation slice is currently in place:

- global create-league modal wired into the authenticated shell
- launch path from `/welcome`
- launch path from the header league selector
- submit through the current backend `createLeague` contract
- success routing into `/league/<leagueCode>`

This implementation is intentionally incomplete relative to the now-reviewed
wizard design and should be replaced after the backend contract cleanup slice.
