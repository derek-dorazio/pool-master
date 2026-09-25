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

`rootAdmin` is omitted from the tables below unless it is the *only* caller — it may call
everything, and repeating it on every row adds noise.

## Access rules

**These six rules decide every row in the tables below.** Where a table and a rule
disagree, the rule wins and the table is a bug. New operations are assigned a role by
applying these rules, not by precedent from a similar-looking route.

**A1. Only `rootAdmin` may read across all rows.** An unscoped `findAll` is a root-admin
operation. Every other caller reads through a scope — their leagues, their league's
squads, their own user.

**A2. A member sees only leagues they are a member of.** League visibility is
`LeagueMembership`, not a query filter someone remembered to apply.

**A3. A commissioner edits leagues; a member only views them.** Write access to a league
and its configuration is the commissioner's.

**A4. A member sees squads and members of their own league(s), one league at a time.**
Every league-scoped read takes a league. There is no cross-league read for a member —
**the product works a single league at a time**, and the UI presents one league, with a
selector when the user belongs to more than one. Cross-league reads are `rootAdmin` by A1.

**A5. A member writes only their own squad.** They read peers' squads (A4); they change
nothing that is not theirs.

**A7. A commissioner may perform any member operation on behalf of any member of their
league.** Rename a squad, invite a co-owner, change membership — everything a member may
do for themselves, a commissioner may do for anyone in the league they run.

This is a rule that **generates rows rather than needing them listed**: every `member:own`
operation below is also available to that league's `commissioner`, without the table
saying so each time. A7 stops at the league boundary and at `User` — a commissioner acts
within their league, and A6 still gives them no user write operations.

**A6. Only `rootAdmin` may *write* a user other than themselves.** A user writes their own
`User` and no one else's. **A commissioner has no user write operations** — being a
commissioner grants league authority, not authority over people.

**Reading is different.** League members **can and should** read each other's user data —
name and email — because that is what a member roster is. The read is scoped **indirectly,
through the join to `LeagueMembership`**, so it returns only users sharing a league with
the caller. There is no unscoped user read for a member; that is `rootAdmin` by A1.

### What A4 and A6 together require of the edges

A member reads peer users, but only through the league join. So a league-scoped read
returns the user, and by §8 and working rule 3 the shape it returns is the **canonical
`UserDto`** — not a name-only fragment assembled for a roster view.

This resolves the embed-or-reference question for this cluster: **edges embed the canonical
`UserDto`.** `LeagueMembership` and `SquadMembership` carry the person, not just a `userId`
the client must resolve with a second call it is not permitted to make unscoped.

Secrets are not a redaction concern here — `passwordHash` and `authId` are not on the
canonical `UserDto` at all, for any caller.

---

## Slice 1 — Identity and membership

Cluster: `User`, `League`, `LeagueMembership`, `Squad`, `SquadMembership`,
`LeagueInvitation`, `SquadOwnerInvitation`. Tracked by #202.

### User

The principal. One object; the caller's relationship to it decides the role, not a
separate object.

**A6 governs writes: self, or `rootAdmin`. A commissioner has no write row here.** Reads
are wider — see the league-scoped row.

| Operation | Role | Rule |
|---|---|---|
| Register | `public` | — |
| Read one | `self`, `rootAdmin` | A6 · `me` resolves to the caller |
| **Read league peers** | `member` | **A4 + A6** · scoped through the `LeagueMembership` join; returns users sharing a league with the caller, as the canonical `UserDto` |
| List / search *(unscoped)* | `rootAdmin` | **A1** |
| Update profile, username, preferences | `self`, `rootAdmin` | A6 |
| Change own password | `self` | A6 · requires the current password |
| Reset another's password | `rootAdmin` | A6 · no current password; the subject differs, not just the precondition |
| Disable *(set `isActive = false`)* | `self`, `rootAdmin` | A6 · self-inactivate and admin-disable are **one operation** |
| Enable | `self`, `rootAdmin` | A6 |
| Delete | `self`, `rootAdmin` | A6 |
| Revoke sessions | `self`, `rootAdmin` | A6 · self-logout and admin force-logout are **one operation** |
| Grant / revoke root admin | `rootAdmin` | A6 |

**A member reads peers' `User` data — name and email — through the league join, never
unscoped.** The canonical `UserDto` travels on the `LeagueMembership` / `SquadMembership`
edge. A6 restricts *writing* other users, not reading them.

### League

| Operation | Role | Notes |
|---|---|---|
| Create | `authenticated` | Three effects, all part of the one operation: the `League`, a `LeagueMembership` for the creator with `role = COMMISSIONER`, and a default `Squad` with the creator as its member/owner. **The commissioner membership — not a column on `League` — is the authoritative record of who runs the league.** Already implemented this way in `leagues/service.ts` |
| Read one | `member`, `rootAdmin` | **A2** |
| Read by invite code | `authenticated` | Precedes membership, so it cannot require it |
| List | `member`, `rootAdmin` | **A1 + A2** · a member gets their leagues (scoped read), root admin gets all (`findAll`). **One operation, scoped by role** |
| Update details, icon, join policy | `commissioner` | **A3** |
| Activate / inactivate *(soft)* | `commissioner` | **A3** · `isActive` |
| Delete permanently *(hard)* | `commissioner` | A3 · `deleteInactiveLeague` — **gated: throws unless already inactive**, and requires typing the `leagueCode` to confirm |

### LeagueMembership — the User↔League edge

Carries `role: COMMISSIONER \| MEMBER` and `status`. Unique on `(leagueId, userId)`.

| Operation | Role | Notes |
|---|---|---|
| Create | *(via invitation acceptance)* | Not a direct operation — see `LeagueInvitation` |
| Read list for a league | `member`, `commissioner` | **A4** · takes a league; this is how members see each other. Embeds the canonical `UserDto` |
| Read one | `member`, `commissioner` | A4 |
| Change role | `commissioner` | **A3** |
| Remove | `commissioner`, `member:own` | Commissioner removes a member; a member leaves. **One operation, two callers** |

### Squad — a team within a league

Never a sports team. Unique on `(leagueId, name)`.

| Operation | Role | Notes |
|---|---|---|
| Create | `member`, `commissioner` | **A7** · creates the subject's squad plus their `SquadMembership`; a commissioner may do this on a member's behalf |
| Read one | `member`, `commissioner` | **A4** · peers readable |
| List for a league | `member`, `commissioner` | **A4** · takes a league |
| Update name, icon | `member:own`, `commissioner` | **A5 + A7** |
| Activate / inactivate *(soft)* | `member:own`, `commissioner` | **A5 + A7** · `isActive`. The normal path |
| Delete permanently *(hard)* | `commissioner` | `deleteInactiveSquad` — **gated: throws unless already inactive**, then cascades to `contestEntry`, `contestEntryPick` and `draftPickHistory`. See the note below |

### SquadMembership — the User↔Squad edge, and ownership

**Membership and ownership are the same thing.** No role column: every member of a squad
is an owner of it. Unique on `(squadId, userId)` *and* on `(leagueId, userId)` — **a user
belongs to at most one squad per league.**

| Operation | Role | Notes |
|---|---|---|
| Create | *(via invitation acceptance)* | See `SquadOwnerInvitation` |
| Read list for a squad | `member`, `commissioner` | **A4** · embeds the canonical `UserDto` |
| Remove | `member:own`, `commissioner` | **A5 + A7** · leaving your squad and being removed are **one operation** |
| Replace | `commissioner` | **A7** · swap one owner for another; see `replacementForUserId` on the invitation |

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

One remains, and it is narrower than it looked:

- **May a member hard-delete their own inactive squad?** A5 settles that they cannot delete
  a peer's, and A7 gives the commissioner the operation regardless. What is open is whether
  permanent deletion is a member operation at all, given it destroys contest history.
  Currently listed as `commissioner` only.

### Soft and hard delete both exist, and hard delete is gated

Worth stating plainly, because it is easy to remember this as "soft delete only":

- **Inactivate** sets `isActive = false`. This is the normal path and what the product
  uses day to day.
- **Delete permanently** is a real row removal, and it **throws unless the record is
  already inactive**. For a squad it cascades to `contestEntry`, `contestEntryPick` and
  `draftPickHistory`. For a league it additionally requires typing the `leagueCode` back.

The service methods say so in their names — `deleteInactiveSquad`, `deleteInactiveLeague`
— and this is exactly the pattern
[`rules/domain-model-conventions-rules.md`](../rules/domain-model-conventions-rules.md) §2
prescribes: `isActive` as "eligibility gating before a later hard delete".

So these are **two operations, not one**, and the catalog lists them separately. Collapsing
them would hide the gate.

Resolved by the rules, recorded so they are not reopened:

- **Password reset vs change** — A6 distinguishes them by *subject*, not just precondition:
  changing your own password is `self` and requires the current one; resetting another
  user's is `rootAdmin` and does not. Two operations.
- **Commissioner authority inside a squad** — A7. A commissioner performs any member
  operation on behalf of any member of their league.
- **Embed or reference on edges** — edges embed the canonical `UserDto`. A member reads
  peer users through the league join, and returns the full object per rule 3. See the note
  under the access rules.

Out of scope by design:

- **Field-level redaction is not modelled.** Admin-only fields are annotated on the
  canonical DTO and left exposed, per §13. This document assigns roles to *operations*,
  not to fields.
