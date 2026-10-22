# Championships: cups, the league championship and history

**Tracking issues:** #841 sports league cups, #863 league championship, #837 league history.
One plan, three tickets, each with its own slices (section 9).

Written 2026-10-21 for Derek's ask: a season-long points race FedEx Cup style, then widened
on 2026-10-22 to the league championship and history, so one doc holds the whole design.
Every finishing place in a contest earns points, and the points add up into cup leaderboards,
a calendar-year championship and trophies. History is additive: it reads what the cups and
championship store and adds no tables. Research input: `plans/league-history-research.md`.

Mockups: the "Season cups concepts" canvas, https://claude.ai/artifact/7CNDV2iCytR2ieq5tA46AH
(phone screens, sample squads): **D** Championship tab, **B** Trophy case tab, **A** Points race
tab, **C** All years summary.

---

## Answered 2026-10-22

1. **Q1** The year is decided in **US Eastern** for every league, fixed on the row at settlement.
2. **Q2** Medal tiles: most 1sts, 2nds, 3rds, podiums (a podium is a 1st, 2nd or 3rd), top-ten
   finishes, and contests played. Ties show every squad tied.
3. **Q3** Delete My team history (`my-team-history-page.tsx`) in #837 slice 3. Every contest's
   leaderboard stays one click away: a cup's Points race lists all its contests, and each opens
   its leaderboard, in season and for past years.
4. **Q4** Everything is free for now. Each view is categorized by feature (section 7) so plans
   can be drawn later, or Platinum given away for a trial period, without touching the views.
5. **Q5** Trophy, cup and standings emails take their feature's class, B. The email catalog
   changes to match.

## Decisions

Derek's (2026-10-21 and 22), not to reopen:

- **Leagues are tenants.** Nothing crosses Poolmaster leagues: no cup, point or trophy is ever
  added up across them, for members or commissioners. "Sports league" is the PGA Tour, NFL, etc.
- **One cup per sports league per season** in a league, created automatically. No cup per
  sport, no hand-picked cups.
- **The league championship counts every contest by the calendar year it went Final**, and is
  materialized at settlement. Built now, not deferred.
- **Points:** `STANDARD` table by default; ties split the points of the places they cover; a
  squad scores from its best entry; every contest counts, no minimum field; a plain running sum,
  no playoff reset; cancelled contests count for nothing.
- **Weight:** one `cupWeight` per contest on its settings (x1, x1.5, x2, Not counted), default
  x1 so commissioners never touch it, fixed once the contest is Final.
- **Crowning:** the commissioner crowns each cup by hand once its counted contests are Final.
  Nothing runs on a timer. No un-crown.
- **Cup name** league setting, default "<league name> Cup", names the championship; past years
  show its current value.
- **Navigation:** one Championships page with three tabs; menu item "Championships"; title
  "<year> Championship Race" in season, "<year> Championships" once the year is over. The
  Championship tab lands first for every year. No separate History menu item.
- **Movement arrows** on the points race; no real trophy names ("FedEx Cup"); projected points
  are the last cup slice.
- **History is only additive** and goes after the cups and championship: past years, drill to
  past contests, one all-time summary (Platinum).
- **Service classes:** contest results free; cups and championship from Pro; all-time summary
  Platinum. Use only as many classes as a feature needs.

Technical, decided in this plan: a shared `ServiceClass` enum for views and emails; championship
points stored at settlement so a later points-table change never shifts a past year; the year
picker skips empty years; matrix cells filter the contest list; Not counted and cancelled
contests are listed, marked; a renamed squad shows its name at the time with today's name beside
it.

---

## 1. What it builds on

| Piece | Where | Used for |
|---|---|---|
| Frozen contest places | `ContestEntryStanding.position` (1 best, ties allowed), written at settlement | The only input to points |
| Contest status | `Contest.status` `COMPLETED` | Only Final contests award points |
| Contest's sports league | `ContestSportEvent` → `SportEvent.eventSeries.sportLeagueId` | Which cup a contest counts toward (one per contest today) |
| Frozen contest leaderboards | existing, read from `ContestEntryStanding` | The drill-through target, for any past contest |

Built by slice 1 of whichever of #841 and #863 goes first: a squad's **best-entry** function,
and the **squad delete guard** (`SQUAD_DELETE_HAS_RESULTS`, failing test first), so a deleted
squad can never punch a hole in a cup or a past year. `Contest.seasonYear` comes with #841
slice 1.

## 2. Cups (#841)

```
League (existing), new settings
  cupPointsScale  CupPointsScale    STANDARD | TOP_TEN | FIELD_BEATEN | CUSTOM; default STANDARD
  cupCustomPoints Int[]             only for CUSTOM (database check)
  cupName         String            default "<league name> Cup" at creation (#863)

Contest (existing), new settings
  seasonYear      Int               default: year of the first event; editable until a cup it counted in is crowned
  cupWeight       CupWeight         NORMAL (x1) | BONUS (x1.5) | DOUBLE (x2) | NOT_COUNTED

Cup                                 unique (leagueId, seasonYear, sportLeagueId)
  leagueId, seasonYear, sportLeagueId
  status          CupStatus         OPEN | CROWNED
  crownedAt       DateTime?

CupStanding                         frozen at crowning; unique (cupId, squadId)
  position, displayPosition         "T2" for ties
  points          Int               tenths of a point
  wins, podiums, contestsCounted
  trophy          CupTrophy?        CHAMPION | RUNNER_UP | THIRD
```

- **Which contests count** is worked out on read: the league's contests in the cup's season and
  sports league, not `NOT_COUNTED`. Open cup standings are computed from frozen places; only
  crowning stores them.
- **Created, never set up.** Contest creation calls the cups service, which makes the cup if
  missing (`rules/architecture-rules.md` §4 *Service Topology*); the migration does it for every
  existing contest. Cups are never deleted. A cup stays off the Trophy case until it has two
  counted contests.
- **Names** are built by the server from season and sports league ("2026 PGA Tour Cup");
  no name column.
- **Weights live on the contest**, not the event (shared by every league) and not the cup (the
  championship would need it set again). A weight change on a Final contest is `CONTEST_FINAL`.
- **One points table per league.** Crowned cups keep their frozen points.
- Enums mirror domain consts in `packages/shared/domain/enums.ts`, like every status column.

### Points

`points = scale(place, rankedEntries) x cupWeight`, from the squad's best entry.

| Scale | Points |
|---|---|
| `STANDARD` | 100, 80, 65, 55, 48, 42, 37, 33, 30, 27 for 1st to 10th; 25 down by 2 to 7 for 11th to 20th; 5 for every place after |
| `TOP_TEN` | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; nothing after 10th |
| `FIELD_BEATEN` | One point per entry finished behind, plus one for finishing |
| `CUSTOM` | The commissioner's list; places past it score 0 |

- Two tied for 2nd in `STANDARD` each get (80 + 65) / 2 = 72.5. Stored as tenths, summed
  exactly, shown to one decimal.
- A squad with no entry gets nothing but still shows, at 0. Equal totals go to more wins, then
  more podiums, then share the place.
- Pure function in `packages/shared/domain/cup-points.ts`, so settings can preview a table;
  unit-tested place by place, tie by tie.

### Crowning

`POST .../cups/:cupId/crown`, the commissioner, whenever the season is done (golf in September,
NFL after the Super Bowl). Refused while a counted contest is Open or Live
(`CUP_HAS_UNFINISHED_CONTESTS`, listing them); drafts never opened don't count. It writes
`CupStanding`, hands out trophies (ties share), and sets `CROWNED`. A contest that goes Final
later is listed "After the cup was crowned" and changes nothing.

## 3. League championship (#863)

A "2026 Derek's Pool Cup" across every contest in every sport. Cups by season can't do it: an
NFL season is mid-way on 31 December.

- **A contest counts in the calendar year it went Final**, in US Eastern (Q1). One still
  running on 31 December counts toward the year it finishes. Best entry once per squad; Not
  counted and cancelled contests are out.
- **Stored at settlement**, in the same transaction that writes `ContestEntryStanding`, through
  `ChampionshipService.recordContest(contestId)` called by contest-management. A backfill
  migration writes every contest already Final. No year-end job: once a year is over no contest
  can go Final in it, so it freezes itself, and "the trophy is presented" is just the page seeing
  that its year has ended.

```
LeagueYearFinish                    one per squad per counted contest; unique (contestId, squadId)
  leagueId, year, squadId, contestId
  place           Int               1 best
  tiedCount       Int               entries sharing the place, for the point split
  rankedEntryCount Int              entries ranked in the contest, for FIELD_BEATEN and the summary
  weight          CupWeight         at settlement
  points          Int               tenths, from the points table at settlement
  settledAt
  index (leagueId, year)
```

A row is written once: `place` never changes, the weight is fixed once Final, and the delete
guard keeps its squad.

**The page, top to bottom (mockup D):**

1. **Trophy and podium**, from 1 January (US Eastern) of the next year: the cup name, the champion, then 1st,
   2nd and 3rd. Before then it shows the leader ("leads with 3 contests to go").
2. **Medal tiles** (Q2): most 1sts, 2nds, 3rds, podiums, top-ten finishes and contests
   played, each with the squad and its count, two to a row.
3. **Finish matrix:** squads as rows, 1st to 10th as columns counting finishes there, and a
   Points column that ranks the table. Equal totals go to most 1sts, then most 2nds.

## 4. Pages and navigation

```
League menu: Championships
  /league/:code/championships/:year           year defaults to the current one
    header: ‹ league · title · year picker "2026 ▾" · All years
    /championship  Championship (lands here)   trophy, podium, tiles, matrix, contests   D
    /trophies      Trophy case                 cup cards, Ready to crown, podiums         B
    /race/:sportLeagueId  Points race          sports league chips, leaderboard           A
  /league/:code/history                       All years summary                          C
```

- **Two levels:** page tabs pick the view; chips inside Points race pick the sports league and
  scroll sideways.
- **Points race:** place, movement, squad, points, wins, contests; a race chart of the top five;
  every contest in the cup with its weight, winner and state (Live, Final, Not counted), and
  why one doesn't count. A standings row opens the squad's points contest by contest; a contest
  row opens that contest's leaderboard, live or final (Q3). So Points race → the cup's contests →
  a leaderboard is two taps, in any year. Crowned, B's podium sits above the table.
- **Trophy case:** a card per cup with leader or champion and the viewer's place; "Ready to
  crown" for the commissioner. A card opens Points race with its chip selected.
- **Links:** a matrix row or tile opens the squad's year; a matrix cell narrows it to that place;
  a contest row opens its final leaderboard; All years opens C, whose years open that year's
  Championship tab.
- **Elsewhere:** a cups card on league home; the trophy shelf on team pages (every top-3 cup and
  championship finish); the points table and cup name on league settings, with a preview; the
  cup weight on contest settings.

## 5. History (#837)

History adds three things to the Championships page; it stores nothing new.

1. **Past years: the year picker.** Choosing 2025 changes every tab; the year is in the path, so
   it can be shared. Past years drop the live parts (movement, Ready to crown, progress,
   projected points). Years offered come from `GET .../championship` and the seasons with a cup;
   empty years are skipped. A past cup never crowned shows "Not crowned" in place of its podium.
   Cups keep their season, so the 2025 NFL Cup sits under 2025 though its last pool went Final in
   February 2026; each board labels its own year.
2. **Drill-through.** Under the matrix, a Contests list: every contest that went Final that year,
   newest first, with sport, date, winner (co-winners on ties), entries, and "Not counted" or "No
   result". The squad's year and a matrix cell filter it. Past Points race rows open leaderboards
   the same way. The Contests page History view gains the year filter and winner line and pages
   25 at a time.
3. **All years (mockup C, no tabs).** Tiles for most championships and most cups won; then each
   year newest first with its champion and cup champions ("2026 so far" for the current year).
   My team's "Contest history" link points here (Q3).

## 6. API

All under `/leagues/:leagueId`, with the league's access check: members and root admin read,
the commissioner writes. Shapes in `packages/shared/dto/` (`cups.dto.ts`, `championship.dto.ts`,
`history.dto.ts`); routes in `cups`, `championship` and `history` modules
(`rules/service-rules.md` §4 *DTOs, Mappers, OpenAPI*).

| Route | Ticket | Returns |
|---|---|---|
| `GET /cups?seasonYear=` | #841 | The season's cups, each with leader and the viewer's place, `canCrown`, `unfinishedContests` |
| `GET /cups/:cupId` | #841 | `CupStandingRowDto[]` (squad ref, position, points, wins, podiums, contests, movement, trophy) and `CupContestRowDto[]` (weight, `CupContestCount`: `COUNTED`, `NO_RESULT`, `NOT_FINAL`, `AFTER_CROWNING`, winner) |
| `GET /cups/:cupId/squads/:squadId` | #841 | One squad's points, contest by contest |
| `POST /cups/:cupId/crown` | #841 | Crown (section 2) |
| `GET /championship/:year` | #863 | Trophy, podium, tiles, matrix |
| `GET /championship` | #863 | Years with their champions |
| `GET /history/contests?year=&squadId=&place=&page=` | #837 | `ContestResultSummaryDto` pages, read from `LeagueYearFinish` so a cell's list matches its count |
| `GET /history/summary` | #837 | Tile counts (`SummaryTile`: `MOST_CHAMPIONSHIPS`, `MOST_CUPS`) and each year's champions |
| `PATCH /leagues/:leagueId`, contest settings | #841, #863 | Gain `cupPointsScale`, `cupCustomPoints`, `cupName`; `cupWeight` |

Typed errors: `CUP_NOT_FOUND`, `CUP_CROWNED`, `CUP_HAS_UNFINISHED_CONTESTS`, `CONTEST_FINAL`,
`SQUAD_DELETE_HAS_RESULTS`. Read cost: open cups read one league-season of frozen places per
page; the championship and summary read a few hundred `LeagueYearFinish` rows a year. If a
league ever gets slow, cache by its latest `settledAt`.

## 7. Service classes

The shared `ServiceClass` enum (`ESSENTIAL`, `A`, `B`, `C`, `D`) in `packages/shared/domain`
serves views and emails, using the email catalog's letters (`plans/email-notifications.md`,
*Class*): Essential every league, A free and up, B from Pro, C from Premium, D Platinum. The
upper plans differ mainly through the levers in `plans/monetization-strategy.md`, *The levers*.

Each view belongs to one **feature**, and each feature to one class. Plans map classes later;
the views only ask about their feature (Q4).

| Feature (`ChampionshipFeature`) | What | Class |
|---|---|---|
| `CONTEST_RESULTS` | Contest results and places, any contest's leaderboard, the Contests page History view | Essential |
| `CUP_STANDINGS` | Trophy case, Points race, race chart, movement, squad breakdown, projected points, league home card | B (Pro) |
| `CUP_CROWNING` | Ready to crown, crowned podiums, cup trophies | B (Pro) |
| `CHAMPIONSHIP` | The Championship tab: trophy, podium, medal tiles, finish matrix, year's contests | B (Pro) |
| `TROPHY_SHELF` | Cup and championship trophies on team pages | B (Pro) |
| `CUP_SETTINGS` | Points table, cup weights, cup name | B (Pro) |
| `PAST_YEARS` | The year picker's earlier years, on every tab, and their drill-through | B (Pro) |
| `ALL_TIME_SUMMARY` | All years | D (Platinum) |

Downgrades hide, never delete: rows are written for every league, the locked view shows the name
and leader with a short note, and only the commissioner sees how to upgrade. Routes ask an
entitlements function about the feature, never about a plan. Nothing is gated yet (Q4).

## 8. Slices

Each slice is one PR with its docs, unit tests of the pure functions, integration tests for each
new query (`rules/testing-rules.md` §9), contract verification for each endpoint, and a browser
journey row once a page exists.

**#841 cups**

1. **Model and read API.** `seasonYear` (backfilled), `Cup`, `CupStanding`, points settings,
   `cupWeight` and enums; cups made on contest create and by migration; `cup-points.ts`;
   `GET /cups`, `/cups/:cupId`, the squad breakdown. Plus the guard and best-entry function if
   #863 slice 1 hasn't landed them.
2. **Pages.** The Championships menu item and page shell with Trophy case and Points race tabs,
   movement and race chart, the squad sheet, the league home card.
3. **Commissioner settings.** Points table with preview; cup weight.
4. **Crowning.** `POST .../crown`, Ready to crown, frozen standings, the podium, the trophy shelf.
5. **Projected points** from live contests, greyed as "if it ended now".

2 and 3 in parallel after 1; 4 and 5 after 2.

**#863 championship** (can go before or alongside #841)

1. **Storage and read.** `LeagueYearFinish`, `League.cupName`, written at settlement, backfill,
   `GET /championship/:year` and `/championship`. Plus the guard and best-entry function if #841
   slice 1 hasn't landed them.
2. **The page.** The Championship tab (trophy, podium, tiles, matrix); cup name setting;
   championship trophies on the shelf. Builds the page shell if #841 slice 2 hasn't.

**#837 history** (after both pages exist)

1. **Past years.** The year picker on every tab, live parts hidden. Mostly web.
2. **Drill-through.** `GET /history/contests`, the Contests list, squad and cell filters, past
   race rows opening leaderboards, the Contests page History view.
3. **All years.** `GET /history/summary` and the page; delete `my-team-history-page.tsx` (Q3).

1 and 2 in parallel; 3 after 1.

## 9. Parked ideas

Dropped (Derek, 2026-10-22): a squad career page and an all-time table, which duplicate All years.

From the research (`plans/league-history-research.md`) and the first history design, dropped
when history became additive. None is in a slice; each is built from the same stored rows unless
it says otherwise, and each needs Derek's yes and a ticket.

- **Record book.** Most championships, back-to-back champions, most wins in a year, longest run
  of podiums, biggest field won (needs `rankedEntryCount`, already on the row), each with the
  holder and the next best.
- **Hall of Lame.** The bad records beside the good: most runner-up finishes, most last places,
  longest drought without a win, earliest survivor exit. A league setting hides it.
- **Perpetual trophies.** One trophy per recurring contest (the Masters pool every year), with a
  plate per year's winner, linked by the contest's event series.
- **Head to head.** For two squads, who finished higher in the contests both played. Shown only
  for rivals with five or more shared contests.
- **Contest medals on the trophy shelf.** A single contest's 1st to 3rd as small medals, so a
  season trophy still stands out.
- **Season recap.** An end-of-year awards card per member, pushed by email (#845) or shown once
  on login. Needs a "seen" flag.
- **Past winners entered by hand.** For leagues older than Poolmaster. Needs a new "historical
  result" record outside the read-only model, so only if leagues ask.
