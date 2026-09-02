# Golf Budget Drafts

> **Status:** In progress. **Beads epic:** `pool-master-9oy`. Its slice 1
> (`pool-master-0nd`) carries a cross-epic `blocked-by` link against `plans/124`'s slice 9
> (`pool-master-piv`) — not `124`'s full epic. `bd show pool-master-9oy` for the live list.
>
> **Coordination warning: shares a touchpoint with `plans/127`.** This epic's slice 4
> (`pool-master-6z6`) and `plans/127`'s epic (`pool-master-wsu`) slice 5
> (`pool-master-398`) both extend `contest-entry-page.tsx:578`'s `selectionType !== 'TIERED'`
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

`SelectionType.BUDGET_PICK` already exists (`enums.ts:136`) and `ContestConfiguration.budget`/
`.pricingMethod` already exist as real columns — unlike category picks, this isn't a stub with
zero plumbing. But investigating `drafts/routes.ts` end to end (during `plans/124`'s review)
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
- **`ContestConfiguration.budget: Int?` / `.pricingMethod: String?`** already exist as real
  columns (`schema.prisma:707-708`) and are already read (though only passed through as flat
  display fields) by `drafts/routes.ts:415-416`.
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

1. **`contest-entry-page.tsx:578` hard-blocks every non-`TIERED` contest today**: `if
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
interface GolfBudgetContestConfig {
  mode: 'GOLF_BUDGET'; // new GolfContestConfigMode value, confirmed — plans/124 §4.9
  budget: number;        // 1000 for both seed presets
  pricingMethod: string; // display-format string, already exists on ContestConfiguration
  rosterSize: number;    // 6 for both seed presets
  countedScores: number; // 6 (All Count) or 4 (Top 4) — the two seed presets, §1
}
```

**Price-range guidance for the seed preset, not enforced logic**: `adminAutoAssignGolfPrices`'s
`minPrice`/`maxPrice` (`plans/124` §4.7a) must be set by the admin such that a $1000 budget and
the contest's `rosterSize` are actually satisfiable — e.g. a 6-pick roster against a $1000 cap
implies an average price around $167, so a `minPrice`/`maxPrice` range like $20–$300 is
reasonable. This is admin judgment per tournament, matching §4.7a's existing design (the admin
sets the range every time price is auto-assigned) — this plan does not compute or enforce a
"correct" range, only documents the relationship so the seed preset isn't set up to be
mathematically infeasible.

---

## 5. Slice sequence

Cross-epic note: every slice here is blocked on `plans/124`'s epic slice 9
(`pool-master-piv`, the `drafts/routes.ts` tier/price rewiring) — not on `plans/124`'s full
epic.

| # | Slice | Depends on |
|---|---|---|
| 1 | `ContestConfigTemplate` seed migration: `GolfContestConfigMode.GOLF_BUDGET` + the two presets, All Count and Top 4, $1000/roster-6 (§4) | `plans/124` slice 9 |
| 2 | `totalSpent`/`isOverBudget` computed field in `buildRosterSelectionResponse` for `BUDGET_PICK` (§3.2); delete the dead `BudgetPickEngine` class and its orphaned unit test, reimplement the sum inline (§3.3, confirmed) | 1 |
| 3 | New `POST /contests/:contestId/entries/:entryId/submit` (`submitContestEntry`) route: recomputes `isOverBudget` server-side, rejects with `422 CONTEST_ENTRY_OVER_BUDGET` (§3.3) | 2 |
| 4 | Frontend: extend `contest-entry-page.tsx:578`'s `selectionType !== 'TIERED'` gate to admit `BUDGET_PICK` (§3.3) — coordinate with `plans/127`'s epic if both are open at once, see this plan's header | 3 |
| 5 | Frontend: budget draft-room UI — running-total/over-budget indicator in the pick UI, wire `submitEntry()` to the new endpoint, surface its `422` as a clear error (§3.3) | 4 |
| 6 | Commissioner contest-config: read-only budget/roster-size display for a `GOLF_BUDGET` contest (mirrors `plans/124`'s tier display and `plans/127`'s category display) | 1 |
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
   sport?~~ **Confirmed: ship it golf-scoped, `GOLF_BUDGET` included.** Budget drafting isn't
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
