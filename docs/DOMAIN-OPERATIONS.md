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
| **Global** | `Sport`, `SportLeague`, `EventSeries`, `SportEvent`, `SportEventRound`, `SportEventTier`, `Participant`, `ParticipantProviderMapping`, `ParticipantLeagueAffiliation`, `ParticipantRankingSnapshot`, `SportEventParticipant` and its standing, round and valuation rows, `ContestConfigTemplate` |
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
league administration, and squad affiliation for anything done on a squad's behalf, entries
included. Each one resolves the resource's league from the database and reads the caller's
membership there.

### Why A10 does not transfer

A10 reads root-admin authority from a claim, and someone reading it could reasonably conclude
that claims are how authority works here. They are not; A10 is the exception, and the line is
**a global property of the user versus a relation to data**, not tolerance for staleness.

| | Root-admin authority (A10) | League and squad membership |
|---|---|---|
| Shape | one global property of the user | a relation between a user and a specific resource |
| Needs data to interpret | no | yes — which league owns this contest, this squad |
| Changes | effectively never within a session | constantly, and by side effect: ADR-0004 removes league access when a team is inactivated |
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
ADR-0004's implicit removal makes it harder, not easier. Without it, saving the query introduces
a gate that keeps granting access to a league the user was removed from.

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

## Slice 2 — Events and participants (the cross-sport core)

Cluster: `Sport`, `SportLeague`, `EventSeries`, `SportEvent`, `SportEventRound`,
`SportEventParticipant`, `SportEventParticipantRound`, `SportEventParticipantStanding`,
`SportEventTier`, `SportEventParticipantValuation`, `Participant`,
`ParticipantProviderMapping`, `ParticipantLeagueAffiliation`, `ParticipantRankingSnapshot`.
Core tracked by #235, golf extensions and the admin operations by #236. Decisions: the
stage-2 comment on #203. The tree `SportLeague → EventSeries → SportEvent` is plans/147 — deleted with its
epic, retrieve via `git show 7e892f52:plans/147-event-series-and-the-season-collapse.md`: an
event is one edition of a series, in one event year, and the series is its only parent.

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
| List | `authenticated` | `listEvents`, filtered by sport, status, sport league (through the series), event year and a name search, unpaged (§16). Returns the canonical `SportEventDto` — the row plus `loadedParticipantCount`, `tierCount`, `contestCount`, contest-setup readiness and `allowedTransitions` — to every caller |
| Read one | `authenticated` | `getEvent` |
| Create | `rootAdmin` | `createEvent` (manual) or `createEventFromProviderEvent` (linked for scores), on a sport league in an event year. The series is found or created by name; a second edition of a series in one year is 409 `EVENT_EDITION_ALREADY_EXISTS` — the database's `(eventSeriesId, eventYear)` constraint. The sport comes from the sport league; golf only for now, 422 `SPORT_NOT_SUPPORTED` otherwise. Seeds the rounds and the default tiers. Provider sync never creates an event: it updates the one linked to a provider event and skips the rest |
| Clone an event year | `rootAdmin` | `cloneEventYear` re-creates each of a sport league's events in one year as next year's edition (or `targetYear`'s), dates shifted; never the field, tiers, scores or provider link. 422 `EVENT_YEAR_HAS_NO_EVENTS` for an empty source year, 409 `EVENT_YEAR_NOT_EMPTY` for a target year that has events. Leaves the current event year alone |
| Update | `rootAdmin` | 409 `EVENT_NOT_ADMIN_MANAGED` once a provider owns the event in full |
| Delete | `rootAdmin` | 409 `EVENT_HAS_CONTESTS`. Deletes the event's rounds and tiers first — before #236 it failed on the foreign key for any event that had them |
| Transition, link / unlink the score source | `rootAdmin` | `transitionEvent`, `linkEventScoreSource`, `unlinkEventScoreSource` |

### SportEventRound, SportEventTier

Children of an event; always reached through it.

| Operation | Role | Notes |
|---|---|---|
| List for an event | `authenticated` | `listEventRounds` in `roundNumber` order; `listEventTiers` in `tierNumber` order |
| Reschedule rounds | `rootAdmin` | `updateEventRounds` |
| Replace tiers | `rootAdmin` | `replaceEventTiers`. 409 `TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS` unless `reassignOrphansTo` names a tier that survives |

### SportEventParticipant — the Participant↔SportEvent edge

Carries `ranking` (the rank that applied at this event), `seedNumber`, `oddsToWin`, and an
`inactiveReason` of `WITHDRAWN` or `ELIMINATED` (null: inactive, no reason recorded).

| Operation | Role | Notes |
|---|---|---|
| List for an event | `authenticated` | `listEventParticipants`. Embeds the canonical `Participant`, the valuation, the standing and each round, with their golf rows. One read serves the field grid, the tier board and the score corrections |
| Add, edit, remove | `rootAdmin` | `addEventParticipants`, `updateEventParticipants` (price included), `removeEventParticipant` — 409 `EVENT_PARTICIPANT_HAS_PICKS` once a contest entry picked it |
| Seed from the sport league, refresh from the provider | `rootAdmin` | `seedEventParticipants` (golf only for now); `refreshEventParticipants` queues a provider sync (202) |

**Golf surfaces render `ELIMINATED` as "Cut"** (decision 1). That is a display mapping, not
a stored value: `formatParticipantStatusLabel` in the shared domain, used by every surface
that shows the status.

### SportEventParticipantRound, SportEventParticipantStanding — base rows

The per-round join and the running standing. **The score lives in the sport extension**
(`SportEventParticipantGolfRound`, `SportEventParticipantGolfStanding`), keyed 1:1 to these.

| Operation | Role | Notes |
|---|---|---|
| Read for an event | `authenticated` | Through `listEventParticipants`. Standing `position` is the cross-sport rank key and is direction-free: **1 is best in every sport.** A reader ranks on it and joins the extension only to display a score |
| Write | *(scoring feed or `rootAdmin`)* | Written base-then-extension in one nested write. Golf corrections: `previewEventGolfRoundScores`, `applyEventGolfRoundScores`, `updateEventParticipantGolfRoundScore` — 422 for a non-golf event |
| Rank | *(every score write)* | `position` and `displayPosition` are computed from the extension's score after each write — the feed or a correction — across the whole event, so no reader re-derives them (#246). Ties share a position and display as "T3"; a withdrawn or eliminated golfer is unranked. The provider supplies no live rank to copy |

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

**Price and tier get the same answer.** `price` is published but inert today: it is shown
on the draft board and in the configuration editor, and nothing enforces a budget until
budget picks (#93) are built. When they are, the price a budget contest spends against is
still the event's, by the ruling above. #93 does not get to re-key it on its own.

| Operation | Role | Notes |
|---|---|---|
| Read for an event | `authenticated` | On each `listEventParticipants` row |
| Auto-assign tiers, replace assignments, auto-assign prices | `rootAdmin` | `autoAssignEventTiers` (source `ODDS` or `RANKING`), `replaceEventTierAssignments`, `autoAssignEventPrices` |

### Participant

| Operation | Role | Notes |
|---|---|---|
| List / search | `authenticated` | Filtered by sport, status, `role` and more, unpaged (§16). `role` is the playing role ("GOLFER"); it was `position` until #246, which left `position` meaning rank alone |
| Read one | `authenticated` | |
| Create, update | `rootAdmin` | **A10** · 403 `ROOT_ADMIN_ACCESS_REQUIRED` from the claim. Before #235 any signed-in user could create or rename a catalog participant |

### ParticipantProviderMapping, ParticipantRankingSnapshot

Provider plumbing. Written by sync; read and repaired by `rootAdmin`. #236 adds one read,
`listParticipantProviderMappings` (`authenticated`, like every catalog read), for the player
page — the mapping count the golf player list carried is gone. #205 adds the repair:
`bindParticipantProviderMapping` (`rootAdmin`, `POST /participants/:id/provider-mappings`) binds
a provider's identifier to the participant with `MANUAL` confidence, moving it if another
participant held it; 404 `PROVIDER_NOT_FOUND` for a provider that is not registered. It
replaced `adminMapParticipant`, which took both ids in the body under `/admin/providers`.

## Slice 3 — Contests and entries

Cluster: `ContestConfigTemplate`, `Contest`, `ContestConfiguration`, `ContestEntry`,
`ContestEntryPick` and the scoring and prize rules under a configuration. Tracked by #244–#248
under #201; decisions: the stage-2 outcome in plans/145, retrieved via
`git show 020de6bf:plans/145-one-object-one-operation-set.md`.

**`ContestConfigTemplate` is global (A11); everything else here is tenant-scoped** — it
belongs to a league through its contest.

### ContestConfigTemplate

A seeded starting configuration for a contest. Keyed by sport, contest format, selection type
and an optional event type.

| Operation | Role | Notes |
|---|---|---|
| List | `authenticated` | `listContestConfigTemplates` (#245). Every filter optional — `sport`, `contestFormat`, `eventType`, `active`; an `eventType` narrows to that type plus the templates for any event type. One read for the create flow and the root-admin screens |
| Update | `rootAdmin` | `updateContestConfigTemplate`, `PUT /api/v1/contest-config-templates/:templateId`, guarded by `requireRootAdmin` like every other global-object write. Seeded rows only; there is no create or delete. Until #248 it was `adminUpdateContestConfigTemplate` under `/api/v1/admin`, the last route there |

### Contest

| Operation | Role | Notes |
|---|---|---|
| Create | `commissioner` | `createContest` (#245) — the one way a contest is made. Takes `name`, `sportEventId`, `contestFormat` (`ROSTER`), `selectionType` (`TIERED` until another selection type has a typed configuration, #93/#99), and a `templateId`, a `configuration`, or both. With both, the template is recorded as provenance and the configuration replaces the template's whole — no merge. Neither: 400 `CONTEST_CONFIGURATION_REQUIRED`. A template that is missing, inactive, or of another format or selection type: 422 `CONTEST_CONFIGURATION_INVALID`. The event must be released and its field loaded (422 `SPORT_EVENT_*`). Answers 201 with the canonical contest read |
| Read configuration | `commissioner` | `getContestConfiguration` (was `getManagedContest` until #248): the contest with its configuration and the tiers it inherits from its event, what the configuration editor reads |
| Update configuration | `commissioner` | `updateContestConfiguration` (was `updateManagedContestConfiguration` until #248). Refused with 409 `CONTEST_CONFIGURATION_SETTLED` while the contest is `COMPLETED` (#246): the settled result is frozen against the configuration it settled under. Reopening the contest (commissioner-gated) is the path back |
| Reopen, close, extend the deadline, move the lock | `commissioner` | `reopenContest`, `closeContest`, `extendContestDeadline`, `updateContestLockTime`. None takes a `reason`: each accepted one and discarded it, and #248 took it off the contract once the audit log it was documented as feeding was gone (#255) |
| List for a league | `authenticated` today | `listContests`. **No league check** — any signed-in user can list any league's contests; contest authorization is #193, which does not yet list this route. Each row carries `entryCount`; until #247 the league-scoped list reported 0 for every contest, because its service was built without the entry reads |
| Delete | `authenticated` today | `deleteContest`, `DRAFT` only. **No league check** (#193, held for discussion: any signed-in user can delete any `DRAFT` contest). Takes the entries, picks, draft state, configuration and the configuration's scoring rules and prize definitions with it; before #247 a configuration with a scoring rule made the delete fail |
| Start | *(event lifecycle)* | When its event moves to `IN_PROGRESS`, every `OPEN` or `LOCKED` contest on it becomes `ACTIVE` in one guarded write, and its commissioners and entrants are emailed once; a re-sent transition finds nothing left to start |
| Read the golf leaderboard | `member` | `getGolfContestLeaderboard`, answering the cross-sport `ContestLeaderboardResponse` (#248): entry standings (`ContestEntryStandingDto`, with the golf total on its golf extension), the event's field as its own `SportEventParticipantDto` rows, and `scoringDefinitionId` — the definition it was ranked by, which a client renders scores and rounds through. Golf only today. Live contests compute from event scores; a `COMPLETED` contest answers from its `ContestEntryStanding` rows (#246), so a score correction after settlement does not rewrite a finished result. A configuration with no scoring rule is 400 `CONTEST_GOLF_LEADERBOARD_SCORING_RULE_MISSING` — there is no golf fallback |

### ContestEntryStanding

An entry's result, frozen when its contest settles — cross-sport core plus a sport extension
(`ContestEntryGolfStanding`, holding `totalScoreToPar`), the same split as the event standing.
`countingPickLimit` records the rule's N it settled under.

| Operation | Role | Notes |
|---|---|---|
| Write | *(settlement)* | Written once per entry when the linked event completes; settlement is its single writer. A contest already `COMPLETED` is skipped, so re-settling cannot rewrite it; reopening moves it back to `ACTIVE`, and the next settlement recomputes |
| Read | `member` | Through the golf leaderboard of a `COMPLETED` contest |

### ContestEntryPick

A selection on an entry. **One insert path**, `ContestEntryPickService.createPick`, which
copies the contest's format onto the pick inside its transaction so the per-format unique
indexes hold (plans/117 §7.1, deleted with its epic; retrieve via
`git show c0191969^:plans/117-league-contest-substrate-redesign.md`). Its port, `ContestEntryPickRepository`, is read-only by
design (#247), so no adapter or fake can become a second way in. The selection operations
themselves — including the tiered replace-on-full and toggle-off rules — are the draft room's,
and move to #198's `SelectionEngine`.

## Slice 4 — Platform and operations

Cluster: `ProviderSyncRun`, `PlatformRuntimeConfig`, and the provider registry they serve.
Tracked by #205 under #201; decisions: the slice 4 outcomes in plans/145, retrieved via
`git show 020de6bf:plans/145-one-object-one-operation-set.md`.

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

Two runtime-tunable documents: the client poll intervals and the ingestion schedule.

| Operation | Role | Notes |
|---|---|---|
| Read, update, reset poll intervals | `rootAdmin` | `getPollIntervals`, `updatePollIntervals` (a partial patch), `resetPollIntervals` |
| Read, update, reset the ingestion schedule | `rootAdmin` | `getIngestionSchedule`, `updateIngestionSchedule`, `resetIngestionSchedule` |
| Set, reset one sport's override | `rootAdmin` | `setSportIngestionOverride`, `resetSportIngestionOverride` |

### Providers and ProviderSyncRun — `ingestion`

| Operation | Role | Notes |
|---|---|---|
| List providers | `rootAdmin` | `listProviders` — each registered provider with a live health check made for the request, its scheduled sports and its active event count. There is no stored health: `ProviderHealthLog` went with the manual health check that wrote it and the provider detail that read it |
| List sync runs | `rootAdmin` | `listProviderSyncRuns` — filtered by provider, sport and status, bounded by a submission-time window (`from`/`to`, default the last 6 hours). Unpaged (§16): the window is the bound |
| Submit a sport sync, an event sync | `rootAdmin` | `submitSportSync`, `submitEventSync` — 202 with one `SUBMITTED` run per feed; the runs execute after acceptance. An event whose `syncScope` forbids a feed is 409 |
| List unmapped competitors | `rootAdmin` | `listUnmappedProviderParticipants` — competitors a provider reports that no participant is mapped to. `bindParticipantProviderMapping` (above) repairs each |
| Clean up stale provider events | `rootAdmin` | `cleanupStaleProviderEvents` — `DRY_RUN` inventories, `EXECUTE` deletes the unblocked; an event a contest references is never deleted |
| Browse a provider's catalog | `rootAdmin` | `listProviderCatalogEvents` — live provider events, each the full `ProviderEventDto` |

Deleted in #205, all unbuilt or unused: the health and error-log surface (service health,
infrastructure and business metrics, error search and detail, alert rules and their mute),
the ingestion dashboard, the provider detail and provider config write, the manual health
check, the one-off re-ingest (the event sync is the path), and the tables `plan_tiers`,
`migration_runs`, `commissioner_action_items`, `ingestion_jobs` and `provider_health_log`.

---

## What this document settles

Several pairs modelled as separate admin and member operations were **one operation with
two callers**. All of them are now collapsed; the table is kept as the record of what was
split and what it became.

| One operation | Was split as | Now |
|---|---|---|
| Disable a user | `inactivateAccount` + `adminDisableUser` | `POST /users/:userId/disable` |
| Enable a user | `reactivateAccount` + `adminEnableUser` | `POST /users/:userId/enable` |
| Delete a user | `deleteAccount` + `adminDeleteUser` | `DELETE /users/:userId` |
| Revoke a user's sessions | logout + `adminForceLogout` | `POST /users/:userId/revoke-sessions` |
| Read a user | `getCurrentUser` + `adminGetUserDetail` | `GET /users/:userId` (`me` resolves to the caller) |
| List leagues | `listLeagues` + `adminListLeagues` | `GET /leagues?scope=mine\|all` |
| Inactivate a league | `inactivateLeague` + `adminInactivateLeague` | `POST /leagues/:id/inactivate` |
| Delete a league | `deleteLeague` + `adminDeleteLeague` | `DELETE /leagues/:id` |
| List squads | `listLeagueSquads` + `adminListTeams` | `GET /leagues/:id/squads` (the admin half deleted, no caller) |
| List contest templates | `listManagedContestTemplates` + `adminListContestConfigTemplates` | `GET /contest-config-templates` (#245) |
| Create a contest | `createContest` + `createManagedContest` | `POST /leagues/:id/contests` (#245) |

Scope is a **parameter of the operation** — exactly as the DAO already expresses it, where
`LeagueRepository.findAll()` is the unscoped read and `findByUser` the scoped one.

**Correction (2026-09-27, while implementing the league collapse).** This previously said
scope is "resolved from the caller's role". That is right for the User operations, where the
subject is named in the path and the role only decides whether you may. It is wrong for a
list: a root admin legitimately needs **both** scopes — their own leagues for the league
selector, every league for the management surface — and one request cannot mean both. So
`GET /leagues` takes an explicit `scope`, and the caller's role decides whether the requested
scope is permitted rather than which scope they get. Role-implicit scope is not a general
rule; it is what a path-addressed operation happens to allow.

**What the league collapse found, recorded because it is the pattern.** As with the User
pairs, the two halves disagreed about more than scope:

- **Counts.** The member-scoped list called the mapper with no counts, so every league it
  returned reported `memberCount: 0` and `activeContestCount: 0`; only the root-admin list
  computed them. Latent — no surface displayed the member list's counts — but it is two
  answers to one question.
- **Filters.** `search` and `isActive` existed only on the root-admin half, though they
  describe the query rather than the caller.
- **Audit.** Only the root-admin half wrote an audit entry. #202 settled it by keying the
  entry on the actor, as `UserService` did; #255 then deleted the audit feature outright, so
  neither half writes one.
- **Nothing else.** `requireCommissioner` already granted root admins, so the `/admin/leagues/*`
  routes were never the only way a root admin could act — they added the audit entry and
  otherwise duplicated behaviour.

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
stays, along with the `createdSquadCount` guard. The `TEAM_OWNER` dependency *type* is gone
with the rest of the dependency-detail payload — see below.

Creator provenance is not a concept this product needs. Who runs a league is the
`LeagueMembership` with `role = COMMISSIONER`, which league creation already writes.

Dropping it: remove the column (migration), the field from `League` in
`packages/shared/domain/types.ts`, the mapping in `prisma-league-repository.ts`, and the
DTO field emitted by `admin/league-service.ts`. `input.createdBy` **stays** as a parameter
of the create operation — it is the userId that becomes the first commissioner.

### Three guards dropped while implementing slice 1 (2026-09-26)

Each existed in exactly one of the two User write paths, which is what made them worth
looking at: a rule that only half the callers enforce is not a rule.

**1. The self-demotion block on `setRootAdmin` is gone.** `admin/user-service.ts` rejected
`isRootAdmin = false` when the subject was the caller, with a 400
`SELF_ROOT_ADMIN_CHANGE`, *before* the last-root-admin count ran. The rule it was reaching
for is "the platform must keep at least one root admin", and that is what the
last-root-admin guard already enforces — for every caller, not just for the self case. With
two root admins, one stepping down is a legitimate operation and the count permits it; with
one, the count rejects it whoever asks. The self check added no protection, only a second
error code the UI had to handle and a rule the account path did not have.

**2. The dependency-detail payload on a blocked hard delete is gone.** `deleteUser` resolved
the first blocking row into `{ dependencyType, team, league }` and shipped it in the error
envelope, so the UI could render "still an owner of team X in league Y" with links. Three
extra queries, a payload shape, a client-side parser and a discriminated type, to name one
of possibly many blockers — and only on the admin path; self-delete returned the typed 409
alone and always had. A typed 409 `ACCOUNT_DELETE_DEPENDENCIES_EXIST` is the contract; the
blockers themselves are visible in the league and squad views that A9 already governs.

**3. The read-only lock on inactive accounts is gone.** See A9: `isActive` is a read filter,
not a write lock. `account/service.ts` rejected profile, username, preference and password
writes to an inactive account with a 409 `ACCOUNT_INACTIVE_READ_ONLY`; the admin path
imposed no such thing, and the lock blocked the obvious recovery — correct your details,
then reactivate.

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
