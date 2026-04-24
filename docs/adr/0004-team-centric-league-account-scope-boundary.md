# ADR 0004: Team is the League-Facing Entity; User Page is Account-Scope Only

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

PoolMaster's webapp has three primary entity surfaces: League, Team, and User. In the first round of nav reorganization design, the question of *where does a commissioner promote/demote/remove a member* was answered with: "on the User page at `/users/:userId`, via commissioner-authority modals."

Product review during the nav reorg (Plans 107/108) surfaced a cleaner boundary:

- **Promote to Commissioner**, **Demote to Member**, and **Remove Owner** are **league-scoped role operations** on a user's relationship to a specific team within a league. They are not account-scope operations.
- Commissioners should never touch a user's **account** (inactivate, delete, reset password, toggle root admin). Those are platform-scope operations reserved to the user themselves or to root admins.
- A user whose team is inactivated loses league access to that league, but their account continues unaffected — they may join other leagues.

Mixing league-role actions with account actions on `/users/:userId` required the backend to compute caller-target league overlap, required the frontend to carry league context into a page that had none by URL, and blurred a permission boundary that is genuinely sharp.

## Decision

Two hard boundaries:

1. **User page (`/users/:userId`) is account-scope only.** It surfaces self actions (edit profile/preferences/password/lifecycle), root-admin actions (toggle root admin, reset password, inactivate/delete account), and viewer read-only identity. It never surfaces league-role actions. Backend `viewerAuthority` signal on the user detail endpoint is a set `{ self, rootAdmin, viewer }` — no commissioner tier on this endpoint.

2. **League-role actions live on league surfaces.** Remove Owner, Promote to Commissioner, and Demote to Member are per-owner row action menus on **Teams and Owners** (`/league/:leagueCode/teams`) and on **Team Home** (`/league/:leagueCode/teams/:teamId`, Owners section) — same modals reachable from both surfaces. Authority is gated via `useLeagueAuthority` (commissioners + root admin) plus a per-team co-owner check for Remove Owner. Root admin is treated as `commissioner` on any league via authority-hook collapse, so the same UI serves both paths.

The "remove from league" concept has no separate operation. Removing a user's last team in a league (Remove Owner or Inactivate Team) automatically removes their league membership, consistent with the invariant "league membership = team ownership in that league."

**Team lifecycle semantics:**

- **Inactivate Team** (commissioner + team owner + root admin, on Team Home) is a *soft* action. The inactivated team cannot create new contest entries; its owners lose league access; data is preserved for remaining league members and the commissioner. Reversible.
- **Delete Team** (root admin only, gated on inactive state, on Team Home) is a *hard cascade* reserved for QA testing residue cleanup. Not intended for real-world team removal. Irreversible.

## Consequences

**Positive**

- Clear account-vs-league permission boundary. Commissioners cannot affect user accounts under any circumstances; user-account deletion is always self-initiated or root-admin-initiated.
- `viewerAuthority` signal on the user detail endpoint simplifies to `{ self, rootAdmin, viewer }` — no commissioner relationship to compute backend-side.
- One canonical league-role modal set reachable from two surfaces (Teams and Owners, Team Home), consistent UX for commissioners and root admins.
- The team-centric invariant ("league membership = team ownership") holds without exceptions.

**Tradeoffs / new constraints**

- A commissioner clicking an owner name on Teams and Owners or Team Home lands on `/users/:userId` with viewer authority, seeing only identity. Their league-role actions stay on the league surface. This is a deliberate navigation pattern, not an oversight — commissioners carry no league authority across the owner-name link.
- Remove Owner has a **>1 owner** precondition. Removing the sole owner of a team is not allowed — the UI routes to Inactivate Team instead. Frontend must enforce this in the action menu; backend must enforce it at the endpoint.
- Delete Team is explicitly positioned as QA-residue cleanup, not a real-world feature. Product copy should not suggest otherwise; UX warnings should make the destructive-and-rare nature clear.

## Alternatives considered

- **Commissioner modals on `/users/:userId` via a `commissioner: [...leagueCodes]` field in `viewerAuthority`.** Rejected: requires the user-detail endpoint to compute caller-target league overlap; blurs the account-vs-league permission boundary; introduces "which league does this action scope to?" ambiguity on a page with no league context.
- **A separate "Remove from League" operation distinct from per-team Remove Owner.** Rejected: redundant with the team-centric invariant. The effect is achievable by removing owner from each team or inactivating the team.
- **Delete Team available to commissioners.** Rejected: cascade deletion of historical contest data is high-impact and rarely needed; restricting to root admin for QA-residue-only is safer and matches the actual use case.
