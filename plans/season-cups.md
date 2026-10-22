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
- **B. Trophy cabinet.** The Cups page: a card per cup with its leader and progress, a "waiting
  on" banner before the cups crown themselves, the crowned podium, and the trophy shelf on a
  team page.
- **C. Past seasons.** History's Cups tab: most cups won, then each season's cup champions,
  newest first.

---

## TL;DR

- **Two kinds of cup, both inside one Poolmaster league** (Derek, 2026-10-21). "League" here is
  always the Poolmaster league, the tenant; "sports league" is the PGA Tour, the LPGA Tour, the
  NFL. The **league cup** is the league's championship for the year, the one leaderboard across
  every contest in every sport. A **sports league cup** (the PGA Tour Cup, the NFL Cup) covers
  that sports league's contests. No cup per sport and no hand-picked cups.
- **The league names its cup.** A new "cup name" league setting, defaulting at league creation to
  "<league name> Cup". Screens show "2026 Derek's Pool Cup", and "2026 Derek's Pool Cup · PGA
  Tour Cup" for a sports league cup.
- **A cup is a rule, not a copy of results.** Standings are worked out on read from the places
  every contest already freezes when it settles (`ContestEntryStanding`), the same read #837
  builds. Nothing is kept in step by hand, and nobody sets a cup up.
- **Points:** FedEx-like table by place, tied squads split the points, and a weight on each
  contest (x1, x1.5, x2, or not counted) set once on the contest's settings. Every contest
  counts, however few entries. The total is a plain running sum: no playoff reset.
- **Cups crown themselves** once their year is over and every counted contest is Final. That
  freezes the standings and hands out trophies; it is what history shows six years later.
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
| Scheduled sweep | `EventLifecycleScheduler` (a fixed-interval sweep in core-api) | The pattern for the year-end crowning check |

A contest's events all belong to one sports league today (contests are made from that sports
league's templates), so a contest counts toward exactly one sports league cup.

## 2. What a cup is

```
League (existing), new settings
  cupName        String             "<league name> Cup" at creation; commissioner edits it
  cupPointsScale CupPointsScale     STANDARD | TOP_TEN | FIELD_BEATEN | CUSTOM; default STANDARD
  cupCustomPoints Int[]             points for 1st, 2nd, ... ; only for CUSTOM

Contest (existing), new setting
  cupWeight      CupWeight          NORMAL (x1) | BONUS (x1.5) | DOUBLE (x2) | NOT_COUNTED

Cup                                 one points race in one league and one season
  leagueId, seasonYear
  scope          CupScope           ALL_CONTESTS | SPORT_LEAGUE
  sportLeagueId                     set only for SPORT_LEAGUE
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
  `seasonYear` that match its scope and whose `cupWeight` is not `NOT_COUNTED`. A contest made
  next month joins the PGA Tour Cup on its own.
- **Where weights live.** On the contest, not the event and not the cup. Events are shared by
  every league on the site, so they can't carry one league's choice; a cup-by-cup setting would
  make the commissioner set the Masters pool twice. One `cupWeight` on the contest's settings
  applies in both cups it counts toward. Default `NORMAL`. Editable until a cup it counts toward
  is crowned.
- **Names.** Cups have no name column. Screens build it from the league's `cupName` and the
  season: "2026 Derek's Pool Cup", and "2026 Derek's Pool Cup · PGA Tour Cup" with the sports
  league's name. A league rename does not change `cupName`; the commissioner edits it on league
  settings, and past cups show the current value (Q2.5).
- **One points table per league**, on league settings, used by all of its cups. A crowned cup
  keeps its frozen points, so changing the table later changes only open cups.
- Database checks keep the scope honest: `sportLeagueId` is set exactly when scope is
  `SPORT_LEAGUE`, and `cupCustomPoints` is non-empty exactly when the scale is `CUSTOM`. Unique
  indexes allow one `ALL_CONTESTS` cup per (league, season) and one cup per (league, season,
  sports league).
- **Cups are created, never set up.** When a contest is created, contest-management calls the
  cups service (modules call each other's services, `rules/architecture-rules.md` §4 *Service
  Topology*), which makes the (league, season)'s league cup and its sports league's cup if they
  don't exist yet. The migration does the same for every existing contest and sets each league's
  `cupName`. Cups are never deleted and their scope never changes.
- A sports league cup stays off the Cups page until it has two counted contests, so a league
  that plays one Super Bowl squares pool doesn't get an NFL Cup with one contest in it. The
  league cup always shows.
- Enums mirror domain consts in `packages/shared/domain/enums.ts` with the `Prisma` prefix,
  like every other status column.
- **A cup never crosses leagues.** Leagues are tenants: a cup belongs to one league, counts only
  that league's contests and ranks only its squads. Every route is under `/leagues/:leagueId`
  with the league's access check.

Decided:

- **Q2.1** (Derek, 2026-10-21) Every league gets a league cup each season, the one leaderboard
  across every contest in every sport. It is the league's championship for that year.
- **Q2.2** (Derek, 2026-10-21) The cups are the league cup and one cup per sports league. No
  combined cup per sport (men's and women's golf together) and no hand-picked cups.
- **Q2.3** (Derek, 2026-10-21) No cross-league cups, ever, for members or commissioners. A
  person in several leagues never sees cups, points or trophies added up across them: the
  league selector is always a hard partition.
- **Q2.4** A contest counts toward both the league cup and its sports league's cup.
- **Q2.5** (Derek, 2026-10-22) A crowned cup from a past season shows the league's current cup
  name. Nothing about the name is frozen on the cup.
- **Q2.6** (Derek, 2026-10-22) A "cup name" league setting, defaulted at league creation to
  "<league name> Cup", names the league cup ("2026 Derek's Pool Cup") and prefixes the sports
  league cups ("2026 Derek's Pool Cup · PGA Tour Cup").

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

Questions:

- **Q3.6** Weight on the contest (set once, used by both cups) rather than per cup?
  Recommendation: on the contest. It's one setting in the place the commissioner already edits
  the contest, and a Masters pool that counts extra in the PGA Tour Cup should count extra in
  the league cup too.

## 4. Season and crowning

A cup belongs to one `seasonYear` (#837 slice 1). It is `OPEN` from creation and its standings
move each time a counted contest goes Final.

**Cups crown themselves.** A cup is crowned automatically when both are true:

1. its season's calendar year is over (1 January of the next year has passed), and
2. none of its counted contests is still Open or Live. Draft contests never opened don't count
   and don't hold it up.

Crowning writes the `CupStanding` rows, hands out `CHAMPION`, `RUNNER_UP` and `THIRD` trophies
(ties share a trophy) and moves the cup to `CROWNED`. The check runs in two places, through one
`CupService.crownIfReady`: when a contest settles (settlement calls the cups service), and in a
once-a-day sweep shaped like `EventLifecycleScheduler`, for a year that ends with nothing left to
settle.

How it plays out:

- A golf league whose last pool settles in November: its 2026 cups crown on 1 January 2027.
- An NFL league whose contests carry season 2025: the playoff and Super Bowl pools are still
  Live in January, so its 2025 cups wait and crown the moment the Super Bowl pool settles in
  February.
- A contest nobody settles: the Cups page shows "Waiting on: <contest>" to everyone, and the
  commissioner can settle it or set it to Not counted.

After crowning, the season is closed for that league: a contest can't be given that
`seasonYear` and its contests' `cupWeight` can't change (typed error `CUP_CROWNED`). #837
lets the commissioner change a contest's season any time; that becomes "any time until the
season's cups are crowned".

This is a timed action, which the codebase usually avoids in favour of explicit release
actions. It fits here because crowning cuts nobody off: by the time it runs, every result it
reads is already frozen, so it records an outcome that can no longer change.

Decided (Derek, 2026-10-22): Q4.2 a crowned cup can't be un-crowned (the root admin can fix a
mistake in the database; no screen for it); Q4.3 no playoff reset, a plain running sum.

Questions:

- **Q4.1** Crown automatically as above? Recommendation: yes. Nobody has to remember to do it,
  and the NFL case works on its own. A "Crown now" button for the commissioner isn't needed,
  since the cup can't be final before the year is over anyway.

## 5. API

All under `/leagues/:leagueId`, members and root admin read, the commissioner writes; same access
check as the league's contests. Shapes in `packages/shared/dto/cups.dto.ts`, routes in a new
`cups` module (`rules/service-rules.md` §4 *DTOs, Mappers, OpenAPI*):

| Method and route | Who | Does |
|---|---|---|
| `GET /cups?seasonYear=` | Member | The league's cups for a season (default: the current one), each with its leader and the viewer's squad's place |
| `GET /cups/:cupId` | Member | Standings (`CupStandingRowDto[]`) and the counted contests (`CupContestRowDto[]`) |
| `GET /cups/:cupId/squads/:squadId` | Member | One squad's points contest by contest |
| `GET /cups/past` | Member | Crowned cups across every season, newest first, paged; used by history |
| `PATCH /leagues/:leagueId` (existing) | Commissioner | Gains `cupName`, `cupPointsScale`, `cupCustomPoints` |
| `PATCH` contest settings (existing) | Commissioner | Gains `cupWeight` |

No write routes on cups themselves: nobody creates, edits or crowns a cup by hand.

- `CupDto` carries `displayName` built by the server, so every screen names cups the same way.
- `CupStandingRowDto`: squad ref (id, current name, icon, `isActive`), `position`,
  `displayPosition`, `points` (number, one decimal), `wins`, `podiums`, `contestsCounted`,
  `movement` (places gained or lost since the last Final contest), `trophy`.
- `CupContestRowDto`: contest ref, sports league, settled date, `weight`, `counts:
  CupContestCount` (`COUNTED`, `NO_RESULT`, `NOT_FINAL`), and the winner.
- `CupDto.waitingOn`: the counted contests still Open or Live, once the year is over.
- Typed errors: `CUP_NOT_FOUND`, `CUP_CROWNED`.
- Read cost: one query per page over the league's settled standings for the season, the same
  shape as #837 section 5. If a league ever gets slow, the escape hatch is the same cache keyed
  by its latest `settledAt`.

## 6. Pages

| Page | Route | Content |
|---|---|---|
| Cups | `/league/:code/cups` | This season's cups as cards: name, leader, viewer's place, contests counted of total; the "Waiting on" banner after year end. Sports league cups show once they have two counted contests |
| Cup | `/league/:code/cups/:cupId` | The leaderboard (place, movement, squad, points, wins, contests), a points-race chart of the top five across the season, and the counted contests with their weights and winners |
| Squad in a cup | sheet from a leaderboard row | That squad's points contest by contest |
| League home | existing | A small league cup card: top three and the viewer's place |
| Team page | existing | Cup trophies won, beside #837's contest trophies |
| History, Cups tab | `/league/:code/history/cups` | Crowned cups by season: champion, podium, link to the frozen table. Built with #837 |
| League settings | existing | Cup name and points table, with a live preview |
| Contest settings | existing | Cup weight |

Decided (Derek, 2026-10-22): Q6.1 Cups gets its own menu item for the current season, and past
cups are also part of History; Q6.2 movement arrows beside each squad; Q6.3 no real trophy
names (no "FedEx Cup").

## 7. Slices

Each slice is one PR with its docs, unit tests of the pure points functions, integration tests
for each new query (`rules/testing-rules.md` §9), contract verification for each endpoint, and a
browser journey row once a page exists. All depend on #837 slice 1 (`seasonYear`, squad delete
guard).

1. **Model and read API.** `Cup`, `CupStanding`, `League.cupName` and the points table
   settings, `Contest.cupWeight`, their enums; migration creating each (league, season)'s cups
   and every league's `cupName`; `cupName` defaulted at league creation; automatic cups on
   contest create; `cup-points.ts` with every scale, ties and weights; `GET /cups`,
   `GET /cups/:cupId` and the squad breakdown.
2. **Cup pages.** The Cups menu item, Cups page, Cup leaderboard with movement and the
   points-race chart, the squad sheet, the league home card.
3. **Commissioner settings.** Cup name and points table on league settings with a preview; cup
   weight on contest settings. Depends on Q3.6.
4. **Crowning, trophies and past cups.** `crownIfReady` from settlement and the daily sweep,
   frozen `CupStanding`, the "Waiting on" banner, trophies on team pages, `GET /cups/past` and
   the History Cups tab (with #837 slices 2 and 5), the closed-season checks. Depends on Q4.1.
5. **Projected points.** Points from live contests' current leaderboards, shown greyed as
   "if it ended now".

Slices 2 and 3 can go in parallel after 1; 4 after 2; 5 after 2.

Decided (Derek, 2026-10-22): Q7.1 projected points, as the last slice.
