# League history

**Tracking issue:** #837

Written 2026-10-21 for Derek's ask: a design refinement pass on the history features. The
feature list came from the monetization strategy (#581, `plans/monetization-strategy.md`,
*History*), which named five pages and five questions but no model, contract or slices. This
plan checks those ideas against main as of #835 and cuts them into slices. Questions sit under
the section they belong to, each with a recommendation; none blocks slice 1.

---

## TL;DR

- **The data is already there.** Every contest type (roster, pick'em, bracket, survivor,
  squares) freezes each entry's place as a `ContestEntryStanding` when it settles, and each
  week's or event's place as a `ContestEntryEventStanding`. History is reading and adding up
  rows we keep, not capturing new data.
- **Three gaps in the model:** there is no "season" on a contest, deleting a squad erases its
  past results, and there is no league-level read of results (the current team history page
  fetches every contest's entry list, one request per contest).
- **Records count finishes, not scores.** A golf to-par total, a pick'em points total and a
  squares box count can't be compared, so all-time numbers are wins, podiums and places.
- **Five slices:** the history read model and past-contests winners; season pages; team
  history; all-time standings; record book and trophies. Monetization gating and a
  season-long points race are left out until their own epics.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| Contests page, History view | `/league/:code/contests/history`, `league-contest-history-page.tsx` | Lists `COMPLETED` contests as cards. No winner, no season, no paging |
| My team history | `/league/:code/history`, `my-team-history-page.tsx` | The viewer's own squad only. Calls `listContestEntries` once per contest in the league (N requests), then filters to its entries |
| Frozen results | `ContestEntryStanding` | One per entry: `position` (1 best, ties allowed), `displayPosition` ("T2"), `totalScore` in the contest's unit, `settledAt`. Written by settlement only |
| Per-event results | `ContestEntryEventStanding` | A pick'em week's or a major's place per entry; place 1 is the week's winner |
| Entry name | `ContestEntry.name` | Built from the squad's name when the entry is made, so it already keeps the name as it was |
| Edition year | `SportEvent.eventYear` | The year the edition is branded with ("the 2026 Masters"). The 2025 NFL season's playoffs are 2026 events |
| Squad delete | `SquadService.deleteInactiveSquad` | Root admin only, squad must be inactive. Deletes its entries, which cascades their standings |

A contest whose events were all cancelled ends `COMPLETED` with no standings (#743). History
shows it as "No result", never as a contest without a winner by mistake.

## 2. What a season is

Monetization Q2 recommended the calendar year of the event's start. Checked against the data,
that splits an NFL season (weeks in 2025, playoffs and Super Bowl in early 2026) and a Premier
League season (August to May) across two years, and `eventYear` splits it the same way. An
office-pool league is usually a group of friends playing across sports, so for most leagues the
calendar year is right, but not for a league that lives on one football season.

**Design:** a typed `seasonYear: Int` column on `Contest`, set by the server when the contest is
created from its first event's start date (calendar year), and editable by the commissioner on
contest settings. It is a label: it changes no scoring and no lifecycle. Season pages group
contests by it. No new `Season` entity: a season is just the contests sharing a `seasonYear`.

- Backfill: existing contests get the year of their first event's start in the migration
  (reference rule: this is derived data, not test data).
- Contract: `seasonYear` on the contest DTOs and the contest update request, bounded (2000 to
  2100) in the schema.

Questions:

- **Q2.1** Season = a year number on each contest, defaulting to the calendar year of its first
  event, that the commissioner can change? Recommendation: yes. It handles the NFL and Premier
  League cases with one field, and nothing new for the 95% of contests where the default is
  right.
- **Q2.2** When can the commissioner change it? Recommendation: any time, including after the
  contest is Final. It is a label for grouping, so fixing a wrong year later should be allowed.
- **Q2.3** Show it as "2026" or "2025-26"? Recommendation: "2026" everywhere. A split label
  needs a per-league setting and doesn't fit golf or tennis.

## 3. Who gets the credit

History credits the **squad** (the league member's group), shown by the entry's name as it was
when the contest closed, beside the squad's current name and icon when it has since been
renamed. Co-owners share the squad's history. A squad that went inactive keeps its history and
still appears; reactivating it (re-invite) brings it back unchanged.

- **Several entries per squad:** a squad "won" a contest if any of its entries placed 1. For
  podiums and average place, a squad's **best entry** in the contest counts, once.
- **Ties:** every entry tied at place 1 is a champion; history shows co-champions. This matches
  the MVP rule that standings allow ties.
- **Weekly wins:** a pick'em week or a majors-pool event won (event standing place 1) is a
  separate count, "week wins", never added to contest wins.

### Squad delete erases history

Today deleting an inactive squad deletes its entries and their standings, so last year's
champion can vanish and everyone below moves up a place on a re-read. Positions stay as frozen
(the rows below are not re-ranked), so the result is a hole: a contest with no first place.

Questions:

- **Q3.1** Should a squad with results in a Final contest be impossible to delete?
  Recommendation: yes. Refuse it with a typed error (`SQUAD_DELETE_HAS_RESULTS`), and say
  "inactivate instead" on the screen. Delete stays for squads that never finished a contest
  (mistakes and test squads), which is what it is used for.
- **Q3.2** Multiple entries: a squad's best entry counts for podiums and average place?
  Recommendation: yes, once per contest. Counting every entry would reward squads that buy more
  entries.
- **Q3.3** Show renamed squads by the name they had then? Recommendation: yes, the entry name
  (already stored), with the current name beside it when they differ. No new data needed.

## 4. Records count finishes

`totalScore` is in each contest's own unit (golf to-par, race points, pick'em points, squares
boxes won, survivor weeks lasted), so a "best score ever" across contests is meaningless, and
even within golf it depends on the contest's counting rule. All-time and record numbers use
**places**, which every contest type has:

| Measure | Definition |
|---|---|
| Wins | Contests where the squad's best entry placed 1 (ties count for each) |
| Podiums | Best entry placed 1, 2 or 3 |
| Contests played | Contests with at least one submitted entry of the squad that has a standing |
| Average place | Mean of the best entry's place across contests played |
| Top-half finishes | Best entry's place within the top half of the contest's ranked entries |
| Week wins | Event standings placed 1 (pick'em weeks, majors-pool events) |

Average place is unfair across a 6-entry and a 60-entry contest, which is why top-half finishes
sit beside it. A finish percentile would be fairer but harder to read on a phone.

Record book entries, all from the measures above: most wins in a season, most wins all-time,
back-to-back champions of the same contest series (see Q4.2), longest run of contests with a
podium, most week wins in one pick'em contest, biggest field won (most entries in a contest the
squad won).

Questions:

- **Q4.1** Finish-based records only, no score records? Recommendation: yes for this epic.
  A score record per contest setup ("best golf to-par in a tiered majors pool") can come later
  if leagues ask; it needs setups grouped by scoring unit.
- **Q4.2** What counts as "the same contest" for back-to-back champions? Recommendation: same
  event series of the contest's first event (the Masters 2025 and the Masters 2026). Contest
  names are free text and change year to year, so they can't be the key.
- **Q4.3** Do survivor and squares contests count toward wins and podiums? Recommendation: yes.
  They settle places like any other contest, and a member who won the Super Bowl squares wants
  the trophy.

## 5. The read model

No new tables. Every page reads `ContestEntryStanding` (and `ContestEntryEventStanding` for week
wins) joined to entry, squad and contest, filtered to the league's `COMPLETED` contests. A busy
league has a few dozen contests and a few thousand standings a year, so the service adds them
up in one query per page and the code that turns rows into measures is pure, unit-tested
functions in a `history` module (`rules/architecture-rules.md` §5 *Project Structure and Layer
Boundaries*). If a league ever gets slow, a cache keyed by the league's latest `settledAt` is the
escape hatch, not a summary table kept in step by hand.

New indexes: `ContestEntryStanding (contestId, position)` exists; add `Contest (leagueId,
status, seasonYear)` for the season list.

### Contracts (typed)

All under `/leagues/:leagueId/history`, league members and root admin only, same access check as
the league's contests. Shapes in `packages/shared/dto/history.dto.ts`:

- `HistoryMeasure` enum: `WINS`, `PODIUMS`, `CONTESTS_PLAYED`, `AVERAGE_PLACE`,
  `TOP_HALF_FINISHES`, `WEEK_WINS`.
- `HistoryRecordType` enum: `MOST_WINS_SEASON`, `MOST_WINS_ALL_TIME`, `BACK_TO_BACK_CHAMPION`,
  `LONGEST_PODIUM_RUN`, `MOST_WEEK_WINS_CONTEST`, `BIGGEST_FIELD_WON`.
- `TrophyPlace` enum: `FIRST`, `SECOND`, `THIRD` (podium trophies on a squad).
- `ContestResultSummaryDto`: contest id, name, sport, contest format, selection type,
  `seasonYear`, settled date, entry count, `winners` (squad ref + entry name, one or more for
  ties), and `hasResult: boolean` for all-cancelled contests.
- `SquadHistoryRowDto`: squad ref (id, current name, icon, `isActive`) plus one number per
  `HistoryMeasure`.
- Endpoints: `GET .../history/contests?seasonYear=&page=` (past contests, paged 25),
  `GET .../history/seasons` (each year with contest count and top squads),
  `GET .../history/seasons/:seasonYear` (that year's contests plus a `SquadHistoryRowDto` table),
  `GET .../history/all-time`, `GET .../history/squads/:squadId` (one squad's contests with its
  best place, trophies and its measures), `GET .../history/records`.

Questions:

- **Q5.1** Compute on read, no summary tables? Recommendation: yes. The numbers are small, it
  can't drift from settlement, and a score correction can't change a settled result anyway.

## 6. Pages

Member menu gets **History** (replacing today's link to My team history):

| Page | Route | Content |
|---|---|---|
| History home | `/league/:code/history` | Seasons list, newest first, each with its contest count and its top three squads by wins. Tabs: Seasons, All-time, Record book |
| Season | `/league/:code/history/:seasonYear` | That year's contests with winners (tap opens the contest's final leaderboard), and a table of squads by wins, podiums, average place |
| All-time | `/league/:code/history/all-time` | Same table across every season, sortable by measure. A chart of wins per season per squad comes in slice 4 |
| Record book | `/league/:code/history/records` | One card per record type with the holder(s); trophy case of podium counts per squad |
| Team page history | `/league/:code/teams/:teamId` and My team | A history section: wins, podiums, trophies, and the list of contests played with place. Replaces `my-team-history-page.tsx`, and works for any squad, not only the viewer's |

The Contests page's History view gains a winner line on each card and a season filter, and reads
the new paged endpoint instead of the full contest list. Copy follows the UI wording rule: squads
appear by name, never as "team" or "squad".

Questions:

- **Q6.1** Does `/league/:code/history` become the league's History page, with the old My team
  history folded into each team page? Recommendation: yes. One place for history, and every
  team page gains the same section.
- **Q6.2** Is the History tab worth showing to a league with no Final contest yet?
  Recommendation: yes, with an empty state ("Results appear here when a contest is final"), so
  the menu doesn't change under members.

## 7. Monetization

The monetization plan puts the past-contests list in Premium, dashboards in Pro and the record
book in Platinum. No league plan model exists yet, and gating needs the entitlements function
that plan describes.

Questions:

- **Q7.1** Build history free for every league now, and gate it when the plan model lands?
  Recommendation: yes. Each page is one route, so gating later is one check per route through
  the entitlements function, and leagues see the feature working before anyone pays.
- **Q7.2** Season-long standings across contests (points per finish crowning a season
  champion): in this epic? Recommendation: no, its own ticket after slice 5. It needs a points
  table per place and a commissioner setting, which is new scoring design, while everything here
  only reads what exists.

## 8. Slices

Each slice is one PR with its docs, unit tests of the pure history functions, integration tests
for each new query (`rules/testing-rules.md` §9), contract verification for each new endpoint,
and a browser journey row once the pages exist.

1. **Read model and past contests.** `Contest.seasonYear` with migration and backfill, editable
   on contest settings; the `history` module and `GET .../history/contests`; winners on the
   Contests page History view with a season filter and paging. Squad delete refuses a squad with
   final results (Q3.1), with a failing test first. Depends on Q2.1 and Q3.1.
2. **Season pages.** `GET .../history/seasons` and `.../seasons/:seasonYear`; the History menu
   item, History home and Season page. Depends on Q6.1.
3. **Team history.** `GET .../history/squads/:squadId`; the history section on every team page
   and My team; delete `my-team-history-page.tsx` and its per-contest fetch loop.
4. **All-time.** `GET .../history/all-time`; the All-time tab with a sortable table and the
   wins-per-season chart.
5. **Record book and trophies.** `GET .../history/records`; the Record book tab and trophy
   counts on team pages. Depends on Q4.1 and Q4.2.

Slices 2 and 3 can go in parallel after slice 1; 4 and 5 can go in parallel after 2.
