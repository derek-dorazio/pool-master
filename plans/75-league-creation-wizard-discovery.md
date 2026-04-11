## Objective

Design the first league-creation wizard for the PoolMaster web app before implementing the commissioner create-league flow.

## Why This Exists

The first-time commissioner journey is now:

1. land on the login/register page
2. self-register
3. land on the normal authenticated app home
4. create the first league from that landing page

We intentionally stopped before implementing league creation so the wizard can be designed deliberately instead of growing ad hoc out of the current scaffold.

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

## Questions To Resolve

1. What is the minimum first-release field set for league creation?
   - likely candidates: league name, sport, visibility
2. Is season selection part of the first wizard, or deferred until later setup?
3. Should the commissioner choose invite policy during creation, or should that stay on a later settings screen?
4. Should the wizard be a single modal step at first, or explicitly multi-step even if the first version has few fields?
5. Should the authenticated landing page remain visible behind the modal, or should the wizard take over focus more fully?
6. What is the success destination after creation?
   - stay on landing and show the new league card
   - or route directly into the new league home/detail page
7. Should the wizard support cancel/reopen behavior with draft-value persistence, or can the first version reset on close?
8. Which empty-state and success-state messages best support the first-time commissioner journey without sounding like placeholder copy?

## Initial Recommendation

- launch from the authenticated landing page as a modal
- start with a small wizard that can grow into multiple steps without changing the mental model
- first-release fields:
  - league name
  - sport
  - visibility
- commissioner becomes `COMMISSIONER` automatically on create
- invitations, contest creation, and deeper settings remain downstream flows
- success should most likely route into the newly created league page, but this remains open for review

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Review the commissioner-first create-league journey against active product goals | Confirm that self-register -> landing -> create league remains the primary first-run path |
| Pending | Define the wizard steps, fields, and validation rules | Keep first version minimal but extensible |
| Pending | Decide the success destination and the empty-state-to-wizard transition | Landing-page continuity vs direct league-home routing is still open |
| Pending | Write the implementation-ready UX and API assumptions | This should be ready before the next webapp implementation slice starts |
