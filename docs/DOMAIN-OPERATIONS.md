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

**These rules decide every row in the tables below.** A1–A7 decide *who may call* an
operation; A8 decides *what viewer context the response carries*; A9 decides what
`isActive` does and does not constrain. Where a table and a rule
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

## A8. Viewer context is delivered once per league, never per row

**Settled 2026-09-26 with the repo owner.** This is the answer to "where does viewer
context live", and it is load-bearing for every DTO below.

### The problem it solves

`LeagueDto` and `SquadDto` carried the requester's relationship to the object *as fields on
the object*, in five different encodings:

| Field | On | Shape |
|---|---|---|
| `leagueRelationship` | `LeagueSummaryDto` | `{ leagueMember, commissioner }` |
| `memberType` | `LeagueSummaryDto` | nullable `LeagueRole` |
| `isRootAdmin` | `LeagueSummaryDto`, `SquadDto` | `boolean`, repeated on every row |
| `teamRelationship` | `SquadDto` | `{ leagueMember, owner, commissioner }` |
| `viewerAuthority` | `UserDetailResponse` | `{ self, rootAdmin, viewer }` |

Two requesters therefore got **different `LeagueDto` values for the same league**, which
makes the DTO not a value of the entity, breaks caching, and was the seed of the
admin/member DTO split this whole pass exists to undo.

### Why "one round trip per league" is the answer

The webapp is a single-page app whose league context is already URL-scoped and already
cached client-side. This is not a new mechanism to build — it exists:

- every league route is `/league/:leagueCode/…`
- `resolveDefaultLeagueCode()` (`league-routing.ts`) picks the landing league — the
  `poolmaster_recent_league` cookie if it still matches a membership, else newest
- `LeagueSelector` navigates to a new league and `rememberRecentLeagueCode()` persists it
- selecting a league fetches `getLeagueByCode` once, cached at
  `QueryKeys.leagues.detail(leagueCode)`
- TanStack Query is the state store, deliberately, with no Zustand mirror
  (`auth-state-ownership.test.ts` enforces this)

So the client already receives the viewer's league context in one round trip on league
selection and holds it for the session. **Every other response repeating it is
duplication, not delivery.**

### The rule

| Surface | Viewer context it carries |
|---|---|
| League-scoped responses — league detail, squads, members, contests, entries | **none.** The client has it from the league-context call |
| The league-context call (`getLeagueByCode`) | the viewer's `LeagueMembership` for that league **and** their `SquadMembership` in it |
| The leagues list — the one inherently multi-league surface | the viewer's `LeagueMembership[]`, once, as an array beside the leagues |
| `isRootAdmin` | **neither.** It is a property of the `User`, read from the cached `UserDto` |

`LeagueDto` and `SquadDto` become pure entity values. No new DTO is invented: the viewer's
context *is* `UserDto` + `LeagueMembership[]` + `SquadMembership[]`, all of which already
exist as canonical shapes. This satisfies working rule 5 — the apparent gap turned out to
already exist under another name.

### Why the leagues list is the one exception

It is inherently N leagues and the viewer's relationship differs per league:
`getLeagueSelectorOptions()` filters on `leagueRelationship.commissioner` and
`sortLeaguesForOverview()` sorts by it, because the selector must show which of your
leagues you run. That needs the relationship **as a set** — which is
`LeagueMembership[]`, one array, not a field repeated on every row.

### Evidence that these were already residue, not design

- `app-shell.tsx` reads **both sources in one file** — line 49 uses `auth.isRootAdmin`
  from the cached user, line 64 uses `activeLeague?.isRootAdmin`. Around twelve call sites
  read that global boolean off a league or squad while `auth-provider.tsx:175` has exposed
  it all along.
- `my-team-page.tsx:149` identifies the viewer's own squad with
  `teamsQuery.data?.find(team => team.teamRelationship.owner)` — it fetches every squad in
  the league and scans a per-row viewer flag. With the viewer's `SquadMembership` in the
  league context this is `find(t => t.id === viewer.squadId)`, and `teamRelationship` comes
  off `SquadDto` entirely.
- `league-cache.ts:6` has a `toLeagueSummary()` that hand-projects `LeagueDetailDto` down
  to `LeagueSummaryDto` field by field — the shadow-projection problem replicated in the
  **client**. Collapsing the two into one `LeagueDto` deletes the function.

### What this does not change

Working rule 4 still holds: admin-only *fields* are noted, not enforced. A8 is about
**whose relationship to the object** travels in the payload, not about trimming fields per
caller. Nothing here authorises a redacted variant.

---

## A9. `isActive` is a read filter, not a write lock

**Settled 2026-09-26 with the repo owner**, after this was got wrong while planning slice 1's
service migration.

Inactivating anything — a `User`, `Squad`, `League`, `SportEvent` — means it is **excluded
from views and from use**. That is the whole of what it means, and it is enforced where
reads happen:

- `SquadRepository.findByLeague(leagueId, includeInactive = false)`
- `SquadMembershipRepository.findBySquad(squadId, includeInactive = false)`
- `LeagueMembershipRepository.findByLeague` / `findByUser` / `countActiveByLeagues`, all
  filtering `status = ACTIVE`

**It does not freeze the row against writes.** An inactive object can still be edited; the
edit simply is not visible anywhere, because the reads exclude it. So a guard that refuses a
*write* because the target is inactive is not protecting anything — it is a second,
weaker version of a rule the read layer already enforces completely.

### The one exception, and why it is not the same thing

**Permanent delete requires the row to be inactive already.** That is a genuine write
precondition, and the rules that state it (`deleteInactiveSquad`, `deleteInactiveLeague`,
admin and self user delete) stay exactly as they are.

The difference: that gate exists so a destructive, irreversible operation cannot be reached
in one step from the normal state. It is sequencing, not freezing. Blocking a *profile edit*
on an inactive account protects nothing by comparison — nothing renders it either way.

### What this ruled out in slice 1

`account/service`'s `requireUserForMutableAccountAction` refused profile, username and
preference updates whenever the account was inactive. It reads as a generalisation of the
delete gate, applied to all writes. It was dropped: nothing in the operation set makes an
inactive account read-only, and a user must be able to sign in while inactive in order to
reactivate, so the account was never actually frozen.

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

**Viewer context moves out of the domain DTOs — see A8 above.** `leagueRelationship`,
`memberType`, `teamRelationship`, `viewerAuthority` and the per-row `isRootAdmin` all come
off `LeagueDto` and `SquadDto`. Settled 2026-09-26; A8 carries the reasoning and the
evidence.

**`League.createdBy` is dropped.** It was a bare `String @db.Uuid` with no relation — no
referential integrity, no traversal.

**Correction (2026-09-26, while implementing).** This section previously said "nothing read
it for a decision. Its only two readers passed it through." That was wrong. Four call sites
*queried* it, and two of them gated a destructive operation: the user hard-delete dependency
guards in `admin/user-service.ts` and `account/service.ts` both counted
`league.createdBy = userId`, and the admin guard reported a `LEAGUE_CREATOR` dependency type
from it.

Dropping it is still correct, for a better reason than "nothing reads it": **those counts are
redundant.** Both guards already count the user's `LeagueMembership` rows, and `createLeague`
writes the creator's `COMMISSIONER` membership in the same operation, so every creator is
already caught by that count. The only case `createdBy` added was a user who created a league
and was later removed from it — who under §12 has no remaining relationship to it. The
`LEAGUE_CREATOR` dependency type is removed with the column.

`Squad.createdBy` is unaffected. It is a real relation (`@relation("SquadCreatedBy")`) and
stays, along with the `createdSquadCount` guard and the `TEAM_OWNER` dependency type.

Creator provenance is not a concept this product needs. Who runs a league is the
`LeagueMembership` with `role = COMMISSIONER`, which league creation already writes.

Dropping it: remove the column (migration), the field from `League` in
`packages/shared/domain/types.ts`, the mapping in `prisma-league-repository.ts`, and the
DTO field emitted by `admin/league-service.ts`. `input.createdBy` **stays** as a parameter
of the create operation — it is the userId that becomes the first commissioner.

## Open items

None. The catalog above was reviewed and accepted.

**Permanent deletion is `commissioner` only** — a member inactivates their own squad but
does not destroy contest history. Low-stakes to revisit: A7 already gives the commissioner
the operation, and a member always has inactivate.

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
