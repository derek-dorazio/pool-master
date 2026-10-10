# Golf budget selection (#93)

> **Status:** Plan approved by Derek 2026-10-09; in implementation. **Tracking issue:** #93.
> **Supersedes** `plans/128-golf-budget-drafts.md`, deleted by the first PR; read it with
> `git show 3a6481a:plans/128-golf-budget-drafts.md`.
> Checked against `main` at `1012778` (2026-10-09); refreshed against `3a6481a` (2026-10-10), see §9.
> Vocabulary per `rules/domain-model-concepts.md` (#544): **selection** is the process,
> **pick** is one chosen golfer, **draft** means only the snake draft type or an unsubmitted entry.

---

## 1. What the format is

Every golfer in the event's field has a **price**. An entry picks a roster of **N golfers**
whose prices add up to no more than the contest's **salary cap**. The best **K** of the N
scores count, exactly as in a tiered contest. Two entries may pick the same golfer
(non-exclusive); one entry cannot pick the same golfer twice.

Seed presets (Derek's earlier spec, kept): **Budget, All Count** (6 golfers, all 6 count) and
**Budget, Top 4** (6 golfers, best 4 count), both with a $50,000 cap (scale per §4.3).

## 2. What was in `plans/128`, and what changed since

`plans/128` was written 2026-09 and corrected through 2026-09-30. Much of what it planned has
since been built for every selection type, or made obsolete:

| `plans/128` said | Today |
|---|---|
| Build a new `POST .../entries/:entryId/submit` endpoint | **Exists** (#481): `submitContestEntry`, explicit Submit, entry goes `DRAFT → SUBMITTED`, a later change that leaves the lineup short sends it back to `DRAFT`. Budget only adds an over-budget check to it. |
| Budget code lives in `drafts/routes.ts` / `buildRosterSelectionResponse` | Gone. #324 moved it to `SelectionService`; #198 added the **SelectionEngine** seam; `modules/selections/selection-engines/budget-pick.ts` already exists and is registered. |
| Use names `getDraftState`, `draftRound` | Renamed (#544): `getSelectionState`, `lineupSlot`, `pickSequence`, `/api/v1/selections`. |
| Error `422 CONTEST_ENTRY_OVER_BUDGET` | The #481 submit errors are `409` (`ENTRY_LINEUP_INCOMPLETE`, `CONTEST_ENTRY_LOCKED`). This plan uses `409 ENTRY_OVER_BUDGET` to match. |
| Roster config is `rosterSize` + `budget` columns, shape `{ selectionType, budget, rosterSize, countedScores }` | Tiered config moved into typed `configJson` (`picksPerTier`, `countedScores`, #479). The create API accepts **only** the tiered shape. Budget config follows tiered into `configJson` (§4.1). |
| The "live hole": budget contests reachable with no budget enforced | **Mostly closed.** The web app only creates tiered contests and the entry page refuses non-tiered ones. An API-created budget contest gets no `rosterSize`, so its roster is 0 and every pick is refused `SELECTION_CONFIG_INVALID`. Nothing to hide; no action needed. |
| Seed $1000 cap against admin price range "$20–$300" | The admin auto-price dialog defaults to **$1,000–$10,000**, and its curve is `1/seed`, which prices most of the field near the minimum. Neither works for a cap (§3.3; replaced by §4.3). |
| Delete dead `BudgetPickEngine` | Done in #323. |

What carries over unchanged: picks are never blocked by the budget, only submission is
(Derek's call in `plans/128` §3.1); price is event-owned on `SportEventParticipantValuation`;
the leaderboard and settlement need no changes (they read `countedScores` from `configJson`).

## 3. What the code does today (the gaps)

### 3.1 The budget engine cannot swap
`budgetPickSelectionEngine.evaluate` rejects re-selecting a held golfer as `DUPLICATE_PICK`, and
a full roster as `ENTRY_COMPLETE`. There is no other remove-a-pick route (tiered removes by
re-selecting, a toggle-off). So a budget entry that fills its roster **can never change it**,
which makes "stay over budget and keep adjusting" impossible. The engine must toggle off.

### 3.2 The room shows a budget entry nothing to pick from
`SelectionService.buildSelectionGroups` builds groups from tiers only. A budget contest has no
tiers in its rules, so `selectionGroups` is empty and the entry page has no list. The
engine needs to say how its field is grouped.

### 3.3 Prices exist but do not suit a cap
- Price is `Decimal(10,2)` per field row, set by the root admin's **Auto-assign prices**
  (min/max, `deriveGolfPrices`, `1/seed` with jitter) and locked at release.
- With `1/seed`, seed 1 gets the max, seed 2 about half, seed 10 about a tenth, and the rest of
  a 140-player field sits within a few dollars of the min. The six most expensive golfers cost
  about 2.5× the max, so a cap either never binds or only binds on the top three or four. The
  middle of the field is all the same price, which removes the decision the format is about.
- Release requires every active golfer to have a **tier**, not a price. A released event with no
  prices can never host a budget contest, because prices lock at release.
- Golfers added to the field after release (alternates) have no price, as they have no tier today.

### 3.4 Config and create path are tiered-only
`ContestConfigurationRequestSchema` is `GolfTieredContestConfigurationSchema`; creation
validates `countedScores` against the event's tier count; `create-contest-page.tsx` hard-codes
`SelectionType.TIERED` and shows only tiered templates. No budget templates are seeded.

### 3.5 Entry page refuses non-tiered contests
`contest-entry-page.tsx` returns "Only tiered contests can be entered here." for any other type,
and its completeness check (`getCompletionStats`) counts tier groups.

## 4. Design

### 4.1 Typed configuration, one shape per selection type
`configJson` becomes a discriminated union on `selectionType`, in `@poolmaster/shared/domain`:

```ts
type ContestSelectionConfig =
  | { selectionType: 'TIERED';      picksPerTier: number; countedScores: number }
  | { selectionType: 'BUDGET_PICK'; rosterSize: number; salaryCap: number; countedScores: number };
// later: CATEGORY_PICK (#99), SNAKE_DRAFT (#199) add their own arm
```

The create/update request schema becomes the matching Zod discriminated union, and must agree
with the contest's top-level `selectionType` (already checked for templates). Per-type
validation sits next to each arm:
- Budget: `rosterSize` 1–12, `countedScores` 1..`rosterSize`, `salaryCap` copied from the event at creation, not supplied by the commissioner. The event must have a price on every active field golfer, and the cheapest
  possible roster must fit under the cap; otherwise `409 CONTEST_BUDGET_UNFILLABLE` (a contest
  nobody can submit to is refused up front, not discovered by members).
- Money is summed in **cents** (integers) from the `Decimal` prices, never as floats.

The legacy `contest_configurations.budget`, `roster_size` and `pick_count` columns stop being
read. The leaderboard's fallback to them goes; dropping the columns is a follow-up dead-code
ticket filed by slice 1 (per the 2026-10-08 dead-code goal), so this epic's migrations stay small.

### 4.2 Engine seam additions (what makes #99 and #199 cheap)
The shared handler stays as is; the engine interface grows three things, each with a tiered
implementation that reproduces today's behaviour exactly:

1. **`evaluate` sees prices and config.** `SelectionRequest` gains the typed config and each
   `EntryPick` carries its price. Budget's rules: held golfer → `TOGGLE_OFF`; no price →
   reject `PRICE_MISSING` (like tiered's `TIER_MISSING`); roster full → `ENTRY_COMPLETE`;
   otherwise `ACCEPT`. **Never rejects for budget.**
2. **`findShortfall` returns a list of typed issues** instead of `{ pickCount, rosterSize,
   shortTierNames }`:
   `ROSTER_SHORT { pickCount, rosterSize }`, `TIER_SHORT { tierNames }`,
   `OVER_BUDGET { spentCents, capCents }` (category adds `CATEGORY_SHORT`). `submitEntry`
   refuses on any issue, mapping each to its error (`ENTRY_LINEUP_INCOMPLETE`,
   `ENTRY_OVER_BUDGET`). `returnToDraftIfShort` already reverts a submitted entry on any
   shortfall, so a swap that goes over the cap after submission sends it back to Draft with no
   new code, the same rule as going short (#481).
3. **`groupField`**: how the room lists the field. Tiered returns today's tier groups; budget
   returns one group, the whole field, ordered by price descending. `buildSelectionGroups`
   calls it instead of reading tiers.

Plus an optional **`lineupSummary`** on the room for the viewed entry, returned by the engine:
budget fills `{ salaryCap, spent, remaining, isOverBudget, openSlots, cheapestFill }`
(`cheapestFill` = cost of the cheapest golfers that could fill the open slots, so the page can
warn "you can't fill your roster with what's left" without blocking). Null for tiered.

### 4.3 Pricing (Derek 2026-10-09: steeper top, prices as % of cap, rounded)
Event-owned, one price per golfer shared by every contest on the event, as today. The
auto-price action is rewritten as a curve over the field's seed order (seed 1 best):

```
x     = (seed - 1) / (fieldSize - 1)          // 0 for the best golfer, 1 for the worst
share = floor + (top - floor) * (1 - x) ^ steepness
price = round(salaryCap * share / unit) * unit
```

Five tunable values, approved by Derek 2026-10-09 as the defaults:

| Setting | Default | What it does |
|---|---|---|
| `salaryCap` | $50,000 | Reference cap the prices are a share of; also the budget templates' default cap |
| `unit` | $100 | Rounding increment (DraftKings style) |
| `topShare` | 24% of cap | Price of the best golfer ($12,000) |
| `floorShare` | 12% of cap | Price of the worst golfer ($6,000) |
| `steepness` | 4 | How fast prices fall from the top: 1 is a straight line, higher keeps the top few expensive and drops the middle of the field towards the floor |

With the defaults on a 144-player field: seed 1 $12,000, seed 5 $11,400, seed 10 $10,600,
seed 20 $9,400, seed 40 $7,700, seed 72 $6,400, last $6,000. The six most expensive cost
$69,600 and the six cheapest $36,000 against a $50,000 cap ($8,333 a slot), so the cap always
binds and every pick is a trade-off. The random jitter in today's `deriveGolfPrices` goes:
prices should be explainable from seed order. The price source label becomes `AUTO_RANKING`
(it is labelled `AUTO_ODDS` today though it comes from seed order).

**Pricing profiles (Derek 2026-10-09).** The values are kept as named profiles: a default
"Standard" ($50,000 cap, $100 unit) and a second "Small" ($5,000 cap, $10 unit), same shares
and steepness. Budgets are event setup, not contest setup (Derek). There is no event config JSON
today (`sport_events.metadata` is provider data). Two layers, approved by Derek 2026-10-09:
the reusable profiles live in an app settings group (`budgetPricingProfiles`); the values an
event was actually priced with live on the event in a new typed JSON column
`sport_events.pricing_config` (Zod-validated, null until priced), written on every assign and
frozen at release.

**Admin loop.** On an unreleased event the root admin opens Assign prices, picks a profile
(default preselected), sees its five values prefilled and may change any of them, assigns, and
can repeat with another profile or other values as often as they like. Release locks prices
for good.

**The event remembers its cap.** Assigning prices also stores the profile values used in the
event's `pricing_config`. A budget contest takes its salary cap from its event, read
only to the commissioner: a contest cap that disagrees with how its event was priced would
make the format either trivial or impossible. Commissioners set roster size and counted
scores.

### 4.4 Web app
- **Create contest:** a selection-type choice (Tiered / Budget) that filters templates and
  swaps the rules fields (picks per tier vs. roster size and salary cap; counted scores for
  both). Every released event is fully priced, so budget is offered on any event.
- **Contest settings (Commissioner tools):** read-only rules line per type, e.g. "Budget · 6
  golfers · $50,000 cap · best 4 count".
- **Entry page:** a small per-type lineup-builder registry keyed by `selectionType` (mirrors
  the backend registry), so the page shell (header, tiebreaker, Submit) is shared and each type
  supplies its list and its completeness rule. Budget builder: one searchable list sorted by
  price with each row's price; a sticky spend bar (spent / cap, remaining, average left per
  open slot); over-budget shows a red state and a plain sentence, the Submit button stays
  disabled with the reason, and a server `409 ENTRY_OVER_BUDGET` is shown the same way.
  Tapping a picked golfer removes them.

## 5. Slices (PR-sized)

| # | PR | Contents |
|---|---|---|
| 0 | Pricing for budget | §4.3 curve and its five settings, dialog fields, `AUTO_RANKING` label; release blocked until every active golfer is priced. Backend + root-admin UI. Independent of 1–4; can run in parallel with 1. |
| 1 | Budget config and templates (backend) | §4.1 typed union in shared domain + DTO + mapper + OpenAPI + SDK regen; budget validation incl. `CONTEST_BUDGET_UNFILLABLE`; budget engine reads `rosterSize` from `configJson`; leaderboard stops reading legacy columns; migration seeding the two budget templates; replace `plans/128` with this plan; file the column-drop follow-up. |
| 2 | Budget rules in the selection room (backend) | §4.2: toggle-off, `PRICE_MISSING`, shortfall issue list, `409 ENTRY_OVER_BUDGET` at submit, revert-to-Draft when over after submit, `groupField`, `lineupSummary` on `SelectionStateResponse`; SDK regen. Unit tests per engine rule, integration for submit refusal and revert. |
| 3 | Create and show budget contests (web) | §4.4 create form type choice and fields, Commissioner tools rules line. |
| 4 | Budget entry page (web) + journey | §4.4 lineup-builder registry with tiered moved behind it unchanged, budget builder, spend bar, errors; one e2e journey: create budget contest, go over cap, Submit refused, swap under, Submit succeeds, appears on leaderboard. |

Order: 1 → 2 → 4, with 3 after 1; 0 any time before 4's e2e (it needs real prices). 2 and 3
can run in parallel. Each opens against `main` as soon as its gates pass.

## 6. What makes #99 and #199 easy afterwards
- A new type is: one `ContestSelectionConfig` arm, one engine, one lineup builder, one template
  migration. The handler, submit, revert-to-Draft and the page shell don't change.
- Category (#99) uses `groupField` (groups = categories) and a `CATEGORY_SHORT` issue.
- Snake (#199) needs one thing this plan does not add: **turn order** (whose pick it is, timer,
  auto-pick). That is a handler-level concept (`currentEntryId` already exists in the room
  shape), designed in #199's own plan; nothing here blocks it.

## 7. Testing
Per `rules/testing-rules.md` §1A–§1C: engine rules unit-tested per outcome (toggle-off on a
full roster, over-cap pick accepted, unpriced rejected, shortfall issue for each rule); cents
arithmetic tested with prices like 33.33; integration tests for create validation, submit
refusal and revert-to-Draft; contract verification for the changed responses; the slice 4 e2e
journey. Tiered behaviour is pinned by its existing functional suite before slice 2 touches the
engine interface.

## 8. Decisions and open questions
- **Decided (Derek 2026-10-09):** picks may take an entry over budget; Submit is disabled in the
  page and refused by the server while over budget; an entry under budget with every slot
  filled can be submitted. The "can't fill with what's left" warning is advisory only.
- **Decided (Derek 2026-10-09):** §4.3 curve and defaults; Standard and Small profiles on the
  Manage > Settings page; applied values on `sport_events.pricing_config`, frozen at release.
- **Decided (Derek 2026-10-09):** releasing an event is blocked until every active golfer has a
  price, as it is for tiers today (slice 0 adds the release blocker).

## 9. Refresh against the redesigned pages (2026-10-10, `main` at `3a6481a`)

Nothing in the redesign changes a decision above. What it changes is where each slice lands:

- **Create contest (#573).** The page already holds the format as a typed form value
  (`selectionType`) and lists formats from one `FORMAT_CHOICES` array whose comment reserves
  Budget's card. Slice 3 is a second card plus its rules fields. The rules inputs live in the
  shared `ContestRulesFields` (used by Create *and* Edit contest), so budget fields go there,
  switched on the selection type; `contest-rules.ts` already switches its sentence, preset
  label and suggested name on the selection type, so each gains a Budget arm.
- **The cap needs to reach the page.** `SportEventDto` carries `tierCount` but nothing about
  prices. Slice 0 adds the event's applied pricing (`salaryCap`, or null when unpriced) to the
  event DTO, so Create contest can show the inherited cap read-only and disable the Budget card,
  with a reason, on an event that was never priced. That case is real in QA: events released
  before slice 0 have no prices and can't be re-priced (prices lock at release).
- **Contest page / Edit contest (#572).** Both read `formatContestRules`; the Budget arm covers
  them. Edit contest shows Format as fixed, so only the rules fields change.
- **Entry page.** Unchanged since the plan: `contest-entry-page.tsx` still refuses non-tiered
  contests and counts tier groups; slice 4 as planned.
- **Admin event screens (#558).** Auto-assign prices sits on the tournament's **Tiers** page
  (`golf-tier-auto-assign-actions.tsx`), prices are editable in the Field grid, and Release's
  "not ready" message names tiers only. Slice 0 rewrites the price dialog there (profile pick
  plus five values) and extends the release blocker and its message to prices.
- **Leaderboard: no tier assumption, no change.** The page's own contract says it shows no
  tier, price, rank or category (`contest-leaderboard-page.tsx`), and the server's counting rule
  reads `countedScores` from `configJson` (`contest-leaderboard-calculator.ts`). A budget entry's
  golfers will show exactly like a tiered one's. The only leaderboard touch is slice 1 removing
  the dead `rosterSize`/`pickCount` fallback in that counting rule.

PR order as built: 0 pricing → 1 typed contest rules → 2 server budget rules → 3 Create contest
Budget card → 4 entry page budget view with the e2e journey. Each goes on the thread branch
restarted from `main` after the previous merges.
