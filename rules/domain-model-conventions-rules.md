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

---

## 11. Open-Ended Additive Substrate Design

Schema designs must accommodate future variants (new sports, new contest
types, new event formats) by **additive table creation**, not by altering
existing tables.

- Adding a new sport: create per-category detail tables, create per-(category
  × contestType) contribution tables, add a Sport row, add scoring rule
  functions. **No alterations to existing tables.**
- Adding a new contest type within an existing sport: create the per-(category
  × contestType) contribution table for the new combo. **No alterations to
  existing tables.**
- Adding a new variant within an existing axis: a new row in an existing table
  is fine; a new nullable column on an existing table to support a new variant
  is the smell to avoid.

The substrate test is: "can the next sport / contest type / variant ship
without altering any existing table?" If no, the design is too coupled to
today's variants.

---

## 12. League, Squad, and Membership Invariants

What a Squad, a membership and an owner *are* is
[domain-model-concepts.md](./domain-model-concepts.md) §2 *Vocabulary*. These are the
rules the model holds them to. Do not introduce synonyms or sub-concepts for them.

### Squad, never team, in the contract layer

Route paths, DTO fields and variable names use **Squad**. `teams[]` as a field name for
squads is wrong. The reasoning, and the UI-side half of the rule, is
`rules/poolmaster-webapp-rules.md` §1 *"Team" Is A UI Label, Not A Domain Term*.

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

This repo's scale makes it unnecessary: leagues have tens of members, not thousands, and
the product shows one league at a time (A8). Where a set could genuinely grow without
bound, the answer is a tighter filter or a retention policy, not a page parameter.

### What this rules out

- Query parameters `page`, `pageSize`, `limit`, `offset`, `perPage`, `cursor`.
- Response envelopes carrying `total`, `page`, `pageSize` or `totalPages` beside `items`.
  Use an entity-named array — `{ users: [...] }`, `{ leagues: [...] }`, `{ squads: [...] }`
  — matching `LeagueListResponse` and `SquadListResponse`.
- Repository ports that take paging arguments or return `{ items, total }`. A port is not
  a place to hide a page either: `UserRepository.findAll` takes filters and returns
  `User[]`.

**Append-only history is bounded by a window, not a page.** The sync-run history grows
without bound, so `listProviderSyncRuns` (formerly `adminListProviderSyncRuns`, which took
`limit`) takes a submission-time window instead: `from` and `to`, defaulting to the last six
hours, backed by an index on `created_at`. That is a filter, not a page — the caller asks for
a time range and gets everything in it. Reach for the same shape for any future log-like
read.
