# Plan 145 — One Domain Object, One Set of Operations

**Tracking issue:** #201

## Purpose

A user is a user. Deleting one is a delete. Who may do it is a permission, not a different
object.

The API currently models permission as **duplication**: the same domain object gets a
second DTO, a second route surface and a second operation name depending on who is calling.
Root admin, league commissioner and member are scopes over the same objects — root admin
sees all leagues, a commissioner sees the leagues they run, a member sees the leagues they
belong to. That is a filter on rows and, at most, on fields. It is not a different object.

Implementation agents repeatedly read the `/admin` prefix as "admin needs its own objects"
and built shadow copies. The cost is compounding: every agent that arrives afterwards finds
two plausible definitions of one concept and picks one.

## Governing Principles

**One canonical DTO per concept, one operation set per object.** Permission decides who may
call an operation. It never decides whether a second operation exists.

**Row scoping belongs in the query and the authorization layer**, never in a second DTO.

**Return the full object.** Projections tailored to a page are how `owners[]` became three
fields of `members[]` under a different name. Settled by the repo owner: shapes are not
narrowed to a control's needs.

**Compare semantics, not field names.** See §5 — this rule exists because the analysis for
this plan got it wrong twice.

## Scope

In scope: the 26 operations under `/admin` that act on objects with an existing user-facing
surface — league (12), user (8), event (5), team (1) — plus the shape consolidation that
follows, and the viewer-scope model that makes it expressible.

Out of scope: the 68 genuinely administrative operations — golf catalog (36), provider
ingestion (10), platform config (10), health and metrics (9), audit (3). They have no
user-facing counterpart and are real domains. They should stop being *named* "admin", but
they are not duplicates and this plan does not collapse them.

## Key Decisions

### 1. The measured problem

185 operations: **94 under `/admin`, 91 everywhere else.** The admin surface is larger than
the rest of the product.

The clearest single case: `adminInactivateLeague` and `inactivateLeague` are the same
operation on the same object, at two endpoints, differing only in who may call it.

One admin operation already returns a shared component: `adminListLeagues` returns
`LeagueListResponse`. **That is not independent evidence — it was done in `0125a22`
(PR #194), the leagues slice of this same refactor, and only because check 1 forced it:
registering `LeagueListResponse` made every route inlining it fail CI.** It shows the
collapse is mechanically possible and survives the functional suite. It does not show it
survives time or other authors. Cite it for the mechanism, not as precedent.

User is split across three surfaces:

| Concept | `/auth` | `/account/*` (self) | `/admin/users/*` (other) |
|---|---|---|---|
| Read | `getCurrentUser` | — | `adminGetUserDetail`, `adminListUsers` |
| Disable | — | `inactivateAccount` | `adminDisableUser` |
| Enable | — | `reactivateAccount` | `adminEnableUser` |
| Delete | — | `deleteAccount` | `adminDeleteUser` |
| Password | — | `changeAccountPassword` | `adminResetUserPassword` |

Three of those rows are the same operation written twice.

### 2. Measured shape duplication

Verified field-by-field against the published contract:

- `adminListUsers.items` is **identical** to `UserProfileDto`.
- Five `account` operations return a shape **identical** to `AuthenticatedSessionUserDto`.
- `adminGetUserDetail` = `UserProfileDto` + `viewerAuthority`.
- `adminListEvents` = `EventSummaryDto` + `providerId`, `loadedParticipantCount`,
  `createdAt`, `updatedAt`.
- `adminListTeams` is `SquadDto` with `members[]` renamed `owners[]` and projected to 3 of
  10 fields, plus denormalised `leagueCode` / `leagueName`.
- `ParticipantDto` has projections at 5, 6, 13 and 14 fields across six admin-golf
  operations.

### 2a. User is the object. Member and owner are relationships.

This is the model, stated by the repo owner, and it is the key to the whole epic:

> A user is the user principal. Once invited to a league, that user is now a **member**.
> Once they name their squad, that member is also the **owner** of that squad. Owner is
> based on the relationship to a squad. Member is based on the relationship to a league.
> But the object is User.

So `member` and `owner` are not types. They are **edges** — User↔League and User↔Squad.
A relationship DTO should reference the User and carry the attributes of the edge. It
should not flatten an arbitrary subset of User into itself.

The current contract does exactly that, and with no rule — **four different answers to
"how much User do I copy in?"**:

| DTO | User identity flattened in | Relationship attributes |
|---|---|---|
| `LeagueMemberDto` | `email`, `firstName`, `lastName` | `role`, `joinedAt` |
| `SquadMembershipDto` | `firstName`, `lastName` — **no `email`** | `status`, `joinedAt`, `createdAt`, `updatedAt` |
| admin `owners[]` | `firstName`, `lastName` | — |
| `LeagueMembershipDto` | **none** — just `userId` | `role`, `status`, `joinedAt`, `createdAt`, `updatedAt` |

The consequence is concrete: **the same person's email is reachable through their league
membership and not through their squad membership.** Any consumer needing it from a squad
context has to make a second call, or someone adds `email` to `SquadMembershipDto` and the
copies drift further apart.

`LeagueMemberDto` and `LeagueMembershipDto` are additionally **two DTOs for one edge** —
the "member list view" and the "membership record".

**`LeagueMembershipDto` is already the correct shape.** It references `userId` and carries
only edge attributes. It predates this refactor — defined in `ef90117` (2026-05-30) — so
unlike the `adminListLeagues` case above, this one *is* independent evidence that the right
pattern existed here first. It is the template, not a thing to invent.

**But `LeagueMemberDto`, the flattened one, was authored in the same commit.** Both shapes
were born together. So the cause is not erosion over time or a later agent degrading an
earlier design: it is the absence of a stated rule at the point of authorship. Two shapes
for one edge looked reasonable to whoever wrote them because nothing said otherwise.

That matters for the fix. A cleanup alone restores consistency once and leaves the same
vacuum behind. The rule has to be written down, and a guard has to enforce it, or the next
agent authors the fifth partial copy for the same reason the first four exist.

Target shape for an edge:

```
LeagueMembership { leagueId, userId, role, status, joinedAt, … }   // the edge
SquadMembership  { squadId, userId, status, joinedAt, … }          // the edge
```

with the User resolved from `userId` — either embedded as the canonical `UserDto` where a
consumer needs it inline, or fetched. **Which of those two, and when, is an open question
below.** What is settled: there is one User shape, and an edge never redefines a subset of
it.

Note the separate concern: `TeamRelationshipDto { leagueMember, owner, commissioner }` and
`LeagueRelationshipDto { leagueMember, commissioner }` are **viewer-scoped** descriptors —
what the *caller's* relationship is — not edges between arbitrary users and objects. They
belong to the viewer-scope question in §4, and they overlap each other
(`LeagueRelationshipDto` is a strict subset of `TeamRelationshipDto`).

### 3. The four kinds of difference — none of which is "a different object"

1. **Row visibility.** Which leagues or users you can see. A query and authorization
   concern. Not a shape concern at all.
2. **Field visibility.** Admin sees `providerId`, `createdAt`, `providerMappings`. Same
   object, more fields.
3. **Viewer-scoped fields.** `teamRelationship`, `isRootAdmin`, `viewerAuthority` — computed
   per caller, named differently in every module.
4. **Arbitrary projections.** Already ruled out; return the full object.

### 4. Target

- One canonical DTO per concept: User, League, Squad, Event, Participant, Contest,
  ContestEntry.
- One operation set per object. `DELETE /users/{id}` is the delete; root-admin-only is a
  permission on it. `me` resolves to the caller.
- Projections deleted.
- Viewer-scoped fields consolidated into one consistently named sub-object, so scope is
  explicit in the model rather than implied by which URL was called.
- Field visibility resolved by one stated rule.
- Row scoping stays in the query and authorization layer.

### 5. Why this was hard to see, and the rule that follows

During the analysis for this plan, two shapes were assessed as "genuinely different
projections, not drifted copies". **Both assessments were wrong.**

`adminListTeams` looked different because its fields were **renamed** (`owners` for
`members`, `ownerCount` for `memberCount`) and **projected** (3 of 10 fields), with
denormalised parent context added. Similarity scoring by field-name overlap misses this
completely: a 3-field projection of a 10-field object scores about 0.3, far below any
sensible duplicate threshold.

**Compare semantics, not field names.** A shadow copy does not look like a copy — that is
exactly why it survived this long. Any guard built for this epic must detect subset and
rename relationships, not just near-identical field sets.

## Execution Sequence

Ordering is driven by one constraint: **#192 must not publish the duplicates as official
named components.** Its remaining modules are `admin` and `admin-golf`, which is precisely
where the shadow copies concentrate.

1. **Settle the viewer-scope model** (open question below). Everything else depends on how
   scope is expressed.
2. **User** — collapse `/auth/me`, `/account/*` and `/admin/users/*` into one operation set.
   The highest-confidence duplicates and the smallest object.
3. **League** — 12 admin operations, one of which (`adminListLeagues`) is already unified and
   serves as the template.
4. **Event and Team** — 6 operations between them.
5. **Rename the 68 remaining administrative operations** for what they are — platform,
   catalog, ingestion, ops — rather than "admin".
6. **#192 conversion** of the consolidated surface.

`account` under #192 becomes trivial at step 2: `$ref` the existing component, zero new
components published.

## Open Questions

- **Embed or reference?** An edge carries `userId`. When a consumer needs the person's
  name inline — a member list, a squad roster — does the edge embed the canonical `UserDto`,
  or does the client resolve it? Embedding is one round trip and risks re-introducing
  partial copies if anyone embeds a subset; referencing is strictly normalised but chattier
  for list views. Decide once; the answer shapes every edge DTO.
- **Viewer-scoped fields: one sub-object or computed top-level fields?** A
  `viewer: { relationship, canEdit, … }` block is explicit and greppable; top-level fields
  read more naturally. Decide once, apply everywhere.
- **Field visibility: omit, null, or always include?** With a single first-party client and
  auth-gated routes, always-include is simplest — but it publishes admin field names to
  every caller.
- **Does `/account/*` survive as a `me` alias**, or do its operations move to
  `/users/me/*`? Affects the frontend either way; the alias is cheaper.
- **What replaces the `admin` name** for the 68 genuinely administrative operations? They
  are real domains and deserve real names.

## Sources / Prior Decisions

- #201 — this epic. #192 — the publishing mechanism, which must follow this work for
  `admin` and `admin-golf`. #193 — contest authorization, which stops being a side issue
  because permissioning is the mechanism that makes one operation set work. #195 —
  `isRootAdmin` claim consistency, same area.
- Repo owner, this session: *"I would like to use the full object, all properties. Not get
  too precise based upon the page/control needs."*
