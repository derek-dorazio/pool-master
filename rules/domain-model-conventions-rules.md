# PoolMaster — Domain Model Conventions Rules

These rules define consistency conventions for the PoolMaster domain model
itself. Use them when proposing, reviewing, or implementing schema/entity/DTO
shape changes.

This file is intentionally separate from two others:

- `domain-model-conventions-rules.md` defines **what a consistent model should
  look like**
- [model-change-rules.md](./model-change-rules.md) defines **the process/checklist
  for changing a model safely**
- [domain-model-concepts.md](./domain-model-concepts.md) says **what the model is** —
  the entity chain, what each entity means and is called on screen, and the verbs

---

## Guiding Principle: Strongly Typed End-to-End

PoolMaster's domain model is **strongly typed at every layer** — Prisma schema,
service-layer interfaces, shared Zod DTOs, generated SDK, and React consumers
all agree on the same shape for the same entity. Drift between layers is a
defect, not a tolerable trade-off.

Specifically:

- **Amorphous shapes are forbidden** when the application code already knows
  the shape. `Json` columns, `z.record(z.unknown())`, `Record<string, unknown>`,
  and discriminator-driven nullable columns are all variations of the same
  anti-pattern: pushing interpretation onto the reader instead of encoding it in
  the type system.
- **The only acceptable use of opaque shapes is at integration boundaries**
  where the shape genuinely cannot be enforced — raw provider payloads
  pre-normalization. After normalization, the shape is typed.
- **Strongly typed beats more concise.** Verbose table names, more mapper
  files, and more discriminated-union variants are acceptable costs when the
  alternative is nullable interpretation, JSON-blob fields, or
  schema-as-context-dependent.

The rules below are concrete applications of this principle.

Sections are numbered §1, §2, then §8 onward. §3–§7 were merged into §1 and §2 when this
file was de-duplicated; the later numbers are kept because code comments, generated API
descriptions and an applied migration cite them by number.

---

## 1. Lifecycle

### Active vs Inactive

Default convention for soft-delete-style lifecycle:

- use `isActive: boolean`
- `true` means the record is active in normal product flows
- `false` means the record remains persisted but should normally be filtered out
  of active/default views or treated as read-only/inactive

Use `isActive` by default for:

- soft delete
- inactive records that remain queryable
- read-only preserved records
- eligibility gating before a later hard delete

When an entity uses `isActive`, it must be a first-class persisted field in the
storage model itself.

- do not model `isActive` only in DTOs
- do not hide `isActive` inside JSON/settings blobs when it is a true lifecycle
  concept for the entity
- expose the same first-class `isActive` concept consistently through shared
  domain types and relevant DTOs

Do not invent multiple lifecycle shapes for the same meaning across entities
without a documented reason.

### Hard Delete

Permanent delete should usually mean actual row removal.

- hard delete removes the record
- do not add `deletedAt` just to accompany a true hard delete
- only add tombstone-style fields such as `deletedAt` when the product
  explicitly needs retained deleted-record metadata rather than real removal

### Status

Reserve `status` for workflow or business-state progression, not basic
soft-delete semantics.

Examples of appropriate `status` usage:

- contest workflow
- invitation lifecycle
- member approval flow
- scoring or processing progress

Examples of what should usually **not** use `status`:

- simple active/inactive lifecycle
- "soft deleted" records that only need normal filtering

If both concepts are needed, keep both:

- `status` for workflow/business meaning
- `isActive` for record activity/presence

Do not collapse them together for convenience.

### Inactive Reasons

If future business needs require distinguishing *why* something is inactive,
prefer a separate field such as:

- `inactiveReason`

This allows PoolMaster to keep the primary active/inactive filter simple while
still supporting richer lifecycle semantics later.

Do not over-model reason enums preemptively when current product behavior only
needs active vs inactive. `SportEventParticipant.inactiveReason` (`WITHDRAWN`,
`ELIMINATED`) is the reference case of one that earned its place.

### Start with the simplest lifecycle

When designing a new entity, start with the simplest lifecycle model that matches approved
product behaviour, and move along this progression only when the product needs the next
step:

1. no lifecycle field, when the entity is always ephemeral or always hard-deleted
2. `isActive`, when it needs a simple soft-delete / inactive state — `League` and `User`
   are the reference cases
3. `inactiveReason`, when *why* it is inactive genuinely matters
4. `status`, when workflow or business-state tracking is required — invitation and contest
   lifecycles are the reference cases

`LeagueMembership` and `SquadMembership` depart from this: each carries a
`status` of only `ACTIVE | INACTIVE`, which is step 2's meaning under step 4's name. Do not
copy that shape onto a new entity.

### Filtering

Default "active" product views filter on `isActive=true` when the entity uses this
convention. When inactive records remain user-visible, say so explicitly in the contract and
the UI plan, and make the difference clear in route docs and DTO field descriptions. Do not
rely on tribal knowledge for whether inactive rows still appear. That `isActive` is a read
filter and not a write lock is access rule A9 in
[`docs/DOMAIN-OPERATIONS.md`](../docs/DOMAIN-OPERATIONS.md).

### Lifecycle on the wire

DTOs should preserve the same lifecycle semantics as the domain model.

- if an entity uses `isActive`, its API-facing DTOs should normally expose
  `isActive` rather than translating that concept into a different lifecycle
  field name
- do not use DTO-only `status` values to represent soft delete when the domain
  model uses `isActive`
- if a DTO intentionally differs from the domain model, document the boundary
  reason in a code comment at the mapper, where the next reader will be standing

Lifecycle wording should stay consistent across:

- Prisma schema
- shared domain types
- DTOs
- service logic
- route documentation
- frontend UI copy where practical

### Questions to ask of any proposed model change

- Is the lifecycle concept soft delete, workflow state, or both?
- Is `isActive` the right primary field, or is `status` being misused to stand in for
  simple active/inactive semantics?
- Will the DTOs stay semantically aligned with the proposed model?
- Is a proposed extra field needed now, or should it be deferred?

If a proposal breaks these conventions, say so before implementation begins. The process
for making the change safely is [`model-change-rules.md`](./model-change-rules.md).

---

## 2. Closed Sets Are Enums

When a field is intentionally constrained to a closed set of values, model it
as an enum/union rather than a broad string.

Use enum-backed modeling for:

- persistence schema enums when the storage tier supports them and the value set
  is stable
- domain enums in `packages/shared/domain/enums.ts`
- shared domain types
- DTO schemas
- mapper return types

Do not use free-form `string` when the product meaning is actually:

- a known provider set
- a known format choice
- a known policy choice
- a known workflow state

If persistence still stores a broad string temporarily, document that as
transitional debt and keep the API/domain surface strongly typed.

For closed sets that are stable enough to persist strongly:

- use a first-class enum in the persistence schema rather than a broad `String`
  column
- keep mapper logic explicit when persistence enum identifiers differ from the
  API/domain literals
- normalize legacy values during migration rather than preserving stale aliases
  indefinitely

Do not leave persistence as free-form text once the repo has high confidence
that the values are:

- closed
- reviewed
- actively used in product/API flows

### Every enum declares its order

A new enum in `packages/shared/domain/enums.ts` states its order beside it, as
`<Name>Order`: `explicitOrder({...})` giving every value its place, or
`alphabeticalOrder('<Name>')` when the set has no natural order and its values sort A
to Z by their display strings, in the reader's language. Every list, grid, picker and sort uses that
order through `compareByEnumOrder` or `sortByEnumOrder`; no consumer keeps a
`Record<Enum, number>` rank map of its own. A screen that genuinely needs another
order (the Home page's current contests, Open before Live) gets a named order beside
the enum, such as `ContestStatusOrderForHomeCurrent`, with a comment saying where it
applies. `tests/unit/shared/enum-order.test.ts` refuses an enum without an order, and
`rules:check:enum-order-maps` refuses an order map declared anywhere else.

The Prisma enum declares its values in the same order, because an SQL `ORDER BY`
on the column sorts by declaration order. Where that order cannot match (reordering
a Postgres enum's values is a migration with a type swap), no read orders by the
column in SQL: the read sorts in code with `compareByEnumOrder`, and the enum is
listed with its reason in the test's `SORTED_IN_CODE`.

An enum whose every value has a reference row may keep its order on that row instead, as a
`display_order` column, when the order is a fact an admin or a migration sets rather than one
the code decides. `Sport` is the one such enum: each `sports` row carries its `displayOrder`
(and its stored `urlSegment`), the API returns them, and every list of sports, web lists
included, sorts by them. No `SportOrder` sits beside the enum, and the test's
`ORDERED_BY_ROW` names it with its reason.

### Every enum value has its words in the display-string module

The words shown for an enum value are not kept beside the enum or on any screen: every value of
every enum in `enums.ts` has an entry in `packages/shared/display-strings/en-US.ts`, read
through `enumLabel('<Name>', code)` (`rules/ux-rules.md` §16 *Display Strings*). A new enum
is added to `SharedEnums` in `display-strings-module.ts` and given its words in the same
change; the type check fails on a missing value, and `rules:check:display-strings` fails on an
enum left out of `SharedEnums`. No code declares a `Record<Enum, string>` of its own.

### A yes/no field is a Boolean

A field that answers yes or no is a non-null `Boolean`, shown as Yes or No. A
third state ("not set", "not applicable", "unknown") is not a nullable Boolean: it
is a named enum whose values say what each state means.

---

## 8. Typed-End-to-End DTO Conventions

These rules apply specifically to keeping types aligned across all layers of
the contract chain.

### Type alignment across layers

If a TypeScript interface exists in the service layer for an entity's data,
the Prisma schema must store it as typed columns (or as a child table for
variable-cardinality data), and the DTO must expose it as a typed Zod schema.

- A shape that's typed in `packages/core-api/src/.../types.ts` but stored as
  Prisma `Json` or wired as `z.record(z.unknown())` is drift.
- The fix is to promote the shape: typed Prisma columns or child tables, typed
  Zod schema, regenerate the SDK.
- Drift between any two of the three layers (storage, service, wire) is a
  defect, not a tolerable trade-off.

### One canonical DTO per entity

Each domain entity has **one canonical response DTO** that represents the
full shape of the entity for any caller with full access. It's used for list,
detail, dashboard, and any other read view at the full-access level.
Frontend filters fields it doesn't render.

- Per-page DTO variants (`LeagueListDto`, `LeagueDashboardDto`) are forbidden.
  They drift.
- The canonical DTO is the single source of truth for the entity's full
  shape on the wire.
- **There are no supplementary variants.** Not for a page, not for a role, not
  for an access level. One entity, one DTO. See §13 and §14.

### Mutation inputs derive from the canonical DTO

Create / update body schemas are derived from the canonical entity Zod schema
using `.pick()`, `.omit()`, or `.partial()` — not hand-shaped from scratch.
The TypeScript types are inferred from the derived schema, not declared
separately.

```ts
// Correct — Zod-first, TypeScript inferred
export const CreateLeagueBodySchema = LeagueDtoSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateLeagueBody = z.infer<typeof CreateLeagueBodySchema>;

// Forbidden — hand-shaped, drifts from LeagueDtoSchema silently
export const CreateLeagueBodySchema = z.object({
  name: z.string(),
  // ...
});
```

Deriving the schema means every change to the canonical DTO automatically
flows to its mutation inputs at compile time. Hand-shaping breaks that
guarantee.

### No DTO variants — view-driven or permission-driven

A list-view DTO that omits fields "for performance" is forbidden — that's view
convenience and drifts from the canonical entity shape.

A redacted DTO that hides fields based on the viewer's access level is **also
forbidden**. Permission decides who may call an operation; it never justifies a
second shape. Admin-only fields are annotated on the canonical DTO and left
exposed — see §13.

- ❌ `LeagueSummaryDto` for list view + `LeagueDetailDto` for detail page —
  view convenience, drifts. Both existed in the published contract until the
  identity refactor deleted them; the comments recording why are in the DTO files.
- ❌ `AdminTeamOwnerSummaryDto` — three fields of `SquadMembership`, described in
  its own docstring as a "thin owner summary row for root-admin surfaces".

#### Struck: the former permission-variant allowance

Until 2026-09, this section permitted redacted variants for restricted access
levels, with `ContestEntryThinDto` given as an approved example. **That allowance
is withdrawn**, for a reason worth recording so it is not reinstated:

`ContestEntryThinDto` was never built. In the entire codebase the allowance
produced **zero** of the variants it sanctioned, and exactly one artifact —
`AdminTeamOwnerSummaryDto`, a shadow copy of `SquadMembership` written in the
allowance's own vocabulary ("thin", role-scoped, "for root-admin surfaces") while
violating this section's own canonical-DTO rule.

A rule that produced only its own abuse is not a rule worth keeping. If genuine
field-level redaction is needed later, it is a model change requiring explicit
approval under §14 — not a standing licence.

---

## 9. Schema Design — Discriminated Unions and Constraints

### Discriminated unions are physical, not nullable-conditional

When variant data has minimal cross-variant overlap, the table must be split
into separate tables on the discriminator axis.

A single table with nullable columns whose meaning depends on a discriminator
column is a JSON blob in column syntax — same anti-pattern, same problems:

- Schema stops being self-documenting (readers need outside context to
  interpret a row).
- Database constraints become impossible (`UNIQUE` over partially-NULL tuples
  is ambiguous).
- Application code has to branch on the discriminator before reading any
  variant column.

The decider is the schema-as-documentation test below: if every column of a
candidate single table applies to every row regardless of the discriminator
value, the single table is correct. If some columns are meaningful only when
the discriminator has a specific value, the table must be split. There is no
threshold around "how many nullable columns is too many" — the test is
binary.

A common case where a single table is correct: `league_memberships`. Its
columns (`league_id`, `user_id`, `role`, `status`, `joined_at`) apply to every
row whether `role` is `COMMISSIONER` or `MEMBER`. The role discriminator
narrows what the membership authorizes, not which fields exist. Splitting it
by role would also cost a constraint — `UNIQUE (league_id, user_id)`, one
membership per user per league, cannot be enforced across two tables.

### Make impossible states unrepresentable at the storage layer

The database schema enforces what it can — `NOT NULL`, foreign keys, unique
indexes, check constraints. Application code is the second line of defense,
not the first.

- Failure proximity: a wrong write must fail at insert time with a
  constraint error, not at read time with a confused renderer.
- "We'll enforce that in the service layer" is acceptable only when the
  constraint genuinely cannot be expressed in the schema.

### Schema-as-documentation

Every column in a table applies to every row. If a column is meaningful only
when another column has a specific value, the table must be split.

Test: can you describe what a column means without referencing any other
column's value? If yes, it belongs. If no, the table is two tables in
disguise.

### No nullable either/or parents

A row never has two or more nullable foreign keys of which exactly one is set ("this pick
points at a team *or* a player", "this finding is about an event *or* a game"). The pair is a
discriminated union in column syntax: the database cannot say "exactly one", a reader has to
test which one is filled before it knows what the row is, and every new kind of parent adds a
column and widens every reader.

- **Smell:** `teamId?` beside `playerId?`, `eventId?` beside `gameId?`, a check constraint
  `num_nonnulls(a, b) = 1`, or a comment saying "one of these is set".
- **Instead:** point at the one parent the alternatives share. A team and a player in an
  event are both field rows, so a pick points at one `SportEventParticipant`; a side of any
  Match is one `…MatchSide`. Where no shared parent exists, the variants are separate tables
  (*Discriminated unions are physical, not nullable-conditional*, above).
- **One nullable parent is fine** when null has one meaning of its own, such as a Match side
  whose field row is not known yet (an undecided bracket place). The rule is about choosing
  *between* parents, not about a parent that may be missing.

---

## 10. Naming Disambiguation

No bare noun is reused across the domain for two distinct concepts.

If `Participant` exists as a real-world entity (e.g., a golfer in a
tournament), the pool-app side uses a different word (`Pick`) for the
analogous concept. Disambiguate at the entity-name level, not via context.

When a bare noun would otherwise collide across two domains, the
longer-prefixed name wins:

- `ContestEntryPick` not `Pick` — there are multiple pick-like entities; the
  prefix clarifies the parent.
- `SportEvent` not `Event` — `Event` overloads with DOM and Node events, and with "domain
  event" as a general term.
- `SportLeague` not `League` — `League` is already the office pool.

This is **not** a rule to prefix every entity. It's a rule to disambiguate
where there's collision risk. Bare names that have only one referent in the
domain (`Participant` is fine if no other "participant" concept exists) stay
unprefixed.

### Full-path names

A table that belongs to another is named by its full owner path, so the name says where it sits
without reading the schema: `SportLeagueSeasonPhaseSlot` is a slot of a phase of a Season of a
sport league, and `SportEventRoundMatchGameSideResult` is a side's result in a game of a match
of a round of a sport event. Two tables with the same last word (a slot definition and a
Season's slot) never need context to tell apart.

- **`SportEvent` is the event path's root.** It is not renamed `SportLeagueSeasonEvent`: it
  points at its Season with a `seasonId` foreign key, and its own tables
  (`SportEventRound`, `SportEventParticipant`, …) extend its name.
- **A platform setting a league picks is a `Platform…Profile` table**, and the league's
  column that picks one is `platform…ProfileId` (`PlatformTierProfile` and
  `SportLeague.platformPlatformTierProfileId`). A profile is defined once, at platform level, and
  shared; nothing sets it per sport.
- **A row of settings that is copied into something when it is created is named
  `…Template`** (`ContestConfigTemplate`); the copy belongs to its target, so a later change
  to the template never rewrites what was copied. A copy kept on the target row (a Season
  slot's series format, copied from its definition) is a column there.
- **A link table is named by its owner plus the target's distinguishing last words**, not the
  target's full path: `SportEventSlot` links an event to its Season slots, and
  `ContestSeasonSlot` links a contest to its covered Season slots (which also keeps it apart
  from `ContestEntryPick.slot`). The plan or ADR that adds a link table settles its name.
- **A provider key's table ends in `…ProviderMapping`** (§17 *Provider keys live only in
  ProviderMapping tables*).

---

## 11. Open-Ended Additive Substrate Design

Schema designs must accommodate future variants (new sports, new contest
types, new event formats) without reshaping what exists, and without a new
table set for every variant.

- **One model when the shape is the same.** Before adding a table, check
  whether an existing one already holds that shape: a playoff series is one
  match with a game row per game played, an NFL week reuses the bracket's
  matches, every family's settled total is the one
  `ContestEntryStanding.totalScore`. A per-sport or per-variant copy of an
  existing shape is the smell; consolidate instead.
- **Results have one shape for every sport.** The target model
  (`domain-model-concepts.md` §5 *The Target Model*) records every result the same way:
  - **A Match has two or more sides.** Two teams, two players, or a whole field: a golf
    stroke-play round is one Match with every golfer as a side, and a race is one Match
    with every driver as a side. A best-of series is one Match.
  - **Head-to-head or field is a property of the Round** (`matchFormat` `HEAD_TO_HEAD` /
    `FIELD`), read from the feed where it varies by round. A `HEAD_TO_HEAD` match has
    exactly two sides; a `FIELD` match has one per competitor. Nothing branches on the
    sport to tell them apart.
  - **A side's number is its fixed place, not home or away.** A Match side holds its field
    row, its `sideNumber` and its spread (side 1 only). The sync writes the away side as 1
    and the home side as 2 on Matches it creates, and never renumbers an existing one. Code
    reads sides by number, never by assuming home or away.
  - **Home/away is per Game, on the Game side result** (`homeAway` `HOME` / `AWAY` / `NONE`),
    because it alternates within a series; a neutral-site Game or a `FIELD` match records
    `NONE`. **The seed is on the event field row only**, never copied onto a Match side.
  - **A Game is one game played** in a Match, and each side's result in that Game is one
    Game side result row (score, position, periods completed, home/away, status). A side's outcome in
    the Match (WON / LOST / TIED / PENDING) is a rollup of its Games.
  - **Period scores are per Game side result** (a period kind `REGULAR` / `OVERTIME` /
    `SHOOTOUT`), and **player stats are per Game** (one row per Game, player and stat
    code). Neither is stored per period of a player, or per team.
  - **No sport or scoring family gets its own result tables.** A golf round, a race result and
    a game score are all Game side results. A `FIELD` event's final result per competitor is
    one standing row; a head-to-head result lives on its Match sides, and a season standing
    belongs to the Season, so no standing row is written for them. A new sport adds data and,
    at most, columns every row of the shape can carry, never a `…GolfRound` or `…RaceResult`
    beside the shared shape.
  - *Status:* today's schema still has the per-family tables (`SportEventRoundMatch` with home
    and away columns, `SportEventParticipantGolfRound`, `…RaceResult`). Code that touches
    them extends nothing new onto them; the league model redesign replaces them (ADR 0012).
- **A new shape goes with its scoring family, not its sport.** Where a family scores
  differently (matches decided by games won, stroke play by strokes), the difference is one
  function per family over the shared result shape, never a table set
  (`architecture-rules.md` §4 *Service Topology*, the sport registry and scoring families).
  Adding a sport to an existing family adds a registry entry and data, not tables.
- **Adding a variant within an existing axis** is a new row or enum member.
  A new nullable column on an existing table that only one variant fills is
  the smell to avoid.

The substrate test is: "can the next sport / contest type / variant ship by
reusing an existing shape or adding its family's own tables, without
altering what other variants use?" If no, the design is too coupled to
today's variants.

---

## 12. League, Squad, and Membership Invariants

What a Squad, a membership and an owner *are* is
[domain-model-concepts.md](./domain-model-concepts.md) §2 *Vocabulary*. These are the
rules the model holds them to. Do not introduce synonyms or sub-concepts for them.

### Squad, never team, in the contract layer

Route paths, DTO fields and variable names use **Squad**. `teams[]` as a field name for
squads is wrong. The reasoning, and the UI-side half of the rule, is
`rules/poolmaster-webapp-rules.md` §1 *A Squad Is a Team On Screen*.

### Squad member and squad owner are the same thing

`SquadMembership` has **no role column**. Every member of a squad is an owner of it. There
is no primary owner, no secondary owner, no owner-versus-member distinction. Do not add
one, and do not name a field `owners` when the entity is `SquadMembership`.

Contrast with `LeagueMembership`, which *does* carry `role: COMMISSIONER | MEMBER` —
that distinction is real and belongs to the league edge, not the squad edge.

### One squad per user per league

`SquadMembership.@@unique([leagueId, userId])` is a deliberate product rule: **a user
belongs to at most one squad in any given league.** It keeps screens and flows simple
and is intended to stay.

This is why `SquadMembership.leagueId` is denormalised even though it is derivable via
`squad.leagueId` — the constraint needs it on the row. **That denormalisation is
load-bearing; do not "clean it up".**

### Squad names are unique within a league

`@@unique([leagueId, name])`. A league may not contain two squads with the same name.

### League creation establishes the first commissioner

Creating a league must also create a `LeagueMembership` for the creator with
`role = COMMISSIONER`. That membership is the authoritative statement of who runs a league,
and it is the **only** record of it: `League` has no `createdBy` column.

It had one until #202. It was a bare uuid with no relation, and because the membership is
written in the same operation as the league, any query over it was answerable from
`LeagueMembership` instead — including the two user-hard-delete guards that counted it.
Do not reintroduce a creator column on an entity whose creator already holds a membership
or ownership row; that row is the fact, and a parallel column is a second source for it.

### Membership and squad membership are one unit

**Every ACTIVE `LeagueMembership` has exactly one ACTIVE `SquadMembership` in that league,
and no ACTIVE squad membership belongs to a non-member.** Both paths that create a league
membership also create the squad membership, so the squad list *is* the member roster —
expect it to be the member layer's UI rather than a separate roster screen.

Every way a membership can end routes through the one unit that ends both. `removeOwner`
once ended the squad membership and left the league membership, so a removed co-owner kept
league access while vanishing from every surface that lists people. An integration suite
asserts the invariant against the database after each way a membership can begin or end;
a new path that creates or ends either edge must go through the same unit.

### League and squad management never touches a user's account

Ending a relationship must not mutate the object's lifecycle. Leaving a last league once
deactivated the user and revoked their refresh tokens, which made recovery impossible:
login refuses an inactive account, accepting an invitation needs a session, and only a root
admin can re-enable. The unit that ends a membership takes no Prisma client, so the
guarantee is structural — keep it that way. Account state belongs to the user
(self-service disable) and to a root admin; see §13 *Operation Access Roles*.

---

## 13. Operation Access Roles

Every operation declares who may call it. The declaration is part of the contract and
belongs in the route definition and the OpenAPI description, not in tribal knowledge.

### The actors

| Actor | Scope |
|---|---|
| **Root admin** | Every league, every user, every object |
| **Commissioner** | One league — the league their `LeagueMembership.role` names them commissioner of |
| **Member** | One league — as a `LeagueMembership` holder |

### The default access pattern within a league

This is the common case and should be assumed unless an operation states otherwise:

| Actor | Own data | Peer data (same league) | League-wide data |
|---|---|---|---|
| **Member** | read / write | **read only** | read |
| **Commissioner** | read / write | read / write | read / write |

"Own data" means the objects tied to the caller's own `SquadMembership` — their squad,
their contest entries, their picks. "Peer data" is the same objects belonging to another
member of the same league. **Members can see their peers; they cannot change them.**

### Annotating operations

Each operation is tagged with the minimum role required, and where the own/peer
distinction applies, which side it falls on. Examples:

- `rootAdmin` — cross-league operations
- `commissioner` — league-scoped write
- `member:own` — the caller's own data, read or write
- `member:peer` — another member's data, read only
- `member` — league-scoped read available to any member

An operation whose access cannot be expressed in these terms is a signal that the
operation is modelled wrong, not that the vocabulary needs extending. Raise it.

### Access level is not a reason for a second object

Permission never justifies a duplicate DTO, a duplicate route, or an `AdminXDto`
alongside an `XDto`. The object is the object; the role decides who may call the
operation. See §8 and §14.

Field-level redaction for lower-privilege callers has **no implementation yet**.
Admin-only fields are annotated on the canonical DTO and left exposed for now — a
deliberate, recorded trade in exchange for a single coherent model. Do not build a
redaction scheme, and do not create a variant DTO to avoid one.

**One recorded exception: counts that cost queries on every read.** `SportEventDto.adminCounts`
(release readiness and the contest count across every league) is filled for a root admin and
`null` for everyone else. It is still one object with one shape; the field is nullable and its
description says who gets it. The reason is cost, not secrecy alone: those counts were five extra
queries on every member's event read, and the contest count crossed leagues, which are tenants.
A new exception needs the same two things — a measured per-read cost and a nullable field on the
canonical DTO — and is recorded here; it is never a second DTO.

---

## 14. Gaps Are Requirements

No shadow or derived object may be created — no per-page DTO, no projection, no "just
for this view" shape, no `AdminXDto` beside an `XDto`.

If the model appears to lack something, that is not licence to work around it. Bring it
back as a question: **what is the new concept, and where does it fit in the core domain
model?** The answer either changes the model — a new entity, edge, field or operation —
or reveals the concept already exists under another name. Both are progress. Inventing
a parallel shape is neither.

**A written convention has already proven insufficient here.** §8 forbade per-page DTO
variants from the repository's first commit, naming `LeagueSummaryDto` /
`LeagueDetailDto` as the explicit counter-example — and both shipped in the published
contract anyway, until the identity refactor deleted them. Treat this section as a hard
stop, not guidance, and prefer a mechanical guard over a restated rule.

---

## 15. Residue — The Right Mechanism, Built Then Bypassed

§14 covers the shadow object someone *created*. This section covers its twin, which has
been the more common finding by far: the correct mechanism **already existed and was not
used**, so a second path grew beside it and both now ship.

This is not a milder version of §14. It is worse in one specific way: the codebase
contains proof that someone already understood the problem, so the next reader finds two
plausible paths with no signal that one is abandoned. "Does it exist?" is the wrong
question — the answer is usually yes.

One pass over the identity cluster (#201, #202, #206) found seven: a whole mapper that no
handler called, a request decorator bypassed by reading identity from the request body, a
repository port bypassed by 60-odd raw Prisma calls, and four more. All were removed. Assume
any cluster holds more.

### The rule

**Finding that the correct mechanism exists does not close the finding. Removing the
bypass does.** A slice is not done while both paths ship. Specifically:

1. **Check for an existing mechanism before adding one** — a repository port, a mapper, a
   provider, a cached query, a request decorator. Search for the capability, not the name
   you would have given it.
2. **When you find one unused, the unused-ness is the defect.** Wire the callers to it and
   delete the bypass in the same change. Leaving a correct-but-dead mechanism in place is
   how it stays dead.
3. **Dead code that encodes a convention is worse than absent code.** `auth.mapper.ts`
   looked like the convention was being followed. Delete it or use it; never leave it.
4. **Prefer the compiler over the serializer.** A contract enforced only by a runtime
   stripping unknown fields is not enforced. The dead mapper was invisible for exactly that
   reason: Fastify's serializer dropped what the handlers shaped wrongly.

### Every slice ends with a residue sweep

Set by the repo owner, 2026-09-26: *"So many times your answer is yes that already exists,
but it wasn't used. I want all of the residue removed."*

The last phase-1 step of every slice is a deliberate sweep of the cluster for residue and
derivations that the slice's forward work did not happen to touch — not a review of the
diff, a search of the cluster. It is a numbered step in the workflow precisely because
it will not happen if it is left to judgement at the end of a long slice.

---

## 16. No Paging In The API

Set by the repo owner, 2026-09-26: **no API operation takes `page`, `pageSize`, `limit`,
`offset` or a cursor, and no response carries a paging envelope.**

A list operation returns its whole result. Narrowing is the job of a **filter** — a league,
a status, a search term — which answers "which rows do I want", a question the caller can
actually answer. Paging answers "how many at a time", which is a transport concern that
leaks into the contract, forces a second parallel count query, and makes every consumer
reassemble a result the server already had.

**A list returns current data by default, and history is reached by a filter.** A league
keeps every season it has played, so a list that returns everything grows with history while
the screen only needs what is current. The default answer is what is open and live — the
current season, the open and in-progress contests — and older rows are one filter away, such
as a year. Where a set could grow without bound even then, the answer is a tighter filter or
a retention policy, not a page parameter.

### What this rules out

- Query parameters `page`, `pageSize`, `limit`, `offset`, `perPage`, `cursor`.
- Response envelopes carrying `total`, `page`, `pageSize` or `totalPages` beside `items`.
  Use an entity-named array — `{ users: [...] }`, `{ leagues: [...] }`, `{ squads: [...] }`
  — matching `LeagueListResponse` and `SquadListResponse`.
- Repository ports that take paging arguments or return `{ items, total }`. A port is not
  a place to hide a page either: `ParticipantRepository.search` takes a term and filters,
  and returns `Participant[]`.

**Append-only history is bounded by a window, not a page.** The sync-run history grows
without bound, so `listProviderSyncRuns` (formerly `adminListProviderSyncRuns`, which took
`limit`) takes a submission-time window instead: `from` and `to`, defaulting to the last six
hours, backed by an index on `created_at`. That is a filter, not a page — the caller asks for
a time range and gets everything in it. Reach for the same shape for any future log-like
read.

**A platform-wide list requires its filter.** The lists that cross leagues — every sport
event, every participant — grow with the platform, not with a league, so none of them may be
read whole (#1180). Events need a sport, a sport league or a year
(`SPORT_EVENT_FILTER_REQUIRED`); participants need a sport or a search of at least
`PLATFORM_SEARCH_MIN_LENGTH` characters (`SEARCH_TERM_REQUIRED`). The search is a substring
match, so each column it matches carries a trigram GIN index. A background job that must
reach every row has its own named read, such as `LeagueRepository.findActive` for the
commissioner notices (#1313). A Manage page over one of these lists asks for the filter
first — a search box, or a year that defaults to this one — rather than loading everything
and filtering in the browser.

**The root admin's Customers grids read every league and every user whole**
(Derek, 2026-11-18: root admin grids load every row and filter on the client, with no server
search and no paging). `listCustomerLeagues` and `listCustomerUsers` (#1882) answer from a
fixed number of grouped queries, so they cost the same for any number of rows (a pinned
query-count test holds each), and are rate limited per address. They replaced the searched
user list and `listLeagues`'s every-league scope (#1896); `listLeagues` reads only the
caller's own leagues. A new whole-platform read
for a root admin grid follows the same three conditions: grouped queries, a scaling test,
a rate limit.

---

## 17. Rules Live In The Model, Not In Code

The same facts end up hard-coded across sync adapters, services and the web app, each copy
plausible on its own: round tables per league, season rollover months in five readers, a
date window that finds one league's playoff, ids built and parsed as strings, and one "is
this a week of games?" guess in three copies. Every one had passed review. **A fact about a sport, a league, a season or an event is data. It
lives in the model, is set once, and code reads it. Code holds behaviour, never a table of
facts about particular leagues.**

The sections below are prohibitions. Each names the smell to search for, because a reviewer
reading a single hunk sees plausible code (`rules/review-triggers.md` §9 *Reviewing for
hard-coded rules* is the review lens; the `scan-hard-coded-rules` skill sweeps the codebase
for them).

### Identify by key, never by position

A row, a round, a phase or a slot is found by its id, its code or a stable key column, never
by where it sits in an array or by counting.

- **Smell:** `rounds[3]`, `rounds.length - 1` as "the final", `weeks.indexOf(week) + 1` as a
  round number, "distance from the final", "the first event that started", an index into a
  list returned by another call, a `Record<number, …>` keyed by round number that one league
  fills in.
- **Instead:** a key the model declares (`FINAL`, a slot key, a phase kind code) or a foreign
  key. Order comes from enum order (§2 *Every enum declares its order*) plus a checked
  qualifier column where the enum repeats (a `WEEK` slot's `weekNumber`), or from a date
  where the order itself changes each Season (a tour's tournaments by their start). It is
  used to *sort*, never to *identify*. Nothing is identified or sequenced (which round
  comes next, which slot is the final) by an `order` or `orderIndex` column kept by hand. A
  display-only `displayOrder`, used only to list rows on screen (as on `Sport`,
  `SportLeague` or a league's positions), is fine.
- Positions shift the moment a provider adds a round, a league adds a play-in or a season is
  shorter; a key does not.

### Never build or parse an id string

An id is opaque. No code concatenates parts into one (`nfl-2026-week-5`,
`…-postseason-round-4`) and no code takes one apart with `split`, a regex or `startsWith` to
learn what it refers to.

- **Smell:** a template literal or `join('-')` producing an id or scope key; `.split('-')`,
  `.match(/…/)`, `startsWith` or `includes` applied to an id, a slug or a provider ref to
  recover a year, a round, a league or a kind; a regex choosing which adapter or reader
  handles an id.
- **Instead:** each part is its own column or foreign key, and the row says what it is
  (a season row, a phase row, a slot row, a provider mapping row). A provider's own
  reference is stored as given, in a `…ProviderMapping` row and nowhere else (*Provider keys
  live only in ProviderMapping tables*, below), and is only compared for equality.
- A slug made for a URL is a display key: it is looked up, never parsed.

### Never match on a name

Code never identifies a sport, league, event, round, team or participant by a name, label or
title string: not `=== 'Super Bowl'`, not `name.includes('Playoff')`, not a keyword list.
Names are for people and change; ids and codes are for code.

- **Smell:** comparing or searching a `name`, `title`, `label` or `displayName` field; a
  constant list of names or keywords; joining two records because their names agree;
  building a display name and later reading meaning back out of it.
- **The one exception is a provider that offers nothing better.** When an external feed
  identifies something only by its name (a stage called "Third Place", a season type by
  word), the match lives in the adapter, as **data**: a mapping table or reference rows that
  pair the provider's string with our key, maintained by migration. The adapter looks the
  string up; it does not branch on it. The mapping is inclusion only, and a string that
  matches no row is not synced and raises the one deduplicated finding described in
  *Provider keys live only in ProviderMapping tables*, never a silent default. Past the
  adapter, everything is keyed.

### Provider keys live only in ProviderMapping tables

Every id or code a data provider uses (its league code, season id, event id, game id,
participant id, position code, round or tournament code) is stored in a table whose name ends
in `…ProviderMapping`, one row per provider per thing, and in no other column. A row of ours
never carries `externalId`, `providerRef`, `providerId` + `externalId` or a list of external
ids; the mapping points at it.

- **Why one place.** A provider key on the row ties the row to one provider, so a second
  provider or a provider switch needs new columns, and the key gets read as if it meant
  something (it is opaque, *Never build or parse an id string*). In a mapping table a switch
  is new rows, and the same row of ours keeps its identity.
- **Mappings are inclusion only.** A mapping row names each provider value we sync, and
  anything else is not synced. A value the feed sends that matches no row creates nothing
  and raises **one `INFO` finding per league and value**, deduplicated across runs and games,
  so a new format or a renamed tournament is seen once and is never synced by default.
  Resolving it is adding a mapping row; **waiving** it records that the value is known and
  deliberately excluded, and silences it. Two mapping rows matching one value is an `ERROR`,
  since the sync cannot choose between them.
- **The provider's own words** (its status codes, its webhook event names) are parsed in its
  adapter as data (*What stays in code*). An unknown word about a thing we do sync (a status
  code on a synced Game) is not an inclusion question, since that thing cannot be set
  correctly: it raises a `WARNING` when the run can continue and an `ERROR` when it cannot,
  deduplicated per league and value the same way, and it cannot be waived.
- **Smell:** a column named `externalId`, `…Ref`, `providerEventId` or `providerId` +
  `externalId` on a table that is not a `…ProviderMapping`; an id prefix that says which
  provider an id came from; a provider code in a constant or a `Record`; a sync that falls
  back to a default when a provider value is unknown.
- *Status:* today's schema still holds provider keys on rows (`SportEvent.externalId`,
  `Participant.externalId`, `SportEventRoundMatch.externalGameId` and others;
  `SportLeague.matchKeyword` was replaced by `SportLeagueProviderMapping` in #1997). A change that touches one adds no new reader of it; the league model
  redesign moves them (ADR 0012).

### Proper names are data, generic words are strings

A proper name (a team's, a player's, a tournament's, a slot's own label such as Super Bowl
or The Masters) is a fact about one real thing, so it is a `name` column on that thing's row,
set by the feed or a migration, and it is never translated. A generic word (Week, Round,
Semifinal, Final, Tie, Lives, a status label) is the same for every row of its kind, so it is
a display string keyed by the code it labels, held in the web app's display strings and never
stored on a row.

- **A row stores a name only when it has its own.** A slot definition has an optional `name`
  for a league's own label; a slot without one shows the word for its kind ("Week 14",
  "Semifinal") from the display strings. Code never copies a generic word into a `name`
  column to have something to show, and never builds a proper name from generic words.
- **Generic words come from one place**, keyed by enum code, and a sport's own word for a
  role is a display string keyed by sport code and role, not a column per sport. The display
  strings' home in the web app is being built (#1956); until it lands, a code's words come
  from the existing UI label maps, never from a stored column.
- **Smell:** a `label`, `displayName` or `roundNames` column holding words every league
  shares; an array of round labels per league; a `name` filled with "Week 1".."Week 18";
  a proper name hard-coded in a constant or a component.

### Per-league facts are model rows, not code tables

How many rounds a league plays, what each is called, how long a series is, which phases are
synced, when its season rolls over, how many teams are seeded, where its regions are: these
are properties of a league or season, so they are columns or rows on the league, season,
phase or slot definitions (`rules/domain-model-concepts.md`). They are never a constant, a
`Record<League, …>`, a `switch` on a league or a mapping file per league.

- **Smell:** a constant or `Record` keyed by a league, sport or provider league code that
  holds numbers, names, months or dates; one mapping file per league whose functions differ
  only in their constants; a helper that takes a league and returns a number; a date window
  ("between January and March") used to find one league's event; the same adapter function
  copied per league with different literals.
- **Instead:** add the property to the definition it describes and set it by migration
  (`rules/architecture-rules.md` §6 *Reference data goes in a migration*); the shared code
  reads it. The words for keys and codes live in the display-string module, keyed by the code
  (`rules/ux-rules.md` §16 *Display Strings*); proper names are name columns on the model.
- This is the data half of `rules/workflow-rules.md` §1 *One global solution, never one
  sport's*: a league's difference is data any league can carry, never a path one league takes.
  It extends the sport registry (`rules/architecture-rules.md` §4 *Sport extension*) to
  leagues and seasons: what one sport shares is in its definition; what one league or season
  owns is in the model.

### One computation per fact

A derived fact — the current season, whether an event is over, which round is the final,
whether an event is a week of games or a bracket, how many events a contest may cover, which
events can take a contest, whether tiers are locked — is worked out in **one** place. Either
it is stored (set by the code that owns it, such as the sync) or it is computed by one
shared function, and every consumer reads that.

- **The web app never re-derives what the API knows.** When a screen needs a fact the
  server decides, the API returns it as a field; the screen does not mirror the server's
  rule. Two copies of a rule disagree sooner or later, and the screen then offers what the
  server refuses (`rules/react-ui-rules.md` §3 *API Integration Rules*).
- **A rule both sides must run lives in `packages/shared`** beside the type it describes
  (status predicates beside the status enum), and both import it. It holds behaviour, not
  domain values: a limit, range or default it would carry is model or config data
  (*The web app holds no domain values*, below).
- **The data provider is the source of truth.** A fact the feed supplies (scores, totals,
  finishing positions and ties, a game's or competitor's status, the cut) is stored as the
  feed gives it, by the sync, and never recomputed from other columns. We compute a fact
  only when the feed does not supply it (composite scores, ratings, standings for a scoring
  family the feed does not rank), and then in one function per fact. Deriving our own value
  beside the feed's makes two answers that drift.
- **Smell:** `new Date().getFullYear()` or a year worked out from today's date; a set of
  statuses spelt inline (`[FINAL, CANCELLED].includes(…)`); a function whose body matches
  another's under a different name; a web helper that restates a server check; a comment
  saying "keep in sync with …"; a total, position, tie marker or score-to-par computed from
  stored rows when the feed sent it.
- This is `rules/architecture-rules.md` §4 *Service Topology* ("one code path per piece of
  business logic") applied to facts and across the backend/web boundary.

### The web app holds no domain values

`clients/poolmaster` contains no domain value of any kind (Derek, 2026-11-23: "Nothing should
ever be hardcoded in the webapp code"). No option list, range, limit, default, threshold,
penalty or scoring number is written in web code, nor imported into it from a shared
constant: every such value is model or configuration data that the API returns, and the
screen renders what it is sent.

- **What the web app may own:** display strings, through the display-strings module
  (`rules/ux-rules.md` §16 *Display Strings*), and pure layout constants (spacing,
  breakpoints, column widths, animation timings) that mean nothing about the domain.
- **Calibration.** Every value of a shared enum, read from the enum in its declared order
  (a grid filter of every status), is the model, not a copy of it; a hand-written subset or
  range of it is a finding. A display cap (how many rows before "and N more") is layout. A
  shared schema's shape is fine for the web to use, but its numeric bounds come from the
  API.
- **Why it is absolute:** a value in the screen is a second copy of a rule the server holds
  or should hold. It is invisible to the model, cannot differ by league or contest, and
  drifts; the screen then offers what the server refuses or shows a number the scoring never
  used.
- **Smell:** an array of choices (`WINNING_SCORE_OPTIONS`, a +10 to -30 range), a numeric
  literal that is a rule (`'80'` for an unplayed round, a maximum entries count, a default
  roster size), a `min`/`max` on an input that the API did not send, a map from a code to a
  number, a default picked in a form because the API sent none.
- **Instead:** the value lives where it belongs in the model (a contest's scoring or setup
  settings, a definition row, a platform profile) and the read that the screen already makes
  returns it (`rules/react-ui-rules.md` §3 *API Integration Rules*). When no API field carries
  it yet, adding that field is part of the slice; a web constant "for now" is not.
- *Status:* existing values of this kind move to model or config data with the league model
  redesign (#1917): the web's golf winning-score tiebreaker options and unplayed-round `'80'`,
  the limit and default constants in `packages/shared/domain` and `packages/shared/dto`
  (events per selection type, survivor lives, roster, squares and tier-profile maximums, the
  game-picks tiebreaker, rounds par, auto-release days and stat value bounds) and the numeric
  bounds in their Zod schemas. Some of these are imported by the web app today; those imports
  are residue too. A change that touches one moves it to an API field, and no new import or
  constant is added.

### What stays in code

Parsing a provider's wire format inside its adapter (a golf score's `CUT`, `WD`, `DQ`, a
hole-by-hole string) is behaviour, and stays code. So does a scoring family's computation.
The test is: **would a new league, season or sport need this code edited to work?** If yes,
the fact is in the wrong place.

### Finding one is a ticket, not a footnote

A reviewer or a scan that finds one of these names the model home it belongs in. Moving it
in the same slice is preferred when the slice already touches that fact; otherwise it is a
tracked issue linked from the PR, and the slice does not add a second copy (§15 *Residue*).
