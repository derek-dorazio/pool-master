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

## Working Rules For This Pass

Set by the repo owner. They bound what this work may and may not do.

1. **Surface conflicting model concepts — do not resolve them silently.** Conflicting object
   names, relationship names, shadow objects that look alike: report them and ask, *and*
   propose the change that makes sense. Open questions live at the foot of this plan.
2. **The database, entity and DAO layer is the source of truth.** Assume it is imperfect —
   it may have drifted, it almost certainly does not model admin operations well, and it may
   not carry the full operation set. Anchor on it anyway; it is the cleanest model available.
   Highlight every gap rather than papering over it.
3. **No lean projections.** Every page uses the full object. `LeagueDto` is `LeagueDto`
   everywhere; a page that needs four fields renders four fields. Wire size is not a concern
   here, and tailored projections are how the shadow copies started.
4. **Admin-only fields and functions are NOTED, not enforced.** Routes get permissioned to
   root admin — that part is easy and in scope. Field-level trimming for commissioners and
   members has no solution yet, and inventing one now is forbidden: the "admin-only mindset"
   is the single biggest cause of the duplication being cleaned up. Mark admin-only
   properties on the DTO and move on. **Accepting some field-exposure risk is a deliberate
   trade** in exchange for reaching one model end to end. Nobody creates a new object or a
   new field projection during this pass.

5. **No shadow or derived object may be created — and permission will not be given.**
   Not a new DTO for a variant view, not a projection, not a "just for this page" shape, not
   an `AdminXDto` beside an `XDto`. If the model appears to lack something, that is not a
   licence to work around it.

   **A gap is a requirement.** Bring it back as: *what is the new concept, and where does it
   fit in the core domain model?* The answer changes the model — a new entity, a new edge, a
   new field, a new operation — or it turns out the concept already exists under another
   name. Both outcomes are progress. Inventing a parallel shape is not, and is how every
   duplicate documented in this plan came to exist.

   This rule outlives the pass. It is a candidate for `rules/*.md` codification before this
   plan is deleted (ADR-0002). **Codified** as §14 of
   `rules/domain-model-conventions-rules.md`.

6. **Residue must be removed, not just identified.** Repeatedly the finding has been *"the
   correct mechanism already exists — it just wasn't used."* That does not close the
   finding; removing the bypass does. A slice is not done while both paths ship.

   > "So many times your answer is yes that already exists, but it wasn't used. I want all
   > of the residue removed." — repo owner, 2026-09-26

   Seven measured instances in the identity cluster alone, from a dead mapper to a
   forgeable identity read. **Codified** as §15 of
   `rules/domain-model-conventions-rules.md`, which carries the table; the last phase-1
   step of every slice is a residue sweep (step 3.6 below).

The goal of this pass is a single end-to-end flow — UI → route → DTO → service → DAO →
schema — over one set of objects and one set of operations. Everything else waits.

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

Out of scope: the 32 genuinely administrative operations — provider ingestion and sync
(12), platform health and metrics (12), operational config (8: poll intervals, ingestion
schedule). Nothing user-facing reads those. They should stop being *named* "admin", but
they are not duplicates and this plan does not collapse them.

### 0a. Correcting a classification error made while writing this plan

An earlier draft put the 40 golf operations in the out-of-scope bucket as "golf catalog
administration — a real catalog domain". **That was wrong, and wrong in exactly the way
this epic is about: they were classified by who writes them rather than by what object
they act on.**

The model those operations administer is not an admin domain. It is **Golf's domain model —
a strongly typed specialization of Event and Participant**:

| General | Golf specialization |
|---|---|
| `Event` | golf tournament |
| `Participant` | golf player |
| `EventParticipant` | tournament roster entry |

Members read this model constantly. Squads build contest entries by picking players;
contests are *for* events and show event details; picks come from event participants; the
scoreboard shows participant scores. They simply do not write it.

Verified against the published contract — every shared component in this model is served by
a **non-admin** operation:

| Component | Served by |
|---|---|
| `ParticipantDto` | `listParticipants`, `getParticipant`, `createParticipant`, `updateParticipant` |
| `EventSummaryDto` | `listEvents` |
| `GolfLeaderboardResponse` | `getGolfContestLeaderboard` |

Meanwhile the admin-golf operations carry **projections of those same shapes** — 5, 6, 13
and 14 fields of an 18-field `ParticipantDto` — inline and unregistered.

So "administering golf events" is a **function** over the shared model, not a separate
domain, and these operations belong in scope. The corrected split:

| Bucket | Ops |
|---|---:|
| **A — shared domain objects** (user 8, league 3, event 3, squad 1, golf model 40) | **55** |
| **B — genuinely admin-only** (sync/providers 12, platform ops 12, operational config 8) | **32** |
| **C — config written by admin, read by consumers** (contest templates 2, golf tiers/pricing 5) | **7** |

This also matters beyond golf. Golf is the first sport; the general/specialized relationship
is how the next sport attaches to the same `Event` and `Participant` objects. Getting it
right once is what makes a second sport additive.

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

### 2y. Why the route layer drifted: the DAO does not cover the model

The DAO is the right anchor, and it is also the proximate cause of the drift — because it
**stops exactly where the shadow DTOs begin**.

**14 of 46 models have a repository port.** The covered set is `User`, `League`,
`LeagueMembership`, `Squad`, `SquadMembership`, `SquadOwnerInvitation`, `LeagueInvitation`,
`Sport`, `Season`, `Participant`, `ParticipantProviderMapping`, `Contest`, `ContestEntry`,
`DraftSession`.

Uncovered — including the entities central to everything a member does:

| Entity | Why it matters |
|---|---|
| `SportEvent` | contests are *for* events |
| `SportEventParticipant` | picks come from these |
| `ContestEntryPick` | the entry itself |
| `SportEventGolfTier`, `…GolfRound`, `…GolfStanding`, `…GolfValuation` | the golf model members read |
| `ContestConfiguration`, `ContestConfigTemplate` | what shapes a contest |
| `SportLeague`, `RefreshToken` | |

And coverage alone overstates it: **`UserRepository` has no list or search** — only
`findById`, `findByEmail`, `create`, `update`, `delete`. So `adminListUsers` cannot use it,
and `admin/user-service.ts` calls `prisma.user.findMany()` directly.

The consequence shows up cleanly when services are counted by how they read:

| Service | repo calls | raw prisma |
|---|---:|---:|
| `squads/owner-invitation-service` | 31 | 2 |
| `squads/service` | 24 | 2 |
| `leagues/invitation-service` | 16 | 3 |
| `contests/service` | 12 | 13 |
| **every `admin/*` service** | **0** | 2–27 |
| **every `golf/*` service** | **0** | 6–24 |
| `account`, `auth`, `sport-catalog`, `events` | **0** | 5–14 |

**The correlation with DTO quality is near-perfect.** The repo-backed modules — squads,
leagues — have the clean DTOs, including `LeagueMembershipDto`, the one correctly shaped
edge in the contract. The repo=0 modules are where every shadow copy and projection lives.

That is the mechanism, end to end:

> No port for the entity → the service goes straight to Prisma → nothing constrains the
> shape it returns → each service invents its own → the same entity acquires several DTOs.

So "the DAO is the source of truth" is the right principle and **not yet true in practice**.
Making it true is the first half of this epic: extend the ports to cover the model and the
full operation set (including the unscoped `findAll`-style reads admin needs), then make
services use them. The DTOs then have something to derive from.

### 2z. The canonical model already exists — it is `schema.prisma`

The entity layer never had this duplication. **The route layer invented it.** 46 models, and
the domain layer is disciplined:

| Concept | Entity | Invented at the DTO/route layer |
|---|---|---|
| User | `User` — **one** | `UserProfileDto`, `AuthenticatedSessionUserDto`, `adminListUsers.items`, `adminGetUserDetail` |
| User↔League edge | `LeagueMembership` — **one** | `LeagueMemberDto` **and** `LeagueMembershipDto` |
| User↔Squad edge | `SquadMembership` — **one** | `SquadMembershipDto`, admin `owners[]` |
| Golf player | **`Participant`** — `golf-player-service.ts` writes `tx.participant.create()` | `ParticipantDto` plus projections at 5, 6, 13 and 14 fields |

**There is no `GolfPlayer` model. No `LeagueMember` model. No `AdminUser` model. No `Owner`
model.** Those names exist only in DTOs and route paths.

The golf specialization is likewise already modelled correctly, and says so in its naming:

```
SportEvent             <- SportEventGolfTier
SportEventParticipant  <- SportEventParticipantGolfRound
                       <- SportEventParticipantGolfStanding
                       <- SportEventParticipantGolfValuation
```

Each golf table names itself as an extension of the general entity it specializes.

**This gives the epic a fixed target rather than a designed one.** The canonical model is
not something to invent in this work; it is to be *recovered*. And it yields a mechanical
rule, checkable at authorship rather than by judgement:

> A DTO names an entity or an edge in `schema.prisma`. A DTO whose name has no
> corresponding model is the signal that it was invented at the route layer.

That rule would have caught `LeagueMemberDto`, `owners[]`, and every golf-player projection
on the day they were written — which is precisely what §2a shows was missing.

**Possible schema drift, unverified:** `AdminAuditEntry` and `CommissionerAuditLog` are the
one pair in 46 that might be the same idea twice. Platform-level and league-level audit
plausibly differ in retention and visibility, so this may be deliberate. Not investigated;
flagged only so it is not assumed clean.

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

**Correction — an earlier draft claimed both shapes were "authored in the same commit",
inferring that the cause was the absence of a stated rule at the point of authorship. That
inference was wrong.** They share `ef90117` because `ef90117` is the repository's **root
commit** — 1,283 files, 307,057 insertions, no parent. Everything present at import shares
that SHA; it says nothing about authorship sequence.

The real finding is stronger. **`rules/domain-model-conventions-rules.md` §8 already states
the rule** — "One canonical DTO per entity", with per-page variants forbidden and
`LeagueSummaryDto` / `LeagueDetailDto` named as the explicit counter-example. Both of those
are registered components in the published contract today.

So this is not a vacuum. A convention was written down, in the right file, with the exact
violating pair named — **and it did not prevent any of this.** That changes what the fix
has to be: restating the rule is demonstrably insufficient, so the enforcement must be
mechanical. §2z gives the check — a DTO whose name has no corresponding entity or edge in
`schema.prisma` was invented at the route layer — and that is computable from the committed
artifacts, like the five guards #192 already ships.

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
overlap each other (`LeagueRelationshipDto` is a strict subset of `TeamRelationshipDto`),
and both are resolved by §2b.

### 2b. Viewer context is delivered once per league — SETTLED, and it is A8

Settled with the repo owner 2026-09-26. **The full reasoning, the evidence and the rule live
in `docs/DOMAIN-OPERATIONS.md` under A8**, which survives this plan's deletion (ADR-0002).
Recorded here because it is the largest model decision in slice 1 and half the shadow
inventory depends on it.

The short version. Five encodings of one idea — `leagueRelationship`, `memberType`,
`isRootAdmin`, `teamRelationship`, `viewerAuthority` — sat as fields *on the domain object*,
so two requesters got different `LeagueDto` values for the same league. That makes the DTO
not a value of the entity, and it is the same mistake as the admin/member DTO split, one
layer down.

What resolved it was the repo owner's observation that the webapp is a single-page app
holding league context in client state, and that **the mechanism already exists**: every
route is `/league/:leagueCode/…`, `resolveDefaultLeagueCode()` picks the landing league from
a cookie, `LeagueSelector` switches it, and selecting a league already fetches
`getLeagueByCode` once into `QueryKeys.leagues.detail(leagueCode)`. TanStack Query is the
store, deliberately, with no Zustand mirror.

So the viewer's league context is **already delivered in one round trip and cached**. Every
other response carrying it is duplication. A8's table says which surface carries what; the
only genuine exception is the leagues *list*, which is inherently N leagues and takes the
viewer's `LeagueMembership[]` as one array rather than a field per row.

No new DTO is invented — the viewer's context is `UserDto` + `LeagueMembership[]` +
`SquadMembership[]`, all canonical already. That is working rule 5 landing the way it is
supposed to: the apparent gap already existed under another name.

`isRootAdmin` needs no new mechanism at all. `auth-provider.tsx:175` has exposed
`auth.isRootAdmin` from the cached user the whole time, and `app-shell.tsx` reads it at line
49 while reading `activeLeague?.isRootAdmin` at line 64. It is pure residue (rule 6, §15).

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
- Viewer-scoped fields **off the domain DTOs entirely**, delivered once per league context
  as the viewer's own `UserDto` + memberships (§2b, A8). Superseded the earlier target of
  "consolidated into one consistently named sub-object" — that would still have left
  `LeagueDto` varying by requester.
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

## How a slice runs — Review, Clarify, Execute

**The findings recorded above are not a backlog to work through. They are evidence that the
approach is needed.** Exhaustively auditing the whole model up front does not work — every
pass through it has turned up something the previous pass missed, including two
classification errors of my own. Discovery belongs *inside* each slice, where the context is
loaded and the answer is checkable.

Every slice runs the same three stages, in order, and does not skip ahead.

### Stage 1 — Review the model and its shadows

**1.0 — Draw the DAO domain model first.** Before any shadow-hunting, produce a diagram of
the cluster as the schema and ports actually define it: entities, attributes that carry
meaning, associations, cardinalities, and the constraints that encode business rules. A
Mermaid `erDiagram` in the slice issue is the format — it renders in GitHub and travels with
the work.

This grounds everything that follows. It is also where the cheapest findings surface:
drawing the identity cluster immediately exposed a foreign key with no relation, a uniqueness
constraint nobody had written down, and the reason one DTO field is called `owners`. Those
came from drawing it, not from searching for them.

The diagram is reviewed with the repo owner **before** stage 1 continues. Everything after
this step is measured against it.

Then, for the slice's entity cluster and only that cluster:

- **Inventory the real model.** The entities and edges in `schema.prisma`, and what the DAO
  ports actually offer for them.
- **Find the shadows.** Every DTO, route shape and projection claiming to represent those
  entities. Compare **semantics, not field names** — a renamed 3-field projection of a
  10-field object scores ~0.3 on any similarity measure and will be missed (§5).
- **Decide the single model.** One DTO per entity, one per edge, named for the schema.
- **Decide how deep the change goes.** Does this cluster need schema changes, or only DAO
  additions? Or is the schema right and only routes and DTOs are wrong? **Say which, with
  evidence, before writing anything.**

Output: the canonical model for the cluster, the list of shadows it replaces, and the layer
the change starts at.

### Stage 2 — Clarify what might be wrong or misunderstood

Stage 1 will surface concepts that are ambiguous, overloaded, or possibly modelled wrong.
**These stop the slice and come to the repo owner** (working rule 1) — with a proposal, not
just a question.

The kinds of thing that belong here, from what stage 1 has already produced elsewhere:
overloaded names (`League` the fantasy league vs `SportLeague` the tour), an entity called
one thing and exposed as another (`Squad` vs `teams[]`), two models that may be one idea
(`AdminAuditEntry` vs `CommissionerAuditLog`), sport particulars sitting in the cross-sport
core (Q0).

Output: answered questions, and a model the owner has agreed to.

### Stage 3 — Execute bottom-up

Only once stages 1 and 2 are settled, and strictly in this order:

| Step | Layer | Phase |
|---|---|---|
| 3.1 | **Schema** — migrations, if stage 1 said the schema is wrong | 1 |
| 3.2 | **DAO** — repository ports covering the cluster's entities and its full operation set, including the unscoped reads admin needs | 1 |
| 3.3 | **Services** — moved onto those ports; no service returns a shape it invented | 1 |
| 3.4 | **DTOs and routes** — one DTO per entity and edge, one operation set per object, permissioned; admin-only fields annotated, not enforced (rule 4) | 1 |
| 3.5 | **Tests** — the slice's unit, integration and functional-api tests moved onto the canonical shapes | 1 |
| 3.6 | **Residue sweep** — search the cluster for shadows and bypasses the forward work did not happen to touch (working rule 6, §15) | 1 |
| 3.7 | **Architecture write-up** — one new document: the service layers and the webapp layers, what goes in each and why, the dependencies between them (exported SDK, generated TS types), and the tests that apply to each layer, with fresh diagrams and flows | 1 |
| 3.8 | **Export** — register the canonical DTOs as named components, regenerate the client SDK (this is #192, resumed for the cluster) | boundary |
| 3.9 | **Frontend** — every surface touching the object or one of its shadows moves onto the generated type, using the full object (rule 3) | 2 |

**A slice's stage 3 stops at 3.7.** Steps 3.8 and 3.9 do not run per slice — see the phase
split below.

### Step 3.7 — the architecture write-up

Set by the repo owner 2026-09-26, after slice 1's step 3.4: *"a separate, new architecture doc
& diagram for the layers and rules for where each piece of service code goes, and why. Along
with all the layers of the webapp and what goes where and why. With dependencies such as
exported SDK and TS types... And do the same for the test organization. What type of tests go
into which folders of which test suites, and why."*

Constraints, as set:

- **One new document.** Not an edit to an existing one.
- **Written fresh.** Do not consult or mirror the existing rules and docs while writing it —
  the point is to describe the structure this refactor actually produced, so that the owner
  can review it against what they expected. A description that inherits the old documents'
  framing cannot serve that purpose.
- **Tests sit beside the layer they test.** Not a separate testing section: each layer is
  described together with the tests that apply to it, which folder and suite they live in,
  and why there rather than elsewhere.
- **Fresh diagrams and flows**, not prose alone.

It runs once, after slice 1, and is for review and discussion rather than as an input to
slices 2–4. A slice is done, for phase-1 purposes, when its schema, DAO, services, routes
and tests name the cluster's entities one way, the sweep is clean, and the phase-1 gates
are green.

### Tests follow the code they test

Codified as §1D of `rules/testing-rules.md`, set by the repo owner 2026-09-26. It changes how
the remaining steps handle tests, and it is the reason #209 shrinks rather than grows:

- **Removing code removes its tests.** Not repaired, not ported. A test against code being
  deleted is testing the wrong thing, whether or not it passes.
- **Migrating code replaces its tests.** The new implementation's test *is* the replacement.
  Its cases come from the shadow comparison already done in stage 1 — and must cover the
  **union** of the shadows' cases, not just the surviving implementation's.
- **Tests must earn their place.** Delete is the default. A test survives by being a case
  worth asserting, not by having existed — and a test that exists only to enforce the shape
  of code being deleted has no replacement owed. A case that still holds gets re-expressed at
  the layer where it is observable.
- **Defect ids are not carried forward, and are no longer required at all.** §1A's reference
  requirement is struck: the product is pre-launch, so an id on a test records the history of
  code still being written. The ~739 existing ids stay where they are rather than being
  mass-renamed, but a deleted or rewritten test's id goes with it.
- **The count is an outcome.** N implementations collapsing to one should leave about one
  implementation's worth of tests covering N implementations' worth of cases. A count that
  does not fall means tests are propagating independently of the code.

The practical effect on the remaining work: for every DTO and operation collapse in steps 3.3
and 3.4, the deleted implementation's tests go with it in the same commit, and the new test
is written from the stage-1 case comparison rather than from the old assertions.

### Test layering — what each layer may assert

Set with the repo owner 2026-09-26, after four commits in this slice repaired
implementation mirrors instead of deleting them. The goal is a correctly-factored service
with correct coverage, not a suite that pins the shape of code being replaced.

| Layer | Asserts | Against |
|---|---|---|
| **DAO** | the query returns the right rows; scoping actually scopes | real Postgres, no mocks |
| **Service** | returned value, thrown typed error, resulting persisted state | behavioural unit tests for pure logic; integration where state matters |
| **Route** | the published contract — status, shape, permission | FAPI through the generated SDK |

**No layer asserts which method was called with what.** Where an effect has no observable,
the test moves *down* a layer until it does — not sideways into a mock assertion. A test
that can only be written as `expect(dep.method).toHaveBeenCalledWith(...)` is a signal the
assertion belongs at a lower layer, or that the effect is not worth asserting.

Deleting such a test is the default. Repairing one during a refactor is the thing to avoid:
it converts a mirror of the old code into a mirror of the new code and produces no safety.

### Step 3.6 — the residue sweep, in detail

Not a review of the diff. A **search of the cluster**, because the residue is by definition
what the forward work did not touch. It is a numbered step rather than a judgement call at
the end of a long slice precisely because it will not otherwise happen.

For every entity and edge in the cluster, and every layer from schema to frontend:

- **Derived and projected shapes.** Any type that is a subset, rename or reshape of a
  canonical DTO. Compare semantics, not field names (§5). Include **client-side**
  projections — `league-cache.ts`'s `toLeagueSummary()` hand-projects one DTO down to
  another, field by field, in the webapp.
- **Bypassed mechanisms.** For each repository port, mapper, provider, cached query and
  request decorator touching the cluster: is anything reaching past it? Raw Prisma beside a
  port, inline response shaping beside a mapper, a value re-fetched beside a cached one.
- **Duplicated facts.** The same value delivered by two paths, especially viewer identity:
  a global flag repeated per row, a relationship derivable from a membership the client
  already holds, an id echoed back that the server can read from the token.
- **Dead code that encodes a convention.** An unused mapper or unused DTO is worse than an
  absent one — it looks like the convention is being followed. Delete or wire it.
- **Contracts enforced only at runtime.** A response shape held together by the serializer
  dropping unknown fields is not type-checked. Route it through a mapper so the compiler
  owns it.

Output: every instance either removed in this slice, or recorded with the reason it is not.
"Already exists" is not a closure. Finish by re-reading §15's table and asking which of
those seven patterns this cluster also has.

## Two phases — backend first, then the frontend in one pass

Set by the repo owner. All of it lands on **one branch**; the phases are a sequencing rule
within that branch, not separate branches or separate PRs.

> "Instead of trying to fix everything in a single pass, first adjust all of the backend and
> tests. Make sure the service build is clean. Then begin on the front-end once all of the
> types and client SDK's are exported."

**Phase 1 — every slice, backend only.** Slices 1 through 4 each run stages 1, 2 and steps
3.1–3.6; step 3.7 runs once, after slice 1. The webapp is not touched and is *expected to be broken* for the duration: routes
and DTOs are changing underneath it and the generated client has not been regenerated yet.

**The boundary — export once.** After the last slice's backend is green, run 3.8 for
everything at once: register the canonical DTOs as named OpenAPI components, `npm run
api:refresh`, and regenerate the client SDK. One regeneration over a settled model, not four
over a moving one.

**Phase 2 — the frontend, one pass.** Every webapp surface moves onto the regenerated types.
Doing this once means each surface is rewritten against the final shape rather than against
an intermediate one that a later slice would change again.

### Why the phases, concretely

Slices 2 and 3 change objects slice 1's frontend would already be rendering — a league page
shows squads, events and contest entries. Converting that page after slice 1 means
converting it again after slices 2 and 3. Deferring the whole frontend to one pass over a
settled model is strictly less work and produces one shape per surface instead of three.

### Phase-1 gates — what "the service build is clean" means

These four commands are the phase-1 definition of done. **Do not run the whole-repo `npm run
lint` or `npm run typecheck` during phase 1** — they include the webapp, which is expected
to be red, and a red webapp says nothing about whether the backend is clean.

| Command | Covers |
|---|---|
| `npm run lint:service` | `packages/**/*.ts` |
| `npm run typecheck:service` | every package except the webapp |
| `npm run typecheck:tests` | `tests/**` — the only gate that compiles the test tree (see below) |
| `npm run test:unit` | backend unit suite |

`npm run rules:check`, `npm run api:check` and `npm run api:validate` also apply and are not
phase-scoped.

**`typecheck:tests` exists because nothing used to compile `tests/`.** `turbo typecheck`
covers `packages/` only (#181) and jest transpiles per file without a program-wide check, so
a test importing a module the change deleted compiled locally and failed in CI. That is
exactly the failure mode this pass will generate repeatedly — every slice deletes shadow
DTOs and the services behind them. Both CI fallouts on #197 were this. Run it before every
push.

The integration and functional-api suites need Postgres, which is not available in every
working environment. Where it is missing, push the branch and let CI run them:
`service-coverage-report` is the job that does.

### CI during phase 1

The CI jobs were split so a broken webapp does not block the backend suites
(`b20c653`, `a2830d9`). The backend chain is `all-contract-gates` →
`service-lint-typecheck` → `service-coverage-report` / `service-build`, and none of it
depends on `poolmaster-build`. Expect `poolmaster-build` and `poolmaster-unit-tests` to be
red for all of phase 1; that is the plan working, not a regression. They must be green
before phase 2 is done.

## Slices — grouped by related objects

Ordered by dependency: later clusters reference earlier ones. **Slices 1–4 are phase-1
(backend) units** — each runs stages 1 and 2 and steps 3.1–3.6, and none of them touches the
webapp. The frontend is a single pass after all four, listed last.

### Slice 1 — Identity and membership
`User`, `League`, `LeagueMembership`, `Squad`, `SquadMembership`, `LeagueInvitation`,
`SquadOwnerInvitation`

**All seven already have repository ports** — the best-covered cluster, and the one whose
repo-backed services already produce the cleanest DTOs. Likely a stage-1 finding of "schema
is right, DAO needs operations added, routes and DTOs are wrong". Known shadows to confirm:
`LeagueMemberDto`/`LeagueMembershipDto`, `adminListUsers` vs `UserProfileDto`, `/account/*`
vs `/admin/users/*`, `adminInactivateLeague` vs `inactivateLeague`, `adminListTeams` vs
`SquadDto`.

First because it is the smallest real test of the whole workflow.

**Stages 1 and 2 are done for this slice.** The ER diagram is in #202, the stage-1 shadow
inventory is in #202 (2026-09-25), and every model question is answered in
`docs/DOMAIN-OPERATIONS.md` — access rules A1–A7 (who may call) and **A8 (viewer context
is delivered once per league, never per row)**.

Two schema changes, step 3.1:

- Add `@@unique([leagueId, name])` to `Squad` — squad names are unique within a league.
  `SquadMembership` already carries `@@unique([leagueId, userId])`, so one squad per user
  per league is already enforced in the database.
- Drop `League.createdBy` — not a concept the model needs. Removes the column, the field in
  `domain/types.ts`, the mapping in `prisma-league-repository.ts`, and the DTO field in
  `admin/league-service.ts`.

Four DAO gaps, step 3.2 — each one a requirement from an access rule (working rule 2, §14):

| Gap | Required by |
|---|---|
| `UserRepository` has no `findAll`/search | A1 — only rootAdmin reads across all users |
| `UserRepository` has no `findByLeague` | A4 + A6 — members read peer users through the league join |
| `LeagueRepository` has no `findByUser` | A2 — a member sees only their own leagues |
| `SquadRepository` needs no cross-league search | **Retired.** A8's "one league at a time" means there is no unscoped squad list; `adminListTeams` is deleted, not unified |

DTO collapses, step 3.4:

| Shadow | Becomes |
|---|---|
| `UserProfileDto` | renamed `UserDto`, moved from `auth.dto.ts` to a new `users.dto.ts` |
| `AdminTeamSummaryDto` | `SquadDto` |
| `AdminTeamOwnerSummaryDto` | `UserDto` |
| `LeagueMemberDto` | `LeagueMembershipDto` with an embedded `UserDto` |
| `LeagueDetailDto` | merged into `LeagueDto` — it is `LeagueSummaryDto` + `joinPolicy`, a pure view variant |
| `LeagueRelationshipDto`, `TeamRelationshipDto`, `UserViewerAuthorityDto` | deleted — A8 |
| `SquadMembershipDto.firstName`/`lastName` | embedded `UserDto` |

Eight duplicate operation pairs collapse to eight operations; the list is in
`docs/DOMAIN-OPERATIONS.md` under *What this document settles*.

**Known step 3.6 sweep targets**, recorded now so they are not lost:

- `account/service.ts` — 26 raw Prisma calls, **zero repository ports**. Not in the
  original §2y diagnosis, which implicated only `admin/*` and `golf/*`. It is half of the
  `/account/*` vs `/admin/users/*` split, and the reason the two drifted: neither side goes
  through `UserRepository`, so nothing constrained them to agree.
- `admin/user-service.ts` (36 raw calls), `admin/league-service.ts` (2),
  `admin/team-service.ts` (1) — all zero ports.
- `league-cache.ts`'s `toLeagueSummary()` — a client-side hand projection of one DTO down
  to another, field by field. Deleted by the `LeagueDto` collapse.
- `my-team-page.tsx:149` — finds the viewer's own squad by scanning
  `team.teamRelationship.owner` across every squad in the league. Becomes a lookup against
  the viewer's `SquadMembership` from the league context.
- ~12 sites reading `isRootAdmin` off a league or squad while `auth-provider.tsx:175`
  exposes `auth.isRootAdmin`. `app-shell.tsx` uses both, at lines 49 and 64.
- `account.dto.ts` registers **no** named components at all, so `AccountResponse` is
  published as an inline anonymous schema. Pre-existing on main, a #192 gap.
- `admin/routes.ts` carries the `#192-mixed:` opt-out from
  `check-dto-conversion-complete.mjs` check 5. Re-examine whether it still needs it once
  the admin DTOs above are gone.
- **Repository test fakes: 50 factories across 13 files — #208.** Pulled out of the sweep
  into its own epic because it is not residue to find at the end, it is a tax being paid
  *now*: three consecutive commits in this slice edited 7, 5 and 10 fakes respectively to
  add one port method each. Sequenced **before** the `UserRepository` service injection,
  since that step needs 17 fakes built from scratch and would otherwise write them twice.
- **210 assertions on mock call shape, 105 of them on raw Prisma — #209.** The fakes are a
  shadow; these are worse, because they mirror the implementation rather than specifying
  behaviour. They break on every refactor that changes nothing, and one of them was found
  passing *vacuously* in this slice. Unlike #208 the test counts are expected to move:
  fewer unit tests, more integration tests.

  **#209 runs BEFORE the rest of step 3.3 and all of step 3.4.** Set by the repo owner
  2026-09-26: *"All of these tests enforcing poorly implemented code is just tax and in the
  way of the refactor."* The original order put it last, which guaranteed every remaining
  migration step would repair mirrors instead of deleting them — and the biggest chunk
  left, the 17 `UserService`/`AccountService` tests that mock `PrismaClient` directly, is
  the most mirror-heavy of all.

  Four commits on this branch added or repaired mirrors rather than deleting them
  (`c4a1dab`, `b1d7c9d`, `384128d`, `183bed8`); those are in #209's scope too. "Verified
  against the mutation" only established that the mirror matched the new code, which is
  not coverage.

**Step 3.3 outcome, recorded 2026-09-26.** Both zero-port services are on
`UserRepository`. What the migration actually changed, beyond the injection:

- **Three one-sided guards dropped**, each present in exactly one of the two write paths:
  the self-demotion block on `setRootAdmin`, the dependency-detail payload on a blocked hard
  delete, and the read-only lock on inactive accounts (A9). Reasoning and evidence are in
  `docs/DOMAIN-OPERATIONS.md`, "Three guards dropped while implementing slice 1".
- **The profile/username/preferences write became one operation for both callers**, in
  `modules/users/user-profile-service.ts`. The document had always defined it for `self` OR
  `rootAdmin`; only the `self` half existed, with the authority rule implicit in the route
  prefix, so the rule had never been tested. It is now `requireWritableUser`, and the two
  identity-availability checks that differed only in the order of their `OR` arms are one
  check over `findByIdentifier`.
- **`isLastRootAdmin` takes the port and the already-loaded user.** It was written inline
  three times in `admin/user-service.ts` plus once here, and re-read the user only to learn
  `isRootAdmin` — which every caller already had.
- **`UserUpdate` replaced `Partial<User>` on the port.** `Partial<User>` could not express
  "clear my timezone", because the optional preferences are `string | undefined` on the
  domain type; worse, a `null` mapped through the enum `Record` returns `undefined`, which
  Prisma reads as "no change", so a clear would have silently done nothing.
- **Three hand-rolled shapes deleted**: `UserListItem`, `UserDetailView` and
  `AccountUserRow`, along with the three copies of the row→domain enum mapping they needed.
  `viewerAuthority` is assembled in the handler that knows the viewer (A8), and
  `account.mapper.ts` is now a projection with no mapping in it.
- **The client-side mirror of the inactive lock went too.** `user-page.tsx` disabled its four
  edit forms on `isInactive`; that is gone, and the two strings telling the user their
  account is read-only now describe what inactive actually means.

Test counts across the step: unit 90 suites/1045 tests → 91/1052, integration 18/76 → 18/83,
webapp 120/499 → 120/498. The unit count did not fall, and that is the honest outcome rather
than the predicted one: 7 tests were deleted with the guards and 3 duplicate `UserService`
tests were removed from `admin-support-services.test.ts`, but the operation that previously
had NO tests for its `rootAdmin` half — and no test of its authority rule at all — needed 16. FAPI 10/60 → 10/59.
The integration rise is `findByIdentifier`, `countRootAdmins` and `update`, none of which had
a DAO test before.

**One tension worth recording.** "Test layering" above says no layer asserts which method was
called with what. `user-profile-service.test.ts` does, for the normalization cases, and the
file says why: that service holds no state and issues no query, so the `UserUpdate` it hands
the port is its entire output — there is no lower layer to move to. The rule held everywhere
else: the `searchUsers` filter pass-through test was deleted rather than re-pointed, and what
survives at the service layer is returned values, typed errors, the *absence* of a write, and
transaction atomicity.

**Step 3.4 and 3.6 outcome, recorded 2026-09-27.**

Step 3.4 ran in three parts. **A8** took the viewer context off the entities: `memberType`,
`leagueRelationship`, `isRootAdmin`, `teamRelationship` and `viewerAuthority` are gone, along
with the three DTOs that existed only to name those blocks. It now travels once, on
`getLeagueByCode` as `LeagueContextResponse` (the league plus the viewer's own
`LeagueMembership` and `SquadMembership`), and once per leagues list as a `LeagueMembership[]`
beside the leagues. **The DTO collapse** merged `LeagueSummaryDto` + `LeagueDetailDto` into
`LeagueDto`, renamed `UserProfileDto` to `UserDto` in its own `users.dto.ts`, replaced
`LeagueMemberDto` with `LeagueMembershipDto` embedding the canonical `UserDto`, did the same
for `SquadMembershipDto`'s loose name columns, and deleted `adminListTeams` with its four
schemas rather than re-pointing them. **The operation collapse** replaced `/api/v1/account/*`
(7 routes), `/api/v1/admin/users/*` (8) and `/api/v1/auth/me` with `/api/v1/users` (11),
where `:userId` accepts `me`: sixteen routes over two DTO families became eleven over one.

The thing that made the collapse worth doing is what it forced into the open. Each of the
eight "pairs" disagreed about its guards, and nobody could see it because the two halves lived
in different files:

- only the admin half had the last-root-admin guard on disable;
- only the account half had a read-only lock on inactive accounts (dropped under A9);
- only the admin half wrote an audit entry — now the rule is stated: the entry records an
  exercise of root-admin authority, so it is keyed on the ACTOR, not on the route prefix;
- only the admin half blocked self-demotion, which the last-root-admin count already covered.

Moving the user list out from under `/api/v1/admin` also separated two failures that the admin
prefix had answered identically: an anonymous caller is not authenticated (401), and an
authenticated caller who is not a root admin is not authorized (403).

### Step 3.6 — the sweep, and what it did NOT convert

Converted: `AuthService`, `SquadService`, `MemberDirectoryService` and
`SquadOwnerInvitationService` onto `UserRepository`; four `User → UserDto` projections and four
copies of the row→domain enum mapping collapsed into one `users.mapper.ts`; two contracts that
were enforced only at runtime (`mapLeagueMembershipToDto` had no declared return type, and
accepting an invitation sent the raw domain object) now compile.

**Five user reads were NOT converted, and the reason is one finding, not five.** They are in
`leagues/invitation-service.ts` (×2), `leagues/member-lifecycle.ts`,
`squads/default-squad.ts` and `contests/service.ts`. Each is a plain user-by-id read that
`UserRepository.findById` covers exactly. What blocks them is the shape of the constructors
they hang off: `ContestService` takes twelve positional parameters with three trailing
optionals, `InvitationService` nine, `LeagueService` seven. Adding a parameter mid-list
silently shifts every existing argument; appending it means every call that stops early has to
pad with `undefined`.

That is not a hypothesis. Converting them and threading the port through produced exactly that
breakage — a test passing a Prisma mock into the logger slot, another passing a repository into
`appBaseUrl`, and a league-creation test that silently skipped default-squad provisioning
because the port arrived as `undefined` — and the failures were type errors and wrong-call
assertions rather than anything about users. The conversion was reverted.

**The fix is to replace those three positional lists with an options object**, and that is its
own change with its own risk, not a step inside a DTO refactor. Recorded here rather than left
in the diff. Two other user reads stay on Prisma by design: `admin/health-service.ts` counts
users for a platform metric, which is not an aggregate read, and `plugins/admin-auth.ts`
re-reads the user per request — which is #195, and now inconsistent with the user routes, since
those take `isRootAdmin` from the token claim.

**Three route maps exist for the same routes.** The Fastify registrations are the truth; the
OpenAPI document is generated from them; and then `packages/shared/api-routes.ts` and
`clients/poolmaster/src/test/msw-api.ts` are hand-maintained copies. Both were stale in this
slice's favour — they still listed `/api/v1/account/*` and `/api/v1/auth/me` after the routes
were gone. Updated here, but two hand-maintained mirrors of a generated artifact is the §15
pattern and should be a follow-up.

**Step 3.7 outcome, 2026-09-27.** `docs/LAYERS.md`. Written from the code rather than from the
existing rules and docs, as set: the point is to describe the structure this refactor produced
so it can be reviewed against what was intended, and a description that inherits the old
framing cannot do that. It covers the service layers (domain → ports → adapters → services →
mappers → DTOs → routes, plus plugins and core), the webapp layers (`lib/` as the boundary,
`features/<area>/` as the unit, the generated SDK and types as the dependency between them),
the tests that apply to each layer with the reason they sit where they do, two end-to-end flows,
and a closing section on the boundaries that are still soft — including the five unconverted
user reads and the three route maps.

Two structural facts it records that were not obvious before writing it down: the webapp's tests
are colocated and vitest-run while every backend test is central and jest-run, which follows
from the runner rather than from a testing policy and means `npm run test:unit` does not include
the webapp; and `clients/poolmaster/src/test/msw-api.ts` plus `packages/shared/api-routes.ts`
are two hand-maintained mirrors of a generated artifact — the shadow pattern of this whole
refactor, one level up.

### Slice 1 frontend reconnection — outcome, 2026-09-27

Not a numbered step. Phase 2 was planned as one pass after all four slices, on the reasoning
that the webapp should move once, onto a settled SDK. The repo owner reduced that to its actual
requirement — *"I just wanted to get the backend refactored and then re-export out the SDK
before beginning the front-end so the front-end wouldn't be using old exports"* — which slice 1
had already satisfied: the DTOs are registered as named components and the SDK is regenerated.
So the webapp was reconnected to slice 1's contract now, with slices 2–4 still to come.

**83 type errors across 37 files, all of them the same four changes.** `LeagueDetailDto` and
`LeagueSummaryDto` becoming one `LeagueDto`; `getCurrentUser` becoming `getUser({ userId: 'me' })`;
viewer context coming off the entities (A8); and a squad or league member's flattened
`firstName`/`lastName` becoming the embedded `UserDto`. Nothing needed a design decision that
slice 1 had not already made — which is the evidence that deferring the frontend bought nothing.

**`useLeagueContext` is A8 realised on the client.** Eight pages each had a byte-identical
`useQuery` for the league, four of them with their own copy of the `rememberRecentLeagueCode`
effect. They now share one hook returning `{ query, league, viewer }`, where `LeagueViewer` is
`{ isRootAdmin, isMember, isCommissioner, membership, squadMembership, mySquadId }`. It reads
`isRootAdmin` from the cached session user and everything else from the league-context response.
The line A8 cited as proof the per-row flag was residue —
`teams.find(t => t.teamRelationship.owner)`, which fetched every squad in a league to scan a
per-row viewer flag — became `teams.find(t => t.id === viewer.mySquadId)`.

**The leagues list is the one place viewer context is a set, and it needed its own shape.**
`LeagueListResponse` carries `{ leagues, memberships }`. `getCommissionerLeagueIds(memberships)`
reduces that to the only question callers asked of the old `leagueRelationship` block, and
`getLeagueSelectorOptions` takes the set. `sortLeaguesForOverview` had no caller outside its own
test and was deleted with it (§1D).

**Two query caches changed shape, and one of them changed behaviour.** `QueryKeys.leagues.list`
now holds `{ leagues, memberships }` and `QueryKeys.leagues.detail(leagueCode)` holds the
league-context response, so `syncLeagueCaches` replaces only the league part of each rather than
overwriting the entry. The behavioural consequence is that **creating a league no longer seeds
its context cache**: `createLeague` returns `LeagueResponse`, and the client cannot invent the
membership that belongs beside it. The new league's page reads its own context on arrival — one
extra request. `LeagueService.createLeague` already returns `{ league, membership }` and the
handler discards the membership, so having create return `LeagueContextResponse` would remove
that request and is the A8-consistent shape; left as a follow-up rather than reopening the
merged backend.

**What the collapse exposed in the tests.** `user-page.test.tsx` bound two mocks to each of
`getUser`, `disableUser`, `enableUser` and `deleteUser` — an `admin*` one and an `*Account` one —
so whichever was registered second silently won for both callers. With one operation there is one
mock, and the root-admin tests had to dispatch on the path (`me` versus a user id) because the
signed-in user and the viewed user are now the same read. That is not test mechanics: it is the
same "two halves of one operation" shape the service collapse removed, sitting in the test
harness.

**Residue swept along the way.** `ManageSectionKey` still listed `'teams'` after step 3.4 deleted
the cross-league team console, and a scaffold test still asserted that section was live — both
gone. `teams-page.tsx` had a local `getOwnerLabel` with an "Unknown owner" fallback that existed
only because the flattened name fields were optional; it now uses the shared `formatUserName`.
`ManageLeagueModal` has no caller outside its own test — flagged, not deleted, since deleting a
whole surface is the repo owner's call.

**Counts.** Webapp 119 suites / 495 tests (was 120/499 — one suite and one test removed as the
code they covered went, the rest net-neutral). Backend unchanged and green: unit 88/1046,
integration 18/82, FAPI 10/58. `npm run api:refresh` produced no diff, confirming the contract
was already current.

### Slice 1 completion sweep — outcome, 2026-09-27

Two things the frontend reconnection surfaced, found by auditing what was left rather than by a
type error. Both were done on the same branch.

**The League half of the operation collapse had never run.** `docs/DOMAIN-OPERATIONS.md` lists
`listLeagues` + `adminListLeagues` and `inactivateLeague` + `adminInactivateLeague` as one
operation split in two, alongside the five User pairs. The User pairs all landed in step 3.3;
the League pairs did not, and `deleteLeague` + `adminDeleteLeague` was the same shape without
being in the table. Two of the three admin routes had **zero** frontend callers.

The collapse found the same class of silent disagreement as the User one, which is the argument
for doing it rather than deleting the unused routes:

- **Counts.** The member-scoped list called `toLeagueDto(league)` with no counts, so every
  league it returned reported `memberCount: 0` and `activeContestCount: 0` while the root-admin
  list computed them. Latent — no surface displayed the member list's counts — but two answers
  to one question.
- **Filters.** `search` and `isActive` existed only on the root-admin half, though they describe
  the query rather than the caller. They narrow either scope now.
- **Audit.** Only the root-admin half wrote an `AdminAuditEntry`. Settled the way `UserService`
  settles it — keyed on the actor, so a commissioner administering their own league writes none
  — rather than merged. The delete's entry reads the league's counts *before* the transaction,
  because afterwards there is nothing to count, and is written *after* it commits, because
  `logAdminAction` holds its own Prisma singleton (#205).
- **Nothing else.** `requireCommissioner` already granted root admins, so the `/admin/leagues/*`
  routes were never the only path — they added the audit entry and otherwise duplicated.

**Scope had to become explicit, and that corrects the epic's own wording.**
`docs/DOMAIN-OPERATIONS.md` said scope is "resolved from the caller's role". That works for the
User operations, where the path names the subject and the role only decides whether you may. It
cannot work for a list: a root admin legitimately needs **both** scopes — their own leagues for
the selector, every league for the management page — and one request cannot mean both. So
`GET /leagues?scope=mine|all`, with `all` returning 403 `LEAGUE_SCOPE_FORBIDDEN` to anyone who
is not a root admin (A1). The doc is corrected rather than quietly contradicted.

Gone with the routes: `AdminLeagueService` (257 lines), `admin/league-handler.ts` (112),
`AdminListLeaguesQuerySchema`, and every league repository, service and user repository the
admin module wired up only to serve them. `LeagueService.findByUser` and `UserLeagueView` went
too — the collapse made them residue in the same commit that created it, since
`listLeagues({ scope: 'mine' })` is that read with the counts it omitted. Its N+1 guard migrated
rather than being deleted: the property it protects is still true of the replacement. `admin-league-service.test.ts` migrated into
`league-service.test.ts` under §1D — the composition it asserted did not change, only its home
— with new cases for scope, for filters on the member-scoped read, for the counts defect, and
for the four audit behaviours.

**Two league reads, one response shape.** `getLeague` (by id) returned a bare `LeagueResponse`
while `getLeagueByCode` returned `LeagueContextResponse`: two reads of one object with two
shapes, the shadow projection of this whole refactor one level up. They share one handler now,
which also removes the duplicated membership authorization each had a copy of.

That fixed the last instance of the pattern A8 was written to remove. `contest-detail-page.tsx`
and `my-team-history-page.tsx` were still finding the viewer's own squad by fetching every squad
in the league and scanning each one's member list for the signed-in user — the same read as
`teams.find(t => t.teamRelationship.owner)`, written by hand rather than as a per-row flag,
which is exactly why removing the flags from the DTOs did not flush them out. Contest-rooted
routes hold a `leagueId` and never a `leagueCode`, so they could not use `useLeagueContext` until
the by-id read carried the context. `useLeagueContextById` serves them, and seeds whichever of
the two cache addresses it did not fetch so one league never sits in two entries with different
content. The contest board's squad-list query is deleted outright: it existed only to answer
that question.

**Residue swept with it.** `sortLeaguesForOverview` and the `'teams'` manage-section key went in
the reconnection; this pass added: the duplicated `listLeagueMembers` query and its identical
`Map` index in both team surfaces, now `useLeagueMembersQuery`; the `contestLeagueCodes` query
key, a contest-shaped address for a league that nothing else could reuse; and four
`Account*FormValues` type aliases still named for the module that no longer exists.

**Stale fixtures that typecheck could not see.** Three test files still built
`memberType`, `leagueRelationship` and `teamRelationship` into their mocks — `vi.fn()` is
untyped, so nothing failed, and the tests passed because they never read those fields. One of
them, `my-team-history-page.test.tsx`, was missing `squadMembership` entirely, which is the field
the page reads now. This is the cost of untyped mocks stated concretely: the contract was
enforced only at runtime, in tests whose whole job is to check the contract.

**The zero-caller operations, resolved with the repo owner — and a claim of mine that was wrong.**

I reported that "there is no league-members surface in the webapp at all." That was wrong, and the
correction matters because it changes what the remaining work is. **The squad list *is* the member
roster.** `ensureDefaultSquadForLeagueMember` runs on both paths that create a `LeagueMembership`
(league creation, invitation acceptance), and accepting a *squad-owner* invitation creates a
`LeagueMembership` with role `MEMBER` plus a `SquadMembership` on that squad. So every league
member has exactly one active squad, and `teams-page.tsx` already renders every squad with its
active owners, each owner's league-role chip, and pending owner invitations. It also already
carries remove-owner and promote/demote through `TeamOwnerActionMenu`. What is missing is the
invite/create/inactivate group, which lives on Team Home behind a `?teamId=` hop — a surfacing
job, not a missing screen. I had also said `changeMemberRole` had no league-level frontend; it has
one, in that shared row menu, reachable from both surfaces.

**Auditing the rest found that most of them were read/write APIs in front of features never
built**, which is a different finding from "no frontend yet":

- Nothing in the codebase ever created a `CommissionerActionItem`. `createActionItem` had one
  caller — a unit test — and `resolveActionItem` had none, so the resolve route could never have
  had anything to resolve.
- Nothing ever wrote to `CommissionerAuditLog`. `AuditService.logAction` had **zero callers**, so
  `getLeagueAuditLog` and `getMemberAuditLog` both always returned `[]`. `getLeagueAuditLog` also
  took `limit`/`offset`, which §16 forbids.

Deleted on the repo owner's decision: `resolveActionItem`, `getLeagueAuditLog`,
`getMemberAuditLog`, `createActionItem`, and `copySeason` (contest copy-forward, no caller,
removed from scope). `AuditService.logAction` and `getContestAuditLog` stay because the contest
audit route is live — it has the same empty-read problem, but contests are slice 3 and #205 has to
settle how many audit tables there should be first.

Kept and ticketed: **#221** the commissioner dashboard, which is the one of the four that returns
real data — every field except `actionItems`, which is now unpopulatable and is that ticket's
first question. **#220** CSV/spreadsheet bulk import, deferred; note the repo owner's framing is
"teams and owners", which the current row shape cannot express. **#219** surfacing the squad
lifecycle actions on the squad list. **#217** inviting a co-owner who has no account yet —
register, join league, join squad in one flow, the one item with real design in it. **#218**
removing a co-owner must also end their league membership, decided here:

> "This should also remove the league membership as well. If the desire is to have a new team,
> they can be re-invited by the commissioner to create a new team."

That last one closes the model into a checkable invariant, which is why it is worth stating:
**every ACTIVE `LeagueMembership` has exactly one ACTIVE `SquadMembership` in that league.** Today
`removeOwner` breaks it — it ends the squad membership and leaves the league membership, so a
removed co-owner keeps league access while disappearing from every surface that lists people.
#218 fixes it and gives `removeMember` its first frontend caller.

### #218 — squad co-owner removal ends the league membership, 2026-09-27

The first follow-up off slice 1's audit, and it turned out to be two findings rather than one.

**The reported defect.** `SquadService.removeOwner` ended the squad membership and left the
`LeagueMembership` ACTIVE. Since every member has exactly one squad, that produced a league member
with no squad — invisible on every surface that lists people in a league, while keeping league
access. The repo owner's decision: *"This should also remove the league membership as well. If the
desire is to have a new team, they can be re-invited by the commissioner to create a new team."*

**The blocker that decision hit, and the second finding.** The obvious implementation is to route
through the existing league-removal path. But `inactivateLeagueMemberUnit` had a third step: if the
league being left was the user's *last* one, it set `user.isActive = false` and revoked every
refresh token. Traced end to end, that made the stated recovery path impossible — `login` refuses
an inactive account, accepting an invitation needs a session, and only a root admin can re-enable
— so a member removed from a team in their only league was locked out and could not be re-invited.

Put to the repo owner, who called the cascade itself the mistake:

> "I think the current step 3 is a mistake. It's fine that it already shipped and was intentional,
> but I guess it was short sighted. Let's remove that step 3 from league management. Let's keep
> league management constrained to removal from squad and league, but not inactivating the user's
> account. … Commissioners really only care about League and Squad membership. They shouldn't care
> if the user's login is still active."

Which is the epic's own principle one level down: the User is the object, membership is a
*relationship*, and a relationship ending must not mutate the object's lifecycle. Account state
belongs to the user (self-service disable) and to a root admin. So step 3 is gone, and
`inactivateLeagueMemberUnit` no longer takes a Prisma client at all — the guarantee is structural,
not conditional.

Verified before changing anything, at the repo owner's request: a user with no leagues logs in
fine (`login` gates on `isActive` only; `WelcomePage` has an explicit zero-league empty state and
returns before its redirect; `AppShell` tolerates an empty list). No defect to file.

**The rule that had to be shared.** A co-owner can be the league's last commissioner while sitting
on somebody else's squad, so ending their league membership could leave a league with nobody who
can administer it. `ensureAnotherActiveCommissioner` moved out of `MemberService` into
`member-lifecycle.ts` as `requireAnotherActiveCommissioner` with a `LastCommissionerError`, and
both services translate it into their own error type at their boundary. One rule, one place.

**Three model facts this surfaced, all worth writing down.** They constrain #217 and #219:

1. **`SquadMembership` is unique on `(leagueId, userId)`** — one squad per member per league, ever.
   So an existing league member *cannot* be added as a co-owner of another squad; the attempt is
   refused with `SQUAD_MEMBERSHIP_CONFLICT`. Co-ownership only arises for somebody who joins the
   league **through** a squad-owner invitation, which is why `rejectIfCurrentLeagueMember` guards
   that flow.
2. **`inviteOwner` auto-accepts for an existing PoolMaster user.** It provisions them onto the
   squad immediately and returns the invitation already `ACCEPTED`. The pending-then-accept path
   exists only for an email with no account behind it — so #217's scope is narrower and clearer
   than it read: it is *only* the no-account case.
3. **Re-invite restores the original squad**, it does not create a new one.
   `ensureDefaultSquadForLeagueMember` reactivates the historical membership and its squad, so a
   rejoining member gets their team back with its contest history. The repo owner confirmed this is
   the intent.

**The invariant is now asserted, not assumed.**
`tests/integration/core-api/league-squad-membership-invariant.integration.ts` reads it straight
from the database after each way a membership can begin or end: *every ACTIVE `LeagueMembership`
has exactly one ACTIVE `SquadMembership` in that league*, and no ACTIVE squad membership belongs to
a non-member. Checked by reverting `removeOwner` to its old behaviour, which produces exactly
`active league member <id> has 0 active squad memberships, expected 1` — so it fails for the right
reason rather than passing vacuously.

**Two harness gaps it exposed.** `teamInvitationsModule` was never registered in
`tests/integration/helpers.ts`, so no integration test could exercise the only flow that produces a
co-owner; and `cleanupTestData` deleted squads without first deleting `squadOwnerInvitation` rows,
which holds an FK to them. Both were invisible until a test created a squad-owner invitation.

### #217 — register against a squad-owner invitation, 2026-09-27

The second follow-up, and #218's work had already narrowed it to one case.

**What the ticket originally claimed, and what is actually true.** I wrote that inviting an
existing user "works" and only the no-account case was missing. `inviteOwner` is sharper than that:
it looks the email up, and on a hit it provisions the user onto the squad immediately and returns
the invitation already `ACCEPTED`. So for an existing user there is **no pending state and no
acceptance step** — they are simply added. The `PENDING` → accept path exists *only* for an email
with no account, and it dead-ended: acceptance needs an authenticated `userId`, which somebody
without an account cannot supply. The webapp said as much out loud — *"Sign in or create an account
first, then come back to accept this team invitation"* — which was not a workaround, it was a wall.

**The security decision, settled with the repo owner: bind to the invited email.** The request
carries no `email` field at all; the account is created with the address the commissioner invited,
read off the invitation server-side. A squad-owner invitation grants league membership, so
honouring an address supplied by the caller would let a forwarded invite link admit an unintended
person. The DTO says this in its description, and the webapp test asserts the absence of an email
input, because the absence *is* the property.

`POST /api/v1/team-invitations/register` → `AuthResponse`. Public by necessity, and not an open
registration hole: it needs a valid PENDING invite code, and it refuses an email that already has
an account with `SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS` — the answer there is "sign in and accept",
not "register again".

**Where the orchestration lives, and why.** In the handler, because it spans two services: the
invitation rules belong to `SquadOwnerInvitationService` and creating an account belongs to
`AuthService`, and neither should know about the other. The invitation is validated **first**, so a
bad or expired code cannot strand an account. `requireInvitationForRegistration` is the new
validator, and `acceptInvitation`'s own PENDING/expiry checks were extracted into a shared
`requirePendingInvitation` rather than duplicated.

**The atomicity limit, stated rather than hidden.** Account creation and the membership writes are
not one transaction, because the repositories hold their own Prisma client and take no transaction
client — the same constraint that keeps `logAdminAction` outside its callers' transactions. If
provisioning failed after registration the invitee would hold an account with no league: a
legitimate state that logs in fine and can be re-invited, not a corrupt one, and *not* a breach of
the league/squad membership invariant (which only constrains active memberships). Making it atomic
needs the repository refactor in #211. The handler logs loudly if it happens.

**A latent bug found on the way.** `GET /api/v1/team-invitations/:inviteCode` described itself as
"the public team-owner invitation flow before or after authentication" but was never added to the
auth guard's public patterns — only the *league* invitation preview one line above was. So an
invited stranger could not read the preview at all. Fixed with the register route's exemption.

**Two hand-maintained mirrors needed updating again**, which is the §15 pattern this epic keeps
running into: `clients/poolmaster/src/test/msw-api.ts` had no entry for the new operation, so the
webapp test failed inside `bindApiMocks` rather than in the code under test.

### #219 — the squad lifecycle actions move onto the roster, 2026-09-28

The third follow-up off slice 1's audit. The squad list **is** the league's member roster — every
`LeagueMembership` gets a `SquadMembership`, so every member appears as an owner of some squad — and
it already carried the per-owner actions (`removeSquadOwner`, `changeMemberRole`) through
`TeamOwnerActionMenu`. What it lacked were the *squad-level* actions, which existed only on Team
Home and were reachable for somebody else's team by appending `?teamId=`. That hop is gone:
`SquadActions` sits under each roster row and carries invite co-owner, revoke a pending invite, and
inactivate the team.

**The permission split, decided with the repo owner.** He asked whether these should be
commissioner-only, since an owner can already do them from their own team page. Two shapes were put
to him; he chose the second:

> "I'd pick B as well. Agreed."

So **invite and revoke stay owner-accessible** — plainly the owner's business, and the backend
already says so via `requireSquadManager` — while **inactivating a squad became commissioner or
root admin only**, a deliberate narrowing from `requireSquadManager`. #218 is what made that
consequential rather than merely generous: inactivating a squad now ends its owners' league
memberships, so under the old guard a sole owner could remove themselves from the league by
pressing a button on their own team page. Ending a team, and with it somebody's league membership,
is league administration.

The narrowing is enforced in `SquadService.inactivateSquad` by a new private `requireCommissioner`,
and Team Home's inactivate action is gated to match rather than offering a button that can only
403.

**Two stale pieces of copy this exposed, both promising the cascade #218 deleted.** Team Home's
success notice said "any user with no other active leagues was also inactivated" and its confirm
dialog hedged the league removal with "if they do not have another active team" — a condition that
never held, since a member has exactly one squad per league. Both now describe what actually
happens: the owners leave the league, their accounts are untouched, and inviting them back restores
the team.

**`createLeagueSquad` is not an action for this screen, and the ticket was wrong to list it.**
#219's table put "create a squad — commissioner" alongside the others. Read against the service,
the operation creates *the caller's own* squad: it requires an active league membership for the
caller, adds the caller as its member, and refuses with `SQUAD_MEMBERSHIP_CONFLICT` if they already
have one. Since `ensureDefaultSquadForLeagueMember` gives every member a squad on join, an active
member — commissioner included — can only ever get a 409 from it. A commissioner does not create a
team for somebody else here; the league invite flow creates it as the invitee joins, which is the
repo owner's own framing (*"Invites just go to users. The invite flow creates the squads as they
register or join."*). Its one live caller stays: Team Home's create-your-team panel, the
self-service path for a member who has no squad. So nothing was built for it.

**Team Home keeps its copies of invite and revoke.** The ticket asks whether it should defer to the
roster instead. It should not, yet: Team Home is where an owner manages their own team's name, icon
and history, and the owner actions belong next to that. The duplication worth removing is the
`?teamId=` hop, and that is what went.

### The slice-1 close-out batch, 2026-09-28

Five tickets taken together once #219 merged. They share no files, so each landed on its own
branch; recorded here because the plan is slice 1's narrative record and four of the five found
something the ticket had not.

**#215 — `createLeague` returns the league context.** The 201 was `{ league }`, but creating a
league also creates the creator's COMMISSIONER membership and the service already returned both;
the handler discarded it. So the client could seed `QueryKeys.leagues.detail(leagueCode)` after
every league write *except* the one that creates the league, and the new league's page re-read
what the 201 already knew. The 201 is now `LeagueContextResponse`, the same shape both league
reads return, with `squadMembership` null by construction. `seedLeagueContext` moved into
`league-cache.ts` so the two cache addresses are written in one place rather than two.

**#212 — both shadow route maps are gone.** `msw-api.ts` derives its map from the committed spec
at test-setup time; `api-routes.ts` is generated by `scripts/generate-api-routes.mjs` and checked
by `npm run api:check`. Measured rather than assumed: the hand-written `api-routes.ts` had **ten
paths missing the spec's trailing slash and four pointing at routes that do not exist**
(`contests.list`, `contests.pool`, `admin.health`, `admin.audit`, all with zero consumers), and
`msw-api.ts` covered 120 operations where the spec has 174.

*Two things fell out of it.* Covering all 174 exposed a **path-shadowing order dependency** —
`GET /leagues/{id}/squads/{squadId}` answers a request for
`GET /leagues/{id}/squads/owner-invitations` if registered first — which the old map avoided only
by having no entry for the shadowing route. And moving `clientLogs` to its documented
`/api/v1/client-logs/` spelling made the functional suite answer **401 instead of 204**: Fastify's
`prefixTrailingSlash: 'both'` serves a prefix-root route under two spellings, the spec documents
the slash form, and `auth-guard` matched only the literal non-slash string — so the documented
path of a deliberately public route rejected the unauthenticated callers it exists for. Fixed as
a class with a `routeSignature` helper that normalises one trailing slash, which also collapsed
four hand-spelled `/version` variants that were the same bug patched narrowly.

**`api-routes.ts` is now permanent rather than transitional**, on the repo owner's call. Deleting
it in favour of the SDK was the end state #212 wanted, but `network-sink.ts` is a production
consumer — the log transport needs `fetch` with `keepalive` and a `sendBeacon` fallback, which the
SDK client does not do. That is also why it is a committed generated file rather than a runtime
spec read like `msw-api.ts`: parsing 1.8 MB of spec at module load would put the spec in the
webapp bundle. The generated header and the generator's manifest both say that entries are not
added without explicit approval.

**#213 / #195 — root-admin authority is the token claim, recorded as access rule A10.**
`/api/v1/users/*` trusted the claim while `/api/v1/admin/*` re-read the user row per request: two
answers to one question, arrived at by attrition when #202 built the user routes and left
`admin-auth` alone. Claim-based everywhere, and the reason it is safe is that `setUserRootAdmin`
already revokes the subject's sessions on demotion — **if that revocation is ever removed, A10
must be revisited.** `RootAdminContext` lost its `name` field (built from the row, no consumers)
and `ROOT_ADMIN_USER_NOT_FOUND` went with the lookup. Both golf functional suites promoted a user
in the database and called `/admin/*` with the token they already held; they only passed because
the row was re-read, so `promoteToRootAdmin` moved into `tests/functional/builders.ts` and
promotes *and* re-issues the session.

**#162 — `consistent-type-imports` enforced.** Mechanical. Worth one line: the ticket measured 22
findings and 13 remained, the rest fixed by other work since it was filed. The risk is invisible
to a typechecker — demoting an import that was doing real work removes the module evaluation — so
the integration and functional suites are what covered it, not the unit suites.

**#206 and #217 were already implemented and still open.** Both were verified against `main` and
closed. #206 asked for a planted-case test — a batch posting somebody else's `sessionId`,
asserting the log line carries the JWT's value — and that test does not exist; what exists is
structural, the DTO rejects the field so no batch can carry one. Stronger, but not the thing that
was asked for, which is why it is written down rather than counted as done.

**Two follow-ups from reviewing the client-log pipeline**, neither ticketed: `userId` left
`LoggerContext` (never transmitted since #206, and populating it made every log call read the
React Query cache), and the client-log rate limit halved to 60 because the limiter is per process
and prod runs two tasks, so a default of 120 meant 240/min in front of one IP.

### Slice 2 — Events and participants (the cross-sport core)
Tracked by **#235** (core) and **#236** (golf) after the stage-2 split; #203 carried stages 1
and 2 and is closed. Outcome and decisions: "Slice 2 stage 2 — outcome" below.

Core: `Sport`, `SportLeague`, `Season`, `SportEvent`, `SportEventRound`,
`SportEventParticipant`, `Participant`, `ParticipantProviderMapping`,
`ParticipantLeagueAffiliation`, `ParticipantRankingSnapshot`
Golf instances: `SportEventGolfTier`, `SportEventParticipantGolfRound`,
`SportEventParticipantGolfStanding`, `SportEventParticipantGolfValuation`

**The largest gap.** `SportEvent`, `SportEventParticipant`, `SportEventRound` and every golf
table have no repository port, which is why all 40 golf admin operations and the whole
`golf/*` service layer run on raw Prisma and emit projections.

**The schema already models the specialization correctly.** `SportEvent.sport` is the
discriminator — a golf event *is* a `SportEvent` with `sport = 'GOLF'` — and the golf tables
are extension rows keyed to the core (`SportEventParticipantGolfValuation` is `@unique` on
`sportEventParticipantId`, a true 1:1). **Core row plus optional sport extension is the
pattern. Sport particulars stay in the extension and never migrate into the core** — stage 1
for this slice must check that in both directions, since Q0 found one that already did.

### Slice 3 — Contests and entries
`Contest`, `ContestEntry`, `ContestEntryPick`, `ContestConfiguration`,
`ContestConfigTemplate`, `ContestPrizeDefinition`, `ContestTimingPolicy`,
`ContestEntryAggregationRule`, `ParticipantContestScoringRule`, `ContestEntryGolfStanding`

`Contest` and `ContestEntry` have ports; nothing else in the cluster does. Overlaps #198 —
that epic's `SelectionEngine` sits on this cluster's DAO, so #198's first slice follows this
one.

### Slice 4 — Platform and operations
Providers, sync runs, ingestion jobs, health, metrics, audit, operational config.

**Carried in from slice 1, 2026-09-26: there are two audit tables for one concept.**
`AdminAuditEntry` and `CommissionerAuditLog` share nine columns — `id`, `actorId`,
`action`, `description`, `beforeState`, `afterState`, `reason`, `ipAddress`, `createdAt`.
They differ only in that the admin one adds `actorEmail`, `resourceType`, `resourceId` and
`userAgent`, and the commissioner one adds a required `leagueId` FK, an optional
`contestId`, and `category`.

They are split **by actor role** — the same mistake this whole pass exists to undo, one
layer down, in the schema. `AdminAuditEntry`'s relation is literally named
`RootAdminAuditActor`.

Slice 1 asked whether self-service user actions should be audited and the repo owner
deferred it here, which is right: the answer depends on how many audit tables there should
be. Writing self actions into `AdminAuditEntry` would give that table a third meaning, and
a new `UserAuditLog` would be a third table for one concept, which working rule 5 forbids.
So **self-service user lifecycle actions are currently not audited**, deliberately, pending
this slice.

One related defect found while looking: `logAdminAction` writes through a module-level
Prisma singleton and takes no transaction client, so calls placed inside a
`$transaction` callback were never enrolled in it — the entry committed immediately and
would have survived a rollback. Slice 1 moved those calls after their transactions
(#202); whether the audit write *should* be atomic is this slice's call, and there is a
real argument that a record of a failed attempt is worth keeping.

The genuinely admin-only operations. No shared objects and no collapse: this slice is naming
(stop calling it "admin") and bringing services onto ports for consistency.

### Phase 2 — the frontend, per slice

**Revised 2026-09-27.** This was "the frontend, once": one pass after all four slices' backends
were green. The repo owner's actual requirement was narrower — the frontend must not be written
against stale exports, so a slice's backend and its SDK re-export must land first. That is
satisfied per slice, not per epic. So the webapp is reconnected **after each slice's boundary
export**, starting with slice 1 (see its outcome above). Reconnecting slice 1 found 83 errors and
not one design decision the slice had not already made, which is the evidence for the change.

Every webapp surface touching the slice's objects moves onto the generated type, using the full
object (rule 3).

Its gates are the ones a slice's phase 1 deliberately skips: `npm run lint` (whole repo,
including the webapp), `npx turbo typecheck --force`, `npm run test:poolmaster:unit`, and green
`poolmaster-build` / `poolmaster-unit-tests` in CI.

## Open Questions — found so far

These surfaced while establishing the approach. **The rest are expected to surface in each
slice's stage 2**, which is the point of the workflow: they are discovered with the cluster's
context loaded, not guessed at up front.

### Q0. Golf has leaked into the cross-sport core — SETTLED in slice 2's stage 2

`SportEventParticipant` is the cross-sport entity, but its `inactiveReason` column is typed
`PrismaGolfParticipantInactiveReason`. The values are `WITHDRAWN`, `CUT`, `ELIMINATED` —
`WITHDRAWN` and `ELIMINATED` are sport-agnostic; only `CUT` is golf-flavoured.

**Settled with the repo owner 2026-09-28, and it supersedes this section's original
proposal.** That proposal was to rename the enum and *keep* the values. The decision drops
`CUT`:

- Enum renames to **`ParticipantInactiveReason`**, values **`WITHDRAWN` / `ELIMINATED`**.
- **`CUT` is dropped**; `ELIMINATED` covers it, and existing `CUT` rows migrate.
- **No `OTHER`** — the column is nullable and `null` already means "inactive, no more
  specific reason recorded".
- `CUT` is user-visible (`deriveLegacyParticipantStatus` passes `inactiveReason` through as
  `participantStatus`), so **golf surfaces render `ELIMINATED` as "Cut"**. The audience keeps
  its word; the core stays sport-agnostic.

Still a Prisma enum rename, so still gated on #191. Full record and the six other decisions
are in the slice-2 outcome below.

**What this section got wrong, worth keeping:** it called this "the only instance found of
sport particulars sitting in the core. Everything else golf-specific is correctly in an
extension table." Slice 2's stage 2 refuted the second sentence in both directions — see
below.

### The cross-cutting questions — all but one now settled

These five surfaced while establishing the approach. Four were answered during slice 1 and
are recorded in [`docs/DOMAIN-OPERATIONS.md`](../docs/DOMAIN-OPERATIONS.md); they are listed
here with their answers so nobody reopens them from this file.

| Question | Answer | Where |
|---|---|---|
| Embed or reference on edges? | **Embed** the canonical `UserDto`; a member reads peer users through the league join and gets the full object (rule 3) | DOMAIN-OPERATIONS "Settled during review" |
| Viewer-scoped fields: sub-object or top-level? | Neither — **off the domain DTOs entirely**, delivered once per league context | A8 |
| Field visibility: omit, null, or always include? | **Always include**, admin-only fields annotated not enforced. Field-level redaction is out of scope by design | DOMAIN-OPERATIONS §13 |
| Does `/account/*` survive as a `me` alias? | **No.** The seven `/account/*` routes and eight `/admin/users/*` routes collapsed into `/users/*` | `modules/users/routes.ts:9` |

**Still open:** *what replaces the `admin` name* for the 68 genuinely administrative
operations. They are real domains and deserve real names. This is slice 4's (#205) by
design, not an unanswered question blocking anything earlier.

## Slice 2 stage 2 — outcome, 2026-09-28

Recorded here because the decisions change the slice's stated scope, and #203's own body was
written before them. The authoritative record with full reasoning is the stage-2 comment on
#203; this is the plan-side narrative.

**The ticket asked four questions. Three more surfaced, and two of those widen the slice.**

1. **Q0** — settled above.
2. **`worldRanking` → `ranking`, on both tables.** The ticket suspected `worldRanking`,
   `oddsToWin` and `seedNumber` were golf/bracket particulars that had leaked into the core.
   **Refuted:** rank, seed and odds are all genuinely cross-sport and all stay. What is wrong
   is the *name* — a rank is not always a world rank. The table each sits on carries the
   meaning: an affiliation row is the competitor's current rank, an event-participant row is
   the rank that applied at that event. Scale: **234 hand-written references across 56
   files**, plus the generated contract.
3. **Two "golf" extension tables have no golf columns — scope change.** `SportEventGolfTier`
   (`tierKey`, `label`, `tierNumber`, `defaultPickCount`) → **`SportEventTier`**;
   `SportEventParticipantGolfValuation` (tier FK, `tierOrderIndex`, `price`, source enums) →
   **`SportEventParticipantValuation`**; `PrismaGolfValuationSource` → **`ValuationSource`**.
   This is Q0's leak pointing the other way — a core concept behind a golf name. Tier, round,
   valuation and standing are common to many sports, not golf inventions.
4. **Standing and round split into base + optional sport extension — scope change.** The
   pattern the core already uses, applied one level down. Round rows hold per-round scores or
   achievements; standing holds the running totals.
   `SportEventParticipantStanding` (core: `position`, `displayPosition`, `status`, `asOf`,
   `currentRound`) + `SportEventParticipantGolfStanding` (extension: `eventStrokes`,
   `eventScoreToPar`, `currentRoundThru`); `SportEventParticipantRound` (core: the
   (participant, round) join and its order) + `SportEventParticipantGolfRound` (extension:
   `strokes`, `scoreToPar`, `thru`).
   **The total number lives in the extension, not the base.** A cross-sport surface ranks on
   `position` and joins the extension only when it needs the score.
5. **Naming rule for the ~40 operations.** Generic model names wherever the concept is
   generic; sport-specific names only for genuinely sport-specific extension objects — which,
   per §3, is fewer tables than the schema currently implies. **Sport is not a filter on most
   routes**: it is established once by selecting a `SportLeague` and inherited from the parent
   thereafter. Only the sport-league list needs a sport filter.
6. **`League` vs `SportLeague` — both names stay.** `SportLeague` is **never abbreviated to
   "league"** in a DTO field, route segment, operationId or comment. Rejected: renaming it to
   `Tour` (wrong for team sports, and it repeats the mistake Q0 fixes) and renaming the
   product's `League` to `Pool` (reopens finished slice-1 work).
7. **The slice splits in two.** Core first, golf second — see below.

### Why ranking on `position` matters beyond this slice

Decision 4 makes `position` the cross-sport rank key, and position is direction-free: 1 is
best in every sport. The raw score that produced it lives in the sport extension, so a
cross-sport surface ranks on `position` and joins the extension only to *display* a score —
it never needs to know whether high or low is better.

That confines score direction to a single point in the system: wherever `position` is
computed from a raw score. Every reader of a standing row is downstream of that and is
direction-free by construction.

So the hardcoded `lowerIsBetter: true` at `contest-management/service.ts` is not the core
half's to fix. It is #234, and the repo owner scoped it **into the golf half (#236)** on
2026-09-29 rather than deferring it — #236 already owns `golf-leaderboard-calculator.ts`,
which is the one place that computes `position` from a score, so doing it in the same pass
avoids editing that file twice. #234 found the field is not only unread but *derivable*:
`SUM_ALL_ENTRIES` preserves the direction of what it sums, so the aggregation row was
restating what `GOLF_RELATIVE_TO_PAR_TOTAL` already implies.

It also found a live defect on the way: `formatRelativeToPar` exists three times and the
copies disagree, so level par renders "E" on the contest entry page and "0" on the
leaderboard and admin event pages. One `format` per scoring definition fixes it.

### Standing obligation carried into the golf half

Set by the repo owner: **actively look for cross-sport concepts wearing sport-specific names
and report them**, rather than renaming only what the slice happens to touch. The test is
"would another sport need this same thing?" Three shapes to watch: a golf-named table with no
golf columns (found: tier, valuation); a golf-named operation over a cross-sport entity; a
cross-sport table with golf-shaped types or defaults (found: Q0's enum).

Seeds already confirmed, recorded on #203: **`ParticipantLeagueAffiliation`** is reachable
only through six golf-named roster operations while its service sits in the generically-named
`modules/sport-catalog/`, a module that registers no routes at all; and **`Sport` carries golf
defaults** — `category` defaults to `GOLF`, `tournamentFormat` to `STROKE_PLAY_TOURNAMENT`, on
the table that is supposed to discriminate *between* sports. Checked and clean, so nobody
re-checks: `SportLeague` and `Season`.

### The split, and a naming caution

**Slice 2 — core** (#235): the schema decisions above, plus ports and DTOs for `SportEvent` /
`SportEventParticipant` / `SportEventRound`. The `ranking` rename spans both halves and lands
here. This half alone unblocks slice 3 (#204).

**Slice 2 — golf** (#236): the golf extension tables, the ~40 admin operations, and the
root-admin frontend, carrying the standing obligation above.

*Do not call these "2a" and "2b" in this document.* §2a and §2b above already mean "User is
the object" and "Viewer context is delivered once per league", and the collision reads badly
in a file where both appear.

### Sequencing

All schema work in either half is gated on **#191** (`migrate-qa` broken), addressed by
PR #232. Nothing in step 3.1 can start until that lands.

## Slice 2 core — outcome, 2026-09-29

#235, executed bottom-up on one branch. #234 (score direction) went first on its own branch,
because it owns `golf-leaderboard-calculator.ts` and the core half had to leave that file's
ranking logic alone.

**3.1 — schema.** One hand-written migration carries every stage-2 schema decision. It runs
as one transaction, so a failure anywhere leaves the database untouched (measured by
appending a division by zero to a copy: P3018, `CUT` rows intact). `CUT` becomes `ELIMINATED`
inside the `ALTER TYPE ... USING CASE` that swaps the enum, so no row can be written with the
old value between the type change and the backfill — there is no separate backfill.
`world_ranking` → `ranking` and the two tier/valuation table renames are renames, not copies.
Standing and round split into a base row plus the golf extension, with the base rows created
**under the extension's existing ids**, so every foreign key and every log line that named a
golf round or standing still names the same thing. The golf live-status string
`'missed-cut'` maps to `ELIMINATED` on the base standing.

**3.2 — DAO.** Ports and Prisma adapters for `Sport`, `SportLeague`, `Season`,
`ParticipantLeagueAffiliation`, `SportEvent`, `SportEventRound`,
`SportEventParticipantRound` and `SportEventParticipantStanding`, each with a DAO test
against Postgres. Two ports in `ports.ts` had no adapter at all — `SportRepository` and
`SeasonRepository` — and the domain `Season` type had drifted from the table; both were
replaced rather than wired up.

**3.3 — services.** `SportLeagueService` and `SeasonService` run on ports. The two copies of
the golf-leaderboard participant loader (contest read and settlement) had drifted; they are
one function now.

**3.4 — DTOs and routes.** One `SportEventDto` for every caller. `EventSummaryDto` and
`AdminEventSummaryDto` each derived the same readiness in their own mapper; `adminListEvents`
was `listEvents` plus four fields, so it is **removed, not re-pointed**, and the root-admin
event browser reads `listEvents`. Both lists lost their paging (§16). Participant create and
update were open to any signed-in user; they now require the root-admin claim (A10).

**3.5 — export** regenerated; **3.6 — frontend**: the event browser, contest creation and
the event-sync page moved to `listEvents` / `SportEventDto`.

### What the sweep found and did not convert

- **Golf services still on raw Prisma** (`golf/*`, including the second participant resolver
  in `golf-score-service.ts`): #236, which owns the golf ports.
- **`events/event-score-source-service.ts`** writes provider linkage on `SportEvent` with raw
  Prisma. Provider plumbing: slice 4.
- **"World rank" labels on golf surfaces**, and `GolfTierSource.WORLD_RANK`: for golf the rank
  *is* the world ranking, so the label is truthful to the audience, in the same way
  `ELIMINATED` renders as "Cut". #236 decides them with the rest of the golf display
  mapping. `PricingMethod.WORLD_RANKING` and `TierAssignmentMethod.WORLD_RANKING` are
  contest-configuration values and belong to #204.
- **`'CUT'` in the mock provider feed** is the provider's vocabulary, not ours; the adapter
  maps it to `ELIMINATED` at the boundary.

### Found on the way, for slice 3 (#204)

- **Standing `position` is never written by production code** — not on the golf standing
  before this slice, and not on the base standing it moved to. The column moved; the gap did
  not. Two readers select it — the golf-leaderboard participant loader and the admin event
  browser — and always get null; contest entries are ranked by the calculator from scores, so
  nothing breaks. But the `position` contract only holds once whatever writes standings
  computes it, and #204 should not build a reader on the column before then.
- `ContestService.createContest` writes no scoring-rule rows, and there are two
  `createContest` implementations.

## Sources / Prior Decisions

- #201 — this epic. #192 — the publishing mechanism, which must follow this work for
  `admin` and `admin-golf`. #193 — contest authorization, which stops being a side issue
  because permissioning is the mechanism that makes one operation set work. #195 —
  `isRootAdmin` claim consistency, same area.
- Repo owner, this session: *"I would like to use the full object, all properties. Not get
  too precise based upon the page/control needs."*
