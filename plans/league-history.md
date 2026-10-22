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
| Cups and Cup pages, frozen `CupStanding`, `GET /cups?seasonYear=`, `GET /cups/past` | #841 | Past seasons of the cup boards; the summary's cup champions |
| Trophy shelf on team pages | #841 slice 4, #863 slice 2 | Already shows every past top-3 finish; history adds nothing there |
| Squad delete guard (`SQUAD_DELETE_HAS_RESULTS`) and the best-entry-per-squad function | whichever of #841 slice 1 or #863 slice 1 goes first | A deleted squad can't punch a hole in a past year |
| `Contest.seasonYear` | #841 slice 1 | Cup seasons |
| Frozen contest leaderboards | existing: a `COMPLETED` contest's leaderboard reads `ContestEntryStanding` | The drill-through target. Already works for any past contest |

A year is the calendar year a contest went Final (#863). Cups keep their own season
(`seasonYear`, #841), so the 2025 NFL Cup appears under 2025 even though its last pool went
Final in February 2026. Each board labels its own year, so the two never sit on one table.

## 2. Past years

A **year toggle** on the championship page and on the Cups and Cup pages: the current year by
default, earlier years in a dropdown, newest first. A past year shows the same page frozen: the
trophy presented, the podium, tiles and matrix; each crowned cup with its podium and table.

- The years offered come from `GET .../championship` (years with a counted contest) and from
  the seasons that have a cup. The toggle shows only years that have something.
- The pages already read by year (`/championship/:year`, `/cups?seasonYear=`). The toggle puts
  the year in the URL (`?year=2025`), so a past year can be linked and shared.
- A past cup still `OPEN` (never crowned) shows its standings with "Not crowned" in place of the
  podium. Nothing nags the commissioner about it.

Questions:

- **Q2.1** Year in the URL as `?year=`, so past years can be shared? Recommendation: yes.
- **Q2.2** Should the toggle skip years with nothing in them? Recommendation: yes. A league that
  sat out 2024 jumps from 2025 to 2023.

## 3. Drill-through to past contests

From a year board to the contests behind it, then to each contest's final leaderboard (which
already exists and is frozen):

- **Championship board:** a "Contests" list under the matrix, every contest that went Final that
  year, newest first: name, sport, date, winner (co-winners on ties), entries, and "Not counted"
  or "No result" where they apply. Tapping one opens its leaderboard. A tap on a matrix cell
  (a squad's 2nds, say) filters the list to those contests.
- **Cup board:** its counted contests are already listed with winners (#841); a past season's
  list opens each leaderboard the same way.
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

The **History** menu item opens one page across every year (mockup C on the season cups canvas,
widened to include the championship):

- **Top:** most championships and most cups won, as tiles, each with the squad and its count.
- **Then each year, newest first:** the championship trophy with its champion, and that year's
  cup champions underneath. The current year shows "2026 so far" with the leaders. Tapping a year
  opens its championship board (section 2) at that year; tapping a cup opens that cup's board.

One endpoint, `GET /leagues/:leagueId/history/summary`: the tile counts and, per year, the
champion squad(s) and cup champions. It reads `LeagueYearFinish` and `CupStanding` for the
league, a few hundred rows a year, summed by pure functions in a small `history` module
(`rules/architecture-rules.md` §5 *Project Structure and Layer Boundaries*). `SummaryTile` is a
typed enum (`MOST_CHAMPIONSHIPS`, `MOST_CUPS`).

The menu link replaces today's "Contest history" link on My team. Today's
`my-team-history-page.tsx` (the viewer's past contests, read with one request per contest) and
its `/league/:code/history` route are deleted, since the trophy shelf and the drill-through cover
it; the route becomes the summary.

Questions:

- **Q4.1** Does the summary live in history, at `/league/:code/history`? Recommendation: yes, as
  Derek's message puts it. #841's planned slice 6 (the same page at `/history/cups`) folds in
  here.
- **Q4.2** Two tiles only (championships, cups)? Recommendation: yes for now. More tiles (most
  podiums all-time, most contests won) can come later from the same rows if leagues ask.
- **Q4.3** Delete My team history once the summary and trophy shelf are in? Recommendation: yes,
  in slice 3.
- **Q4.4** Build history free for every league, and gate it when paid plans exist
  (`plans/monetization-strategy.md`)? Recommendation: yes. Each page is one route, so gating later
  is one check per route.

## 5. Slices

All after #841 and #863 have shipped the pages they extend. Each slice is one PR with its docs,
unit tests of the pure functions, integration tests for each new query (`rules/testing-rules.md`
§9), contract verification for each new endpoint, and a browser journey row.

1. **Past years.** The year toggle on the championship, Cups and Cup pages, with the year in
   the URL. Mostly web; the read endpoints exist.
2. **Drill-through.** `GET .../history/contests`; the Contests list under the championship board,
   matrix cells that filter it, and the year filter and winner line on the Contests page History
   view.
3. **All-time summary.** `GET .../history/summary`; the History menu item and page; delete
   `my-team-history-page.tsx` and its per-contest fetch loop.

Slices 1 and 2 can go in parallel; 3 after 1.
