# Plan 144 — Selection Engine Consolidation

**Tracking issue:** #198

## Purpose

Make selection a real abstraction: one shared handler, one persistence path, and a small
per-type engine — so adding a selection type is an implementation, not a route-file edit
in four places.

Selection works today. The code does not say so. `TieredPickEngine` and `BudgetPickEngine`
are well-factored, unit-tested and wired to nothing, while the live tier rules are written
inline inside a 1493-line route file. A reader finds an authoritative-looking engine that
never runs, and the rules that do run are buried in a request handler.

## Governing Principles

**The live behaviour is correct; the code around it lies.** The tier-picker semantics —
tap to select, tap again to deselect, pick past a full tier and it swaps the last one —
are deliberate and specified by `tests/functional/drafts.functional.ts`
("pool-master-mab replaces and unselects participants in a completed tiered entry group").
This effort must not change what the product does. It changes where the rules live.

**Delete the dead engines rather than adapt them.** They encode rules the product
rejected. See §2.

**One insert path stays one insert path.** Everything goes through
`ContestEntryPickService.createPick`. That invariant predates this work (plans/117 §7.1)
and survives it.

## Scope

In scope: the `INDEPENDENT` selection types — tiered, budget, category. The
`SelectionEngine` interface, the extraction of tiered and budget onto it, category as the
third implementation, the `SelectionCoordination` property, and terminology unification at
the code level.

Out of scope: turn-based selection (#199), Prisma model renames (§5), and the #192 DTO
conversion of this module, which waits for the consolidated surface (§6).

## Key Decisions

### 1. What is already right

Worth stating, because it is the expensive part and it is already done:

- **One persistence model.** `ContestEntryPick` stores tiered, budget and snake picks
  alike. Every insert goes through `ContestEntryPickService.createPick` — transactional,
  resolves the denormalised `contestFormat` from the parent contest, documented as "no
  insert path bypasses this".
- **One context loader.** `loadDraftContext()` resolves contest, entries, memberships,
  tiers, configuration and selectable participants, type-agnostically.
- **`SelectionType` is already a dispatch key** with a `501` fallback for unimplemented
  types. Adding a type is a recognised extension point, not a rewrite.
- **Shared view-building.** `buildSelectionGroups`, `buildValuationLookup`,
  `buildDraftTiers` are reused across types.

The domain model is in good shape for pluggable engines. Only the seam is missing.

### 2. Why the existing engines are deleted, not wired up

They are not an unwired version of the live rules. They are a different, weaker model:

| Rule | `TieredPickEngine` | Live route |
|---|---|---|
| Tier identified by | caller passes `tierId` | derived from the participant's own `tier`, matched by id **or** name |
| Quota field | `picksRequired` | `picksFromTier` |
| Picking when tier is full | **rejects** | **replaces** the last pick in that tier |
| Re-picking the same participant | not handled | **toggles it off** |
| Exclusivity across entries | absent | enforced when `isExclusive` |
| Roster-size cap | absent | enforced |
| `draftRound` ordering | absent | computed from tier ordering |
| Persistence | none | `ContestEntryPickService.createPick` |

On the central rule they are opposites: full tier → engine rejects, route swaps.

**The design lesson, and the reason the first attempt failed.** `validatePick` returns
`{ valid, reason }`. A boolean cannot express *replace* or *toggle off*, which is what the
tier-picker UI needs. The abstraction failed on its return type, so the rules were written
inline instead. The replacement interface must model the **outcome**.

### 3. The interface

Derived from what actually varies, not from what seems tidy.

```ts
type SelectionOutcome =
  | { kind: 'accept' }
  | { kind: 'replace'; pickId: string }
  | { kind: 'toggleOff'; pickId: string }
  | { kind: 'reject'; code: string; message: string };

interface SelectionEngine {
  capacity(config, tiers): number;
  evaluate(ctx, entry, participant, existingPicks): SelectionOutcome;
  ordinal(ctx, participant, existingPicks): { round: number };
  buildState(ctx, entryId): SelectionStateDto;
}
```

Everything common stays in one shared handler: authentication, squad membership,
participant-in-event, availability, exclusivity, persistence, response envelope. The
engine supplies only what differs.

Today that per-type behaviour is scattered across four disjoint places in one file:
`getRosterSize()`, the inline branches of `submitContestSelection`,
the branching in `buildDraftStateResponse`, and two response builders. Adding Category
currently means editing all four.

### 4. Coordination and exclusivity are two axes

`ContestConfiguration.isExclusive` already exists and is **already enforced for tiered and
budget** — `drafts/routes.ts:1092` rejects a participant another entry holds, `:686`
filters the available list. So an exclusive tiered contest already ships as
first-come-first-served: exclusive, but uncoordinated.

Exclusivity is the cause of contention. Coordination is one response to it. They are not
the same property:

| | Independent | Turn-based |
|---|---|---|
| **Non-exclusive** | tiered, budget, category | (no use case) |
| **Exclusive** | first-come-first-served (**ships today**) | snake draft, auction |

Add `SelectionCoordination` — `INDEPENDENT` | `TURN_BASED` — as an enum rather than a
boolean, so auction (simultaneous bidding) fits later without a migration. Keep
`isExclusive` unchanged.

This plan covers `INDEPENDENT` only.

**`isExclusive` defaults to `false` everywhere, and exclusivity is the minority case for
this application.** Audited and already true across every layer: Prisma carries
`@default(false)` on both `Contest` and `ContestConfiguration`; the four request DTOs
declare `z.boolean().optional()`, so an omitted field falls through to that default; and
nothing in `packages/` or `clients/poolmaster/` sets it to `true`. The only `true`
literals outside tests live in `clients/_archived/`, which is not in the lint or build
surface.

One deliberate asymmetry: `drafts.dto.ts:98` declares `isExclusive: z.boolean()` as
**required**. That is the response DTO — the server always knows the value — so required is
correct there. Requests stay optional.

Record this as an invariant: **no template, seed, factory or migration may default
`isExclusive` to `true`.** Tiered, budget and category are non-exclusive contests. Engines
must still handle `true`, because the column exists, the shared handler enforces it, and an
exclusive tiered contest is a coherent first-come-first-served format — but it is never the
default.

### 4a. Exclusivity test coverage — a real gap, found while writing this plan

Both conditions must be covered for every independent engine. Today they are covered
inconsistently, and in opposite directions:

| Fixture | `isExclusive` | Covers |
|---|---|---|
| `seedTieredDraftFixture` | never set → `false` | non-exclusive only |
| `seedBudgetPickFixture` | `true` | exclusive only |

So **exclusive tiered and non-exclusive budget have no coverage at all**. The shared
exclusivity paths — the cross-entry rejection at `drafts/routes.ts:1092` and the
availability filter at `:686` — are exercised only through budget.

Those two untested crossings are exactly what the engine extraction could break silently:
if exclusivity moves from the shared handler into an engine, or vice versa, nothing today
would catch it being dropped for tiered or wrongly applied to budget.

**Requirement for each engine slice:** a test at both `isExclusive = true` and `false`,
asserting the cross-entry rule and the availability list in each. Parameterise the fixtures
rather than duplicating them — `seedTieredDraftFixture` already takes an options object.

### 5. Terminology — Selection, Pick, Draft

Three terms compete today and collide inside single identifiers: `undoContestDraftSelection`
and `undoSnakeDraftSelection` each use two of them; `extendPickClock` uses a third.

- **Selection** — the process and its configuration. `SelectionType`,
  `SelectionCoordination`, "making selections".
- **Pick** — one participant chosen; the record. `ContestEntryPick` is the table. A pick is
  a noun with a timestamp.
- **Draft** — retired as a process name. Survives only inside `SNAKE_DRAFT` as a selection
  *type*, since that is the term of art.

Reads as: *a squad makes selections; each selection is recorded as a pick; one selection
type is snake draft.*

**Pick is not a competing term for Selection — it is the record of one.** Collapsing them
would force renaming `ContestEntryPick`, a table rename needing a destructive migration
while `migrate-qa` is broken (#191), for no conceptual gain.

In scope: module directory (`drafts/` → `selections/`), operationIds, route paths, DTO
names, `DraftStatus` → `SelectionStatus`. Out of scope: Prisma model renames.

**Rename after the duplicates are resolved, not before**, or the same surface gets renamed
twice.

## Execution Sequence

1. **Remove snake draft** (#200). Deletes six routes with no callers, the in-memory store
   and queue, the snake engine and session manager, and the duplicate commissioner controls
   in `contests/`. Smallest first because it removes branches every later step would
   otherwise have to carry.
2. **Define `SelectionEngine`; extract tiered as the first implementation.** The functional
   tests are the safety net — they already specify replace and toggle-off.
3. **Budget as the second implementation.** Near-clone of tiered; the first real test of
   whether the interface is right.
4. **Category as the third** — the proof that adding a type no longer means editing a route
   file. Blocked on the open question below.
5. **`SelectionCoordination`**, terminology rename.
6. **#192 DTO conversion** of the consolidated module.

## Open Questions

- **Is `CATEGORY` a distinct type, or is it what `TIERED` already is?** `SelectionType`
  carries `SNAKE_DRAFT`, `TIERED`, `BUDGET_PICK`. `contest-management-types.ts` has
  `GOLF_CATEGORY_PICKS`, described there as "a fully-typed stub with no implementation".
  This must be settled before the enum is touched — it is a published contract value.
- **Does `buildState` belong on the engine?** Tiered and budget share
  `buildRosterSelectionResponse` today; only snake needed its own. The read side may be a
  separate strategy, or may not need one at all.
- **Where does exclusivity live** once engines exist — the shared handler (it is
  config-driven and type-agnostic) or the engine (it interacts with capacity)? Current code
  puts it in the shared path, which is probably right.

## Sources / Prior Decisions

- #198 — this epic. #200 — snake removal. #199 — deferred coordinated selection, which
  records what the removed implementation got wrong.
- plans/117 §7.1 — the single-insert-path invariant for `ContestEntryPick`.
- plans/124 §4.6 — tiers as event-owned data, the source of `buildDraftTiers`.
- `tests/functional/drafts.functional.ts` — the behavioural contract for tiered and budget.
