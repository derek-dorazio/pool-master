# League history

**Tracking issue:** #837

**Depends on:** #841 (sports league cups) and #863 (league championship), both designed in
`plans/season-cups.md`. Both go first; nothing here starts until the pages it builds on exist.

Rescoped 2026-10-22 on Derek's direction: history is **only additive** on top of the cups and
championship. Those features design and build every current-year view (the cup leaderboards,
the championship trophy, podium, medal tiles and finish matrix, the trophy shelf on team pages).
History adds three things on top:

1. **Past years:** the same year boards for earlier years.
2. **Drill-through:** from a year board into that year's contests and their final leaderboards.
3. **One all-time summary** across every year, drilling into each year's board.

Earlier versions of this plan (git history) also had history's own season pages, all-time
tables, a record book and team history pages. Those are dropped: the year boards replace them.
Research input: `plans/league-history-research.md`.

---

## 1. What it builds on

| Piece | From | Used for |
|---|---|---|
| Championship page, `GET /leagues/:leagueId/championship/:year`, `GET .../championship` (years with champions) | #863 | Past years of the championship board; the summary's list of years |
| `LeagueYearFinish`, one row per squad per counted contest, written at settlement | #863 | The summary's counts. Nothing re-reads every contest |
| Season page (Championship, Trophy case and Points race tabs, year picker, All years link), frozen `CupStanding`, `GET /cups?seasonYear=`, `GET /cups/past` | #841 | Past seasons of the cup boards; the summary's cup champions |
| Trophy shelf on team pages | #841 slice 4, #863 slice 2 | Already shows every past top-3 finish; history adds nothing there |
| Squad delete guard (`SQUAD_DELETE_HAS_RESULTS`) and the best-entry-per-squad function | whichever of #841 slice 1 or #863 slice 1 goes first | A deleted squad can't punch a hole in a past year |
| `Contest.seasonYear` | #841 slice 1 | Cup seasons |
| Frozen contest leaderboards | existing: a `COMPLETED` contest's leaderboard reads `ContestEntryStanding` | The drill-through target. Already works for any past contest |

A year is the calendar year a contest went Final (#863). Cups keep their own season
(`seasonYear`, #841), so the 2025 NFL Cup appears under 2025 even though its last pool went
Final in February 2026. Each board labels its own year, so the two never sit on one table.

## 2. Past years

The cups plan's **Season page** (`plans/season-cups.md` §6 *Navigation*) holds a year's three
views as tabs: Championship (lands first, every year), Trophy case, and Points race with sports
league chips, at `/league/:code/season/:year`. Its header has a **year picker** and an
**All years** link. History's past years are that picker: choosing 2025 changes every tab at
once, and the year is in the path, so a past year can be linked and shared.

A past year shows the same tabs frozen: the trophy presented, the podium, tiles and matrix; each
crowned cup with its podium and table. Live parts (movement arrows, "Ready to crown", progress,
projected points) drop out.

- The years offered come from `GET .../championship` (years with a counted contest) and from
  the seasons that have a cup. The picker shows only years that have something.
- The pages already read by year (`/championship/:year`, `/cups?seasonYear=`), so the picker
  needs no new endpoint.
- A past cup still `OPEN` (never crowned) shows its standings with "Not crowned" in place of the
  podium. Nothing nags the commissioner about it.

Questions:

- **Q2.1** Should the picker skip years with nothing in them? Recommendation: yes. A league that
  sat out 2024 jumps from 2025 to 2023.

## 3. Drill-through to past contests

From a year board to the contests behind it, then to each contest's final leaderboard (which
already exists and is frozen):

- **Championship tab:** a "Contests" list under the matrix, every contest that went Final that
  year, newest first: name, sport, date, winner (co-winners on ties), entries, and "Not counted"
  or "No result" where they apply. Tapping one opens its leaderboard. A matrix row or medal tile
  opens the squad's year (cups plan §6), which is this list filtered to the squad; a matrix cell
  (a squad's 2nds, say) filters it further to that place.
- **Points race tab:** its counted contests are already listed with winners (#841); in a past
  year each row opens that contest's final leaderboard the same way.
- **Contests page, History view:** gains the same year filter and winner line, and pages 25 at a
  time instead of loading every contest.

One new endpoint: `GET /leagues/:leagueId/history/contests?year=&squadId=&place=&page=`,
returning `ContestResultSummaryDto` (contest id, name, sport, contest format, selection type,
settled date, entry count, `winners` with squad ref and entry name, `counted: boolean`,
`hasResult: boolean`). The `squadId` and `place` filters serve the matrix cell; they read
`LeagueYearFinish`, so a cell's list always matches its count. Shapes in
`packages/shared/dto/history.dto.ts`; members and root admin, the league's usual access check.

Questions:

- **Q3.1** Matrix cells open the matching contests? Recommendation: yes. It answers "which
  were my three 2nds?" with no extra page.
- **Q3.2** List Not counted and cancelled contests in a year, marked? Recommendation: yes. They
  happened, and the list should say why they aren't in the matrix.
- **Q3.3** Show a renamed squad by its name at the time? Recommendation: yes, the entry name
  (already stored), with the current name beside it when they differ.

## 4. All-time summary

The Season page's **All years** link opens one page across every year, at `/league/:code/history` (mockup C on the season cups canvas,
widened to include the championship):

- **Top:** most championships and most cups won, as tiles, each with the squad and its count.
- **Then each year, newest first:** the championship trophy with its champion, and that year's
  cup champions underneath. The current year shows "2026 so far" with the leaders. Tapping a year
  opens `/league/:code/season/:year` on its Championship tab; tapping a cup champion opens that
  year's Points race with the cup's chip selected.
- **No tabs.** It is one page. The Seasons, Cups, All-time and Records tabs in mockup C come from
  this plan's first version and go.

One endpoint, `GET /leagues/:leagueId/history/summary`: the tile counts and, per year, the
champion squad(s) and cup champions. It reads `LeagueYearFinish` and `CupStanding` for the
league, a few hundred rows a year, summed by pure functions in a small `history` module
(`rules/architecture-rules.md` §5 *Project Structure and Layer Boundaries*). `SummaryTile` is a
typed enum (`MOST_CHAMPIONSHIPS`, `MOST_CUPS`).

There is no separate History menu item: the summary is reached from the Season page's
All years link, and My team's "Contest history" link points at it instead. Today's
`my-team-history-page.tsx` (the viewer's past contests, read with one request per contest) and
its `/league/:code/history` route are deleted, since the trophy shelf and the drill-through cover
it; the route becomes the summary.

Questions:

- **Q4.1** Does the summary live in history, at `/league/:code/history`? Recommendation: yes, as
  Derek's message puts it. #841's planned slice 6 (the same page at `/history/cups`) folds in
  here.
- **Q4.2** Two tiles only (championships, cups)? Recommendation: yes for now. More tiles (most
  podiums all-time, most contests won) can come later from the same rows if leagues ask.
- **Q4.5** No History menu item, only the Season page's All years link? Recommendation: yes. One
  Season menu item holds every year, and All years is one tap from any of them.
- **Q4.3** Delete My team history once the summary and trophy shelf are in? Recommendation: yes,
  in slice 3.
- **Q4.4** Build history open to every league now, and gate it when paid plans exist? Section
  5 says which class each view is in. Recommendation: yes.

## 5. Service classes

History exists to be worth paying for (Derek, 2026-10-22). Nothing is gated yet. Derek doesn't
want features forced into four levels (2026-10-22): the plans differ mostly by other levers
(entries per contest, league size, number of sports leagues; `plans/monetization-strategy.md`).
History needs only two classes of its own, using the shared `ServiceClass` letters
(`plans/season-cups.md` Q9.1), plus one rule:

| View | Class | Why |
|---|---|---|
| A past contest's final leaderboard; the Contests page History view with winners, any year | Essential | A result never disappears. A league that drops a plan still sees every contest it played |
| Past years of the championship board, and its drill-through | The championship's own class | Past years come with the feature: a league that has the championship has its history |
| Past seasons of the sports league cups | The cups' own class | Same rule |
| All-time summary across every year | D (Platinum) | Derek: the multi-year trend view is Platinum |

- **Downgrades hide, never delete.** A league that loses a feature keeps every row; the views
  above its plan show a short locked note to everyone and the upgrade path to the commissioner.
- **Typed:** a `HistoryFeature` enum (`CONTEST_RESULTS`, `ALL_TIME_SUMMARY`) mapped to
  `ServiceClass` in `packages/shared/domain`. Past-year views ask for the feature they show
  (the championship's or the cups'), so they need no entry of their own. The routes ask the
  entitlements function about the feature, never about a plan.

Questions:

- **Q5.1** These classes? Recommendation: as in the table.

## 6. Slices

All after #841 and #863 have shipped the pages they extend. Each slice is one PR with its docs, its views' feature checks,
unit tests of the pure functions, integration tests for each new query (`rules/testing-rules.md`
§9), contract verification for each new endpoint, and a browser journey row.

1. **Past years.** The Season page's year picker opens past years on every tab, with live parts
   hidden. Mostly web; the read endpoints exist. If the cups build the picker for the current
   year only, this slice fills its past years.
2. **Drill-through.** `GET .../history/contests`; the Contests list under the Championship tab,
   the squad's year and matrix cells that filter it, past points race rows opening leaderboards, and the year filter and winner line on the Contests page History
   view.
3. **All-time summary.** `GET .../history/summary`; the All years page and its links; delete
   `my-team-history-page.tsx` and its per-contest fetch loop.

Slices 1 and 2 can go in parallel; 3 after 1.
