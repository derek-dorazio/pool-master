# League history

**Tracking issue:** #837

Written 2026-10-21 for Derek's ask: a design refinement pass on the history features. The
feature list came from the monetization strategy (#581, `plans/monetization-strategy.md`,
*History*), which named five pages and five questions but no model, contract or slices. This
plan checks those ideas against main and cuts them into slices. Questions sit under the section
they belong to, each with a recommendation; none blocks slice 1.

**Updated 2026-10-22** (twice) to line up with the league championship (#863, `plans/season-cups.md`
section 8) and the sports league cups (#841, same plan). Derek's direction: a league's year is
the calendar year, its championship page (trophy, medal tiles, finish matrix) freezes on
1 January and *is* that year's history view, and year results are stored as contests settle so
history never re-reads every contest. Research input: `plans/league-history-research.md`.

---

## TL;DR

- **A history year is the championship year.** A contest belongs to the calendar year it went
  Final (#863). The frozen championship page for that year is the year's history view, with the
  year's contests and winners under it.
- **History reads stored finishes, not every contest.** #863 writes a `LeagueYearFinish` row per
  squad per counted contest at settlement. All-time standings, records and trophies add those
  up; nothing re-sums `ContestEntryStanding` across all time.
- **Records count finishes, not scores.** A golf to-par total, a pick'em points total and a
  squares box count can't be compared, so all-time numbers are wins, podiums and places.
- **One gap left in the model:** deleting a squad erases its past results. Slice 1 refuses it.
- **Single-year views first, then all-time.** Each year is the championship and cup pages with a
  year toggle; an all-time summary (mockup C) fronts them later.
- **Five slices:** past contests with winners and the squad delete guard; the year's contests
  under the championship page; team history; the all-time summary and table; the record book.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| Contests page, History view | `/league/:code/contests/history`, `league-contest-history-page.tsx` | Lists `COMPLETED` contests as cards. No winner, no year, no paging |
| My team history | `/league/:code/history`, `my-team-history-page.tsx` | The viewer's own squad only. Calls `listContestEntries` once per contest in the league (N requests), then filters to its entries |
| Frozen results | `ContestEntryStanding` | One per entry: `position` (1 best, ties allowed), `displayPosition` ("T2"), `totalScore` in the contest's unit, `settledAt`. Written by settlement only, for every contest type |
| Per-event results | `ContestEntryEventStanding` | A pick'em week's or a major's place per entry; place 1 is the week's winner |
| Entry name | `ContestEntry.name` | Built from the squad's name when the entry is made, so it already keeps the name as it was |
| Squad delete | `SquadService.deleteInactiveSquad` | Root admin only, squad must be inactive. Deletes its entries, which cascades their standings |

Planned elsewhere and used here:

| Piece | Ticket | Used for |
|---|---|---|
| `LeagueYearFinish` (league, year, squad, contest, place, tie count, weight, points), written at settlement, backfilled | #863 slice 1 | Year view, all-time, records, trophies |
| Championship page and `GET .../championship/:year`, `GET .../championship` | #863 | The year view (with its year toggle) and the all-time summary's list of years and champions |
| `League.cupName` | #863 | The trophy's name in history ("2026 Derek's Pool Cup") |
| `Contest.cupWeight` `NOT_COUNTED` | #841 | Side bets and test pools left out of the championship, and so of history's numbers |
| Crowned cups, trophy shelf, `GET .../cups/past` | #841 slices 4 and 6 | Cup trophies on team pages and the all-time summary |

A contest whose events were all cancelled ends `COMPLETED` with no standings (#743). History
shows it as "No result".

## 2. What a year is

A history year is the **calendar year the contest went Final**, the same rule as #863, with the
year fixed on the `LeagueYearFinish` row at settlement (US Eastern, #863 Q8.1). One rule means
the 2026 history page and the 2026 championship never disagree. A 2025 NFL season pick'em that
goes Final in January 2026 is a 2026 contest in history, as in the championship.

`Contest.seasonYear` (the first version of this plan) is no longer used by history. Only the
sports league cups (#841) group by it, and the cup pages and the all-time summary show each cup under its own
season ("2025 NFL Cup").

Questions:

- **Q2.1** History's year = the calendar year a contest went Final, the same as the
  championship? Recommendation: yes. It replaces the earlier `seasonYear` recommendation for
  history; two different years on one page would confuse members.
- **Q2.2** `Contest.seasonYear` then only serves the cups. Move it from #837 slice 1 to #841
  slice 1? Recommendation: yes, so it is built with the only feature that reads it. #841 slice 1
  already depends on #837 slice 1 for the delete guard, so the order doesn't change.
- **Q2.3** Show the year as "2026", not "2025-26"? Recommendation: yes, everywhere. Cups name
  their own seasons.

## 3. Who gets the credit

History credits the **squad** (the league member's group), shown by the entry's name as it was
when the contest closed, beside the squad's current name and icon when it has since been
renamed. Co-owners share the squad's history. A squad that went inactive keeps its history and
still appears; reactivating it (re-invite) brings it back unchanged.

- **Several entries per squad:** a squad's **best entry** in a contest counts, once (#863 uses
  the same rule, so `LeagueYearFinish` already holds it).
- **Ties:** every entry tied at place 1 is a champion; history shows co-champions. This matches
  the MVP rule that standings allow ties.
- **Not counted contests:** history's numbers (wins, podiums, records) come from
  `LeagueYearFinish`, so a contest set to Not counted is left out of them, as it is of the
  championship. It still appears in the year's contest list and on the team's contest list,
  marked "Not counted".

### Squad delete erases history

Today deleting an inactive squad deletes its entries and their standings, so last year's
champion can vanish. Positions stay as frozen, so the result is a hole: a contest with no first
place. #841 and #863 both rely on this being refused.

Questions:

- **Q3.0** Should a squad with results in a Final contest be impossible to delete?
  Recommendation: yes. Refuse it with a typed error (`SQUAD_DELETE_HAS_RESULTS`), and say
  "inactivate instead" on the screen. Delete stays for squads that never finished a contest
  (mistakes and test squads). The #841 and #863 designs already assume this.
- **Q3.1** Show renamed squads by the name they had then? Recommendation: yes, the entry name
  (already stored), with the current name beside it when they differ.
- **Q3.2** Show Not counted contests in history's lists, marked, but leave them out of wins and
  records? Recommendation: yes. A side bet shouldn't make someone an all-time leader, but it did
  happen and the list should say so.

## 4. Records count finishes

`totalScore` is in each contest's own unit (golf to-par, race points, pick'em points, squares
boxes won, survivor weeks lasted), so a "best score ever" across contests is meaningless. All-time
and record numbers use **places**, read from `LeagueYearFinish`:

| Measure | Definition |
|---|---|
| Wins | Finishes at place 1 (ties count for each) |
| Podiums | Finishes at places 1 to 3 |
| Contests played | Finishes of any place |
| Championships | Years the squad led the championship (the trophy) |
| Average place | Mean place across contests played |
| Top-half finishes | Place within the top half of the contest's ranked entries |

The yearly medal tiles and finish matrix are #863's; all-time is the same matrix and the same
tiles summed across every year, plus the Championships column.

Record book entries: most championships, back-to-back champions (two years running), most wins in
a year, most wins all-time, back-to-back winners of the same contest (Q4.2), longest run of
podiums, biggest field won.

Questions:

- **Q4.1** Finish-based records only, no score records? Recommendation: yes for this epic.
- **Q4.2** What counts as "the same contest" for back-to-back winners? Recommendation: the same
  event series of the contest's first event (the Masters 2025 and the Masters 2026). Contest
  names are free text and change year to year.
- **Q4.3** Do survivor and squares contests count toward wins and podiums? Recommendation: yes,
  unless the commissioner sets them to Not counted.
- **Q4.4** Top-half finishes and biggest field won need the contest's number of ranked entries.
  Add `rankedEntryCount` to `LeagueYearFinish` (#863 slice 1) rather than join back to every
  contest? Recommendation: yes; one more integer written at settlement, in the spirit of Derek's
  "materialize it".
- **Q4.5** Add the research's three extras (`plans/league-history-research.md` section 4):
  perpetual trophies per event series, "Hall of Lame" records (longest drought, most last
  places), and head to head between two squads? Recommendation: perpetual trophies and Hall of
  Lame yes, in slice 5, since they come from the same rows. Head to head as a later ticket after
  slice 3.

## 5. The read model

No history tables of its own. Two sources:

- **`LeagueYearFinish`** (#863) for every number: year view, all-time, records, trophies. A
  league's whole history is one indexed read of its rows (a few hundred a year), summed by pure
  functions in a `history` module (`rules/architecture-rules.md` §5 *Project Structure and Layer
  Boundaries*). This answers Derek's concern: nothing re-reads every contest for all time.
- **Contests and `ContestEntryStanding`** for lists only: the year's contests with their winners
  (one indexed query per year, place 1 rows only) and one squad's contests (by its entries).

Weekly wins from `ContestEntryEventStanding` stay on the contest's own page and are not a
history measure in this epic.

### Contracts (typed)

All under `/leagues/:leagueId/history`, league members and root admin only, same access check as
the league's contests. Shapes in `packages/shared/dto/history.dto.ts`:

- `HistoryRecordType` enum: `MOST_CHAMPIONSHIPS`, `BACK_TO_BACK_CHAMPIONSHIPS`,
  `MOST_WINS_YEAR`, `MOST_WINS_ALL_TIME`, `BACK_TO_BACK_CONTEST_WINNER`, `LONGEST_PODIUM_RUN`,
  `BIGGEST_FIELD_WON` (plus Hall of Lame members if Q4.5 is yes).
- `TrophyKind` enum: `CHAMPIONSHIP` (#863), `CUP_CHAMPION` (#841), `CONTEST_FIRST`,
  `CONTEST_SECOND`, `CONTEST_THIRD`.
- `ContestResultSummaryDto`: contest id, name, sport, contest format, selection type, the year
  it went Final, settled date, entry count, `winners` (squad ref + entry name, one or more for
  ties), `counted: boolean`, and `hasResult: boolean` for all-cancelled contests.
- `SquadHistoryRowDto`: squad ref (id, current name, icon, `isActive`) and one number per
  measure in section 4.
- Endpoints: `GET .../history/contests?year=&page=` (past contests, paged 25),
  `GET .../history/all-time`, `GET .../history/squads/:squadId` (one squad's contests with its
  best place, its trophies and its measures), `GET .../history/records`. The list of years and
  each year's page are #863's `GET .../championship` and `GET .../championship/:year`; history
  doesn't duplicate them.

## 6. Pages

**Single-year views come first** (Derek, 2026-10-22). Each year's pages are the championship
page (#863) and the Cups and Cup pages (#841), and a **year toggle** on those same pages shows a
past year, frozen. History adds no second copy of them. Later, an **all-time summary** (mockup C
on the season cups canvas) fronts the per-year pages: most championships and cups won, then each
year's champions, each row opening that year's pages. It is built once, shared by #841 slice 6
and this epic.

Member menu gets **History** (replacing today's link to My team history):

| Page | Route | Content |
|---|---|---|
| Year contests | under the championship page, `/league/:code/championship` with its year toggle | The year's contests with winners (tap opens the contest's final leaderboard), below #863's trophy, podium, medal tiles and matrix |
| All-time summary | `/league/:code/history` | Mockup C: most championships, most cups, then each year's champions, newest first; each row opens that year's championship and cups. Tabs: Summary, All-time table, Record book |
| All-time table | `/league/:code/history/all-time` | Medal tiles and finish matrix across every year, with a Championships column; sortable |
| Record book | `/league/:code/history/records` | One card per record type with the holder(s) and the next best |
| Team page history | `/league/:code/teams/:teamId` and My team | The trophy shelf (#841 slice 4, #863 slice 2: every top-3 finish in a crowned cup and the championship) plus contest podiums from this epic; the finish counts; the list of contests played with place, with the same year toggle. Replaces `my-team-history-page.tsx`, and works for any squad |

The Contests page's History view gains a winner line on each card and a year filter, and reads
the new paged endpoint instead of the full contest list. Copy follows the UI wording rule: squads
appear by name, never as "team" or "squad".

Questions:

- **Q6.1** Does `/league/:code/history` become the league's all-time summary, with the old My
  team history folded into each team page? Recommendation: yes.
- **Q6.2** Is History shown to a league with no Final contest yet? Recommendation: yes, with an
  empty state ("Results appear here when a contest is final").
- **Q6.3** Contest podiums (1st to 3rd in a single contest) on the trophy shelf beside cup and
  championship trophies? Recommendation: yes, but as smaller medals, so a season trophy stands
  out from one weekend's win.

## 7. Monetization

The monetization plan puts the past-contests list in Premium, dashboards in Pro and the record
book in Platinum. No league plan model exists yet.

Questions:

- **Q7.1** Build history free for every league now, and gate it when the plan model lands?
  Recommendation: yes. Each page is one route, so gating later is one check per route.

Season-long standings (the old Q7.2) are now #841 (sports league cups) and #863 (the league
championship).

## 8. Slices

Each slice is one PR with its docs, unit tests of the pure history functions, integration tests
for each new query (`rules/testing-rules.md` §9), contract verification for each new endpoint,
and a browser journey row once the pages exist.

1. **Past contests and the delete guard.** The `history` module and
   `GET .../history/contests`; winners on the Contests page History view with a year filter and
   paging. Squad delete refuses a squad with final results, with a failing test first. Needs
   nothing from #863 (the year comes from settlement dates). #841 and #863 depend on this slice.
2. **Year contests.** The year's contests with winners under #863's championship page, following
   its year toggle. Needs #863 slice 2.
3. **Team history.** `GET .../history/squads/:squadId`; the history section on every team page
   and My team, with contest podiums on the trophy shelf and a year toggle; delete
   `my-team-history-page.tsx` and its per-contest fetch loop. Cup and championship trophies join
   the shelf as #841 slice 4 and #863 slice 2 land.
4. **All-time summary and table.** The History menu item; `GET .../history/all-time`; the
   summary (with #841 slice 6, built once) and the all-time table. Needs #863 slice 1.
5. **Record book.** `GET .../history/records`; the Record book tab. Depends on Q4.1, Q4.2 and
   Q4.5.

Slice 1 goes first. Single-year views (2, 3) come before all-time (4, 5); 3 can go in parallel
with #863; 2 follows #863 slice 2; 4 goes with #841 slice 6; 5 last.
