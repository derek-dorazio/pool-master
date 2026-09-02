# Golf Category Drafts

> **Status:** In progress. **Beads epic:** `pool-master-wsu`. Its slice 1
> (`pool-master-ir1`) carries a cross-epic `blocked-by` link against `plans/124`'s slice 9
> (`pool-master-piv`) — not `124`'s full epic. `bd show pool-master-wsu` for the live list.
>
> **Coordination warning: shares a touchpoint with `plans/128`.** This epic's slice 5
> (`pool-master-398`) and `plans/128`'s epic (`pool-master-9oy`) slice 4 (`pool-master-6z6`)
> both extend `contest-entry-page.tsx:578`'s `selectionType !== 'TIERED'` gate. Do not let
> both land independently — whichever lands first should extend the gate to admit **both**
> `CATEGORY_PICK` and `BUDGET_PICK` in one small commit, and the other rebases onto it rather
> than re-editing the same line.
>
> **Testing policy:** see `plans/124`'s header — it applies to every slice in this epic
> too. In short: update every existing test the slice touches, give new code/branches
> direct unit coverage, and update any existing FAPI scenario whose shape this slice
> changes, in the same slice.

---

## 1. Context

`GolfContestConfigMode.GOLF_CATEGORY_PICKS` / `GolfCategoryContestConfig` existed in the
codebase as a fully-typed DTO/type-layer stub with **zero backend implementation anywhere** —
confirmed across `contest-management/service.ts`, `contests/service.ts`,
`golf-leaderboard-calculator.ts`, `golf-contest-settlement-service.ts`, and (checked in a later
pass) `drafts/routes.ts`, the actual live draft-room backend. `plans/124` §4.11 deletes it, and
deletes the live-but-dead UI branch in `create-contest-page.tsx` that submitted it. This plan
is the real, designed rebuild the user asked for — on a clean slate, not by resurrecting that
stub, per `plans/124` §4.6a/§4.11's explicit reasoning for why deleting first was still correct.

**Seed presets to ship with this plan** (exact user specification):

| Preset | Categories | Pick count | Counting rule |
|---|---|---|---|
| Category Draft — All Count | US Player, International Player, Rookie, Previous Champion, Wildcard | 1 from each (5 total) | All 5 count |
| Category Draft — Top 4 | same 5 categories | 1 from each (5 total) | Best 4 of 5 count |

**Categories are computed, not assigned — this is the central design decision, corrected from
an earlier draft of this plan.** An earlier draft modeled category membership as a stored,
admin-editable field per tournament (mirroring how tiers work). The user corrected this
directly: each category is defined by an **evaluation rule** against real, permanent facts
about a golfer (nationality, tour debut year, tournament history) — nothing is stamped or
manually assigned, and there is no "auto-assign categories" admin action at all. This is a
better design, not just a different one: it removes an entire admin workflow (nothing to
override, nothing that can drift from the underlying facts) and it dissolves what was this
plan's biggest open question (§9).

---

## 2. What already exists that this plan reuses (verified, not assumed)

- **`GolfCategoryKey`** (`packages/shared/domain/enums.ts:278-284`) already has 5 of the 6
  values this plan ends up needing: `SENIOR`, `ROOKIE`, `PREVIOUS_WINNER`, `US_PLAYER`,
  `INTERNATIONAL_PLAYER`. **Decision, revised from an earlier draft: add `WILDCARD`, keep
  `SENIOR`** rather than swapping one for the other — `SENIOR` gets a real rule (§3) too, just
  not one of the two default seed presets (§6). `PREVIOUS_WINNER` covers "Previous Champion" —
  same concept, existing enum value, no rename needed at the code level even though the
  user-facing label differs. `SENIOR`'s only other references (checked) are a trivially-derived
  DTO enum and the dead UI branch `plans/124` already deletes — irrelevant now that it isn't
  being removed anyway.
- **`SelectionType.BUDGET_PICK`** already exists for `plans/128` — no equivalent
  `SelectionType` value exists for category picks yet. This plan adds one: `CATEGORY_PICK`.
- **`getDraftState`'s response contract is already generic enough for this with zero DTO
  changes** — verified by reading `drafts.dto.ts:194`/`150`: `selectionGroups`
  (`groupId`/`groupName`/`groupNumber`/`picksFromGroup`/`participants`) is already reused
  identically for `TIERED` and `BUDGET_PICK` today. One group per category, `picksFromGroup: 1`,
  is exactly this shape — no contract work, only backend population logic (§4).
- **The leaderboard needs zero changes.** `golf-leaderboard-calculator.ts`'s counting logic
  (`resolveGolfLeaderboardCountingRule`/`buildGolfLeaderboardEntry`, best-N-of-M by score) is
  already completely draft-format-agnostic — it sorts picks by score and counts the top N,
  never inspecting how a pick was drafted. This is the concrete proof of the user's own point
  in `plans/126`: a category draft's leaderboard looks identical to a tiered one.
- **`Participant.nationality`** (`schema.prisma:583`, `String? @db.VarChar(10)`, pre-existing)
  is a real, permanent fact about the player — the `US_PLAYER`/`INTERNATIONAL_PLAYER` rule's
  data source (§3).

---

## 3. Data model — two new facts about a player, one new piece of tournament history

**`nationality` and tour debut year are properties of the *player*, not the tournament** — the
user's framing, and the right one: they don't change per event, so they don't live on
`SportEventParticipant`.

```prisma
// Participant (existing table) — one additive column:
yearJoinedTour Int? @map("year_joined_tour")
```

**"Previous Champion" is different in kind — it's a fact about the *tournament's recurring
identity*, not the player, and not any one year's instance of the tournament either.** An
earlier draft of this plan scoped the history table to `SportEvent` directly, reasoning that no
cross-year tournament link existed to attach it to instead. One now does:
`plans/124` §4.3a adds `LeagueEvent` — a stable identity for a recurring tournament ("The
Masters," "The US Open") separate from any one year's `SportEvent` row, which every year's
`adminCreateGolfTournament` (including via Clone Season, `plans/124` §4.2a) resolves to
automatically by matching `(sportLeagueId, name)`. The history table links to *that*, not to
this year's `SportEvent`:

```prisma
/// Which golfers have previously won this recurring tournament — the data
/// source for the PREVIOUS_WINNER category rule. Linked to LeagueEvent
/// (plans/124 §4.3a), not to any one year's SportEvent, so there is nothing
/// to copy forward between years: every year's tournament resolves to the
/// same LeagueEvent and sees the same history automatically.
model LeagueEventPreviousWinner {
  id            String   @id @default(uuid()) @db.Uuid
  leagueEventId String   @map("league_event_id") @db.Uuid
  participantId String   @map("participant_id") @db.Uuid
  wonYear       Int      @map("won_year")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  leagueEvent LeagueEvent @relation(fields: [leagueEventId], references: [id])
  participant Participant @relation(fields: [participantId], references: [id])

  @@unique([leagueEventId, participantId, wonYear])
  @@map("league_event_previous_winners")
}
```

**This removes the copy-forward problem entirely, not just automates it.** An earlier draft
proposed having Clone Season copy the previous-winners list onto each newly-created tournament.
With the history linked to `LeagueEvent` instead, there's nothing to copy — this year's and next
year's `SportEvent` rows both resolve to the same `LeagueEvent` (§4.3a's find-or-create-by-name),
so they already see the identical history through one shared link. The only real remaining
question is *appending* a newly-completed tournament's own winner as a new row once known —
see §5/§9, now a smaller question than before.

**No `SportEventParticipantGolfCategory` table — an earlier draft of this plan had one, now
removed.** There is nothing to store per golfer per tournament; category membership is computed
at read time from the facts above.

**No schema change needed for `SENIOR` — corrected from an earlier draft.** That draft added
an `isSeniorTour: Boolean` column to `SportLeague` so any number of leagues could be flagged as
a senior tour. The user corrected this directly: there is exactly one senior tour
(`plans/124`'s "Champions Tour" / "PGA Tour Champions" example row), so a flag column is
overkill for a one-of-a-kind fact — the rule can just name the specific league. A new shared
constant identifies it by name, the same pattern `plans/124` §3.3 already uses for
`MANUAL_ADMIN_PROVIDER_ID`:

```ts
// packages/shared/domain/golf.ts — new constant
export const SENIOR_TOUR_LEAGUE_NAME = 'PGA Tour Champions';
```

`golf-category-rules.ts`'s `SENIOR` rule resolves the `SportLeague` row by this exact name once
per `deriveCategoryConfig` call (not once per golfer), then checks each participant's
`ParticipantLeagueAffiliation`s for a match on that league's id. **No admin has anything to set
or check** — the moment `plans/124`'s standard "add a league" flow creates a `SportLeague` row
named exactly `PGA Tour Champions`, the rule resolves it automatically. If no such row exists
yet, `SENIOR` simply has zero eligible members that draft, not an error — the same
not-an-error pattern already established for `PREVIOUS_WINNER` on a tournament with no
`leagueEventId`. This also dissolves what was §9's open question about where an admin would
set the flag — there's no flag to set.

### The six category rules — pure functions, not a generic rule engine

Six fixed categories don't need a data-driven "rules" abstraction — six small, named, pure
functions in a new `modules/golf/golf-category-rules.ts`, unit-tested in isolation the same way
`golf-seeding-algorithm.ts` is:

| Category | Rule | Data source |
|---|---|---|
| `US_PLAYER` | `nationality === 'USA'` | `Participant.nationality` |
| `INTERNATIONAL_PLAYER` | `nationality != null && nationality !== 'USA'` | `Participant.nationality` |
| `ROOKIE` | `yearJoinedTour === season.year` | `Participant.yearJoinedTour`, the tournament's own `Season.year` (not the real-world calendar year — the tournament's season is the correct reference point) |
| `PREVIOUS_WINNER` | `participantId` appears in this tournament's `LeagueEvent`'s `LeagueEventPreviousWinner` rows | `SportEvent.leagueEventId → LeagueEventPreviousWinner` |
| `SENIOR` | has *any* `ParticipantLeagueAffiliation` to the `SportLeague` row named `SENIOR_TOUR_LEAGUE_NAME` ("PGA Tour Champions") | `ParticipantLeagueAffiliation` joined to `SportLeague`, resolved by name — independent of which league the tournament itself belongs to, same cross-league-eligibility pattern `plans/124` §4.2 already establishes for field invites |
| `WILDCARD` | always true | none — every golfer in the field is eligible |

**A golfer with `nationality: null` is eligible for neither `US_PLAYER` nor
`INTERNATIONAL_PLAYER`** — explicitly, not as an accidental side effect of the comparison
(`null !== 'USA'` would otherwise silently classify them as international). They remain
eligible for `WILDCARD` (always) and independently for `ROOKIE`/`PREVIOUS_WINNER`/`SENIOR` if
those facts are known. This is what fully resolves the "ambiguous golfer" question an earlier
draft of this plan treated as open (§9) — there's no default to pick between, because there's
no assignment action making a default necessary in the first place.

**Categories are not a partition — they deliberately overlap, and `WILDCARD` overlaps with
everyone.** A US-based rookie is simultaneously eligible for `US_PLAYER`, `ROOKIE`, and
`WILDCARD`; a senior sponsor invite could be `SENIOR`, `WILDCARD`, and (if their nationality is
on file) `US_PLAYER`/`INTERNATIONAL_PLAYER` all at once. This is correct per the user's own
framing ("Wildcard would allow any player at all") and has one real consequence for pick
validation: eligibility overlapping across categories does **not** mean a member can draft the
*same* golfer into two category slots — "one from each category" still means as many distinct
golfers as categories in that contest's template. §4 covers the validation this requires that
tiers never needed (tiers are a strict partition, so this scenario can't arise there).

---

## 4. `drafts/routes.ts` — computed groups, plus one genuinely new validation rule

Once `plans/124` §4.6b's rewiring lands, `drafts/routes.ts`'s tier path calls
`golf-tier-service.getEffectiveTiersForContest`. This plan adds a structurally parallel, but
not identical, category path:

- **`deriveCategoryConfig`** (new function, sibling to the rewired `deriveTierConfig`): for the
  contest's linked event, loads the field (`SportEventParticipant` + `Participant`), its
  `leagueEventId`'s `LeagueEventPreviousWinner` rows (if the event has no `leagueEventId` — a
  one-off, non-recurring tournament — `PREVIOUS_WINNER` simply has no eligible members, not an
  error), and each participant's `ParticipantLeagueAffiliation`s (for `SENIOR`), then runs
  **only the category rule functions
  the contest's own template lists** (§3, §6 — six exist, a given template uses however many it
  declares, five for both current seed presets) to build one `selectionGroup` per listed
  category, `picksFromGroup: 1` for both seed presets. Unlike the tier path, a participant can
  legitimately appear in more than one group's `participants` list.
- **`buildDraftStateResponse`** dispatches on `Contest.selectionType`; add a `CATEGORY_PICK`
  branch calling `deriveCategoryConfig` instead of the tier path — structurally identical
  dispatch shape to the existing `TIERED`/`BUDGET_PICK` split, not new plumbing.
- **Pick validation** (`drafts/routes.ts:907-1184` today): add a `CATEGORY_PICK` branch
  enforcing two things, not one — (1) at most one pick per category (`picksFromGroup: 1`, the
  same shape as `TIERED`'s `picksFromTier` check), **and (2) a participant already picked for
  one category in this entry cannot be picked again for a different category** — genuinely new
  logic, since overlapping eligibility (§3) makes this reachable in a way the strictly-partitioned
  tiered path never has to guard against.

**Nothing about the tiered path needs to change to add this.** The dispatch is a new
`if`/`switch` branch alongside the existing one, not a restructuring of it — directly
satisfying "don't implement impediments" for `plans/124`'s tiered work.

**Correction inherited from `plans/128`'s §3.3 investigation, applies identically here**:
`contest-entry-page.tsx:578` hard-blocks every non-`TIERED` contest today (`if
(contest.selectionType !== 'TIERED') { return <ErrorState .../> }`). The earlier "no frontend
change needed" verdict (the audit behind `plans/126`) only checked the draft-room rendering
layer — this separate gate blocks a member from ever reaching the entry page for a
`CATEGORY_PICK` contest at all. This condition needs extending to admit `CATEGORY_PICK`
alongside `TIERED`; real frontend work, not zero as previously stated. Unlike `plans/128`,
category mode needs no budget-style running-total UI or a finalize-endpoint decision — once
this gate is extended, the existing entry-completion flow (`lineupComplete`, one pick per
`selectionGroup`) already works for a category room, with the one addition of surfacing
validation rule (2) above as a clear error if attempted.

---

## 5. UI

**No Field editor changes, no auto-assign action — there is nothing to assign.** This is the
concrete UI-side consequence of §3's redesign: an earlier draft of this plan added a Category
column and an "Auto-assign from nationality" button to the Field editor; neither is needed now,
since category membership is computed at draft-room render time from `Participant`/
`LeagueEventPreviousWinner`, never stored or edited per tournament.

**New surface actually needed: maintaining `LeagueEventPreviousWinner`.** Scoped to
`LeagueEvent` (`plans/124` §4.3a), not to any one year's tournament, this is smaller than an
earlier draft of this plan assumed — there's no per-year copy step, only:
- **Historical backfill via bulk upload, confirmed as the only entry point — no one-at-a-time
  manual add.** A bulk paste/upload, matching the established paste/upload/preview/apply
  pattern (`plans/124` §5.2/§6.4's shared `BulkUploadPanel`) — rows of
  `playerName or externalId, wonYear`, scoped per recurring tournament (i.e., per
  `LeagueEvent`, reachable from any year's Tournament Home that has one). A **"Clear existing
  history first"** checkbox on the upload controls the semantics, both confirmed:
  - **Checked** — deletes all of that `LeagueEvent`'s existing `LeagueEventPreviousWinner` rows
    before applying the upload, i.e. a clean full replace. The expected path for the initial
    historical load, or a full re-load if the source data was wrong.
  - **Unchecked (default)** — upsert on `@@unique([leagueEventId, participantId, wonYear])`:
    existing rows are left alone, new rows are added. The expected path for the common
    ongoing case, adding one new winner without touching prior years' data.
  Every future year's tournament that resolves to the same `LeagueEvent` sees whatever's
  loaded automatically — nothing to re-enter per year.
- **Appending a newly-completed tournament's own winner** — the one piece of genuine yearly
  maintenance left, and now independent of Clone Season entirely (there's no list to copy
  forward anymore, so this doesn't need to ride on that action at all). Once a tournament
  reaches `COMPLETED`, its position-1 finisher (`SportEventParticipantGolfStanding` where
  `position = 1`) is already fully determined by PoolMaster's own scoring data — a small
  **"Record champion"** action on Tournament Home (only shown when the event has a
  `leagueEventId` and is `COMPLETED`) that appends one `LeagueEventPreviousWinner` row from that
  standing, rather than requiring the admin to re-type a name that PoolMaster already knows.
  Manual entry remains available for backfilling years PoolMaster never scored itself.
- **Commissioner contest-config** (`create-contest-page.tsx`, once category mode exists for
  real): a `GOLF_CATEGORY_PICKS`-mode contest reads its category list and counting rule
  read-only from the linked template (§6), the same read-only-from-event/template pattern
  `plans/124` §4.6/§6.3 already established for tiers.

---

## 6. `ContestConfigTemplate` shape for this mode

Deferred here from `plans/124`'s ContestConfigTemplate discussion, per the user's direction —
this plan owns the category-shaped config, not `plans/124`. Unchanged by §3's redesign — the
template only ever needed to say *which* categories and *how many count*, never *how* a
category's membership gets computed:

```ts
interface GolfCategoryContestConfig {
  mode: 'GOLF_CATEGORY_PICKS';
  categories: Array<{ categoryKey: GolfCategoryKey; label: string; pickCount: 1 }>;
  countedScores: number; // 5 (all count) or 4 (top 4 of 5) for the two seed presets
}
```

Seeded via migration, matching `plans/124`'s decision that `ContestConfigTemplate` needs no
create/edit UI — both presets (§1) ship as data, not admin-authored content.

**`SENIOR` is a real, available category rule (§3) but is not part of either default seed
preset** — most tournaments don't admit senior players at all, so defaulting it into the
standard presets would be wrong for the common case. It exists for a future, separately-seeded
template targeting senior-eligible events specifically (a Champions Tour major, a "Legends"
exhibition mixing tours, etc.) — no new plumbing needed to add one later, since
`GolfCategoryContestConfig.categories` is already an arbitrary list, not a fixed five-tuple.
Not part of this plan's own seed migration; a follow-up whenever a real senior-eligible
tournament needs it.

---

## 7. Slice sequence

Cross-epic note: every slice here is blocked on `plans/124`'s epic slice 9
(`pool-master-piv`, the `drafts/routes.ts` tier/price rewiring) — not on `plans/124`'s full
epic. Slices 5 and 6 also depend on specific `plans/124` frontend slices (`BulkUploadPanel`,
Tournament Home) landing first.

| # | Slice | Depends on |
|---|---|---|
| 1 | `Participant.yearJoinedTour` column + `LeagueEventPreviousWinner` table + migration; `CATEGORY_PICK` added to `SelectionType` (§3) | `plans/124` slice 9 |
| 2 | `modules/golf/golf-category-rules.ts` — the six pure rule functions, including the `SENIOR_TOUR_LEAGUE_NAME` league-name lookup (§3); unit tests | 1 |
| 3 | `drafts/routes.ts`: `deriveCategoryConfig` + `CATEGORY_PICK` dispatch branch + the new cross-category pick-uniqueness validation rule (§4) | 2 |
| 4 | `ContestConfigTemplate` seed migration: `GolfContestConfigMode.GOLF_CATEGORY_PICKS` + the two presets, All Count and Top 4 (§6) | 3 |
| 5 | Frontend: extend `contest-entry-page.tsx:578`'s `selectionType !== 'TIERED'` gate to admit `CATEGORY_PICK` (§4) — coordinate with `plans/128`'s epic if both are open at once, see this plan's header | 3 |
| 6 | Frontend: `LeagueEventPreviousWinner` bulk-upload panel (paste/upload, "Clear existing history first" checkbox, upsert otherwise, §5), reusing `plans/124`'s shared `BulkUploadPanel` | 1, `plans/124`'s `BulkUploadPanel` slice |
| 7 | Frontend: "Record champion" action on Tournament Home, appending the position-1 finisher once a tournament completes (§5) | 1, `plans/124`'s Tournament Home slice |
| 8 | Commissioner contest-config: read-only category list + counting-rule display for a `GOLF_CATEGORY_PICKS` contest (§5) | 4 |
| 9 | FAPI scenario: category-pick contest end to end — create a tournament (via `plans/124`), create a category contest, submit entries obeying the no-golfer-in-two-categories rule, confirm the leaderboard renders with no code changes (format-agnostic, per `plans/126`) | 4, 5, 6, 7, 8 |

---

## 8. Verification

**Testing policy reminder — see the header.** This list is gates to run, not the whole
obligation: also update every existing test this epic's slices touch, give new code and
branches direct unit coverage, and keep FAPI coverage in sync with any changed API shape.

- *Unit* — each of the six category rule functions in isolation (nationality null-handling,
  `ROOKIE`'s `Season.year` comparison, `SENIOR`'s league-name resolution when the league
  doesn't exist yet, `PREVIOUS_WINNER` against a tournament with no `leagueEventId`); the new
  cross-category pick-uniqueness validation rule, including the case tiers never had to handle
  (one golfer eligible for two categories at once).
- *Integration* — `LeagueEventPreviousWinner`'s bulk-upload full-replace vs. upsert semantics
  (§5); the "Record champion" action's idempotency (running it twice doesn't double-insert).
- *FAPI* — slice 9 above is the flagship scenario.
- *Frontend* — the extended `contest-entry-page.tsx` gate (§4) with both `CATEGORY_PICK` and
  whatever `plans/128` adds already admitted, not just this plan's own type in isolation.

---

## 9. Open questions

1. ~~Should "Auto-assign categories from nationality" default `WILDCARD` for anyone without an
   unambiguous category, or leave them uncategorized?~~ **Dissolved by §3's redesign.** There is
   no auto-assign action and nothing is ever stored per golfer, so there's no default to choose
   — a golfer with unknown nationality is simply not `US_PLAYER`/`INTERNATIONAL_PLAYER`-eligible,
   full stop, computed correctly every time rather than defaulted once and left stale.
2. ~~`LeagueEventPreviousWinner`'s yearly-maintenance mechanism is proposed, not confirmed.~~
   **Confirmed: bulk upload only, no one-at-a-time manual add.** Simplified by linking to
   `LeagueEvent` (`plans/124` §4.3a) instead of per-year `SportEvent` — there's no copy-forward
   step to design, since every year's tournament already sees the same history through one
   shared link. Maintenance is exactly two paths, both now fully specified (§5): the bulk
   upload with its "Clear existing history first" checkbox (full replace vs. upsert) for
   historical backfill, and the "Record champion" auto-append action once a tournament
   completes for ongoing yearly maintenance. No separate single-row manual-entry UI.
3. ~~**`ROOKIE`'s reference year is the tournament's `Season.year`, not the real-world calendar
   year.**~~ **Confirmed.** Intended behavior as designed in §3, including for a tournament
   played very early or late in its nominal season year.
4. ~~Is `GolfCategoryKey`'s existing `SENIOR` value referenced anywhere that adding `WILDCARD`
   alongside it would affect?~~ **Resolved, checked: no hidden blast radius** — see §2. (No
   longer a removal, so the risk this question originally worried about no longer applies
   either — kept for the record since the check itself is still useful context.)
5. ~~**Where does an admin set `SportLeague.isSeniorTour`?**~~ **Dissolved by a corrected
   design (§3).** There is no `isSeniorTour` flag any more — the user pointed out a boolean is
   overkill when there's exactly one senior tour. `SENIOR` now resolves a specific `SportLeague`
   row by name (`SENIOR_TOUR_LEAGUE_NAME = 'PGA Tour Champions'`, §3) — an admin creates that
   league through `plans/124`'s ordinary "add a league" flow like any other, with nothing extra
   to set or a checkbox to find.
6. ~~**`LeagueEventPreviousWinner`/the category rule functions are golf-scoped by design, not
   an oversight.**~~ **Confirmed, not actually open** — recorded as design reasoning, not a
   question: `LeagueEvent` itself (`plans/124` §4.3a) is cross-sport, but this plan's use of it
   for category history is golf-specific. Per `plans/124` §4.9's explicit decision,
   generalizing any of this further is deferred until a second sport's real requirements exist
   to design against — same call as `plans/128`'s budget-mode question.

---

## 10. References

- `plans/124-golf-admin-tournament-management.md` §4.2a/§4.3a/§4.6/§4.6a/§4.6b — the event-owned
  tier model, `LeagueEvent` recurring-tournament identity, Clone Season, and `drafts/routes.ts`
  rewiring this plan builds directly on top of.
- `plans/126-leaderboard.md` — confirms the leaderboard requires no changes for this mode.
- `plans/128-golf-budget-drafts.md` — the sibling deferred plan; independent of this one,
  sharing the `ContestConfigTemplate`/`drafts/routes.ts` dispatch pattern and the
  `contest-entry-page.tsx` gate finding (§4).
