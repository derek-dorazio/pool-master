# PoolMaster — Domain Model Conventions Rules

These rules define consistency conventions for the PoolMaster domain model
itself. Use them when proposing, reviewing, or implementing schema/entity/DTO
shape changes.

This file is intentionally separate from
[model-change-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/model-change-rules.md):

- `domain-model-conventions-rules.md` defines **what a consistent model should
  look like**
- `model-change-rules.md` defines **the process/checklist for changing a model
  safely**

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
