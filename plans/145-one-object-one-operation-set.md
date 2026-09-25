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
   plan is deleted (ADR-0002).

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
| 3.6 | **Export** — register the canonical DTOs as named components, regenerate the client SDK (this is #192, resumed for the cluster) | boundary |
| 3.7 | **Frontend** — every surface touching the object or one of its shadows moves onto the generated type, using the full object (rule 3) | 2 |

**A slice's stage 3 stops at 3.5.** Steps 3.6 and 3.7 do not run per slice — see the phase
split below. A slice is done, for phase-1 purposes, when its schema, DAO, services, routes
and tests name the cluster's entities one way and the phase-1 gates are green.

## Two phases — backend first, then the frontend in one pass

Set by the repo owner. All of it lands on **one branch**; the phases are a sequencing rule
within that branch, not separate branches or separate PRs.

> "Instead of trying to fix everything in a single pass, first adjust all of the backend and
> tests. Make sure the service build is clean. Then begin on the front-end once all of the
> types and client SDK's are exported."

**Phase 1 — every slice, backend only.** Slices 1 through 4 each run stages 1, 2 and steps
3.1–3.5. The webapp is not touched and is *expected to be broken* for the duration: routes
and DTOs are changing underneath it and the generated client has not been regenerated yet.

**The boundary — export once.** After the last slice's backend is green, run 3.6 for
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
(backend) units** — each runs stages 1 and 2 and steps 3.1–3.5, and none of them touches the
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

**Stage 1.0 and stage 2 are already done for this slice** — the ER diagram is in #202 and the
repo owner's answers are recorded in `docs/DOMAIN-OPERATIONS.md` (access rules A1–A7). Two
schema changes came out of that review and are step 3.1 for this slice:

- Add `@@unique([leagueId, name])` to `Squad` — squad names are unique within a league.
- Drop `League.createdBy` — not a concept the model needs. Removes the column, the field in
  `domain/types.ts`, the mapping in `prisma-league-repository.ts`, and the DTO field in
  `admin/league-service.ts`.

Stage 1's shadow inventory has not been run yet. Known starting points to confirm are listed
above.

### Slice 2 — Events and participants (the cross-sport core)
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

The genuinely admin-only operations. No shared objects and no collapse: this slice is naming
(stop calling it "admin") and bringing services onto ports for consistency.

### Phase 2 — the frontend, once
Not a fifth slice. Runs after all four slices' backends are green and step 3.6 has exported
the canonical DTOs and regenerated the client SDK. Every webapp surface touching any object
in slices 1–4 moves onto the generated type, using the full object (rule 3).

Its gates are the ones phase 1 deliberately skips: `npm run lint:webapp`,
`npm run typecheck:webapp`, `npm run test:poolmaster:unit`, and green `poolmaster-build` /
`poolmaster-unit-tests` in CI.

## Open Questions — found so far

These surfaced while establishing the approach. **The rest are expected to surface in each
slice's stage 2**, which is the point of the workflow: they are discovered with the cluster's
context loaded, not guessed at up front.

### Q0. Golf has leaked into the cross-sport core — rename the enum?

`SportEventParticipant` is the cross-sport entity, but its `inactiveReason` column is typed
`PrismaGolfParticipantInactiveReason`. The values are `WITHDRAWN`, `CUT`, `ELIMINATED` —
`WITHDRAWN` and `ELIMINATED` are sport-agnostic; only `CUT` is golf-flavoured, and it has a
natural analogue in other cut/elimination formats.

**Proposal:** rename the enum to `ParticipantInactiveReason` and keep the values. The core
entity then carries no sport-specific type. It is a Prisma enum rename, so it needs a
migration — cheap, but not free while `migrate-qa` is broken (#191).

This is the only instance found of sport particulars sitting in the core. Everything else
golf-specific is correctly in an extension table.


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
