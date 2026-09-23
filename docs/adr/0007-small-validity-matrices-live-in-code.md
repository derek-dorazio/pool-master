# ADR 0007: Small Validity Matrices Live in Code, Not the Database

- **Status:** Accepted
- **Date:** 2026-09-23

## Context

PoolMaster has several small enumerated compatibility matrices — `(tournamentFormat ×
contestFormat) → valid?`, supported provider × sport combinations, allowed
selection-mode-per-contest-format combinations. Each is a finite cross-product of two
domain enums, answering "is this pairing permitted?"

The reflexive answer for anything matrix-shaped is a database table: it is data, it has
rows, it goes in the database. That reflex is wrong for matrices with these properties, and
applying it costs more than it returns.

This guidance previously sat in `rules/architecture-rules.md §2` as though it were a rule.
It is not a rule — it is a decision with criteria and tradeoffs, which is ADR shape. Moved
here under the same sorting principle that drives #133: rules state what must never happen;
decisions state what was chosen and why.

## Decision

**Small enumerated compatibility matrices live in code as TypeScript const maps, not in the
database.**

```ts
export const VALID_CONTEST_FORMATS_BY_TOURNAMENT_FORMAT: Record<TournamentFormat, ContestFormat[]> = {
  STROKE_PLAY_TOURNAMENT: ['ROSTER'],
  KNOCKOUT_BRACKET:       ['ROSTER', 'BRACKET'],
  // ... exhaustive over TournamentFormat
};
```

Typing the map as `Record<SomeEnum, …>` is the point, not an incidental detail: TypeScript
fails the build when a new enum member has no entry. That is a guarantee no database table
can offer.

### Use code when all of these hold

- The matrix is small — tens of cells, not thousands.
- Cells change at the cadence of code releases, not user actions.
- Compile-time exhaustiveness checking adds value.
- There is no genuine product requirement for runtime configurability by non-developers.

### Use the database instead when any of these hold

- Cells change as part of normal admin-configured workflow.
- The matrix is genuinely large — hundreds of entries or more.
- Tenant-specific overrides are required.

### The matrix is a catalog, not a write permission

A validity matrix says which combinations are *coherent in the domain*. It does not say
which are *implemented*. Creation and mutation paths must gate against both — the matrix,
and what the current configuration, scoring and UI contracts actually support. A pairing
can be domain-valid and still unsupported by the code that would have to execute it.

This distinction has been a live source of bugs: a matrix read as an authorization check
lets a request through to code that cannot service it.

## Consequences

**Accepted costs.** Changing a matrix requires a code release. Non-developers cannot adjust
one. If a matrix later acquires genuine runtime-configurability requirements, it must be
migrated to the database — and the code path that reads it will need a cache, since it moves
from a module constant to a query.

**What this avoids.** DB-backed matrices carry costs that are easy to underestimate: a
migration on every change, runtime caching to avoid a query per validation, a query on every
validation when the cache misses, and no compile-time check that every enum value is
covered. Defaulting to the database is over-engineering for a matrix that meets the criteria
above.

**Where the exhaustiveness guarantee stops.** `Record<Enum, …>` catches a *missing* key. It
does not catch a key whose value is wrong, nor a `switch` elsewhere that fails to handle a
new enum member. `@typescript-eslint/switch-exhaustiveness-check` covers the second case and
is not currently enabled — see #160, which measured three genuine unhandled domain states on
live enums.

## Alternatives Rejected

**Database-backed matrices with an admin UI.** Rejected for the current matrices because no
product requirement asks for runtime configurability, and the cost is paid continuously
while the benefit stays hypothetical. Revisit per-matrix if a requirement appears — this ADR
does not forbid the pattern, it sets the default.

**A hybrid: code as the default, database as an override layer.** Rejected as the worst of
both. It keeps the migration and caching costs, loses the compile-time guarantee (the
effective matrix is no longer statically known), and adds a precedence question at every
read site.

**Leaving it in `architecture-rules.md`.** Rejected because it made a decision look like a
rule. Readers treated the criteria as conditions to satisfy rather than as a judgement to
make, and the "matrix is not a write permission" caveat was buried in a rules file where
nobody looked for it when writing a mutation path.
