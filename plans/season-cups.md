# Season cups

**Tracking issue:** #841

Written 2026-10-21 for Derek's ask: a season-long points race across a league's contests,
FedEx Cup style. Every finishing place in a contest earns points, and the points add up across
a group of contests into a cup leaderboard with a champion and trophies. Cups are an in-season
feature first; finished cups then feed league history (#837, `plans/league-history.md`), which
leaves this out of its own scope (its Q7.2). Questions sit under the section they belong to,
each with a recommendation; none blocks slice 1.

Visual concepts: the "Season cups concepts" canvas,
https://claude.ai/artifact/7CNDV2iCytR2ieq5tA46AH (phone screens; sample squads, not real data):

- **A. Points race leaderboard.** The cup page: cup switcher, leader and "you" summary, the
  table with movement arrows and wins, a points-race chart of the top five, and the counted
  contests with their weights and why one doesn't count.
- **B. Trophy cabinet.** The Cups page: a card per cup with its leader and progress, the
  commissioner's "Ready to crown" banner, the crowned podium, and the trophy shelf on a
  team page.
- **D. League championship (#863).** The trophy presented on 1 January (a "presented" tweak
  shows the leader view before then), the medal tiles, and the finish matrix.
- Mockups A to C were drawn before the split, so A's header shows the all-sports championship now
  in #863. The same layout is the PGA Tour Cup page.
- **C. Past seasons.** History's Cups tab: most cups won, then each season's cup champions,
  newest first.

---

## TL;DR

- **One cup per sports league, inside one Poolmaster league** (Derek, 2026-10-21/22). "League"
  here is always the Poolmaster league, the tenant; "sports league" is the PGA Tour, the LPGA
  Tour, the NFL. Each sports league a league plays gets a FedEx-style cup for the season (the
  "2026 PGA Tour Cup", the "2025 NFL Cup"). No cup per sport and no hand-picked cups.
- **The league-wide championship across every sport is split off** to #863 (Derek,
  2026-10-22), because sports league seasons don't line up with the calendar year. It counts
  contests by the calendar year they end, with a trophy, medal tiles and a finish matrix; see
  section 8.
- **A cup is a rule, not a copy of results.** Standings are worked out on read from the places
  every contest already freezes when it settles (`ContestEntryStanding`), the same read #837
  builds. Nothing is kept in step by hand, and nobody sets a cup up.
- **Points:** FedEx-like table by place, tied squads split the points, and a weight on each
  contest (x1, x1.5, x2, or not counted) set once on the contest's settings. Every contest
  counts, however few entries. The total is a plain running sum: no playoff reset.
- **The commissioner crowns each cup** when its season is done, once every counted contest is
  Final. That freezes the standings and hands out trophies; it is what history shows six years
  later.
- **Five slices:** model and read API; cup pages; commissioner settings; crowning, trophies and
  past cups; projected points from live contests.

## 1. What it builds on

| Piece | Where | Used for |
|---|---|---|
| Frozen contest places | `ContestEntryStanding.position` (1 best, ties allowed), written at settlement | The only input to cup points |
| Contest status | `Contest.status` `COMPLETED` | Only Final contests award points (projected points are slice 5) |
| Contest's sports league | `ContestSportEvent` → `SportEvent.eventSeries.sportLeagueId` | Which sports league cup a contest counts toward |
| Season | `Contest.seasonYear`, added by #837 slice 1 | Which season a contest counts toward |
| A squad's best entry | #837 `history` module, Q3.2 | A squad with several entries in a contest scores once, from its best place |
| Squad delete guard | #837 slice 1, Q3.1 | A squad with results can't be deleted, so cup standings can't lose a row |

A contest's events all belong to one sports league today (contests are made from that sports
league's templates), so a contest counts toward exactly one sports league cup.

## 2. What a cup is

```
League (existing), new settings
  cupPointsScale CupPointsScale     STANDARD | TOP_TEN | FIELD_BEATEN | CUSTOM; default STANDARD
  cupCustomPoints Int[]             points for 1st, 2nd, ... ; only for CUSTOM

Contest (existing), new setting
  cupWeight      CupWeight          NORMAL (x1) | BONUS (x1.5) | DOUBLE (x2) | NOT_COUNTED

Cup                                 one points race in one league and one season
  leagueId, seasonYear
  sportLeagueId                     the sports league whose contests it counts
  status         CupStatus          OPEN | CROWNED
  crownedAt      DateTime?

CupStanding                         frozen when the cup is crowned, like ContestEntryStanding
  cupId, squadId                    unique together
  position, displayPosition         1 best; "T2" for ties
  points                            Int (tenths of a point)
  wins, podiums, contestsCounted    Int
  trophy         CupTrophy?         CHAMPION | RUNNER_UP | THIRD
  crownedAt
```

- **Which contests count** is worked out on read: the league's contests with the cup's
  `seasonYear` in its sports league and whose `cupWeight` is not `NOT_COUNTED`. A contest made
  next month joins the PGA Tour Cup on its own.
- **Where weights live.** On the contest, not the event and not the cup. Events are shared by
  every league on the site, so they can't carry one league's choice; a cup-by-cup setting would
  make the commissioner set it again for #863's championship. One `cupWeight` on the contest's
  settings applies in every cup it counts toward. Default `NORMAL`. Editable until the contest is
  Final (typed error `CONTEST_FINAL`), so a settled result's weight never moves.
- **Names.** Cups have no name column. Screens build it from the season and the sports league's
  name: "2026 PGA Tour Cup". The "cup name" league setting Derek chose (Q2.6) names #863's
  championship, so it moves there.
- **One points table per league**, on league settings, used by all of its cups. A crowned cup
  keeps its frozen points, so changing the table later changes only open cups.
- A database check keeps `cupCustomPoints` non-empty exactly when the scale is `CUSTOM`. A
  unique index allows one cup per (league, season, sports league).
- **Cups are created, never set up.** When a contest is created, contest-management calls the
  cups service (modules call each other's services, `rules/architecture-rules.md` §4 *Service
  Topology*), which makes the (league, season, sports league)'s cup if it doesn't exist yet. The migration
  does the same for every existing contest. Cups are never deleted.
- A sports league cup stays off the Cups page until it has two counted contests, so a league
  that plays one Super Bowl squares pool doesn't get an NFL Cup with one contest in it.
- Enums mirror domain consts in `packages/shared/domain/enums.ts` with the `Prisma` prefix,
  like every other status column.
- **A cup never crosses leagues.** Leagues are tenants: a cup belongs to one league, counts only
  that league's contests and ranks only its squads. Every route is under `/leagues/:leagueId`
  with the league's access check.

Decided:

- **Q2.1** (Derek, 2026-10-22) The league-wide championship across every sport is split off to
  #863, by calendar year (section 8).
- **Q2.2** (Derek, 2026-10-21) One cup per sports league. No combined cup per sport (men's and
  women's golf together) and no hand-picked cups.
- **Q2.3** (Derek, 2026-10-21) No cross-league cups, ever, for members or commissioners. A
  person in several leagues never sees cups, points or trophies added up across them: the
  league selector is always a hard partition.
- **Q2.5, Q2.6** (Derek, 2026-10-22) A "cup name" league setting, defaulted at league creation
  to "<league name> Cup", with past seasons shown under its current value. Both go with #863.

## 3. Points

A squad's points from one contest come from its **best entry's place** in that contest:

```
points = scale(place, rankedEntries) x contest.cupWeight
```

| Scale | Points | Feel |
|---|---|---|
| `STANDARD` (default) | 100, 80, 65, 55, 48, 42, 37, 33, 30, 27 for 1st to 10th; then 25 down by 2 to 7 for 11th to 20th; 5 for every place after | FedEx-like: winning matters most, everyone who plays gets something |
| `TOP_TEN` | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; nothing after 10th | Formula 1: simple, only the top ten score |
| `FIELD_BEATEN` | One point for every entry finished behind, plus one for finishing | Fair across a 6-entry pool and a 60-entry pool |
| `CUSTOM` | The commissioner's own list; places past the list score 0 | For leagues with their own tradition |

- **Ties share the points of the places they cover**, as the PGA Tour does: two entries tied
  for 2nd in `STANDARD` each get (80 + 65) / 2 = 72.5. Points are kept to one decimal place in
  the response and summed exactly (stored as tenths, `Int`, so no floating sums).
- **Weight** multiplies the contest's points and shows beside the contest on the cup page
  ("x1.5"). `NOT_COUNTED` leaves the contest out of every cup, for a side bet or a test pool.
- **Every contest counts**, whatever its number of entries. If a minimum is ever added, the cup
  page and the contest page must both say why a contest didn't count.
- **A plain running sum.** The final standings are the total of every counted contest's points.
  No playoff reset and no dropped worst results.
- **Cancelled contests** (all events cancelled, no standings, #743) award nothing and don't
  count as played. The cup page lists them as "No result".
- **Squads with no submitted entry** in a contest get nothing from it. A squad that played no
  counted contest still appears at the bottom with 0, so the table shows the whole league.
- **Cup ties** are broken by more wins, then more podiums, then shared (a "T3"), matching the
  MVP rule that standings allow ties.
- The points function is pure, lives in `packages/shared/domain/cup-points.ts` so the
  commissioner screen can preview a table, and is unit-tested place by place, tie by tie.

Decided (Derek, 2026-10-22): Q3.1 `STANDARD` is the default; Q3.2 three fixed weights; Q3.3
every contest counts, no minimum field for now; Q3.4 ties split points; Q3.5 best entry only,
the same function as #837.

- **Q3.6** (Derek, 2026-10-22) One weight per contest, on the contest's settings, used by every
  cup the contest counts toward. Every contest defaults to x1 (`NORMAL`, the column default and
  the create default), so a commissioner never has to touch it.

## 4. Season and crowning

A cup belongs to one `seasonYear` (#837 slice 1). It is `OPEN` from creation and its standings
move each time a counted contest goes Final.

**The commissioner crowns each cup** (Derek, 2026-10-22), with `POST .../cups/:cupId/crown`,
whenever they decide its season is done: the PGA Tour Cup after the last golf pool in
September, an NFL Cup after the Super Bowl pool. Nothing runs on a
timer and nothing waits for the calendar. The Cups page shows a "Ready to crown" button to the
commissioner once every counted contest is Final.

- Crowning refuses while a counted contest is still Open or Live (typed error
  `CUP_HAS_UNFINISHED_CONTESTS`, listing them). The commissioner settles it or sets it to Not
  counted first. Draft contests never opened don't count and don't hold it up.
- It writes the `CupStanding` rows, hands out `CHAMPION`, `RUNNER_UP` and `THIRD` trophies
  (ties share a trophy), and moves the cup to `CROWNED`.
- After that the cup is frozen: a contest that goes Final later in the same season doesn't
  change it (the cup page lists it as "After the cup was crowned"). A counted contest's
  `cupWeight` is already fixed, since it can't change once the contest is Final.
- #837 lets the commissioner change a contest's season any time; that becomes "any time until a
  cup it counted in is crowned".

Decided (Derek, 2026-10-22): Q4.1 crowned by hand by the commissioner, not automatically and not
at a fixed date. An automatic crown would need each cup to know its own set of events and end
date, which is more setup than a league should have to do. Q4.2 a crowned cup can't be
un-crowned (the root admin can fix a mistake in the database; no screen for it). Q4.3 no
playoff reset, a plain running sum.

## 5. API

All under `/leagues/:leagueId`, members and root admin read, the commissioner writes; same access
check as the league's contests. Shapes in `packages/shared/dto/cups.dto.ts`, routes in a new
`cups` module (`rules/service-rules.md` §4 *DTOs, Mappers, OpenAPI*):

| Method and route | Who | Does |
|---|---|---|
| `GET /cups?seasonYear=` | Member | The league's cups for a season (default: the current one), each with its leader and the viewer's squad's place |
| `GET /cups/:cupId` | Member | Standings (`CupStandingRowDto[]`) and the counted contests (`CupContestRowDto[]`) |
| `GET /cups/:cupId/squads/:squadId` | Member | One squad's points contest by contest |
| `POST /cups/:cupId/crown` | Commissioner | Crown the champion (section 4) |
| `GET /cups/past` | Member | Crowned cups across every season, newest first, paged; used by history |
| `PATCH /leagues/:leagueId` (existing) | Commissioner | Gains `cupPointsScale`, `cupCustomPoints` |
| `PATCH` contest settings (existing) | Commissioner | Gains `cupWeight` |

Crowning is the only write on a cup itself: nobody creates, edits or deletes one.

- `CupDto` carries `displayName` built by the server, so every screen names cups the same way.
- `CupStandingRowDto`: squad ref (id, current name, icon, `isActive`), `position`,
  `displayPosition`, `points` (number, one decimal), `wins`, `podiums`, `contestsCounted`,
  `movement` (places gained or lost since the last Final contest), `trophy`.
- `CupContestRowDto`: contest ref, sports league, settled date, `weight`, `counts:
  CupContestCount` (`COUNTED`, `NO_RESULT`, `NOT_FINAL`, `AFTER_CROWNING`), and the winner.
- `CupDto.canCrown` for the commissioner, and `unfinishedContests`: the counted contests still
  Open or Live.
- Typed errors: `CUP_NOT_FOUND`, `CUP_CROWNED` (season change into a crowned cup), `CUP_HAS_UNFINISHED_CONTESTS`, `CONTEST_FINAL` (weight change on a Final contest).
- Read cost: one query per page over the league's settled standings for the season, the same
  shape as #837 section 5. If a league ever gets slow, the escape hatch is the same cache keyed
  by its latest `settledAt`.

## 6. Pages

| Page | Route | Content |
|---|---|---|
| Cups | `/league/:code/cups` | This season's cups as cards: name, leader, viewer's place, contests counted of total; "Ready to crown" for the commissioner. Sports league cups show once they have two counted contests |
| Cup | `/league/:code/cups/:cupId` | The leaderboard (place, movement, squad, points, wins, contests), a points-race chart of the top five across the season, and the counted contests with their weights and winners |
| Squad in a cup | sheet from a leaderboard row | That squad's points contest by contest |
| League home | existing | A small cups card: each open cup's leader and the viewer's place |
| Team page | existing | Cup trophies won, beside #837's contest trophies |
| History, Cups tab | `/league/:code/history/cups` | Crowned cups by season: champion, podium, link to the frozen table. Built with #837 |
| League settings | existing | Cup points table, with a live preview |
| Contest settings | existing | Cup weight |

Decided (Derek, 2026-10-22): Q6.1 Cups gets its own menu item for the current season, and past
cups are also part of History; Q6.2 movement arrows beside each squad; Q6.3 no real trophy
names (no "FedEx Cup").

## 7. Slices

Each slice is one PR with its docs, unit tests of the pure points functions, integration tests
for each new query (`rules/testing-rules.md` §9), contract verification for each endpoint, and a
browser journey row once a page exists. All depend on #837 slice 1 (`seasonYear`, squad delete
guard).

1. **Model and read API.** `Cup`, `CupStanding`, the league's points table settings,
   `Contest.cupWeight`, their enums; migration creating each (league, season, sports league)'s
   cup; automatic cups on contest create; `cup-points.ts` with every scale, ties and weights; `GET /cups`,
   `GET /cups/:cupId` and the squad breakdown.
2. **Cup pages.** The Cups menu item, Cups page, Cup leaderboard with movement and the
   points-race chart, the squad sheet, the league home card.
3. **Commissioner settings.** Points table on league settings with a preview; cup weight on
   contest settings.
4. **Crowning, trophies and past cups.** `POST .../crown` and the "Ready to crown" button,
   frozen `CupStanding`, trophies on team pages, `GET /cups/past` and
   the History Cups tab (with #837 slices 2 and 5), the frozen-cup checks.
5. **Projected points.** Points from live contests' current leaderboards, shown greyed as
   "if it ended now".

Slices 2 and 3 can go in parallel after 1; 4 after 2; 5 after 2.

Decided (Derek, 2026-10-22): Q7.1 projected points, as the last slice.

## 8. League championship

**Tracking issue:** #863. Its own slices (below), separate from the cup slices in section 7.

A "2026 Derek's league" championship across every contest in every sport. Cups by season don't
work for it: an NFL season is mid-way on 31 December and a Premier League season runs August to
May. Derek's design (2026-10-22):

### What counts

- **A contest counts in the calendar year it went Final.** One still running on 31 December
  counts toward the year it finishes in. No `seasonYear` involved.
- A squad's **best entry** in each contest counts, once (#837 Q3.2). Its place is the frozen
  `ContestEntryStanding.position`. Contests set to `NOT_COUNTED` (`cupWeight`) are left out;
  cancelled contests have no places and count for nothing.

### The page, top to bottom

1. **The trophy** (from 1 January of the next year): a trophy with the league's cup name under
   it ("2026 Derek's Pool Cup") and the champion squad's name under that. Before 1 January the
   space shows the current leader, "leads with 3 contests to go" style.
2. **Medal tiles** (option B): power tiles for the year's leaders: most 1sts, most 2nds, most 3rds, most podiums, most contests played, most top-ten finishes. Each tile shows the squad and its count.
3. **The finish matrix** (option A): squads as rows; columns 1st to 10th count how often each
   squad finished there; a Points column ranks the table. Points = for each finish, the place's
   value in the points table times the contest's `cupWeight`. Ties split the points of the
   places they cover, as in the cups. Equal totals go to most 1sts, then most 2nds.

**Freezing on 1 January** needs no job and no crowning: once the year is over, no contest can
go Final in it, so its rows can never change. "The trophy is presented" is the page seeing that
the year it shows has ended. The frozen year becomes that year's history view (#837).

### Stored as contests settle

Derek's call: materialize it, so history never has to read every contest for all time. Rows
are written **when a contest settles**, in the same transaction that writes its
`ContestEntryStanding` rows, so they can't drift and no year-end step exists:

```
LeagueYearFinish                    one per squad per counted contest
  leagueId, year, squadId, contestId    unique (contestId, squadId)
  place          Int                1 best
  tiedCount      Int                how many entries share that place (for the point split)
  weight         CupWeight          the contest's cupWeight at settlement
  points         Int                tenths of a point, from the points table at settlement
  settledAt
  index (leagueId, year)
```

- The year page sums one league-year of rows: a few hundred at most. Medal counts and the
  matrix columns are `count(*)` by place; points are a sum.
- Written by settlement, through a `ChampionshipService.recordContest(contestId)` that
  contest-management calls. A backfill in the migration writes rows for every contest already
  Final.
- `place` is never re-derived later, and a Final contest's `cupWeight` can't change (typed
  error `CONTEST_FINAL`), so a row is written once. The one exception is a row whose squad is
  deleted, which #837 Q3.1 already refuses.

Questions:

- **Q8.1** Which time zone decides the year? A contest settled at 7pm US Eastern on 31 December
  is already 1 January in UTC. Recommendation: US Eastern for every league until leagues get
  their own time zone (they have none today; times are converted for display only). The year
  is fixed on the row when the contest settles, so it never moves later.
- **Q8.2** Store each finish's points at settlement, or work them out from the place when the
  page is read? Recommendation: store them. Then changing the league's points table in June
  changes only contests that settle after it, and past years can never shift. The page says
  which table was in force when.
- **Q8.3** Medal tiles: most 1sts, most 2nds, most 3rds, most podiums, most contests played,
  most top-ten finishes? Recommendation: those six, two to a row on a phone. Ties on a tile show every squad tied.
- **Q8.4** Is #863 still deferred? Recommendation: build it after #837 slice 1, alongside the
  cup slices. It needs nothing from `seasonYear`, so it could even go first.

### Slices (#863)

1. **Storage and read.** `LeagueYearFinish`, `League.cupName` (default "<league name> Cup" at
   creation, Q2.6), written at settlement, backfill migration, `GET
   /leagues/:leagueId/championship/:year` (trophy, tiles, matrix) and `.../championship` (years
   with their champions, for history).
2. **The page.** Trophy, medal tiles and matrix; league settings gains the cup name. History's
   year view shows the same page frozen (with #837).

Options weighed: the matrix with points (A, chosen for the ranking); a medal table ranked by
1sts, then 2nds, then 3rds (B, chosen as the tiles); an average finish percentile (fair across
field sizes, hard to read on a phone; not used).
