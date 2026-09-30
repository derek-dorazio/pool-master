# Golf Budget Drafts

> **Status:** In progress. **Tracking issue:** #93 (migrated from `pool-master-9oy`).
> `gh issue view 93` for the live slice list.
>
> **The `plans/124` dependency is satisfied.** Slice 1 (#94) was blocked by `plans/124`'s
> slice 9 (`pool-master-piv`) — not `124`'s full epic. That epic (`pool-master-476`) closed
> 2026-09-03, so nothing here is blocked.
>
> **Coordination warning: shares a touchpoint with `plans/127`.** This epic's slice 4
> (#95) and `plans/127`'s epic (#99) slice 5
> (#105) both extend `contest-entry-page.tsx`'s `selectionType !== 'TIERED'`
> gate. Do not let both land independently — whichever lands first should extend the gate to
> admit **both** `BUDGET_PICK` and `CATEGORY_PICK` in one small commit, and the other rebases
> onto it rather than re-editing the same line.
>
> **Testing policy:** see `plans/124`'s header — it applies to every slice in this epic
> too. In short: update every existing test the slice touches, give new code/branches
> direct unit coverage, and update any existing FAPI scenario whose shape this slice
> changes, in the same slice.

---

## 1. Context

`SelectionType.BUDGET_PICK` already exists (`enums.ts:136`) and `ContestConfiguration.budget`
already exists as a real column — unlike category picks, this isn't a stub with zero plumbing.
(**Corrected 2026-09-30:** this sentence also claimed `.pricingMethod`. That column is dropped
by `plans/145`'s slice 3a (#244) as write-and-echo state no client reads — see §4a.) But investigating `drafts/routes.ts` end to end (during `plans/124`'s review)
found that **budget drafting does not actually enforce a budget today**: `BUDGET_PICK` is
dispatched to the identical `buildRosterSelectionResponse`/pick-validation code as `TIERED`,
with no spend calculation anywhere. Pick validation
(`drafts/routes.ts:907-1184`) only ever checks a roster-size cap for `BUDGET_PICK` — the exact
same check every other format gets. Price is display-only. The class that would do real
spend-math, `BudgetPickEngine` (`modules/drafts/engine/budget-pick-engine.ts`), is confirmed
**dead** — instantiated nowhere outside its own unit test
(`tests/unit/draft-service/budget-pick-engine.test.ts`), never wired into `drafts/routes.ts` or
anything it calls. An earlier pass in this review incorrectly cited this file as evidence that
budget contests were "real and functional" — that was wrong, corrected here.

**Seed presets to ship with this plan** (user specification): a **$1000 spending cap**, default
**roster size of 6**, in two counting variants:

| Preset | Roster size | Budget | Counting rule |
|---|---|---|---|
| Budget — All Count | 6 | $1000 | All 6 count |
| Budget — Top 4 | 6 | $1000 | Best 4 of 6 count |

**The enforcement model, specified directly by the user, is not "reject the pick" — it's
"gate final submission."** Individual pick actions are never blocked by budget. The running
total updates after every selection; going over $1000 shows an over-budget indicator and lets
the member keep adjusting freely (swap picks in and out) — but the entry cannot be **submitted**
while over budget. This is a materially different validation shape than an earlier draft of
this plan assumed (reject the pick itself, §3 below is corrected accordingly), and it also
surfaces a real architectural gap: there is no dedicated "finalize this roster" server action
today for this to gate.

---

## 2. What already exists that this plan reuses (verified, not assumed)

- **`SelectionType.BUDGET_PICK`** already exists — no new contest-level enum value needed,
  unlike `plans/127`'s `CATEGORY_PICK`.
- **`ContestConfiguration.budget: Int?`** already exists as a real column and is already read
  (though only passed through as a flat display field) by `drafts/routes.ts`. **Corrected
  2026-09-30:** this bullet also claimed `.pricingMethod`, and claimed both were "already
  read". `pricingMethod` was written and echoed, never read by any client, and #244 drops the
  column along with the dead `PricingMethod` enum. Nothing in this plan needs it — see §4a for
  why, and for the value set kept as narrative. `budget` is untouched by that slice.
- **Per-golfer price already lives on the event, not the contest** — `plans/124` §4.5's
  `SportEventParticipantGolfValuation.price`, populated by `adminAutoAssignGolfPrices` (§4.7a):
  best-`seedNumber` golfer near `maxPrice`, worst near `minPrice`, interpolated by relative
  weight, `minPrice`/`maxPrice` set per-action by the admin. This plan does not need to build a
  new pricing mechanism — it needs to (a) make `drafts/routes.ts` read price from the right
  place (already covered by `plans/124` §4.6b's rewiring, not duplicated here) and (b) add the
  spend-cap check that has never existed.
- **`getDraftState`'s response contract needs no changes here either** — a budget draft room
  already renders the same `selectionGroups`/participant-with-price shape `TIERED` uses; the
  gap is entirely in validation, not in what the frontend receives. (The pick UI was already
  confirmed to render price correctly regardless of format, in the audit that produced
  `plans/126`.)

---

## 3. What this plan actually builds

### 3.1 Pick actions never block on budget — they never did, and that's now confirmed correct

`drafts/routes.ts:907-1184`'s pick-submission handler needs **no new rejection logic** for
budget. `BUDGET_PICK` keeps the same roster-size-only check every format gets (§2); this plan
does not add a spend-check here. An earlier draft of this plan proposed exactly that (reject a
pick that would exceed the cap) — the user corrected it directly: picks are always freely
add/swappable regardless of running total. Roster-size cap still applies unchanged and
independently of budget — the two are separate constraints, one already enforced, one that
needs a home elsewhere (§3.3).

### 3.2 Live running total — a `getDraftState` response addition, not new validation

The draft room needs to show the member their current spend after every pick, so the response
`buildRosterSelectionResponse` assembles needs one new computed field for `BUDGET_PICK`
contests: `totalSpent` (sum of `price` across the entry's committed picks, via the same
event-owned `SportEventParticipantGolfValuation` the tier path reads post-`plans/124` §4.6b) and
`isOverBudget: totalSpent > contestConfiguration.budget`. This is read-only, computed fresh on
every `getDraftState` call — not a stored value, nothing to keep in sync.

### 3.3 The real gap: there is no "finalize this roster" server action to gate

Investigated the actual frontend submit flow (`contest-entry-page.tsx`) to find where a budget
gate would attach, and found two things worth recording precisely:

1. **`contest-entry-page.tsx` hard-blocks every non-`TIERED` contest today**: `if
   (contest.selectionType !== 'TIERED') { return <ErrorState .../> }` — "The first-pass entry
   builder currently supports tiered contest selections only." This means the earlier claim
   that the pick/entry UI needs "no frontend change" for budget mode (from the audit that
   produced `plans/126`) was **incomplete** — that audit confirmed the *draft room* rendering
   (`getDraftState` consumption) needs no change, but this separate gate gates the entire entry
   page before a member can even reach it. `plans/127` inherits the identical finding for
   `CATEGORY_PICK` — both plans need this condition extended, not just their own dispatch logic.
2. **What today's "Submit entry" button actually calls is not a roster-finalization action.**
   `submitEntry()` calls `saveEntryDetailsMutation`, whose backend call is `updateContestEntry`
   — a generic name/tiebreaker update, unrelated to picks. Individual picks are already
   persisted one at a time via `submitSelectionMutation` as they're made; "entry complete"
   (`lineupComplete`) is a **client-side-only** computed check today (are all required slots
   filled), with no corresponding server-side "this roster is locked" concept at all.

**Consequence, now confirmed: a real, new "finalize entry" endpoint, not an extension of
`updateContestEntry`.** The client cannot be trusted to gate submission alone — a disabled
button with no server-side backstop would be the same class of gap this whole review has been
closing elsewhere — and the user picked option (b) directly: add a dedicated endpoint distinct
from the existing name/tiebreaker save, that both budget mode and (eventually) any other mode
needing a real lock-in moment can share.

- **`POST /contests/:contestId/entries/:entryId/submit`**, operationId `submitContestEntry`
  — same route family as the existing `PATCH /:contestId/entries/:entryId` /
  `updateContestEntry` (`contests/routes.ts:282`), sibling action rather than a parameter on
  that call. For `BUDGET_PICK` contests, the handler recomputes `totalSpent`/`isOverBudget`
  server-side (§3.2's same computation, not trusted from the client) and rejects with
  **`422 CONTEST_ENTRY_OVER_BUDGET`** — matching the plain `SCREAMING_SNAKE` error-code
  convention this plan set already uses elsewhere (`SPORT_EVENT_NOT_RELEASED`,
  `TIERS_LOCKED_BY_ENTRIES`, `EVENT_NOT_ADMIN_MANAGED`) — when `isOverBudget` is true. Success
  marks the entry as submitted (the first real server-side "this roster is locked" concept —
  today's `lineupComplete` stays client-side-only for the pre-submit checklist UI, but
  submission itself becomes a real state transition). For every non-`BUDGET_PICK` selection
  type this endpoint has no extra check beyond today's `lineupComplete`-style completeness
  validation — the budget gate is additive, not a new universal rule.
- The frontend's `submitEntry()` (`contest-entry-page.tsx`) calls this new endpoint instead of
  (or in addition to, for the name/tiebreaker fields) `saveEntryDetailsMutation` once a lineup
  is complete — exact button/flow wiring is implementation-time detail, not designed further
  here.

**Confirmed: delete `BudgetPickEngine`, reimplement §3.2/§3.3's sum inline.** Consistent with
this review's standing pattern — `TieredPickEngine`'s sibling class and the original
`GOLF_CATEGORY_PICKS` stub were both deleted outright rather than resurrected — the dead
class is removed in the same slice that adds the real `totalSpent`/`isOverBudget` computation,
not kept around as salvageable reference. This repo does not keep two implementations of the
same check (already found and fixed once for `tier-engine.ts`/`pricing-engine.ts`, and again
for the orphaned pick-engine classes themselves).

---

## 4. `ContestConfigTemplate` shape for this mode

Deferred here from `plans/124`, per the user's direction:

```ts
interface BudgetContestConfig {
  selectionType: 'BUDGET_PICK'; // SelectionType.BUDGET_PICK — already exists, enums.ts:136
  budget: number;        // 1000 for both seed presets
  rosterSize: number;    // 6 for both seed presets
  countedScores: number; // 6 (All Count) or 4 (Top 4) — the two seed presets, §1
}
```

**Corrected 2026-09-30.** This shape previously read `mode: 'GOLF_BUDGET'; // new
GolfContestConfigMode value, confirmed`. Two things about it were wrong once `plans/145`'s
slice-3 stage 2 settled:

- **`GolfContestConfigMode` is deleted by #244** — it held one value, `GOLF_TIERED`, a
  golf-prefixed duplicate of `SelectionType`, which already carries both `TIERED` and
  `BUDGET_PICK`. There was never a `GOLF_BUDGET` value to add, and no new enum value is needed
  here at all. `ContestConfiguration.configMode` goes with it as a redundant second copy of
  `selectionType`; `ContestConfigTemplate.configMode` is renamed `selectionType` by #248.
- **`pricingMethod` is dropped**, so it is no longer a field of this shape. See §4a.

**Price-range guidance for the seed preset, not enforced logic**: `adminAutoAssignGolfPrices`'s
`minPrice`/`maxPrice` (`plans/124` §4.7a) must be set by the admin such that a $1000 budget and
the contest's `rosterSize` are actually satisfiable — e.g. a 6-pick roster against a $1000 cap
implies an average price around $167, so a `minPrice`/`maxPrice` range like $20–$300 is
reasonable. This is admin judgment per tournament, matching §4.7a's existing design (the admin
sets the range every time price is auto-assigned) — this plan does not compute or enforce a
"correct" range, only documents the relationship so the seed preset isn't set up to be
mathematically infeasible.

---

## 4a. Tier and pricing strategies — the sketch preserved from deleted enums

`plans/145`'s slice 3a (#244) deletes two enums that typed nothing. Both columns they described
were `z.string()` / `VarChar(50)`, so neither enum ever constrained a value, and the only
consumer of either was a test asserting it existed. The code goes; the design thinking in the
value sets is worth keeping, so it is recorded here — narrative, not a contract.

**Why they went rather than got wired up.** Valuation provenance is already recorded at the
right grain on the event side: `SportEventParticipantValuation.priceAssignedSource` and
`.tierAssignedSource` are per-competitor and genuinely enum-enforced. A contest-level
`pricingMethod` cannot express a field that is part-auto and part-manual, which is the normal
case once an admin adjusts a few prices; the per-participant columns can. The contest-level
column was also write-and-echo — never read by any client.

**What is live today.** `TierSource` (`ODDS`, `RANKING`) is the live subset — the two orderings
`SportEventTierService.autoAssignTiers` actually implements, mapping to
`ValuationSource.AUTO_ODDS` / `AUTO_RANKING`. Anything below that is not in `TierSource` is
design space, not behaviour.

### `PricingMethod` — how a competitor's price gets set (5 values)

| Value | Intent |
|---|---|
| `ODDS` | Price from the book's odds. Live as `TierSource.ODDS` on the tier side |
| `SEED` | Price from a bracket/draw seed. Natural for tournaments with a seeded field |
| `WORLD_RANKING` | Price from the sport's ranking. Live as `TierSource.RANKING` |
| `SEASON_STATS` | Price from season performance rather than a market or a ranking |
| `COMMISSIONER` | Priced by hand. Now expressible per-competitor via `priceAssignedSource` |

### `TierAssignmentMethod` — how a field gets grouped into tiers (8 values)

| Value | Intent |
|---|---|
| `SEED` · `WORLD_RANKING` · `ODDS` | Order the field by a strength measure, then fill tiers. The last two are live as `TierSource` |
| `CONFERENCE` · `DIVISION` | Group by league structure rather than strength. The obvious NCAA / pro-league shape |
| `POT` | Group by a draw pot — the World Cup / Champions League mechanic |
| `BOUT_POSITION` | Group by card position — combat sports, where the card's order *is* the hierarchy |
| `COMMISSIONER` | Grouped by hand. Now expressible per-competitor via `tierAssignedSource` |

**The four worth keeping in mind** are `CONFERENCE`, `DIVISION`, `POT` and `BOUT_POSITION`.
They are the only ones that are not "order by a strength measure" — they group by structure, and
a grouping strategy is what category picks need (`plans/127`, #99). When a second sport's admin
plan wants one of them, the shape to extend is the event-side `TierSource` plus
`tierAssignedSource` pair, not a resurrected contest-level enum.

---

## 5. Slice sequence

Cross-epic note: every slice here is blocked on `plans/124`'s epic slice 9
(`pool-master-piv`, the `drafts/routes.ts` tier/price rewiring) — not on `plans/124`'s full
epic.

| # | Slice | Depends on |
|---|---|---|
| 1 | `ContestConfigTemplate` seed migration: `selectionType: 'BUDGET_PICK'` + the two presets, All Count and Top 4, $1000/roster-6 (§4) | `plans/124` slice 9 |
| 2 | `totalSpent`/`isOverBudget` computed field in `buildRosterSelectionResponse` for `BUDGET_PICK` (§3.2); delete the dead `BudgetPickEngine` class and its orphaned unit test, reimplement the sum inline (§3.3, confirmed) | 1 |
| 3 | New `POST /contests/:contestId/entries/:entryId/submit` (`submitContestEntry`) route: recomputes `isOverBudget` server-side, rejects with `422 CONTEST_ENTRY_OVER_BUDGET` (§3.3) | 2 |
| 4 | Frontend: extend `contest-entry-page.tsx`'s `selectionType !== 'TIERED'` gate to admit `BUDGET_PICK` (§3.3) — coordinate with `plans/127`'s epic if both are open at once, see this plan's header | 3 |
| 5 | Frontend: budget draft-room UI — running-total/over-budget indicator in the pick UI, wire `submitEntry()` to the new endpoint, surface its `422` as a clear error (§3.3) | 4 |
| 6 | Commissioner contest-config: read-only budget/roster-size display for a `BUDGET_PICK` contest (mirrors `plans/124`'s tier display and `plans/127`'s category display) | 1 |
| 7 | FAPI scenario: budget contest end to end — create a tournament (via `plans/124`), create a budget contest, pick over budget and confirm submission is rejected, correct back under budget and confirm it succeeds, confirm the leaderboard renders with no code changes (format-agnostic, per `plans/126`) | 3, 5, 6 |

---

## 6. Verification

**Testing policy reminder — see the header.** This list is gates to run, not the whole
obligation: also update every existing test this epic's slices touch, give new code and
branches direct unit coverage, and keep FAPI coverage in sync with any changed API shape.

- *Unit* — `totalSpent`/`isOverBudget` computation against a range of pick combinations
  including zero picks and a complete roster; the deleted `BudgetPickEngine`'s test is removed,
  not ported, since the class it tested no longer exists.
- *Integration* — `submitContestEntry`'s `422 CONTEST_ENTRY_OVER_BUDGET` path, and that a
  non-`BUDGET_PICK` contest hitting the same endpoint gets no extra check beyond today's
  completeness validation (§3.3).
- *FAPI* — slice 7 above is the flagship scenario.
- *Frontend* — the extended `contest-entry-page.tsx` gate (§3.3) with both `BUDGET_PICK` and
  whatever `plans/127` adds already admitted, not just this plan's own type in isolation; the
  over-budget indicator updating after every pick without blocking the pick itself (§3.1).

---

## 7. Open questions

1. ~~Does budget drafting need a `GolfContestConfigMode.GOLF_BUDGET` value at all, or is it
   already fully identified by `SelectionType.BUDGET_PICK` at the contest level, independent of
   sport?~~ **Superseded 2026-09-30: it is identified by `SelectionType.BUDGET_PICK` alone.**
   `plans/145`'s slice 3a (#244) deletes `GolfContestConfigMode` — it held one value and
   duplicated `SelectionType` (§4a). The answer below stands on its substance: **ship the
   feature golf-scoped**, because there is no second sport's requirements to generalize
   against. What changes is only that "golf-scoped" needs no golf-prefixed enum value to say
   so — the golf scoping lives in the golf rule code and the seeded template, not in a
   duplicate discriminator. Budget drafting isn't
   conceptually golf-specific, and neither, really, are tiers or categories — but there's no
   second sport's real requirements to generalize against yet, and speculatively designing a
   cross-sport shape now would repeat the exact build-ahead-of-need mistake this whole review
   already reversed elsewhere (`espn-adapter.ts`/`openf1-adapter.ts`, the original
   `GOLF_CATEGORY_PICKS` stub). `plans/124` §4.9 records the explicit decision: ship golf, all
   three draft types (`124`/`127`/`128`), fully working, before looking for commonality across
   sports. Expect a real refactor here once a second sport's admin plan needs the same
   mechanic — not before.
2. ~~`countedScores` for the seed preset~~ **Resolved: two presets, not one** — All Count (6 of
   6) and Top 4 (4 of 6), both roster size 6, both $1000 (§1).
3. ~~**Submit-time error shape for an over-budget entry.**~~ **Confirmed: `422
   CONTEST_ENTRY_OVER_BUDGET`** from the new `submitContestEntry` endpoint (§3.3) — matches
   this plan set's existing plain-error-code convention.
4. ~~**`(a)` vs `(b)` in §3.3.**~~ **Confirmed: (b).** A new, dedicated
   `POST /contests/:contestId/entries/:entryId/submit` (`submitContestEntry`) endpoint, not an
   extension of `updateContestEntry` — see §3.3 for the full design.

---

## 8. References

- `plans/124-golf-admin-tournament-management.md` §4.5/§4.6b/§4.7a — event-owned price and the
  `drafts/routes.ts` rewiring this plan's spend-check is added on top of, not instead of.
- `plans/126-leaderboard.md` — confirms no leaderboard changes needed for this mode either.
- `plans/127-golf-category-drafts.md` — the sibling deferred plan; independent of this one.
  Its header points here for §4a's tier-strategy sketch.
- `plans/145-one-object-one-operation-set.md` — "Slice 3 stage 2 — outcome, 2026-09-30" is the
  source of the three corrections above and of §4a. Slice 3a (#244) drops
  `ContestConfiguration.pricingMethod`/`configMode` and the `PricingMethod`,
  `TierAssignmentMethod` and `GolfContestConfigMode` enums; `ContestConfiguration.budget` is
  untouched by any slice-3 ticket.
