# Golf Contest Leaderboard

> **Status:** In progress. **Beads epic:** `pool-master-jhb`. Its slice 1
> (`pool-master-eeq`) carries a cross-epic `blocked-by` link against `plans/124`'s slice 1
> (`pool-master-uvc`) — not the whole `plans/124` epic; slices 2/3 have no other dependency on
> `plans/124`. `bd show pool-master-jhb` for the live list.
>
> **Testing policy:** see `plans/124`'s header — it applies to every slice in this epic
> too. In short: update every existing test the slice touches, give new code/branches
> direct unit coverage, and update any existing FAPI scenario whose shape this slice
> changes, in the same slice.

---

## 1. Context

The pick/draft UI (`contest-entry-page.tsx`/`contest-entry-selection.tsx`) already reads
tier/rank/price/odds correctly from `getDraftState` and needs no changes — confirmed by a prior
audit in this same conversation. What's missing is the other end: **members have no way to see
scores once picks are locked in.**

That's not because the backend doesn't exist. It does, fully, and matches this plan's spec
almost exactly out of the box:

- `ContestManagementService.getGolfLeaderboard` (`contests/service.ts:470`) — the real service
  method, gated on `contestPicksRevealed(contest.status)`.
- `GET /api/v1/contests/{contestId}/golf/leaderboard`, operationId `getGolfContestLeaderboard`
  (`contests/routes.ts:222`) — the real route.
- `golf-leaderboard-calculator.ts` (273 lines) — the real calculation logic, verified by
  reading the code, not assumed correct.

**Zero frontend files call it.** `contest-detail-page.tsx`'s heading toggles to "Leaderboard"
once picks are revealed, but its actual content is a generic, alphabetically-sorted entries
list with no scores — its own code comment explains why: *"pool-master-eux.5 removed the
legacy score blob that previously implied finish order here... the Golf-specific leaderboard
API owns score/rank ordering."* This plan is that deferred piece: build the page against the
endpoint that's been waiting for one.

**One real, concrete dependency on `plans/124`, not a vague one.** `loadGolfLeaderboardParticipants`
(`contests/service.ts:1142`) reads `row.status` directly into `participantStatus` — this is
exactly the `SportEventParticipant.status` column `plans/124` §4.1 replaces with
`isActive`/`inactiveReason`. Once that ships, this line breaks (or silently reads a field that
no longer means what it used to) and must be updated. This plan does not re-litigate that
decision — it just has to land in a sequence where this one line gets fixed, whichever plan's
slice touches it first.

---

## 2. Reference design (user-provided, described not fetched)

Based on the user's description of `easyofficepools.com`'s PGA Championship pool tracker,
translated into what already exists in the response model:

- **Per-entry header row**: the entry's total score, shown relative-to-par, computed as the
  **sum of only the counting picks** — not all of them. Non-counting picks (the worst
  `M - N` of an `N`-of-`M` format) render with strikethrough, visually present but excluded
  from the total.
- **Per-golfer rows**: a `Total` column (always relative-to-par) plus one cell per round.
  **Completed rounds display raw strokes** (e.g. "68"); **the in-progress round displays
  relative-to-par** (e.g. "-3"). This is a real, deliberate distinction, not an inconsistency.
- **No tier, price, rank, odds, or category anywhere on this view.** That data belongs
  exclusively to entry selection/submission (the pick UI, already correct) — the leaderboard's
  job is exactly "N golfers, M counting," independent of how they were drafted. This holds
  regardless of draft format: a tiered pool, a future category pool, and a future budget pool
  would all render an *identical* leaderboard, because none of that format-specific metadata is
  a leaderboard concern. That's a genuinely useful property: this page's shape never has to
  change if `plans/124`'s dropped `GOLF_CATEGORY_PICKS` mode ever comes back as real,
  purpose-built future work — it's already format-agnostic by construction.

---

## 3. What already exists (verified by reading the code, not assumed)

| Concern | Current behavior | Location |
|---|---|---|
| Counting rule | `resolveGolfLeaderboardCountingRule` builds `{ type: 'BEST_N_GOLFERS', count }` from `countedScores` (falls back to `rosterSize`/`pickCount`) — matches `plans/124` §4.6a's confirmed-kept contest-level fields | `golf-leaderboard-calculator.ts:34-51` |
| Entry total | `buildGolfLeaderboardEntry` sorts picks by score, takes the top `count` as `countingPickIds`, sums **only** those into `totalScoreToPar` | `golf-leaderboard-calculator.ts:53-100` |
| Dropped-pick flag | `isDropped: hasScore && !isCounting` — exactly the strikethrough signal the UI needs | `golf-leaderboard-calculator.ts:~93` |
| Per-round display | `toGolfRoundCell`: `status === 'complete'` → `displayType: 'STROKES'`, `displayValue: String(strokes)`; otherwise → `displayType: 'TO_PAR'`, `displayValue: formatRelativeToPar(scoreToPar)` — **this is already exactly the completed-vs-active rule from §2**, computed server-side | `golf-leaderboard-calculator.ts:247-266` |
| Position/ties | `rankGolfLeaderboardEntries` — tie-aware, produces `T{n}` display positions | `golf-leaderboard-calculator.ts` |
| Availability gate | `getGolfLeaderboard` throws `CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN` until picks are revealed | `contests/service.ts:475-480` |
| Route | `GET /contests/{contestId}/golf/leaderboard` → `getGolfContestLeaderboard` | `contests/routes.ts:222` |
| Frontend consumer | **None.** Grepped all of `clients/poolmaster/src` — zero references to `getGolfContestLeaderboard` outside the generated SDK | — |
| `contest-detail-page.tsx`'s fake "Leaderboard" | Generic, cross-sport, cross-format entries list, alphabetically sorted, no scores, no tier/price — deliberately scoped this way by an earlier slice (`pool-master-eux.5`) | `contest-detail-page.tsx:47-54` |

**Response shape already carries everything §2 needs** (`packages/core-api/src/mappers/contests.mapper.ts:74-145`):
`GolfLeaderboardModel { countingRule, participants, entries, asOf }`, `GolfLeaderboardEntryRow
{ totalScoreToPar, position, displayPosition, countingPickCount, scoredPickCount, picks }`,
`GolfLeaderboardEntryPickRow { isCounting, isDropped, tier, participant }`,
`GolfLeaderboardParticipantRow { worldRanking, oddsToWin, seedNumber, totalScoreToPar,
rounds: { r1..r4 } }` (three of these fields are trimmed, see below),
`GolfLeaderboardRoundCellRow { displayType, displayValue, thru }`.

**Resolved: trim these from the response.** `GolfLeaderboardParticipantRow.worldRanking`/
`oddsToWin`/`seedNumber` and `GolfLeaderboardEntryPickRow.tier` are exactly the fields §2 says
the leaderboard must never display, and this plan's UI will never render them. Keep the API
aligned to what it actually needs to serve — delete these four fields from
`contests.mapper.ts`'s `GolfLeaderboardParticipantRow`/`GolfLeaderboardEntryPickRow` and their
population in `loadGolfLeaderboardParticipants`/`buildGolfLeaderboardEntry`
(`contests/service.ts`). If a future consumer genuinely needs them (an admin debug view, say),
that's a small, well-scoped addition to make then, against a concrete requirement — not a
reason to carry unused fields now.

---

## 4. What this plan actually builds

This is overwhelmingly a **frontend plan**. The calculation logic already matches the spec;
the job is exposing it.

### 4.1 Backend — two required fixes, one sequenced against `plans/124`

1. **`participantStatus` → `isActive`/`inactiveReason`.**
   `loadGolfLeaderboardParticipants`'s `participantStatus: row.status ?? null`
   (`contests/service.ts:1142`) must change once `SportEventParticipant.isActive`/`inactiveReason`
   exist. Proposed mapping: drop the single `participantStatus: string | null` field from
   `GolfLeaderboardParticipantRow` and replace it with the same `isActive`/`inactiveReason`
   shape `plans/124` §4.1 already establishes everywhere else — one participant-status
   representation platform-wide, not a second string encoding invented for this one response
   model. This is a **sequencing dependency, not new design**: if `plans/124` ships first, its
   own slice work should include this fix (cross-reference back into that plan); if this plan
   ships first, it inherits the pre-existing bare-string column as-is and this fix becomes a
   follow-up slice once `plans/124` lands.
2. **Trim `worldRanking`/`oddsToWin`/`seedNumber`/`tier` from the response** (§3) — delete these
   fields from `GolfLeaderboardParticipantRow`/`GolfLeaderboardEntryPickRow`
   (`contests.mapper.ts`) and stop populating them in `loadGolfLeaderboardParticipants`/
   `buildGolfLeaderboardEntry`. Independent of fix 1 — no sequencing dependency, can land in
   this plan's own first slice.

### 4.2 Frontend — the real scope

**A new, separate page — not integrated into `contest-detail-page.tsx` at all.** Resolved by
the user directly: `contest-detail-page.tsx` is repurposed to be about **contest entry and
update, pre-live** — viewing and editing your own entry before the event goes live — and is
never used for the leaderboard. This sharpens `pool-master-eux.5`'s original principle (keep
the generic page generic) into a stronger statement: the generic page isn't just agnostic about
*how* to render scores, it doesn't render live/post-reveal contest state at all — that's a
wholly separate concern living on its own route.

- New route + page, e.g. `/leagues/:leagueId/contests/:contestId/leaderboard` (exact path
  TBD at implementation, matching this app's existing contest-route conventions) rendering the
  golf-specific `GolfLeaderboard` component, sourced from `getGolfContestLeaderboard`.
- `contest-detail-page.tsx` loses its misleading `picksRevealed ? 'Leaderboard' : 'Entries'`
  heading toggle (§3) — it keeps one consistent identity ("Entry" / "My Picks," exact label
  TBD) focused on pre-live viewing/editing, and gains a link out to the new leaderboard route
  once picks are revealed, rather than trying to *be* the leaderboard.
- This also resolves what §6's original open question 2 was asking — no longer open.

**Rendering, directly off the existing response shape — no client-side score math:**
- One block per entry (already sorted by `position` server-side — render in given order, don't
  re-sort): entry name, `displayPosition`, `totalScoreToPar` (bold, relative-to-par).
- One row per pick within the entry: golfer name, R1–R4 cells rendering `displayValue`
  verbatim (the server already decided STROKES vs. TO_PAR per cell), a `Total` column from the
  participant's own `totalScoreToPar`.
- `isDropped` picks render with strikethrough text; `isCounting` picks render normally. No
  other visual distinction needed — `isCounting`/`isDropped` are already mutually exclusive
  and exhaustive for scored picks.
- **No column for tier, price, rank, odds, or seed** — even though present in the payload
  (§3's mismatch, §6.1).
- Live refresh: reuse the polling pattern `contest-detail-page.tsx` already has for entries
  (`shouldPollContestEntries`), including its exact **30-second** `refetchInterval`
  (`contest-detail-page.tsx:157`) — no separate constant, since it already lines up with the
  backend's own 30–60s live-scores sync cadence (confirmed §6).
- **Current-round header cue** — a small header above the leaderboard body, e.g. "Round 2 —
  In Progress," derived from data the response already carries (no new field needed): the
  highest round number with any `IN_PROGRESS` cell across the field, or the highest completed
  round if none are in progress. Confirmed in scope (§6).

**Supporting frontend work**: add `getGolfContestLeaderboard` to `query-keys.ts` and
`msw-api.ts`'s `operationDefinitions` (the standard "every new/newly-consumed operationId"
requirement already established in `plans/124`).

---

## 5. API surface

No new backend operations. This plan is entirely a new consumer of an operation that already
exists:

| Method + path | operationId | Notes |
|---|---|---|
| `GET /contests/{contestId}/golf/leaderboard` | `getGolfContestLeaderboard` | Already implemented, already gated on picks-revealed (`409`-shaped `CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN` otherwise). §4.1's two fixes — `participantStatus` → `isActive`/`inactiveReason`, and trimming `worldRanking`/`oddsToWin`/`seedNumber`/`tier` — are the only planned modifications to this operation's response shape. |

---

## 6. Open questions

1. ~~Trim the unused fields, or leave them?~~ **Resolved: trim.** Keep the API aligned to what
   it's actually required to serve — see §3, §4.1.
2. ~~Exact UI placement.~~ **Resolved: separate route, not integrated into
   `contest-detail-page.tsx` at all** — see §4.2.
3. ~~**Polling interval.**~~ **Confirmed: reuse `shouldPollContestEntries`'s exact 30-second
   interval.** No separate leaderboard-specific cadence — it already lines up with
   `EVENTLIVESCORES`'s own 30–60s sync cadence (`plans/124`/`125`), see §4.2.
4. ~~**Current-round context cue.**~~ **Confirmed: in scope.** A header like "Round 2 — In
   Progress" above the leaderboard, derived client-side from the existing response (highest
   round with an in-progress cell, else highest completed round) — see §4.2.
5. ~~**Sequencing against `plans/124`.**~~ **Confirmed: rides with `plans/124`'s own slice
   work.** The `participantStatus` → `isActive`/`inactiveReason` fix (§4.1 fix 1) lands in
   whichever `plans/124` slice migrates `SportEventParticipant.status`, not as a separate
   follow-up slice here — avoids an intermediate state where the leaderboard mapper still
   reads a column `plans/124` has already dropped. `plans/124`'s own slice table should be
   updated to note this when that slice is scheduled.

---

## 7. Slice sequence

| # | Slice | Depends on |
|---|---|---|
| 1 | `GolfLeaderboard` frontend component + new route (§4.2) + `query-keys.ts`/`msw-api.ts` additions; backend trim of `worldRanking`/`oddsToWin`/`seedNumber`/`tier` from `GolfLeaderboardParticipantRow` (§4.1 fix 2 — no sequencing dependency, rides here) | — |
| 2 | Repurpose `contest-detail-page.tsx`: remove the `picksRevealed ? 'Leaderboard' : 'Entries'` toggle, settle on one pre-live entry-focused identity, add a link out to the new leaderboard route once picks are revealed (§4.2) | 1 |
| 3 | Live-refresh polling reusing `shouldPollContestEntries`'s exact 30s interval + current-round header cue (§4.2, §6.3) | 1 |

**Not a slice of this epic**: the `participantStatus` → `isActive`/`inactiveReason` fix (§4.1
fix 1, §6 item 5) is confirmed to ride inside `plans/124`'s own slice 1
(`pool-master-uvc`) — tracked there, not duplicated here.

---

## 8. Verification

**Testing policy reminder — see the header.** This list is gates to run, not the whole
obligation: also update every existing test this epic's slices touch and keep FAPI
coverage in sync with any changed API shape (notably the `participantStatus` →
`isActive`/`inactiveReason` fix, §4.1).

- *Unit* — no new calculation logic to test (§3 confirms it already exists and is already
  covered), but add a regression test locking in the `isDropped`/strikethrough contract at the
  component level: an entry with `M` picks and `N`-counting rule renders exactly the top `N` by
  score as normal weight and the rest struck through, regardless of pick order in the raw
  response.
- *Component* — Vitest + RTL: a round cell with `displayType: 'STROKES'` renders the raw
  number; one with `displayType: 'TO_PAR'` renders the formatted relative-to-par string; the
  component never renders a tier/price/rank/odds value even though the mock response includes
  them (asserts the omission, not just the inclusion of what's expected).
- *Integration* — exercise the full chain: create a contest, submit an entry, reveal picks,
  post round scores through the existing sync/manual-upload path, call
  `getGolfContestLeaderboard`, assert the entry total only reflects counting picks and dropped
  picks are flagged correctly.
- *Manual* — view a live (or manually-scored) golf contest's leaderboard mid-tournament and
  confirm the in-progress round shows to-par while a completed round shows strokes, side by
  side, on the same page.

---

## References

- `plans/124-golf-admin-tournament-management.md` — the event-owned tier/price/field model;
  §4.1's `isActive`/`inactiveReason` is this plan's one real dependency.
- `plans/125-sync-flow-deprecation.md` — `EVENTLIVESCORES` remains the score source this
  leaderboard ultimately reads through `SportEventParticipant`/`SportEventParticipantGolfRound`.
- `pool-master-eux.5` — the prior slice that deliberately deferred golf-specific score/rank
  display out of the generic contest detail page, which this plan finishes.
