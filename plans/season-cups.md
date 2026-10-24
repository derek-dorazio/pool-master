# Championships: cups, the league championship and history

**Tracking issues:** #841 sports league cups, #863 league championship, #837 league history,
#872 squad page, #873 record book and Hall of Lame, #874 perpetual trophies. One plan, six tickets, each with its
own slices (sections 8, 10, 11, 12).

Written 2026-10-21 for Derek's ask: a season-long points race FedEx Cup style, then widened
on 2026-10-22 to the league championship and history, so one doc holds the whole design.
Every finishing place in a contest earns points, and the points add up into cup leaderboards,
a calendar-year championship and trophies. History is additive: it reads what the cups and
championship store and adds no tables. Research input: `plans/league-history-research.md`.

Mockups: the "Season cups concepts" canvas, https://claude.ai/artifact/7CNDV2iCytR2ieq5tA46AH
(phone screens, sample squads): **D** Championship tab, **B** Trophy case tab, **A** Points race
tab, **C** All years summary, **E** squad page.

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

Technical, decided in this plan: a shared feature list for views and emails (`ServiceClass`
until #944 replaced it with `PlanFeature`, see §7); championship
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
  crownedPointsScale, crownedCustomPoints   the league's points table at crowning

CupStanding                         frozen at crowning; unique (cupId, squadId)
  position, displayPosition         "T2" for ties
  points          Int               tenths of a point
  wins, podiums, contestsCounted
  trophy          CupTrophy?        CHAMPION | RUNNER_UP | THIRD
```

- **Which contests count** is worked out on read: the league's contests in the cup's season and
  sports league, not `NOT_COUNTED`. Open cup standings are computed from each final contest's
  settled finish and weight (`LeagueYearFinish`), scored on the league's current table; only
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
(`CUP_HAS_UNFINISHED_CONTESTS`, listing them), and before any contest has counted
(`CUP_NOTHING_COUNTED`); drafts never opened don't count. It writes
`CupStanding`, hands out trophies (ties share), and sets `CROWNED`. A contest that goes Final
later is listed "After the cup was crowned" and changes nothing.

## 3. League championship (#863)

A "2026 Derek's Pool Cup" across every contest in every sport. Cups by season can't do it: an
NFL season is mid-way on 31 December.

- **A contest counts in the calendar year it went Final**, in US Eastern (Q1). One still
  running on 31 December counts toward the year it finishes. Best entry once per squad; Not
  counted and cancelled contests are out.
- **Stored at settlement**, through `ChampionshipService.recordContest(contest, settledAt)`, which
  contest settlement calls once the places are frozen and just before it completes the contest.
  Settlement runs no transaction, so this order stands in for one: a failed write leaves the
  contest unsettled, to be settled again, and a second write for a contest writes nothing. A backfill
  migration writes every contest already Final. No year-end job: once a year is over no contest
  can go Final in it, so it freezes itself, and "the trophy is presented" is just the page seeing
  that its year has ended.

```
LeagueYearFinish                    one per squad per counted contest; unique (contestId, squadId)
  leagueId, year, squadId, contestId
  place           Int               1 best
  tiedCount       Int               entries sharing the place, for the point split
  rankedEntryCount Int              entries ranked in the contest, for FIELD_BEATEN, records and last places
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
   the same way. The Contests page History view gains the year filter and winner line, one year
   at a time.
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
| `GET /cups?seasonYear=` | #841 | The season's cups, each with its full standings and contests (`CupDto`, the same shape `GET /cups/:cupId` answers). No viewer context (access rule A8): the client finds its own squad's row, and whether the commissioner can crown from its role and the contests' `count` |
| `GET /cups/seasons` | #837 | The seasons with a cup to show, newest first: the year picker's cup years |
| `GET /cups/:cupId` | #841 | `CupStandingRowDto[]` (squad ref, position, points, wins, podiums, contests, movement, trophy) and `CupContestRowDto[]` (weight, `CupContestCount`: `COUNTED`, `NO_RESULT`, `NOT_FINAL`, `AFTER_CROWNING`, winner) |
| `GET /cups/:cupId/squads/:squadId` | #841 | One squad's points, contest by contest |
| `GET /cups/:cupId/projection` | #841 | An open cup's standings if its live contests ended now, from their leaderboards as they stand; nothing stored |
| `POST /cups/:cupId/crown` | #841 | Crown (section 2) |
| `GET /championship/:year` | #863 | Trophy, podium, tiles, matrix |
| `GET /championship` | #863 | Years with their champions |
| `GET /history/contests?year=&squadId=&place=` | #837 | `ContestResultSummaryDto[]` for one year (no paging, `rules/domain-model-conventions-rules.md` §16), read from `LeagueYearFinish` so a cell's list matches its count |
| `GET /history/summary` | #837 | Tile counts (`SummaryTile`: `MOST_CHAMPIONSHIPS`, `MOST_CUPS`) and each year's champions |
| `PUT /cup-settings` | #841, #863 | The championship name and points table together (`cupName`, `cupPointsScale`, `cupCustomPoints`), apart from the league's details, as League settings edits them in their own section |
| `PUT /contest-management/contests/:contestId/cup-weight` | #841 | A contest's `cupWeight`, until it is final |

Typed errors: `CUP_NOT_FOUND`, `CUP_CROWNED`, `CUP_HAS_UNFINISHED_CONTESTS`, `CUP_NOTHING_COUNTED`, `CONTEST_FINAL`,
`SQUAD_DELETE_HAS_RESULTS`. Read cost: open cups read one league-season of frozen places per
page; the championship and summary read a few hundred `LeagueYearFinish` rows a year. If a
league ever gets slow, cache by its latest `settledAt`.

## 7. Service classes

Since #944 each view and email is a `PlanFeature` (`packages/shared/domain`), and the first plan
that has it is a root admin setting in `PLAN_CONFIG`, so the class letters below are only where
each started: Essential is every league always (not a feature at all), A starts at Free, B at Pro,
D at Platinum (`plans/monetization-strategy.md`, *First build: plans and plan behaviour*). The
upper plans differ mainly through the levers in `plans/monetization-strategy.md`, *The levers*.

Each view belongs to one **feature**. The views only ask about their feature (Q4), through the
plan entitlements service.

| Feature (`PlanFeature`) | What | Starts at |
|---|---|---|
| (none) | Contest results and places, any contest's leaderboard, the Contests page History view | Always |
| `CUP_STANDINGS` | Trophy case, Points race, race chart, movement, squad breakdown, projected points, league home card | Pro |
| `CUP_CROWNING` | Ready to crown, crowned podiums, cup trophies | Pro |
| `CHAMPIONSHIP` | The Championship tab: trophy, podium, medal tiles, finish matrix, year's contests | Pro |
| `TROPHY_SHELF` | Cup and championship trophies, contest medals and perpetual trophies on squad pages and the Trophy case | Pro |
| `CUP_SETTINGS` | Points table, cup weights, cup name | Pro |
| `PAST_YEARS` | The year picker's earlier years, on every tab, and their drill-through | Pro |
| `ALL_TIME_SUMMARY` | All years | Platinum |
| `RECORD_BOOK` | Record book and Hall of Lame (#873) | Platinum |

Downgrades hide, never delete: rows are written for every league, the locked view shows the name
with a short note, and only the commissioner sees how to upgrade. Routes ask the
plan entitlements service about the feature, never about a plan. Gated with #948
(`docs/DOMAIN-OPERATIONS.md`, *Hidden by plan*).

## 8. Slices

Each slice is one PR with its docs, unit tests of the pure functions, integration tests for each
new query (`rules/testing-rules.md` §9), contract verification for each endpoint, and a browser
journey row once a page exists.

**#841 cups**

1. **Model and read API.** `seasonYear` (backfilled), `Cup`, points settings, `cupWeight` and
   enums; cups made on contest create and by migration; `cup-points.ts`; `GET /cups`,
   `/cups/:cupId`, the squad breakdown. Plus the guard and best-entry function if #863 slice 1
   hasn't landed them. `CupStanding`, `Cup.status` and `crownedAt`, and the `AFTER_CROWNING` count
   come with crowning (slice 4), so no table or value sits unwritten before then.
2. **Pages.** The Championships menu item and page shell with Trophy case and Points race tabs,
   movement and race chart, the squad sheet, the league home card. Built with the squad sheet as
   a full page (`rules/ux-rules.md` §12 rule 4) and the Trophy case as the landing tab until #863
   slice 2 adds the Championship tab. Each view's feature is now a `PlanFeature` (#944, §7);
   the views are gated on it (#948).
3. **Commissioner settings.** Points table with preview; cup weight. Brought the championship
   name setting with it, since it shares the section.
4. **Crowning.** `POST .../crown`, Ready to crown, frozen standings, the podium. The trophy
   shelf moved to #872 slice 2, whose squad results endpoint and trophy case section are the same
   thing; a shelf built here would need its own endpoint only to be replaced. Cups score each final contest from its `LeagueYearFinish` row's finish
   and weight, not the live `contest.cupWeight`, so a weight saved while settlement runs cannot
   split a cup from the championship. Open cups keep scoring on the league's table as it stands
   (slice 3); crowning freezes the standings with that table on the cup, so a crowned cup's
   chart and squad breakdown keep matching its frozen points.
5. **Projected points** from live contests, greyed as "if it ended now". `GET .../projection` scores each live
   counted contest from its own leaderboard's places, at its own weight, on top of the counted
   ones; Points race shows it as a greyed "If it ended now" column beside the standings while a
   contest is live. A crowned cup has none (409 `CUP_CROWNED`).

2 and 3 in parallel after 1; 4 and 5 after 2.

**#863 championship** (can go before or alongside #841)

1. **Storage and read.** `LeagueYearFinish`, `League.cupName`, written at settlement, backfill,
   `GET /championship/:year` and `/championship`. Plus the guard and best-entry function if #841
   slice 1 hasn't landed them. (It also wrote the contest's series and selection type; #874 reads
   those from the contest, so #954 dropped them.)
2. **The page.** The Championship tab (trophy, podium, tiles, matrix); cup name setting (landed with #841 slice 3);
   championship trophies on the shelf, which comes with the shelf itself in #872 slice 2. Builds the page shell if #841 slice 2 hasn't.

**#837 history** (after both pages exist)

1. **Past years.** The year picker on every tab, live parts hidden. Mostly web. Built with
   `GET /cups/seasons` for the cup years. A cup's live parts go once its season is over (a past
   year and nothing open or live), not on the year alone, so a 2025 NFL Cup keeps them through
   February; Ready to crown stays for the commissioner on a past cup, so one never crowned can
   still be.
2. **Drill-through.** `GET /history/contests`, the Contests list, squad and cell filters, past
   race rows opening leaderboards, the Contests page History view. Built in two PRs: the
   endpoint with the Championship tab's list and filters first (a matrix count narrows it, kept in
   the link as `?squad=…&place=…`), then the Contests page History view, which reads the same list one year at a time with the years its completed contests went final in. Points race rows already
   opened their leaderboards in any year (#841 slice 2). The squad filter lists only counted
   contests, as Played counts them; the unfiltered list shows every contest that went final.
3. **All years.** `GET /history/summary` and the page; delete `my-team-history-page.tsx` (Q3).
   Built as one PR: All years sits under the Championships menu (the header has an All years
   link, and My team's history link now opens it); a year's cups follow the Trophy case rule
   (crowned ones, and open ones with two counted contests), and a year with neither a champion
   nor such a cup is skipped.

1 and 2 in parallel; 3 after 1.

## 9. Ideas not taken

Derek, 2026-10-22: the history ideas became tickets #872 (squad page, with contest medals and
the year in review), #873 (record book and Hall of Lame) and #874 (perpetual trophies). An
all-time table and a separate career page duplicate All years and the squad page. Head to head
is dropped: pools aren't played head to head. Past winners entered by hand wait until a league
asks.

**Shared components.** The league slices build the medal tiles, finish matrix, cup row, contest
row and trophy shelf as components that take an optional `focusSquadId`, so #872 reuses them
without a rewrite. That is the only thing the squad page asks of the league slices.

## 10. Squad page (#872)

Every squad's page, My team and other teams' (`/league/:code/team`, `/league/:code/teams/:teamId`),
gains the squad's cut of every Championships view: the same rows, filtered to one squad, with
the same components (mockup E). It moves exactly when the league views do: as each contest
goes Final, and live contests show the squad's current place.

```
Squad header: icon · name · owners · year picker "2026 ▾"
  Championship card   place of N, points, gap to the leader, movement   → Championship tab
  Medal tiles         1sts, 2nds, 3rds, podiums, top tens, played (its own counts)
  Finish row          its matrix row; a number opens those contests
  Cups                one row per cup: place, points, movement          → Points race, chip set
  Contests            the year's contests: place, points, weight; live ones dashed, current place
                                                                         → the contest's leaderboard
  Trophy case         cup and championship trophies, contest medals (1st/2nd/3rd counts),
                      perpetual trophy plates (#874)
  Records             records and Hall of Lame entries it holds (#873)
  All years           one line per year: championship place and cup finishes → that year here
```

- **One request per page:** `GET /leagues/:leagueId/squads/:squadId/results?year=` returning
  `SquadYearResultsDto`. The server calls the same service functions the league pages use
  (championship standings, cup standings, records) and keeps the squad's row, so the squad page
  and the league page can never disagree. The contest list reads the existing
  `GET /history/contests?squadId=`.
- **Contest medals** (Derek's idea 6) are small counts of contest 1sts, 2nds and 3rds, all time,
  from `LeagueYearFinish`, so a cup trophy still stands out.
- Today's owners section stays at the top; results sit under it. The page replaces
  `my-team-history-page.tsx` together with All years (#837 slice 3).
- **Classes:** each section asks for its league feature (`CHAMPIONSHIP`, `CUP_STANDINGS`,
  `TROPHY_SHELF`, `PAST_YEARS`, `RECORD_BOOK`), so the squad page needs no class of its own.

### Year in review

At the end of the year each member gets an email with their squad's year: the squad page's
snapshot as of 31 December (championship place, tiles, best finish, cups, trophies won that
year), linking to the squad page for that year. It is the same data at one moment, so it is an
email, not another page. Sent through the email outbox (#845), class B.

- **Q6** (Derek, 2026-10-23) The commissioner sends it, with a "Send the 2026 year in review"
  button on the Championships page from 1 January. No job runs.
- **Telling the commissioner** (Derek, 2026-10-23): from 1 January until it is sent, the
  commissioner sees a "Your 2026 year in review is ready to send" banner on league home and the
  Championships page, like Ready to crown. It is worked out on read (the year is over and
  nothing has been sent for it), so it needs no timer either. An email reminder, and later an
  automatic send on 1 January around 2am US Eastern, come with a scheduled job (Derek's long-run
  plan); the button and banner stay as the manual path.

### Slices (#872)

1. **Squad year.** The results endpoint; championship card, tiles, finish row, cups and contests
   on the squad page. After #863 slice 2 and #841 slice 2.
   Built as `GET /leagues/:id/history/squads/:squadId?year=` in the `history` module (`getSquadYear`),
   not under `/squads`, so the squad's cut sits beside the league views it reads. The championship
   now works out each squad's movement the way a cup does. The contests are the counted ones it
   placed in; live ones stay in My team's My entries with their current place. The year is the
   current one until slice 2 adds the picker.
2. **Trophies and all years.** Contest medals, the trophy case section (the trophy shelf: every
   top-3 cup finish from `CupStanding.trophy` and championship finish), the All years strip and
   the year picker. After #841 slice 4 and #837 slice 1.
   Built as `GET /leagues/:id/history/squads/:squadId/years` (`getSquadHistory`): the medals, the
   shelf and every year's `SquadYearDto`. A championship trophy is a podium with points in a year
   that is over (`TrophyKind`; `trophyForPlace` is shared with crowning). The year picker is
   `?year=` on the squad page; the strip lists only the years, and the cups, the squad placed in. Perpetual
   trophy plates join the shelf with #874.
3. **Records.** The squad's records and Hall of Lame entries. After #873.
   Built as a Records section under the trophy case, read from the league's record book
   (`listRecords`, the query All years uses) and kept to the rows where the squad has the best
   value, so the two cannot disagree; no endpoint of its own. Hall of Lame rows it holds show
   there too, unless the league hides them.
4. **Year in review email.** After slice 1 and #845's outbox.
   Built as `GET /leagues/:id/history/year-review` and `POST .../year-review/:year/send`, the
   `YEAR_IN_REVIEW` email (Results category, class B) and a `league_year_reviews` row per league
   and year that clears the banner. Each active owner of an active squad that placed gets its
   year; a squad that placed in nothing gets none. The banner, with its Send button, shows to
   commissioners on league home and above every Championships tab.

## 11. Record book and Hall of Lame (#873)

A section on the All years page, and on the squad page for records a squad holds. Every record
is worked out on read from the league's `LeagueYearFinish` rows (a few thousand at most), by
pure functions in the `history` module, and shows the holder(s), the value, the year, and the
next best. Ties show every holder.

| `RecordType` | Record |
|---|---|
| `MOST_CHAMPIONSHIPS` | Most league championships |
| `BACK_TO_BACK_CHAMPIONS` | Longest run of championships in consecutive years |
| `MOST_WINS_IN_A_YEAR` | Most contest wins in one year |
| `MOST_WINS_ALL_TIME` | Most contest wins |
| `LONGEST_PODIUM_RUN` | Most contests in a row on the podium, in settlement order |
| `BIGGEST_FIELD_WON` | A win with the most ranked entries |
| `REPEAT_WINNER` | Most years in a row winning the same recurring contest (#874's key) |
| `MOST_RUNNER_UPS` | Hall of Lame: most 2nd places |
| `MOST_FOURTHS` | Hall of Lame: most 4th places, just off the podium |
| `MOST_LAST_PLACES` | Hall of Lame: most last places, in contests of three or more squads |
| `LONGEST_DROUGHT` | Hall of Lame: most contests in a row played without a win, past or still running |

- `League.hallOfLameVisible Boolean @default(true)`, on league settings, hides the Hall of Lame
  rows for the whole league.
- `GET /leagues/:leagueId/history/records` returns `RecordDto[]`; Not counted and cancelled
  contests are out, as everywhere.
- Class: `RECORD_BOOK`, D (Platinum), with All years.

### Slices (#873)

1. **Record book.** The endpoint, the record book rows, the section on All years. After #863
   slice 1 and #837 slice 3. `REPEAT_WINNER` came after #874.
   Built as `GET /leagues/:id/history/records` (`listRecords`, members), worked out by pure
   functions in `history/records.ts`; the record book sits under the All years tiles. Each record
   shows its best value and the next value down, every holder of each; a record nobody holds is
   left out.
2. **Hall of Lame.** Its rows and the league setting.
   Built as four more `RecordType`s from the same `rankRecords`, which leaves them out when
   `League.hallOfLameVisible` is off, so a hidden Hall of Lame never leaves the server. The setting
   rides on `PUT /cup-settings` with the championship name and points table (Edit championships).
   A last place is the worst place among the squads (each squad's best entry), in contests of
   `LAST_PLACE_MIN_SQUADS` (3) or more squads.

## 12. Perpetual trophies (#874)

One trophy per contest a league runs every year, with a plate per year's winner: "The Masters
pick'em, 2022 Gimme Putts, 2023 Fore Play, 2024 Gimme Putts".

- **What makes a contest recurring:** it has exactly one event, and an event is one edition of
  its series a year (the Masters, the Super Bowl), so the same series and selection type in a
  later year is the same contest run again. A week of games (several games, one round, none
  sending its winner on) earns none: each NFL regular-season week is its own series, and Week 1
  Pick'em is not a trophy (Derek, 2026-10-24). Contests over several events and Not counted
  contests get none. Trophies are keyed by (`eventSeriesId`, `selectionType`), so the Masters
  pick'em and the Masters squares are two trophies.
- A trophy appears once the league has run it in two event years. Each plate shows the event's
  year and the winner(s); a year it didn't run is skipped, and a year with no result says so.
- The name is built from the series and the selection type ("Masters Tournament Tiered"), no
  setting, with the sports league beside it so the ATP and WTA "US Open Bracket" tell apart.
- Shown on the Trophy case tab under the cups, and as plates on each winner's squad page.
- `GET /leagues/:id/history/trophies` (`listPerpetualTrophies`) returns `{ trophies }`. Class:
  `TROPHY_SHELF`, B.

### Slices (#874)

1. **Perpetual trophies.** The endpoint, the Trophy case section, plates on squad pages. After
   #863 slice 1 and #841 slice 4.
   Built in the `history` module by pure functions in `history/perpetual-trophies.ts`, from the
   completed one-event contests (their series, event year and games) and the finishes. The squad
   page reads the same list and keeps the plates naming the squad. `REPEAT_WINNER` followed in
   its own PR: the record book ranks each squad's longest run of a trophy won in consecutive event
   years from the same trophies.
