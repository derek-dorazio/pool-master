# Plan 36 Companion: Authentication And Authorization Unification User Cases

## Purpose

This companion document captures the user cases and user flows implied by
[Plan 36](./36-authentication-and-authorization-unification.md).

It exists to preserve product and UI implications separately from the lower-level
auth/session implementation plan.

The target direction assumed here is:

- one backend-owned cookie/session trust model
- local login with `username or email + password`
- Google login
- one global user identity
- league-scoped authorization for product behavior
- admin capability handled separately from ordinary league permissions

## Primary Actors

- Visitor
- Authenticated User
- League Member
- League Commissioner
- Platform Admin
- Dual-Capability User

## Core User Cases

### AU-001: Register with username, email, and password

Actor:
- Visitor

Goal:
- create a new account that can later join leagues and manage squads

Flow:
1. Visitor opens sign-up page.
2. Visitor enters username, email, password, and any required profile fields.
3. Backend creates the account and establishes the authenticated session.
4. App hydrates user identity from backend session state.
5. User lands in the appropriate post-auth shell.

Notes:
- username and email normalization rules must be consistent
- browser should not store access tokens in `localStorage`

### AU-002: Log in with username or email and password

Actor:
- Existing User

Goal:
- authenticate with a normal consumer login pattern

Flow:
1. User opens login page.
2. User enters username or email plus password.
3. Backend validates credentials.
4. Backend issues the authenticated session cookie(s).
5. Frontend requests the authenticated identity/session read.
6. User is routed into the application.

### AU-003: Log in with Google

Actor:
- Visitor or Existing User

Goal:
- authenticate through a standard Google flow without creating a separate auth model

Flow:
1. User selects "Continue with Google".
2. Browser is redirected to Google OIDC.
3. User completes Google authentication.
4. Backend callback resolves or creates the linked user account.
5. Backend issues the same normal PoolMaster session cookies.
6. Frontend hydrates from backend-authenticated identity.

Notes:
- Google-linked identities should attach to the same core `User`
- no separate browser auth path should exist for Google users

### AU-004: Resume an authenticated session

Actor:
- Returning User

Goal:
- reopen the app and remain signed in without browser-readable auth storage

Flow:
1. Browser opens web or admin app.
2. Frontend requests session identity.
3. Backend validates session cookies.
4. Backend returns authenticated identity and capability context.
5. App renders authenticated shell or redirects to login.

### AU-005: Log out

Actor:
- Authenticated User

Goal:
- end the active browser session cleanly

Flow:
1. User clicks logout.
2. Backend invalidates or expires the session.
3. Frontend clears any hydrated identity state.
4. Browser returns to unauthenticated shell.

## Authorization-Oriented User Cases

### AU-006: Access member-facing routes as a normal league user

Actor:
- League Member

Goal:
- access product routes based on league membership

Flow:
1. User authenticates.
2. User opens a protected product route.
3. Backend resolves user identity from session.
4. Backend checks league membership and applicable league role.
5. Route succeeds or returns forbidden.

### AU-007: Access commissioner tools

Actor:
- League Commissioner

Goal:
- use league-management capabilities not available to ordinary members

Examples:
- promote a member to commissioner
- demote a commissioner to member
- create contests
- configure contests
- manage squads or league settings

Flow:
1. Commissioner authenticates.
2. Commissioner opens a commissioner-only screen.
3. Backend resolves authenticated user.
4. Backend verifies commissioner capability in that league.
5. Commissioner action proceeds.

### AU-008: Access admin tools

Actor:
- Platform Admin

Goal:
- use admin routes through the same auth/session model, but separate authorization

Flow:
1. Admin authenticates through the normal shared auth model.
2. Admin opens an admin route.
3. Backend resolves authenticated principal.
4. Backend verifies admin capability/permissions.
5. Route succeeds or returns forbidden.

Notes:
- admin capability should not depend on browser-supplied identity headers

### AU-009: Dual-capability user chooses an application surface

Actor:
- User who is both product user and platform admin

Goal:
- move between product and admin surfaces without separate trust models

Flow:
1. User authenticates once.
2. Backend returns authenticated identity plus capability context.
3. Frontend presents default route or app switcher behavior.
4. User navigates to product or admin surface.
5. Backend still performs route-specific authorization checks.

## League And Invite-Related Auth Cases

### AU-010: Accept a league invite while not yet registered

Actor:
- Invited Visitor

Goal:
- accept an invite and become a member in one flow

Flow:
1. Visitor opens invite link/code flow.
2. App validates invite.
3. Visitor is prompted to sign up or log in.
4. Backend creates or resolves the user account.
5. Backend accepts the invite.
6. Backend creates or reactivates league membership as `MEMBER`.
7. User lands inside the invited league context.

### AU-011: Accept a league invite as an existing user

Actor:
- Existing User

Goal:
- join another league with the same account

Flow:
1. User opens invite link.
2. App confirms authentication or prompts login.
3. Backend validates the invite.
4. Backend creates or reactivates league membership.
5. User lands inside the new league.

### AU-012: Commissioner manages league roles

Actor:
- League Commissioner

Goal:
- promote or demote league members

Flow:
1. Commissioner opens league people/management page.
2. Commissioner views current active members.
3. Commissioner promotes a member to `COMMISSIONER` or demotes back to `MEMBER`.
4. Backend validates commissioner authority and league constraints.
5. Updated membership role is returned.

Notes:
- league must always retain at least one active commissioner

## UX And API Implications

The future UI will likely need:

- shared sign-up and login screens
- Google login option
- session-based app bootstrapping
- league-aware route hydration after login
- commissioner tools for member management
- admin-capable route gating and app-switch behavior

The future backend/API will need:

- truthful session identity read
- invite acceptance flow that works with account creation
- commissioner role-management endpoints
- admin capability attached to the same user identity but enforced separately

## Open Product Questions

These are intentionally still open:

1. How exactly should admin capability attach to the global `User` model?
2. Should dual-capability users land in product, admin, or a chooser by default?
3. Should invite acceptance happen directly on the invite route, or on a dedicated onboarding screen after validation?
