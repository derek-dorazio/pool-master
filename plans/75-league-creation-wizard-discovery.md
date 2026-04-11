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

## Resolved Decisions

1. First-release field set:
   - league name
   - visibility
2. `sport` is explicitly deferred.
   - reason: the active backend `League` model does not persist sport today, so
     adding sport to the first wizard would either be misleading UI or a hidden
     backend-model expansion
3. Season selection is deferred until later setup.
4. Invite policy is deferred to league settings.
5. First version is a single-step modal that is visually structured so it can
   evolve into a multi-step wizard later.
6. The modal launches over the current authenticated page and leaves the page
   visible behind it.
7. Success routes directly into `/league/<leagueCode>`.
8. Closing the modal resets its draft values in the first version.
9. Commissioner membership is created automatically as part of league creation.

## First-Release UX Shape

- launch path:
  - zero-league `/welcome` empty state
  - header league-selector `Create league` action
- modal title:
  - `Create your league`
- supporting copy:
  - concise commissioner-first guidance, not placeholder or fake preview text
- fields:
  - `League name`
  - `Visibility`
- primary CTA:
  - `Create league`
- secondary CTA:
  - `Cancel`

## Validation Rules

- `League name`
  - required
  - trimmed
  - client-side validation should mirror backend contract bounds
- `Visibility`
  - required
  - default to `PRIVATE`
- submit is disabled while the mutation is pending
- server errors render inside the modal using the shared error message extractor
- on success:
  - invalidate/refetch league list state
  - update recent-league cookie to the created league
  - route to `/league/<leagueCode>`

## Backend / API Implications

- no new backend model change is required for the first version
- first-release implementation should use the existing `createLeague` contract
- `sport` remains a future product/model decision and must not be represented as
  persisted truth until the backend model supports it

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Review the commissioner-first create-league journey against active product goals | Self-register -> `/welcome` -> create league remains the primary first-run path |
| Done | Define the wizard steps, fields, and validation rules | First release is a single-step modal with `name` + `visibility`, pending-state handling, inline validation, and reset-on-close |
| Done | Decide the success destination and the empty-state-to-wizard transition | Launch from `/welcome` empty state and header selector; success routes directly to `/league/<leagueCode>` |
| Done | Write the implementation-ready UX and API assumptions | First release intentionally avoids adding `sport` until the backend model supports it |

## First Implementation Slice Status

The first implementation slice based on this plan is now in place:

- global create-league modal wired into the authenticated shell
- launch path from `/welcome`
- launch path from the header league selector
- submit through the existing backend `createLeague` contract
- success routing into `/league/<leagueCode>`
