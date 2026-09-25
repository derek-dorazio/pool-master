# PoolMaster — Domain Operations by Role

The operations each domain object supports, and who may call them.

This is the **target model**, derived from `schema.prisma` and the access rules in
[`rules/domain-model-conventions-rules.md`](../rules/domain-model-conventions-rules.md)
§13 — not a description of the routes that exist today. Audits under #201 measure the
current API against this document, not the reverse.

Clusters are added as their slice reaches stage 1. Everything here has been reviewed and
agreed with the repo owner.

## Role vocabulary

| Tag | Who |
|---|---|
| `public` | No authenticated session required |
| `authenticated` | Any signed-in user, regardless of league |
| `member` | Holder of a `LeagueMembership` in the league in question |
| `member:own` | …acting on their own data |
| `member:peer` | …acting on another member's data in the same league |
| `commissioner` | `LeagueMembership.role = COMMISSIONER` for that league |
| `rootAdmin` | `User.isRootAdmin` — every league, every object |

**Default within a league:** a member reads and writes their own data, **reads** peers,
reads league-wide data. A commissioner reads and writes all of it. A root admin does the
same across every league.

`rootAdmin` is omitted from the tables below unless it is the *only* caller — it may call
everything, and repeating it on every row adds noise.

---

## Slice 1 — Identity and membership

Cluster: `User`, `League`, `LeagueMembership`, `Squad`, `SquadMembership`,
`LeagueInvitation`, `SquadOwnerInvitation`. Tracked by #202.

### User

The principal. One object; the caller's relationship to it decides the role, not a
separate object.

| Operation | Role | Notes |
|---|---|---|
| Register | `public` | Creates the `User` |
| Read one | `member:own`, `rootAdmin` | `me` resolves to the caller |
| List / search | `rootAdmin` | The only genuinely admin-only read in this cluster |
| Update profile, username, preferences | `member:own`, `rootAdmin` | |
| Change password | `member:own` | Requires the current password |
| Reset password | `rootAdmin` | Without the current password — this is the distinction, not a different operation |
| Disable *(set `isActive = false`)* | `member:own`, `rootAdmin` | Self-service inactivation and admin disable are **one operation** |
| Enable | `member:own`, `rootAdmin` | |
| Delete | `member:own`, `rootAdmin` | |
| Revoke sessions | `member:own`, `rootAdmin` | Self-logout and admin force-logout are **one operation** |
| Grant / revoke root admin | `rootAdmin` | |

A user is readable by peers only through a `LeagueMembership` or `SquadMembership` they
share — see those edges. There is no general member-to-member user read.

### League

| Operation | Role | Notes |
|---|---|---|
| Create | `authenticated` | Three effects, all part of the one operation: the `League`, a `LeagueMembership` for the creator with `role = COMMISSIONER`, and a default `Squad` with the creator as its member/owner. **The commissioner membership — not a column on `League` — is the authoritative record of who runs the league.** Already implemented this way in `leagues/service.ts` |
| Read one | `member`, `rootAdmin` | |
| Read by invite code | `authenticated` | Needed before joining, so it cannot require membership |
| List | `member`, `rootAdmin` | A member sees leagues they belong to; root admin sees all. **One operation, scoped by role** |
| Update details, icon, join policy | `commissioner` | |
| Activate / inactivate | `commissioner` | |
| Delete | `commissioner` | Requires typing the `leagueCode` to confirm |

### LeagueMembership — the User↔League edge

Carries `role: COMMISSIONER \| MEMBER` and `status`. Unique on `(leagueId, userId)`.

| Operation | Role | Notes |
|---|---|---|
| Create | *(via invitation acceptance)* | Not a direct operation — see `LeagueInvitation` |
| Read list for a league | `member`, `commissioner` | A member reads peers. This is how members see each other |
| Read one | `member:own`, `member:peer`, `commissioner` | |
| Change role | `commissioner` | Promote or demote |
| Remove | `commissioner`, `member:own` | Commissioner removes a member; a member leaves the league. **One operation, two callers** |

### Squad — a team within a league

Never a sports team. Unique on `(leagueId, name)`.

| Operation | Role | Notes |
|---|---|---|
| Create | `member` | Creates the caller's squad in a league they belong to, and their `SquadMembership` |
| Read one | `member`, `commissioner` | Peers are readable |
| List for a league | `member`, `commissioner` | |
| Update name, icon | `member:own`, `commissioner` | |
| Activate / inactivate | `member:own`, `commissioner` | |
| Delete | `commissioner` | |

### SquadMembership — the User↔Squad edge, and ownership

**Membership and ownership are the same thing.** No role column: every member of a squad
is an owner of it. Unique on `(squadId, userId)` *and* on `(leagueId, userId)` — **a user
belongs to at most one squad per league.**

| Operation | Role | Notes |
|---|---|---|
| Create | *(via invitation acceptance)* | See `SquadOwnerInvitation` |
| Read list for a squad | `member`, `commissioner` | Peers readable |
| Remove | `member:own`, `commissioner` | Leaving your squad and being removed are **one operation** |
| Replace | `commissioner` | Swap one owner for another; see `replacementForUserId` on the invitation |

### LeagueInvitation

Two kinds on one entity, discriminated by `inviteType`: an email invite, and a reusable
link with `maxUses` / `currentUses`.

| Operation | Role | Notes |
|---|---|---|
| Send email invitations | `commissioner` | |
| Generate invite link | `commissioner` | |
| List for a league | `commissioner` | |
| Preview by code | `authenticated` | The invitee has no membership yet, so this cannot require one |
| Accept | `authenticated` | Creates the `LeagueMembership` |
| Revoke | `commissioner` | |

### SquadOwnerInvitation

| Operation | Role | Notes |
|---|---|---|
| Create | `member:own`, `commissioner` | A squad member invites a co-owner to **their own** squad; a commissioner may invite to any squad in the league |
| List for a league | `member:own`, `commissioner` | |
| Preview by code | `authenticated` | Same reasoning as league invitations |
| Accept | `authenticated` | Creates the `SquadMembership`. Subject to one-squad-per-league |
| Revoke | `member:own`, `commissioner` | |

---

## What this document settles

Several pairs currently modelled as separate admin and member operations are **one
operation with two callers**. Recorded explicitly because they are the audit's main
targets:

| One operation | Currently split as |
|---|---|
| Disable a user | `inactivateAccount` + `adminDisableUser` |
| Enable a user | `reactivateAccount` + `adminEnableUser` |
| Delete a user | `deleteAccount` + `adminDeleteUser` |
| Revoke a user's sessions | logout + `adminForceLogout` |
| List leagues | `listLeagues` + `adminListLeagues` |
| Inactivate a league | `inactivateLeague` + `adminInactivateLeague` |
| List squads | `listLeagueSquads` + `adminListTeams` |
| Read a user | `getCurrentUser` + `adminGetUserDetail` |

Scope is a **parameter of the operation**, resolved from the caller's role — exactly as
the DAO already expresses it, where `LeagueRepository.findAll()` is the unscoped read and
`findByUser` the scoped one.

## Settled during review

**`League.createdBy` is dropped.** It was a bare `String @db.Uuid` with no relation — no
referential integrity, no traversal — and nothing read it for a decision. Its only two
readers passed it through: the repository row→domain mapper, and an admin DTO field.

Creator provenance is not a concept this product needs. Who runs a league is the
`LeagueMembership` with `role = COMMISSIONER`, which league creation already writes.

Dropping it: remove the column (migration), the field from `League` in
`packages/shared/domain/types.ts`, the mapping in `prisma-league-repository.ts`, and the
DTO field emitted by `admin/league-service.ts`. `input.createdBy` **stays** as a parameter
of the create operation — it is the userId that becomes the first commissioner.

## Open items

- **Password reset vs change.** Listed as two operations because the precondition differs
  (current password vs none). If they unify behind one operation with an
  admin-only-skip-verification branch, say so — it is a real call, not an oversight.
- **Commissioner creating a squad for another member.** Listed as `member` create only.
  Whether a commissioner may create a squad on someone's behalf is unresolved.
- **Field-level redaction is not modelled.** Admin-only fields are annotated on the
  canonical DTO and left exposed, per §13. This document assigns roles to *operations*,
  not to fields.
