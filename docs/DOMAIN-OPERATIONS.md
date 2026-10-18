# PoolMaster — Domain Operations by Role

The operations each domain object supports, who may call them, and the access rules that
decide it. This is **product truth** — what the model permits under any implementation —
organised by aggregate. It deliberately does not list fields: `schema.prisma` and
`packages/shared/domain` are the source for those, and a field table here would be a second
copy that drifts.

Section references (§N) without a file name are to
[`rules/domain-model-conventions-rules.md`](../rules/domain-model-conventions-rules.md),
whose §13 *Operation Access Roles* states the role model these tables apply. When the routes
and this document disagree, the routes are the defect.

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
operation; A11 decides which objects A1 applies to; A8 decides *what viewer context the
response carries*; A9 decides what `isActive` does and does not constrain; A10 and A12 decide
*where authority is read from* — the token for root admin, a query for membership. Where a table
and a rule disagree, the rule wins and the table is a bug. New operations are assigned a role by
applying these rules, not by precedent from a similar-looking route.

**A1. Only `rootAdmin` may read across all rows of a tenant-scoped object.** An unscoped
`findAll` over tenant-scoped data is a root-admin operation. Every other caller reads
through a scope — their leagues, their league's squads, their own user. **A11 decides which
objects are tenant-scoped.** A1 says nothing about global objects, where there is no scope
to read through.

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
| League-scoped responses — squads, members, contests, entries | **none.** The client has it from the league-context call |
| The league-context call — `getLeagueByCode` **and** `getLeague` | the viewer's `LeagueMembership` for that league **and** their `SquadMembership` in it |
| The leagues list — the one inherently multi-league surface | the viewer's `LeagueMembership[]`, once, as an array beside the leagues |
| `isRootAdmin` | **neither.** It is a property of the `User`, read from the cached `UserDto` |

**Both league reads return the context (added 2026-09-27).** `getLeague` (by id) originally
returned a bare `LeagueResponse` while `getLeagueByCode` returned `LeagueContextResponse` —
two reads of one object with two shapes, which is the shadow projection this pass removes, one
level up from the DTOs. They share one handler now and one response.

It matters beyond tidiness. A contest-rooted surface resolves a contest first and learns a
`leagueId`, never a `leagueCode`, so before the by-id read carried context those pages
answered "which squad is mine?" by fetching every squad in the league and scanning each one's
member list for the signed-in user. That is the read A8 exists to replace, written by hand
instead of as a per-row flag — which is why removing the flags from the DTOs did not flush it
out and a later sweep had to.

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

Sign-in and session refresh therefore accept an inactive account, and inactivating your own
account keeps the session you did it from while revoking the others. Until 2026-10 both
refused with `ACCOUNT_INACTIVE` and self-inactivation signed the user out, so an account
that inactivated itself could never sign back in to reactivate or delete itself.

---

## A10. Root-admin authority is read from the access-token claim

**Settled 2026-09-28 with the repo owner (#213, #195).** Every surface answers "is this caller a
root admin" the same way: from the `isRootAdmin` claim on the access token, set when the token was
issued. No route re-reads the `User` row to decide it.

### The inconsistency this replaced

`/api/v1/users/*` (11 routes) already trusted the claim, because #202 built them that way.
`/api/v1/admin/*` — leagues, providers, golf, config, audit — ran `prisma.user.findUnique` on every
request inside `plugins/admin-auth.ts`. So a role change took effect immediately on one surface and
on the next token for the other, and nobody had decided that; it arrived by attrition.

It surfaced as a test failure rather than a review finding. `root-admin.functional.ts` promoted a
user by writing `isRootAdmin: true` straight to the database and then called a route with the
client it already held. Against `/admin/*` that worked, because the row was re-read. Against the
user routes it got a 403, because the token in hand still said `isRootAdmin: false`.

### Why the claim is the safe side of the trade

The obvious objection to a claim is that a demotion does not take effect until the token expires.
That objection does not apply here, because **`setUserRootAdmin` already revokes the subject's
sessions on demotion**, deliberately. Removed authority cannot be used until they log in again,
and the next login mints a token without the claim. The window is closed for the case that
matters.

What genuinely does get slower is **promotion**: a newly promoted root admin waits for their next
token, at most the access token's lifetime. Nobody is harmed by gaining authority a few minutes
late.

### What follows from it

- A test that promotes a user in the database **must re-issue their session** before calling any
  route as a root admin. `promoteToRootAdmin` in `tests/functional/builders.ts` does both; three
  suites previously promoted without the re-login and passed only because `/admin/*` re-read the
  row.
- `RootAdminContext` carries `id` and `email`, both signed claims. It used to carry a `name` built
  from the row, which had no consumers.
- `ROOT_ADMIN_USER_NOT_FOUND` is gone with the lookup. A signed token for a deleted user now reads
  as a plain 403, the same answer for the caller with one fewer code to distinguish.
  `ROOT_ADMIN_SESSION_REQUIRED` and `ROOT_ADMIN_SESSION_INVALID` are unchanged, which matters
  because `clients/poolmaster/src/lib/api.ts` treats both as refresh-triggering.

---

## A11. The model has a tenant half and a global half, and only the tenant half is scoped

**Settled 2026-09-29 with the repo owner**, after #236 widened the sport-catalog reads and A1
as written appeared to forbid it.

PoolMaster's domain divides in two, and the division is **ownership, not sensitivity**:

- **Tenant-scoped objects** belong to somebody — a `User`, a `League`, a `Squad`. Two members
  of different pools see different rows, and one must never see the other's.
- **Global objects** describe the world outside the product. The NCAA March Madness bracket
  and the Masters field are the same facts for every account on the platform. Scottie
  Scheffler is on the PGA Tour whether or not anyone has ever created a pool.

A1 was written when every unscoped table in the schema happened to be tenant-scoped, so it
generalised from a sample of one kind. Applied to a global object its own wording breaks
down: there is no "your sports" to read through.

### The rule

**On a global object, reads are `authenticated` and writes are `rootAdmin`.**

Reads are open because there is nothing to protect: every authenticated caller would see
byte-identical rows, so withholding them guards no one's data. It only forces the product to
invent a second, member-visible copy of the same facts — the shadow-DTO duplication this
epic exists to remove. A member choosing golfers for a contest needs the field and the
rankings; that is the product working, not a leak.

Writes stay `rootAdmin` because global rows are platform state: one bad edit is wrong for
every tenant at once.

### The test — all three, or it is tenant-scoped

1. **No owner.** No column, directly or transitively, resolves to a `User`, `League` or
   `Squad`.
2. **Identical for every viewer.** Two users in different pools see the same rows. "Yours"
   is meaningless for it.
3. **Not produced by anyone's activity.** Nothing in the row exists because a user did
   something in the product.

Default to tenant-scoped. An object that fails any condition is tenant-scoped, and a
borderline object is tenant-scoped until the repo owner says otherwise.

### Classification

| | Objects |
|---|---|
| **Global** | `Sport`, `SportLeague`, `EventSeries`, `SportEvent`, `SportEventRound`, `SportEventTier`, `Participant`, `ParticipantProviderMapping`, `ParticipantLeagueAffiliation`, `SportEventParticipant` and its standing, round and valuation rows, `ContestConfigTemplate` |
| **Tenant-scoped** | `User`, `League`, `LeagueMembership`, `Squad`, `SquadMembership`, both invitation objects, `Contest` and everything under it — configuration, entries, picks, scoring rules, prizes |

The boundary is where the two halves meet: `SportEventParticipant` is global (a golfer in a
tournament), `ContestEntryPick` is tenant-scoped (a squad chose that golfer). The pick fails
condition 3.

**`ContestConfigTemplate` is global — classified in slice 3 (#245).** It passes all three
conditions: platform seeded, no owner, not produced by anyone's activity. Its reads are
`authenticated` — a commissioner needs the templates to create a contest, and a template is
the same row for every viewer — and its one write stays `rootAdmin`. Until #245 it was held at
`rootAdmin` pending this call, which is why the commissioner flow had its own copy of the read.
A contest's *configuration*, copied from a template at create, is tenant-scoped like the rest
of the contest: the template is where it came from, not what it is.

### What this rule does not do

- **Global is not public.** A valid session is still required. A11 moves an object from
  `rootAdmin` to `authenticated`, never to anonymous.
- **Global is not a field-level exemption.** A11 decides which *rows* a caller may read.
  Whether a particular column should be visible stays §13: admin-only fields are annotated on
  the canonical DTO, not enforced. If a field on a global object turns out to be genuinely
  operational — provider identifiers are the live example — that is a §13 question, and
  answering it does not require re-gating the object.
- **Global is not an argument for widening tenant reads.** No tenant-scoped object becomes
  readable because it is "not very sensitive". A11 is a structural test, not a judgement
  about harm.

---

## A12. Relational authority is resolved by query in the pre-check, never carried on the token

**Settled 2026-10-01 with the repo owner (#193).** League membership and squad affiliation —
the authority a caller has *relative to a resource* — are resolved per request, by query, inside
the pre-check that gates the route. They are never carried on the access token as claims.

The pre-checks are `requireMemberOfLeague` for read-only access within a league's scope
(browsing contests, the leaderboard, other squads and members), the commissioner gates for
league administration, and squad affiliation (`requireMemberOfSquad`, #292, or `requireOwnSquad`
for the caller's own squad, #458) for anything done on a squad's behalf, entries included. Each one resolves the resource's league from the database and reads the caller's
membership there.

### Why A10 does not transfer

A10 reads root-admin authority from a claim, and someone reading it could reasonably conclude
that claims are how authority works here. They are not; A10 is the exception, and the line is
**a global property of the user versus a relation to data**, not tolerance for staleness.

| | Root-admin authority (A10) | League and squad membership |
|---|---|---|
| Shape | one global property of the user | a relation between a user and a specific resource |
| Needs data to interpret | no | yes — which league owns this contest, this squad |
| Changes | effectively never within a session | constantly, and by side effect: inactivating a team ends its owners' league memberships (`rules/domain-model-concepts.md` §3) |
| Cardinality | one boolean | many leagues, many squads per user |
| Revocation | `setUserRootAdmin` revokes the subject's sessions on demotion | nothing comparable exists |

Root-admin is safe as a claim because it needs no data to interpret, does not change within a
session, and has a revocation path that closes the window when it does. Membership has none of
those properties. And a claim could not remove the database read anyway: the pre-check must
resolve the resource's league from the database whatever the token says, so a membership claim
would not save the query, only add a second and staler source of truth beside it.

### No caching, and no claim-based optimization, for now

This is early-stage feature development, and the cost is one indexed read —
`findByLeagueAndUser` on the `(leagueId, userId)` unique key — that `requireCommissionerForContest`
already performs for every contest-scoped commissioner gate. Nothing about it needs optimizing.

### The prerequisite for revisiting it

**Anyone who later wants membership claims, or a membership cache, must first build a revocation
path equivalent to the one that makes A10 safe** — removing a member, inactivating a squad or
team, and every other path that ends a membership must invalidate whatever carries it, before
the next request is decided. Nothing comparable exists for membership removal today, and
removal by side effect makes it harder, not easier. Without it, saving the query introduces
a gate that keeps granting access to a league the user was removed from.

---

## Identity and membership

Cluster: `User`, `League`, `LeagueMembership`, `Squad`, `SquadMembership`,
`LeagueInvitation`, `SquadOwnerInvitation`.

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
| Update profile, username, preferences | `self`, `rootAdmin` | A6 · **one operation, either caller** — `modules/users/user-profile-service.ts`; the authority rule is `requireWritableUser`, and a caller who is neither gets 403 `USER_WRITE_FORBIDDEN` |
| Change own password | `self` | A6 · requires the current password |
| Reset another's password | `rootAdmin` | A6 · no current password; the subject differs, not just the precondition |
| Disable *(set `isActive = false`)* | `self`, `rootAdmin` | A6 · self-inactivate and admin-disable are **one operation** |
| Enable | `self`, `rootAdmin` | A6 |
| Delete | `self`, `rootAdmin` | A6 |
| Revoke sessions | `self`, `rootAdmin` | A6 · self-logout and admin force-logout are **one operation** |
| Grant / revoke root admin | `rootAdmin` | A6 |

**The scope is a parameter, not a second operation.** The account routes pass the
authenticated caller as both actor and subject; an admin route passes a `userId`. That is the
only difference between the two callers, and it is an argument — which is why there is one
implementation. Before #202 the `self` half lived in `account/service.ts` with the authority
rule implicit in the route prefix, and the `rootAdmin` half did not exist.

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
| Update details, icon | `commissioner` | **A3** |
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
| Inactivate *(soft)* | `commissioner` | `inactivateSquad` · `isActive`. The normal path. Ends every owner's league membership, so it is league administration, not an owner's button (#219). Undone by inviting an owner back |
| Delete permanently *(hard)* | `rootAdmin` | `deleteInactiveSquad` (#292) — **gated: throws unless already inactive**, then cascades to its entries, picks, owner invitations and memberships. QA-residue cleanup. See the note below |

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

## Events and participants (the cross-sport core)

Cluster: `Sport`, `SportLeague`, `EventSeries`, `SportEvent`, `SportEventRound`,
`SportEventParticipant`, `SportEventParticipantRound`, `SportEventParticipantStanding`,
`SportEventTier`, `SportEventParticipantValuation`, `SportEventMatch`, `Participant`,
`ParticipantProviderMapping`, `ParticipantLeagueAffiliation`.
The tree is `SportLeague → EventSeries → SportEvent`: an event is one edition of a series, in
one event year, and the series is its only parent.

**Every object in this cluster is global (A11).** No row here belongs to a user, league or
squad, so A1–A7 do not apply: reads are `authenticated`, writes are `rootAdmin`. The one
exception is a read that exposes operational detail — it still returns the canonical object,
with the admin-only fields annotated in the DTO rather than stripped (rule 4, §13).

**Sport is established once, then inherited** (stage 2, decision 5). Selecting a
`SportLeague` fixes the sport; a series, an event, a roster or a participant is reached
through that parent, so none of their operations takes a sport filter. Only the
sport-league list, and the event list — which is the member's entry point and has no
parent — take one.

**`SportLeague` is never abbreviated to "league"** (decision 6). `League` is the product's
pool of players; `SportLeague` is the PGA Tour or the NFL.

**One guard for every write** (#236). Each write on these objects takes the route-level
`requireRootAdmin` hook (`core/root-admin-guard.ts`): 403 `ROOT_ADMIN_ACCESS_REQUIRED` from the
access-token claim (A10). It runs at `onRequest`, before validation, so a non-admin never learns
an operation's shape from a 400 — the answer the `/admin` routes these replaced gave too.

### Sport

| Operation | Role | Notes |
|---|---|---|
| List | `authenticated` | `listSports`. Rows are seeded with the platform; there is no create operation. The port is `SportRepository` |

### SportLeague

| Operation | Role | Notes |
|---|---|---|
| List, read one | `authenticated` | `listSportLeagues` takes the sport — the one list that does — and `isActive`. Each row carries its affiliation and event counts and its `currentEventYear` |
| Create, update | `rootAdmin` | `createSportLeague` takes the sport; unique on `(sportId, name)`. Adding a tour is one call, not a migration |
| Set the current event year | `rootAdmin` | `updateSportLeague` with `currentEventYear` — one write, so a sport league never has two. 422 `EVENT_YEAR_HAS_NO_EVENTS` for a year the sport league has no events in: the integrity the season foreign key it replaced used to give (#315) |
| Set how brackets advance | `rootAdmin` | `bracketAdvancement` on create or update (#722): `FIXED` (the default) sends each winner to the match its link names; `RESEED_BY_SEED` lets a round's matches link nowhere, so the admin places their winners by seed (the NFL after Wild Card weekend). 422 `SPORT_LEAGUE_NOT_BRACKET` for `RESEED_BY_SEED` on a sport not played as a bracket |

### EventSeries

The recurring tournament — "The Masters" — that each year's `SportEvent` is an edition of
(#314). Unique on `(sportLeagueId, name)`; carries `isActive`.

| Operation | Role | Notes |
|---|---|---|
| Find or create | (internal) | Event creation resolves the series by `(sportLeagueId, name)` and creates it on first use — never an admin decision. No route reaches a series on its own |

### ParticipantLeagueAffiliation — the Participant↔SportLeague edge

Who competes on a tour, with their current `ranking` — the tour's ranking, not a world ranking.

| Operation | Role | Notes |
|---|---|---|
| List for a sport league | `authenticated` | Embeds the canonical `Participant` |
| Add, remove | `rootAdmin` | Unique on `(sportLeagueId, participantId)`. 409 `SPORT_LEAGUE_AFFILIATION_ALREADY_EXISTS`, 404 `SPORT_LEAGUE_AFFILIATION_NOT_FOUND` |
| Update rankings | `rootAdmin` | One write for the set |
| Preview / apply an upload | `rootAdmin` | Rows resolve by participant id, then external id, then exact name, within the sport league's sport — one resolver, shared with the golf score upload. Apply refuses any unresolved or ambiguous row and writes nothing (422 `SPORT_LEAGUE_AFFILIATION_UPLOAD_UNRESOLVED_ROWS`) |

The six golf-named roster operations these replace (`adminGetGolfLeagueRoster` and siblings)
are gone (#236).

### SportEvent

| Operation | Role | Notes |
|---|---|---|
| List | `authenticated` | `listEvents`, filtered by sport, status, sport league (through the series), event year and a name search, unpaged (§16). Returns the canonical `SportEventDto` — the row plus `loadedParticipantCount`, `tierCount`, `untieredParticipantCount`, `contestCount`, contest-setup readiness and `allowedTransitions` — to every caller. `DRAFT` events are listed to root admins only (#431) |
| Read one | `authenticated` | `getEvent`. A `DRAFT` event is 404 `EVENT_NOT_FOUND` to anyone but a root admin (#431) |
| Create | `rootAdmin` | `createEvent` (manual) or `createEventFromProviderEvent` (linked for scores), on a sport league in an event year. The series is found or created by name; a second edition of a series in one year is 409 `EVENT_EDITION_ALREADY_EXISTS` — the database's `(eventSeriesId, eventYear)` constraint. The sport comes from the sport league. Seeds the rounds and the default tiers. Provider sync never creates an event: it updates the one linked to a provider event and skips the rest. Every new event is `DRAFT`: commissioners can't see or use it until it is released |
| Clone an event year | `rootAdmin` | `cloneEventYear` re-creates each of a sport league's events in one year as next year's edition (or `targetYear`'s), dates shifted; never the field, tiers, scores or provider link. 422 `EVENT_YEAR_HAS_NO_EVENTS` for an empty source year, 409 `EVENT_YEAR_NOT_EMPTY` for a target year that has events. Leaves the current event year alone |
| Import an event year from a provider | `rootAdmin` | `importEventYearFromProvider` creates each provider event for a sport league's tour starting in that calendar year that PoolMaster lacks, each as `createEventFromProviderEvent` would, linked for scores. A provider event belongs to the tour when its tour name equals the sport league's `matchKeyword`, ignoring case. Events already linked, and series that already have an edition that year, are skipped and reported, so a re-run creates nothing. 422 `SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD`; 404 `PROVIDER_NOT_FOUND` or `SPORT_LEAGUE_NOT_FOUND` (#385) |
| Update | `rootAdmin` | `updateEvent` edits any event, linked to a provider or not. A provider sync never overwrites these fields (#435). The round schedule follows the edit: a new start date moves every round (start and end) by the same amount, and a higher round count adds the missing rounds, each a day after the one before. Lowering the count keeps the stored rounds, but the lifecycle scheduler ignores any past the new count |
| Delete | `rootAdmin` | 409 `EVENT_HAS_CONTESTS`. Deletes the event's rounds and tiers first — before #236 it failed on the foreign key for any event that had them |
| Release for contests | `rootAdmin` | `releaseEvent`, `POST /events/:eventId/release` (#431): `DRAFT` → `SCHEDULED`, the only way out of `DRAFT` apart from cancelling. 409 `SPORT_EVENT_NOT_DRAFT`; 409 `SPORT_EVENT_ALREADY_STARTED` once the start time has passed; 422 `SPORT_EVENT_NOT_READY` until the field is loaded, every active participant has a tier and a price (#93), and every tier has an active participant (the event's `emptyTierLabels` lists the tiers that do not: no entry could pick from them). A bracket event (#698) also needs its bracket: every side of every match names a team or is fed by an earlier match, every active team is in it, and no withdrawn team is. Release locks the event's tiers and prices for good; rank, odds and withdrawals stay editable, and a participant added later stays untiered. The event's start time is the contest cutoff: no contest is created or opened after it |
| Transition, link / unlink the score source | `rootAdmin` | `transitionEvent`, `linkEventScoreSource`, `unlinkEventScoreSource`. `transitionEvent` refuses `DRAFT` → `SCHEDULED` with 409 `SPORT_EVENT_RELEASE_REQUIRED`: that move is `releaseEvent`'s. `linkEventScoreSource` refuses a provider that is not registered (404 `PROVIDER_NOT_FOUND`) or does not cover the event's sport (422 `PROVIDER_SPORT_MISMATCH`), since no scores could ever arrive through it |
| Start simulated live scoring | `rootAdmin` | `startEventLiveSimulation` asks the linked provider to play the event's four rounds forward on its own clock, so a live contest's leaderboard can be tested; calling again restarts from round 1. Scores still arrive through the live-score sync, which polls only while the event is `IN_PROGRESS`. 409 `EVENT_NOT_LINKED` when unlinked, 422 `LIVE_SIMULATION_UNSUPPORTED` unless the provider reports `supportsLiveSimulation` (only the QA mock feed does), 404 `PROVIDER_EVENT_NOT_FOUND` when the provider no longer has the linked event |
| Read simulated live scoring | `rootAdmin` | `getEventLiveSimulation` reports the running simulation's clock and current round, so the score-source card can keep it current; 409 `EVENT_NOT_LINKED` when unlinked, 422 `LIVE_SIMULATION_UNSUPPORTED` as for start, and 404 `LIVE_SIMULATION_NOT_RUNNING` when none has been started, the provider restarted, or the provider no longer has the linked event |
| Link to a simulated event | `rootAdmin` | Tournament Home's **Link to a new simulated event** calls `linkEventScoreSource` with `externalId` `sandbox-<event id>` on the golf provider that reports `supportsLiveSimulation`. The QA mock answers any `sandbox-` id with a golf event of its own, so a made-up tournament on any dates gets a field and a simulation (#402) |

### SportEventRound, SportEventTier

Children of an event; always reached through it.

| Operation | Role | Notes |
|---|---|---|
| List for an event | `authenticated` | `listEventRounds` in `roundNumber` order; `listEventTiers` in `tierNumber` order |
| Reschedule rounds | `rootAdmin` | `updateEventRounds` |
| Replace tiers | `rootAdmin` | `replaceEventTiers`. 409 `TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS` unless `reassignOrphansTo` names a tier that survives; 409 `SPORT_EVENT_TIERS_LOCKED` once the event is released |

### SportEventParticipant — the Participant↔SportEvent edge

Carries `ranking` (the rank that applied at this event), `seedNumber`, `oddsToWin`, and an
`inactiveReason` of `WITHDRAWN` or `ELIMINATED` (null: inactive, no reason recorded).

| Operation | Role | Notes |
|---|---|---|
| List for an event | `authenticated` | `listEventParticipants`. Embeds the canonical `Participant`, the valuation, the standing and each round, with their golf rows, and a race's result (`race`). One read serves the field grid, the tier board and the score corrections |
| Add, edit, remove | `rootAdmin` | `addEventParticipants`, `updateEventParticipants` (price included, until release: 409 `SPORT_EVENT_TIERS_LOCKED` after; on a released bracket event a changed seed is 409 `SPORT_EVENT_SEEDS_LOCKED`, and a provider sync keeps the stored seed; `isPlayInPlace` marks or unmarks a row as a play-in place only on a bracket event, 422 `SPORT_EVENT_NOT_BRACKET` otherwise, and only before release, 409 `SPORT_EVENT_BRACKET_LOCKED` after), `removeEventParticipant` — 409 `EVENT_PARTICIPANT_HAS_PICKS` once a contest entry picked it, 409 `EVENT_PARTICIPANT_IN_BRACKET` while a match names it |
| Fill a play-in place | `rootAdmin` | `setEventPlayInWinner` repoints a field row marked as a play-in place ("Texas / Xavier") to the winner, which keeps the row's seed, tier, price, picks and bracket place; the pairing's participant is inactivated and the row is a play-in place no more, so a place is filled once. 422 `SPORT_EVENT_NOT_BRACKET`; 404 `EVENT_PARTICIPANT_NOT_FOUND`, or `PARTICIPANT_NOT_FOUND` for a winner that is not an active participant of the sport; 409 `EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE` for a row that is not (or no longer) a play-in place, `EVENT_PARTICIPANT_ALREADY_ON_FIELD`, or `PLAY_IN_SLOT_ALREADY_PLAYED` once the row's match has started |
| Bulk-adjust by upload | `rootAdmin` | `previewEventParticipantUpload` (writes nothing) and `applyEventParticipantUpload`: rows set `ranking`, `oddsToWin`, `seedNumber`, `isActive`, `inactiveReason` on participants **already on the field** — omitted leaves a value, null clears it. Rows resolve within the field by `participantId`, then `externalId`, then exact case-insensitive `playerName`, first identifier only. A participant not on the field is UNRESOLVED (the upload never adds one); one named twice is a `DUPLICATE_PARTICIPANT` row error. Apply is all or none through the `updateEventParticipants` write path, 422 `EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED` otherwise (#128). Here and in the grid save, `ranking` and `seedNumber` are whole numbers from 1 to 2,147,483,647 (the 32-bit columns' limit); anything else is a 400 validation error (#437) |
| Seed from the sport league, refresh from the provider | `rootAdmin` | `seedEventParticipants` (golf only for now); `refreshEventParticipants` queues a provider sync (202), which writes each golfer's ranking from the provider's field onto the event participant (#384) |

**Golf surfaces render `ELIMINATED` as "Cut"** (decision 1). That is a display mapping, not
a stored value: `formatParticipantStatusLabel` in the shared domain, used by every surface
that shows the status.

### SportEventMatch — a bracket event's games

The matches of an event whose sport's tournament format is `KNOCKOUT_BRACKET` (#698). Each
names its round, its home and away field rows, the match and side its winner advances to, and
the region or conference it is played in (`regionLabel`, null for none);
the database refuses a match feeding itself, two matches feeding one side, a winner on a match
that is not `COMPLETED`, and a field row's delete while a match names it.

| Operation | Role | Notes |
|---|---|---|
| Read the bracket | `authenticated` | `getEventBracket`, in match-number order. A `DRAFT` event is 404 `EVENT_NOT_FOUND` to anyone but a root admin. 422 `SPORT_EVENT_NOT_BRACKET` for a sport that plays none |
| Load the bracket | `rootAdmin` | `loadEventBracket` replaces the whole bracket, until release (409 `SPORT_EVENT_BRACKET_LOCKED` after). 422 `BRACKET_INVALID` lists every problem: a repeated match number, an unknown round, a side not on the field or named twice, an advance to a missing or not-later match, two matches feeding one side, a fed side that also names a team, or other than one final in the last round. Completeness is checked at release, not here |
| Edit a match | `rootAdmin` | `updateEventBracketMatch` by match number: time and site at any point, sides only until release (409 `SPORT_EVENT_BRACKET_LOCKED`). 404 `BRACKET_MATCH_NOT_FOUND`; 422 `BRACKET_INVALID` for a side problem |
| Enter a result | `rootAdmin` | `recordEventMatchResult` by match number (#699): the winner's side, with both scores or neither (a series' score is games won). In one write it completes the match, puts the winner on its side of the next match, and rewrites every team's standing from the bracket: champion `COMPLETE` and first, teams out in the same round sharing a place, a loser `ELIMINATED`, `currentRound` the latest round with a match. Only on a released event (409 `SPORT_EVENT_NOT_RELEASED` for a draft). 422 `MATCH_SIDES_NOT_SET` while a side waits for its team; 422 `MATCH_RESULT_INVALID` for one score without the other, or the winner not scoring more. Changing the winner is 409 `SPORT_EVENT_MATCH_RESULT_LOCKED` once the next match has a result; fixing only the scores is always allowed |
| Clear a result | `rootAdmin` | `clearEventMatchResult`: the match is scheduled again, the side its winner filled is emptied and the standings are rewritten. A match with no result is left as it is. 409 `SPORT_EVENT_MATCH_RESULT_LOCKED` once the next match has a result |
| Propose a reseeded round | `rootAdmin` | `proposeEventRoundMatchups`, `GET /events/:eventId/bracket/rounds/:roundNumber/reseed` (#722), saving nothing: in each region the best seed left hosts the worst, the second best the second worst, and a bye or a linked winner keeps its match and side. 422 `BRACKET_NOT_RESEEDED` when the sport league is `FIXED` or the round is not one after matches that link nowhere; 409 `SPORT_EVENT_NOT_RELEASED` for a draft; 409 `BRACKET_ROUND_NOT_FINISHED` while a match of the round before has no result; 409 `BRACKET_ROUND_ALREADY_PLAYED` once a match of the round has started; 422 `BRACKET_INVALID` when the teams left do not fill a region's matches |
| Set a reseeded round | `rootAdmin` | `setEventRoundMatchups`, `PUT /events/:eventId/bracket/rounds/:roundNumber/matchups`: both sides of every match of the round, all or none, and again until the round starts. The refusals above, and 422 `BRACKET_INVALID` naming every problem: a match left out or set twice, a team not left in the round or placed twice, a team out of its region, a bye or linked winner moved |

**Reseeded brackets** (#722). In a `RESEED_BY_SEED` sport league a round's matches may name no
next match; release lets the round after them wait with empty sides, and a result there places
no one. The final is still the one match in the last round. Once the admin sets the next round,
a changed or cleared result in the round before swaps or empties the team it placed, until that
team's next match has a result (409 `SPORT_EVENT_MATCH_RESULT_LOCKED`). A winner waiting to be
placed stands `ACTIVE` with `currentRound` the next round.

A bracket contest scores by `KNOCKOUT_ROUND_POINTS`: each win scores its round's value, plus
the seed difference times the multiplier when the upset bonus is on and the worse seed wins
(an unseeded team counts as the field's worst seed; a bye scores nothing). Contest setup
requires one round value per round of the event: 422 `CONTEST_SCORING_ROUNDS_MISMATCH`
otherwise. Until the bracket has a result, no team is scored.

### SportEventParticipantRound, SportEventParticipantStanding — base rows

The per-round join and the running standing. **The score lives in the sport extension**
(`SportEventParticipantGolfRound`, `SportEventParticipantGolfStanding`), keyed 1:1 to these.

| Operation | Role | Notes |
|---|---|---|
| Read for an event | `authenticated` | Through `listEventParticipants`. Standing `position` is the cross-sport rank key and is direction-free: **1 is best in every sport.** A reader ranks on it and joins the extension only to display a score |
| Write | *(scoring feed or `rootAdmin`)* | Written base-then-extension in one nested write. Golf corrections: `previewEventGolfRoundScores`, `applyEventGolfRoundScores`, `updateEventParticipantGolfRoundScore` — 422 for a non-golf event. A race's standings are written by its finishing order (below) |
| Rank | *(every score write)* | `position` and `displayPosition` are computed from the extension's score after each write — the feed or a correction — across the whole event, so no reader re-derives them (#246). Ties share a position and display as "T3"; a withdrawn or eliminated golfer is unranked. The provider supplies no live rank to copy |

### SportEventParticipantRaceResult — the finish-position extension

How one runner's race ended (#622): `resultStatus` (`FINISHED`, `DID_NOT_FINISH`,
`DISQUALIFIED`, `DID_NOT_START`), `finishPosition` (1 the winner; a dead heat shares a place),
`startPosition`, `riderName` and `isOfficial`, keyed 1:1 to the field row and removed with it.
The table refuses a place below 1, a place on a runner that did not finish, and an official
finisher with no place. There is no racing feed: the admin's finishing order is the only writer.

| Operation | Role | Notes |
|---|---|---|
| Read for an event | `authenticated` | On each `listEventParticipants` row as `race`, null until a result is entered |
| Preview a finishing order | `rootAdmin` | `previewEventRaceResults` writes nothing. Rows resolve within the field as the field upload's do; each row reports `CREATE`, `UPDATE` or `UNCHANGED`, or a row error — `DUPLICATE_PARTICIPANT`, `POSITION_WITHOUT_FINISH`, or (official only) `FINISH_WITHOUT_POSITION` — and the order as a whole `POSITIONS_INVALID` or `FIELD_INCOMPLETE` |
| Apply a finishing order | `rootAdmin` | `applyEventRaceResults`, all or none. Every value is stored as sent and none is derived (the score-correction pattern); runners not named keep their stored result, so a stewards' change is one row. `isOfficial` is set on every result of the race: the race is official as a whole. Places, merged with the stored ones, must run 1, 2, 3 … with a dead heat repeating a place and skipping the next (1, 2, 2, 4). An official result needs a result for every active runner and a place for every finisher; a scratched runner needs none. Also writes each runner's core standing: `position` its place, displayed "T2" in a dead heat, `COMPLETE` once it started and `WITHDRAWN` when it did not start. 422 `RACE_RESULT_ROWS_INVALID`, `RACE_RESULT_POSITIONS_INVALID`, `RACE_RESULT_FIELD_INCOMPLETE`, and `EVENT_SCORING_FAMILY_MISMATCH` for an event whose sport is not scored by finishing place |
| Score | *(contest scoring)* | Only an official result scores. A finisher scores its contest's `pointsTable` value at its place (0 beyond the table; both runners of a dead heat take the full points); `DID_NOT_FINISH`, `DISQUALIFIED` and `DID_NOT_START` score `didNotFinishPoints`, and so does a scratched runner with no result once the race is official. A runner with no result, or any result not yet official, is unscored |

### SportEventParticipantValuation

The tier assignment and price for a participant at an event. 1:1 with
`SportEventParticipant`.

**One valuation per field row, shared by every contest on the event — deliberate (#249).**
The row is keyed by `sportEventParticipantId` alone and tiers are keyed
`(sportEventId, tierKey)`, so two leagues running contests on the same event read the
same tiers and the same prices. Nothing is scoped to a contest or a league, and only a
root admin writes them. That is the intent, not an accident of early modelling: it gives
one valuation per event to maintain, keeps entries comparable across pools, and spares
every commissioner the work of tiering a full field. A commissioner who wants a different
difficulty curve cannot have one, and that is the accepted cost.

The alternative — re-keying the valuation to the contest so each pool tunes its own — was
considered and rejected. It would move the valuation out of the global half of A11 into
tenant data, needing a commissioner write path, seeding rules for a contest created after
its event was priced, and a rule for what a price change means once entries exist. Nothing
has asked for it.

**Price and tier get the same answer.** The price a budget contest spends against is the
event's, by the ruling above, and so is its salary cap: a budget contest copies the event's
`pricing.salaryCap` into its rules when it is created or edited (#93).

| Operation | Role | Notes |
|---|---|---|
| Read for an event | `authenticated` | On each `listEventParticipants` row |
| Auto-assign tiers, replace assignments, auto-assign prices | `rootAdmin` | `autoAssignEventTiers` (source `ODDS` or `RANKING`; with no `tierSize`, an event that keeps its sport's default tier count gets the sport's tier size per tier and the last tier takes the rest while that fills every tier, and any other tier count, or a field too small for that, gets the active field spread evenly, larger tiers first), `replaceEventTierAssignments`, `autoAssignEventPrices`. All three refuse with 409 `SPORT_EVENT_TIERS_LOCKED` once the event is released (#431). Prices follow the budget curve (#93): `price = round(salaryCap × (floor + (top − floor) × (1 − x)^steepness) / unit) × unit`, where `x` runs from 0 for the best seed to 1 for the last golfer (unseeded golfers last). The request carries the five values and the profile they came from, usually a Budget pricing profile; they are stored on the event as `pricing` in the same write, and its `salaryCap` is every budget contest's cap. 422 `PRICING_CONFIG_INVALID` when the floor share is above the top share or the unit above the worst golfer's price (`salaryCap × floorSharePercent / 100`), which could round prices to $0 |

### Participant

| Operation | Role | Notes |
|---|---|---|
| List / search | `authenticated` | Filtered by sport, status, `role` and more, unpaged (§16). `role` is the playing role ("GOLFER"); it was `position` until #246, which left `position` meaning rank alone |
| Read one | `authenticated` | |
| Create, update | `rootAdmin` | **A10** · 403 `ROOT_ADMIN_ACCESS_REQUIRED` from the claim. Before #235 any signed-in user could create or rename a catalog participant |

### ParticipantProviderMapping

Provider plumbing. Written by sync; read and repaired by `rootAdmin`. #236 adds one read,
`listParticipantProviderMappings` (`authenticated`, like every catalog read), for the player
page — the mapping count the golf player list carried is gone. #205 adds the repair:
`bindParticipantProviderMapping` (`rootAdmin`, `POST /participants/:id/provider-mappings`) binds
a provider's identifier to the participant with `MANUAL` confidence, moving it if another
participant held it; 404 `PROVIDER_NOT_FOUND` for a provider that is not registered. It
replaced `adminMapParticipant`, which took both ids in the body under `/admin/providers`.

`ParticipantRankingSnapshot` and the `PARTICIPANTRANKINGS` feed that wrote it were retired in
#125. A golfer's current ranking is `ParticipantLeagueAffiliation.ranking`, owned by the root
admin; an event participant's ranking comes from the provider's field (#384), and a field that
carries none leaves the ranking already on the row.

The `EVENTSCHEDULE` and `EVENTRESULTS` feeds were retired in #126, and with them the sport-level
sync (`submitSportSync`). Events are created and linked by the root admin; the provider's
upcoming-event catalog is read only on demand. The two remaining feeds, `EVENTPARTICIPANTS` and
`EVENTLIVESCORES`, are event-scoped and reach only linked (`SCORES_ONLY`) events. A field sync
writes the field and its size, never the event's details or status, and a score for a round the
admin did not schedule is skipped, never creating the round (#435). A live score is written only
while its event is `IN_PROGRESS`: before, there is nothing to score, and after, corrections are
the admin's alone. An event's lifecycle is moved
by the admin or by the date-driven lifecycle scheduler. Sync-run history rows for the retired
feeds were deleted by migration, and stored ingestion config drops their keys on boot. The stale
provider event cleanup went too: it cleared events sync used to create, and every event is now an
admin's (ADR-0009).

## Contests and entries

Cluster: `ContestConfigTemplate`, `Contest`, `ContestConfiguration`, `ContestEntry`,
`ContestEntryPick` and the scoring and prize rules under a configuration.

**`ContestConfigTemplate` is global (A11); everything else here is tenant-scoped** — it
belongs to a league through its contest.

### ContestConfigTemplate

A seeded starting configuration for a contest. Keyed by sport, contest format, selection type
and an optional event type. An optional `sportLeagueId` (#624) makes it one sport league's own
preset — the NASCAR, IndyCar or F1 points table, an LPGA template — offered only for that
league's events; null, as every template before #624 is, offers it for every league of its sport.
The league's FK is `ON DELETE RESTRICT`: a league with templates is retired, not deleted.

| Operation | Role | Notes |
|---|---|---|
| List | `authenticated` | `listContestConfigTemplates` (#245). Every filter optional — `sport`, `sportLeagueId`, `contestFormat`, `eventType`, `active`; an `eventType` narrows to that type plus the templates for any event type, and a `sportLeagueId` to that league's templates plus the sport-wide ones, never another league's. The create flow asks for the chosen event's league and starts on that league's default over the sport-wide default. One read for the create flow and the root-admin screens |
| Update | `rootAdmin` | `updateContestConfigTemplate`, `PUT /api/v1/contest-config-templates/:templateId`, guarded by `requireRootAdmin` like every other global-object write. Seeded rows only; there is no create or delete. The rules keep the template's selection type: a body of another type is 422 `CONTEST_CONFIG_TEMPLATE_RULES_MISMATCH` (#93). Only an active template can be the default: deactivating one clears it, and an inactive one cannot take it. Making one the default clears the default of the others with its sport, format, event type and sport league exactly, so each sport league keeps its own default preset (#624). Until #248 it was `adminUpdateContestConfigTemplate` under `/api/v1/admin`, the last route there |

### Contest

| Operation | Role | Notes |
|---|---|---|
| Create | `commissioner` | `createContest` (#245) — the one way a contest is made. Takes `name`, `sportEventId`, `contestFormat` (`ROSTER`), `selectionType` (`TIERED`, `BUDGET_PICK` or `RANDOM_DRAW`; others wait on a typed configuration, #99/#199), and a `templateId`, a `configuration`, or both. The configuration is typed by its own `selectionType`: tiered rules carry `picksPerTier` and `countedScores`, budget rules `rosterSize` (1 to 12) and `countedScores`, random-draw rules `picksPerEntry` (1 to 12, how many golfers the draw deals each entry) and `countedScores`, no more than `picksPerEntry` (422 `CONTEST_DRAW_FIELD_OUT_OF_RANGE`, #601). Rules of another type than the contest's: 422 `CONTEST_RULES_SELECTION_TYPE_MISMATCH`. A selection type the event's sport does not offer (its sport definition lists the allowed ones): 422 `CONTEST_SELECTION_TYPE_NOT_ALLOWED`. Budget rules take the event's salary cap, so they need a priced event (409 `CONTEST_EVENT_NOT_PRICED`) whose cheapest `rosterSize` active golfers fit under it (409 `CONTEST_BUDGET_UNFILLABLE`), and `countedScores` no more than `rosterSize` (422 `CONTEST_BUDGET_FIELD_OUT_OF_RANGE`). With both, the template is recorded as provenance and the configuration replaces the template's whole — no merge. Neither: 400 `CONTEST_CONFIGURATION_REQUIRED`. A template that is missing, inactive, or of another format or selection type: 422 `CONTEST_CONFIGURATION_INVALID`. A template that is one sport league's own preset, for an event of another league (the event's league is read through its series): 422 `CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH` (#624). The event must be released, not yet started, and its field loaded (422 `SPORT_EVENT_*`). How the contest is scored rides in the configuration's optional `scoring` (a participant scoring definition and its settings, #622), and a template can carry a preset there: the request's scoring replaces the template's, and the template's applies when the request sends none, even with its rules replaced. A definition the event's sport does not offer: 422 `CONTEST_SCORING_DEFINITION_NOT_ALLOWED`. Sent nothing, a contest takes its sport's default definition with its default settings; a definition with no default settings (horse racing's `FINISH_POSITION_POINTS`, whose `pointsTable` and `didNotFinishPoints` are the commissioner's) is 422 `CONTEST_SCORING_SETTINGS_REQUIRED`. The contest is saved `DRAFT` (#117): only the league's commissioners (and root admins) see it, nobody can enter it, and its name and configuration stay editable. Answers 201 with the canonical contest read |
| Open to league | `commissioner` | `openContest`, `POST …/contest-management/contests/:contestId/open` (#117): `DRAFT` → `OPEN` with a compare-and-set, so a double press runs once. Members see and enter the contest from then on; its name, configuration and existence are locked for good, with no undo. 409 `CONTEST_NOT_DRAFT` when it is not a draft; 409 `CONTEST_EVENT_ALREADY_STARTED` once the event's start time has passed or it is `IN_PROGRESS` or later (the draft stays a draft); 422 when the stored configuration no longer fits the event's tiers. Budget rules run the create's price checks again without saving anything (409 `CONTEST_EVENT_NOT_PRICED` or `CONTEST_BUDGET_UNFILLABLE`), because withdrawals can shrink the event's active field after the rules were saved. The field need not be ready: entries wait on it. Telling the league (feed post, email) will hang off this action |
| Read configuration | `commissioner` | `getContestConfiguration` (was `getManagedContest` until #248): the contest with its configuration and the tiers it inherits from its event, what the configuration editor reads |
| Update configuration | `commissioner` | `updateContestConfiguration` (was `updateManagedContestConfiguration` until #248). `DRAFT` only: refused with 409 `CONTEST_CONFIGURATION_LOCKED` once the contest is opened to the league (#117). The rules are checked as at create, against the contest's own selection type. An update that sends no `scoring` keeps the contest's (its points table, say). Members enter against these rules, so nothing reopens them: no operation returns a contest to `DRAFT` |
| List for a league | `authenticated` today | `listContests`. `DRAFT` contests are listed only to the league's commissioners and root admins (#117); the contest detail read answers a draft 404 to anyone else, and a league's `activeContestCount` never counts drafts. **No league check** — any signed-in user can list any league's contests; contest authorization is #193, which does not yet list this route. Each row carries `entryCount` and `sportEvent` (the event's name and start, null when the contest has no event; #577), so a list needs no per-event reads; until #247 the league-scoped list reported 0 for every contest, because its service was built without the entry reads |
| Delete | `authenticated` today | `deleteContest`, `DRAFT` only. **No league check** (#193, held for discussion: any signed-in user can delete any `DRAFT` contest). Takes the entries, picks, selection state, configuration and the configuration's scoring rules and prize definitions with it; before #247 a configuration with a scoring rule made the delete fail |
| Start | *(event lifecycle)* | When its event moves to `IN_PROGRESS`, every `OPEN` contest on it becomes `ACTIVE` in one guarded write, and its commissioners and entrants are emailed once; a re-sent transition finds nothing left to start |
| Read the contest leaderboard | `member` | `getContestLeaderboard`, answering the cross-sport `ContestLeaderboardResponse` (#248): entry standings (`ContestEntryStandingDto`, with the entry's total as `totalScore`), the event's field as its own `SportEventParticipantDto` rows, the event's `sport` — which a client resolves through the sport registry to the scoring family and vocabulary it renders the board with — and `scoringDefinitionId` — the definition it was ranked by, which a client renders scores and rounds through. Golf and the racing sports: each pick carries its family's block (`golf` or `race`, the other null); an entry's total is the one `totalScore` in every family, read through `scoringDefinitionId`. Live contests compute from event scores; a `COMPLETED` contest answers from its `ContestEntryStanding` rows (#246), so a score correction after settlement does not rewrite a finished result. A configuration with no scoring rule is 400 `CONTEST_LEADERBOARD_SCORING_RULE_MISSING` — there is no golf fallback — and a rule whose settings fail its scoring definition's schema is 400 `CONTEST_LEADERBOARD_SCORING_SETTINGS_INVALID` |

### ContestEntryStanding

An entry's result, frozen when its contest settles. One row in every sport: `totalScore` is the
settled total its position was ranked from, in the unit of the contest's scoring definition (a
golf to-par total, a race's points), so no scoring family keeps a settled-total table (#695).
`countingPickLimit` records the rule's N it settled under.

| Operation | Role | Notes |
|---|---|---|
| Write | *(settlement)* | Written once per entry when the linked event completes; settlement is its single writer. A contest already `COMPLETED` is skipped, so re-settling cannot rewrite it; a `DRAFT` (never opened) contest is skipped too and keeps its status, since a draft leaves only by being opened or deleted (#117). No route moves a contest back out of `COMPLETED` (the unused reopen, close-early and extend-deadline endpoints were deleted) |
| Read | `member` | Through the contest leaderboard of a `COMPLETED` contest |

### ContestEntryPick

A selection on an entry. **One insert path**, `ContestEntryPickService.createPick`, which
copies the contest's format onto the pick inside its transaction so the per-format unique
indexes hold (plans/117 §7.1, deleted with its epic; retrieve via
`git show c0191969^:plans/117-league-contest-substrate-redesign.md`). Its port, `ContestEntryPickRepository`, is read-only by
design (#247), so no adapter or fake can become a second way in. The selection operations
themselves are the selection room's: `SelectionService` is the shared handler (auth, the pick window,
availability, persistence), and what varies by selection type, including the tiered
replace-on-full and toggle-off rules, is a `SelectionEngine` looked up by `SelectionType`
(`selections/selection-engines/`, #198). The registry is exhaustive: every selection type has an engine (#605).

**Entries and picks change in one window**, `areContestEntriesOpen` (contests/entry-window): the
contest is `OPEN`, not yet drawn (a random draw closes entries, #601), and its event has not reached its scheduled start time, the cutoff opening a
contest also uses. The scheduled start closes the window even when the event's status update to
`IN_PROGRESS` is late. Entering, renaming, setting a tiebreaker and leaving answer 400
`CONTEST_ENTRY_LOCKED` outside it; the selection room's picks answer 409 (below). A re-entry is
numbered past the highest entry number the team holds in the contest, because leaving deletes
the team's first entry and keeps the later ones.

**An entry counts only once submitted** (#481). It is created `DRAFT`, and its owner submits it
when the lineup is complete. The leaderboard, settlement, the contest-started email and a
contest's `entryCount` read `SUBMITTED` entries alone. A draft is kept, never deleted, so its
team can still see and finish it before tee-off; one left unsubmitted at tee-off simply doesn't
count.

| Operation | Role | Notes |
|---|---|---|
| Read the selection room | `member` | `getSelectionState`. A `DRAFT` contest answers 404 `CONTEST_NOT_FOUND` to anyone but its league's commissioners and root admins, as the contest read does (#117). While the contest is `DRAFT` or `OPEN` and not yet drawn, picks are hidden from other teams (`contestPicksRevealed`): the history carries only the caller's own entries, and `entryId` names another team's entry only from `ACTIVE` on, falling back to the caller's own before that. Any active member of the entry's squad, co-owners included, reads it as their own. A tiered room lists the field by tier; a budget room lists it as one group, dearest first, and adds `lineupSummary` for the viewed entry: spent, remaining, whether it is over the cap, open places and what the cheapest available golfers would cost to fill them (#93) |
| Place, swap, unselect | squad member | `submitContestSelection`, only while the contest is `OPEN` and its event's start time has not passed (the status follows the event's move to `IN_PROGRESS`, which can lag): 409 `CONTEST_ENTRY_LOCKED` otherwise, the code the entry's own create, edit and leave answer. Re-picking a held golfer unselects it, and that works for a golfer who has since withdrawn; a new pick of a withdrawn golfer is 400 `PARTICIPANT_UNAVAILABLE`. Budget (#93): the salary cap never refuses a pick, so an entry can go over while it rearranges; a golfer with no price is 400 `PRICE_MISSING`. A change that leaves a `SUBMITTED` entry's lineup short, or over a budget contest's cap, sends it back to `DRAFT`; a swap within a full tier, or one that stays under the cap, keeps it submitted |
| Submit an entry | squad member | `submitContestEntry`, `POST /api/v1/selections/:contestId/entries/:entryId/submit` (#481), in the same window as picks (409 `CONTEST_ENTRY_LOCKED`). The lineup must hold the full roster with exactly each tier's picks: 409 `ENTRY_LINEUP_INCOMPLETE` names the short tiers otherwise. A budget lineup must also cost no more than the salary cap, summed in cents: 409 `ENTRY_OVER_BUDGET` otherwise, reported only once the lineup is complete (#93). Submitting a draft sends the "Entry submitted" email; submitting a submitted entry changes nothing |
| Run a random draw | `commissioner` | `runContestDraw`, `POST /api/v1/selections/:contestId/draw` (#601). A random-draw contest's one explicit release action, after members enter and before tee-off: the event's available field is shuffled by a fresh seed and dealt round-robin to the shuffled entries, `picksPerEntry` each; leftovers are not dealt, and withdrawn golfers never are. One transaction writes the `contest_draws` row (seed, field order, entry order, who ran it), every pick (`isAutoPicked`), and submits every entry. From then on the contest's entries are closed and its picks are public (`contestPicksRevealed`), though it stays `OPEN` until its event starts. Final: no undo, no redraw. Before the draw an entry holds no picks; any pick is 409 `SELECTION_DEALT_BY_DRAW`. 409 `CONTEST_NOT_RANDOM_DRAW`, `CONTEST_DRAW_ALREADY_RUN` (also a draw racing another), `CONTEST_DRAW_NOT_OPEN`, `CONTEST_EVENT_ALREADY_STARTED`, `CONTEST_DRAW_NO_ENTRIES`, `CONTEST_DRAW_FIELD_TOO_SMALL` (fewer available golfers than entries × `picksPerEntry`), `CONTEST_DRAW_ENTRIES_CHANGED` (an entry came or went while it dealt; nothing written) |

## Platform and operations

Cluster: `ProviderSyncRun`, `PlatformRuntimeConfig`, and the provider registry they serve.

**Every operation here is `rootAdmin`, reads included.** Neither object passes A11: a sync run
can exist because a root admin submitted it (condition 3), and a runtime-config row names the
user who last wrote it (condition 1). Nor is either tenant data — nothing here belongs to a
league. They are operational state, so both halves stay behind the claim. Each module takes
`requireRootAdmin` as one `onRequest` hook for all its routes.

**`admin` is the permission, not a place** (#205). The operations live with what they
administer: runtime settings under `/api/v1/platform`, providers and syncs under
`/api/v1/ingestion`. Nothing is left under `/api/v1/admin`: the contest-template write, the last
operation there, moved to `/api/v1/contest-config-templates` in #248, and the `admin-auth` plugin
went with it.

### PlatformRuntimeConfig — `platform`

Runtime-tunable settings groups, one JSON document each: the ingestion schedule, email (`EMAIL_CONFIG`: whether system email is sent, per-email switches,
Reply-To; see `docs/EMAIL-DELIVERY.md`), and budget pricing (`BUDGET_PRICING_CONFIG`, #93: the named pricing profiles, default first, that the Tiers page's price dialog starts from; Standard $50,000 cap / $100 unit and Small $5,000 / $10, both best 24%, worst 12%, steepness 4). Every group is owned by `AppSettingsService` (#450): each core-api task
refreshes them from the database every 30 seconds, and every save is recorded in
`platform_runtime_config_history`. Which settings belong here and which stay in env is
`rules/architecture-rules.md` §6 *Runtime settings live in the database, not in env*.

| Operation | Role | Notes |
|---|---|---|
| List, read settings groups | `rootAdmin` | `listSettingsGroups`, `getSettingsGroup` — value in use, defaults, `stored` or `defaults`, who last saved it. The `/manage/settings` page |
| Save, reset a settings group | `rootAdmin` | `updateSettingsGroup` (the whole value plus `expectedUpdatedAt`; 409 `SETTINGS_CONFLICT` if someone saved in between), `resetSettingsGroup` |
| Read a group's recent changes | `rootAdmin` | `listSettingsGroupHistory` — newest first, at most 20; the limit is the bound on an append-only history. Each value is typed by its group's schema; a change whose stored values no longer validate is logged and left out |
| Switch email, or one email, off | `rootAdmin` | `updateSettingsGroup` on `EMAIL_CONFIG`, from the Email card of `/manage/settings`. A skipped email still counts as sent |
| Read, update, reset the ingestion schedule | `rootAdmin` | `getIngestionSchedule`, `updateIngestionSchedule`, `resetIngestionSchedule` |
| Set, reset one sport's override | `rootAdmin` | `setSportIngestionOverride`, `resetSportIngestionOverride` |

### Providers and ProviderSyncRun — `ingestion`

| Operation | Role | Notes |
|---|---|---|
| List providers | `rootAdmin` | `listProviders` — each registered provider with a live health check made for the request, its scheduled sports and its active event count. There is no stored health: `ProviderHealthLog` went with the manual health check that wrote it and the provider detail that read it |
| List sync runs | `rootAdmin` | `listProviderSyncRuns` — filtered by provider, sport and status, bounded by a submission-time window (`from`/`to`, default the last 6 hours). Unpaged (§16): the window is the bound |
| Submit an event sync | `rootAdmin` | `submitEventSync` — 202 with one `SUBMITTED` run per feed; the runs execute after acceptance. An event whose `syncScope` forbids a feed is 409 |
| List unmapped competitors | `rootAdmin` | `listUnmappedProviderParticipants` — competitors a provider reports that no participant is mapped to. `bindParticipantProviderMapping` (above) repairs each |
| Browse a provider's catalog | `rootAdmin` | `listProviderCatalogEvents` — live provider events, each the full `ProviderEventDto`; without `from`/`to` it returns every event the provider has, with no window around today (#402) |

Deleted in #205, all unbuilt or unused: the health and error-log surface (service health,
infrastructure and business metrics, error search and detail, alert rules and their mute),
the ingestion dashboard, the provider detail and provider config write, the manual health
check, the one-off re-ingest (the event sync is the path), and the tables `plan_tiers`,
`migration_runs`, `commissioner_action_items`, `ingestion_jobs` and `provider_health_log`.

---

## One operation, two callers

**Scope and caller are parameters of an operation, never a reason for a second one.** Every
pair below was once modelled as separate admin and member operations, and every pair had
drifted — different guards, different response shapes, counts computed on one half only,
filters that existed on one half though they described the query rather than the caller.

| One operation | Route |
|---|---|
| Disable / enable a user | `POST /users/:userId/disable`, `/enable` |
| Delete a user | `DELETE /users/:userId` |
| Revoke a user's sessions | `POST /users/:userId/revoke-sessions` |
| Read a user | `GET /users/:userId` (`me` resolves to the caller) |
| List leagues | `GET /leagues?scope=mine\|all` |
| Inactivate / delete a league | `POST /leagues/:id/inactivate`, `DELETE /leagues/:id` |
| List squads | `GET /leagues/:id/squads` |
| List contest templates | `GET /contest-config-templates` |
| Create a contest | `POST /leagues/:id/contests` |

**A list takes an explicit scope; a path-addressed operation does not.** For an operation
whose subject is named in the path, the caller's role decides only whether they may. A list
is different: a root admin legitimately needs both their own leagues (for the selector) and
every league (for management), and one request cannot mean both. So `GET /leagues` takes
`scope`, and the role decides whether the requested scope is permitted — not which scope the
caller gets.

## Soft and hard delete both exist, and hard delete is gated

Easy to misremember as "soft delete only":

- **Inactivate** sets `isActive = false`. This is the normal path.
- **Delete permanently** is a real row removal, and it **throws unless the record is already
  inactive**. For a squad it cascades to its entries, picks, owner invitations and
  memberships; for a league it also requires typing the `leagueCode` back. Permanently deleting a league is
  `commissioner`; permanently deleting a squad is `rootAdmin` only, and inactivating one is
  `commissioner`, because it ends its owners' league memberships.

The service methods say so in their names (`deleteInactiveSquad`, `deleteInactiveLeague`),
and this is the "eligibility gating before a later hard delete" pattern of §1 *Lifecycle*.
They are **two operations, not one**; collapsing them would hide the gate.

## Deliberately absent

Each of these existed once, on one of two write paths, and was removed because a rule that
only half the callers enforce is not a rule. Do not reintroduce them.

- **No self-demotion block on root admin.** The rule it reached for — the platform keeps at
  least one root admin — is the last-root-admin count, which applies to every caller. With
  two active root admins one may step down; with one, the count refuses whoever asks. Only
  active root admins count, so administering the platform never depends on someone first
  reactivating an account.
- **No dependency-detail payload on a blocked hard delete.** A typed 409
  `ACCOUNT_DELETE_DEPENDENCIES_EXIST` is the contract. The blockers are visible in the league
  and squad views A9 already governs; resolving one of possibly many into the error envelope
  cost three queries, a payload shape and a client parser.
- **No read-only lock on an inactive account.** `isActive` is a read filter, not a write lock
  (A9), and the lock blocked the obvious recovery — correct your details, then reactivate.
- **No creator column on `League`.** Who runs a league is the `COMMISSIONER` membership that
  creation writes in the same operation — §12 *League creation establishes the first
  commissioner*. `Squad.createdBy` is a real relation and is unaffected.
- **No field-level redaction.** Admin-only fields are annotated on the canonical DTO and left
  exposed (§13). This document assigns roles to *operations*, not to fields.

Also settled by the access rules, recorded so they are not reopened: password **change**
(`self`, requires the current one) and **reset** (`rootAdmin`, does not) are two operations
distinguished by subject (A6); a commissioner performs any member operation on behalf of any
member of their league (A7); edges embed the canonical `UserDto`, and a member reads peers
through the league join.
