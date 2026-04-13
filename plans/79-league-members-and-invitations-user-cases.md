# Plan 79 Companion: League Members And Invitations User Cases

## Purpose

Capture the intended member-management and invitation product model that should
follow the league-creation wizard.

This plan exists so the create-league wizard can stay narrowly scoped while the
next-step commissioner flows are still documented clearly.

## Status

Deferred until the first real league-creation wizard is completed and reviewed.

## Guiding Product Decisions So Far

- The league route uses the persisted unique `leagueCode` field:
  - `/league/<leagueCode>`
- League creation confirmation should preview the future join path for members.
- The commissioner should have a dedicated members-management page for each
  league.
- The members page should eventually show:
  - current league members
  - sent invitations
  - invitation status
  - commissioner invitation actions
- The invite/join story should be consistent between:
  - the create-league confirmation step
  - the future members page

## Deferred Feature Note

This plan records the intended user cases only.

It does **not** mean the following are in current build scope yet:

- email invitation sending UI
- invitation-status management UI
- stable league join route implementation
- invitation revocation UX
- notification/email orchestration polish

Those remain deferred until the league-creation wizard is complete.

## Primary Actors

- Commissioner
- Existing League Member
- Invited Visitor
- Invited Existing User

## Use Cases

### LM-001: Commissioner finishes league creation and sees how to invite members

Actor:
- Commissioner

Goal:
- understand the next step immediately after creating a league

Flow:
1. Commissioner completes the create-league wizard.
2. Confirmation/review state shows the created league identity.
3. Confirmation state shows a member join link using the league route pattern:
   - `/league/<leagueCode>/join`
4. Confirmation state explains that the commissioner can either:
   - share the join link directly
   - manage invitations from the future members page

Notes:
- this join-path shape is the current intended product direction
- implementation details may still route through invite-code-backed acceptance
  until the dedicated join flow is designed

### LM-002: Commissioner opens the league members page for a newly created league

Actor:
- Commissioner

Goal:
- manage membership from a league-scoped commissioner surface

Flow:
1. Commissioner opens the members page for a league.
2. Page shows the current active members.
3. For a newly created league, the list initially shows only the commissioner.
4. The page also shows the invitation area, even when no invitations have been
   sent yet.

Notes:
- the empty invitation area should feel intentional, not broken
- the page should be the home for member and invite management

### LM-003: Commissioner invites members by entering email addresses

Actor:
- Commissioner

Goal:
- invite one or more people into the league from the members page

Flow:
1. Commissioner opens the members page.
2. Commissioner clicks `Invite members`.
3. App opens an invite-members flow/wizard.
4. Commissioner enters one or more email addresses.
5. Backend creates invitations and begins delivery through the notification
   system.
6. Members page updates to show the sent invitations and their status.

Notes:
- invitation sending UX should support multiple email addresses
- exact invite-wizard shape is deferred for later design

### LM-004: Commissioner sees current invitation status on the members page

Actor:
- Commissioner

Goal:
- understand who has been invited and what still needs action

Flow:
1. Commissioner opens the members page.
2. Page shows sent invitations separately from active members.
3. Each invitation shows a lifecycle state such as:
   - pending
   - accepted
   - expired
   - revoked

Notes:
- status display should be easy to scan
- richer management actions can be added later

### LM-005: Commissioner shares the member join link without sending email invites

Actor:
- Commissioner

Goal:
- invite people quickly by sharing a link directly

Flow:
1. Commissioner copies the displayed join link.
2. Commissioner shares the link outside the app.
3. Invitee opens the join path for that league.
4. Invitee follows the join/acceptance flow and lands in the invited league.

Notes:
- this flow should be visible from both:
  - league-creation confirmation
  - members page

## Open Questions For Later Design

1. Should `/league/<leagueCode>/join` be a stable public join entry that then
   resolves to an invitation object, or should it primarily redirect into an
   invite-code-backed flow?
2. Should the members page combine:
   - current members
   - pending invites
   on one screen, or use separate tabs/sections?
3. Should invite-by-email support only comma/newline-separated entry first, or a
   richer tokenized multi-address input?
4. Which commissioner actions belong on invitation rows in the first version:
   - resend
   - revoke
   - copy link
   - none yet

## Relationship To Active Plans

- [plans/75-league-creation-wizard-discovery.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/75-league-creation-wizard-discovery.md)
  should reference this plan for the post-create invite/member next step.
- [plans/76-league-home-and-league-context-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/76-league-home-and-league-context-user-cases.md)
  owns the league-scoped shell and route model that this members/invitation
  feature will plug into later.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 79-001 | 1 | Capture the post-create join-link and members-page requirements from product review | Done | Confirmation page should show `/league/<leagueCode>/join`, and a future members page should show current members, invitations, and invitation statuses. |
| 79-002 | 1 | Design the members page structure for commissioner-first member management | Not Started | |
| 79-003 | 1 | Design the invite-members flow or wizard for multi-email invitation sending | Not Started | |
| 79-004 | 1 | Decide how stable join routes relate to invite-code acceptance under the hood | Not Started | |
