# PoolMaster — Domain Model Conventions Rules

These rules define consistency conventions for the PoolMaster domain model
itself. Use them when proposing, reviewing, or implementing schema/entity/DTO
shape changes.

This file is intentionally separate from
[model-change-rules.md](./model-change-rules.md):

- `domain-model-conventions-rules.md` defines **what a consistent model should
  look like**
- `model-change-rules.md` defines **the process/checklist for changing a model
  safely**

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
  pre-normalization, opaque audit-log snapshots whose shape varies by source
  entity. After normalization, the shape is typed.
- **Strongly typed beats more concise.** Verbose table names, more mapper
  files, and more discriminated-union variants are acceptable costs when the
  alternative is nullable interpretation, JSON-blob fields, or
  schema-as-context-dependent.

The rules below are concrete applications of this principle.

---

## 1. Purpose

PoolMaster should use consistent domain-model patterns so that:

- data-modeler recommendations are repeatable
- backend and frontend interpret entity lifecycle the same way
- DTOs remain aligned with domain semantics rather than drifting into ad hoc
  per-feature patterns
- future model changes can build on established conventions instead of
  re-deciding basics every time

---

## 2. Lifecycle Naming Conventions

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
needs active vs inactive.

---

## 3. DTO Conventions

DTOs should preserve the same lifecycle semantics as the domain model.

- if an entity uses `isActive`, its API-facing DTOs should normally expose
  `isActive` rather than translating that concept into a different lifecycle
  field name
- do not use DTO-only `status` values to represent soft delete when the domain
  model uses `isActive`
- if a DTO intentionally differs from the domain model, document the boundary
  reason explicitly in the active plan or code comments

Lifecycle wording should stay consistent across:

- Prisma schema
- shared domain types
- DTOs
- service logic
- route documentation
- frontend UI copy where practical

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

## 4. Filtering Conventions

Default "active" product views should usually filter on `isActive=true` when
the entity uses this convention.

When inactive records remain user-visible:

- document that explicitly in the contract and UI plan
- make the difference between visible-but-inactive and active clear in route
  docs and DTO field descriptions

Do not rely on tribal knowledge for whether inactive rows should still appear.

---

## 5. Future-State Guidance

When designing new entities, start with the simplest lifecycle model that
matches the approved product behavior.

Preferred progression:

1. no lifecycle field when the entity is always ephemeral or always hard-deleted
2. `isActive` when the entity needs a simple soft-delete / inactive state
3. add `inactiveReason` later if product meaning genuinely requires it
4. add `status` only when workflow/business-state tracking is required

Do not jump straight to enums or multi-state workflow models without real
product need.

---

## 6. Data-Modeler Responsibilities

When reviewing a proposed model change, the data-modeler should explicitly
check:

- whether the lifecycle concept is actually soft delete, workflow state, or
  both
- whether `isActive` is the correct primary field
- whether `status` is being misused to stand in for simple active/inactive
  semantics
- whether DTOs will remain semantically aligned with the proposed model
- whether a proposed extra field is truly needed now or should be deferred

If the proposal breaks these conventions, the data-modeler should call that out
before backend implementation begins.

---

## 7. Current PoolMaster Direction

These conventions match the current intended direction for PoolMaster:

- league and user lifecycle should use real persistent `isActive` fields when
  active/inactive is a core lifecycle concept
- user account lifecycle should use a real persistent activity field such as
  `User.isActive`
- `status` remains reserved for workflow/state-machine concepts such as
  invitation and contest lifecycle

As PoolMaster evolves, update this file when the domain conventions themselves
change, not merely when a specific feature is being implemented.

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
- Permission-driven thin/redacted variants (see next rule) are
  **supplementary** contracts for restricted access levels. They do not
  replace the canonical DTO for callers with full access; they exist
  alongside it.

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

### DTO variants are permission-driven, not view-driven

A redacted DTO that hides fields based on the viewer's access level is a
legitimate variant — it's a different contract for a different access level.

A list-view DTO that omits fields "for performance" is forbidden — that's view
convenience and drifts from the canonical entity shape.

Examples:

- ✅ `ContestEntryThinDto` (id, name, squadName) shown to non-owners
  pre-event-live, while `ContestEntryDto` (with picks + scores) shown to
  owners — permission boundary.
- ❌ `LeagueSummaryDto` for list view + `LeagueDetailDto` for detail page —
  view convenience, drifts.

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

A common case where a single table is correct: an `audit_log` /
`commissioner_audit_log` table whose columns (`actor_id`, `action`,
`before_state`, `after_state`, `created_at`) apply uniformly across every
action type. The action-type discriminator narrows interpretation of the
existing fields, not which fields exist.

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
- `SportEvent` not `Event` — `Event` overloads with the in-process event bus.

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
