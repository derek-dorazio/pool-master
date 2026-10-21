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
  commissioner's "Ready to crown" banner, a "Start a Football Cup" suggestion, the crowned
  podium, and the trophy shelf on a team page.
- **C. Past seasons.** History's Cups tab: most cups won, then each season's cup champions,
  newest first.

---

## TL;DR

- **A cup is a rule, not a copy of results.** It names a season, which contests count (every
  contest, one sport, one sport league, or a hand-picked list) and a points table. Standings are
  worked out on read from the places every contest already freezes when it settles
  (`ContestEntryStanding`), the same read #837 builds. Nothing is kept in step by hand.
- **Every league gets a Poolmaster Cup** (all sports) each season without lifting a finger. The
  commissioner can add sport cups (a Golf Cup, an NFL Cup) and custom cups ("Derek's Cup").
- **Points follow the place, the field and an optional weight.** A preset points table, shared
  points for ties, and a per-contest weight so a majors pool can count for more.
- **Crowning is an explicit action.** The commissioner crowns the champion, which freezes the
  standings and hands out trophies. That frozen row is what history shows six years later.
- **Five slices:** model and read API; the cup leaderboard page; commissioner cup tools;
  crowning, trophies and past seasons; projected points from live contests.

## 1. What it builds on

| Piece | Where | Used for |
|---|---|---|
| Frozen contest places | `ContestEntryStanding.position` (1 best, ties allowed), written at settlement | The only input to cup points |
| Contest status | `Contest.status` `COMPLETED` | Only Final contests award points (projected points are slice 5) |
| Contest sport | `ContestSportEvent` → `SportEvent.sport` and `SportEvent.eventSeries.sportLeagueId` | Which sport and sport league a contest belongs to, for sport cups |
| Season | `Contest.seasonYear`, added by #837 slice 1 | Which season a contest counts toward |
| A squad's best entry | #837 `history` module, Q3.2 | A squad with several entries in a contest scores once, from its best place |
| Squad delete guard | #837 slice 1, Q3.1 | A squad with results can't be deleted, so cup standings can't lose a row |
| Explicit release actions | Contest release, round release | Crowning a cup is the same kind of action, never a date-based lock |

A contest's events all belong to one sport league today (contests are made from that league's
templates), so a contest has exactly one sport and one sport league.

## 2. What a cup is

```
Cup                              one points race in one league and one season
  leagueId, seasonYear, name
  scope        CupScope          ALL_SPORTS | SPORT | SPORT_LEAGUE | HAND_PICKED
  sport        Sport?            set only for SPORT
  sportLeagueId                  set only for SPORT_LEAGUE
  pointsScale  CupPointsScale    STANDARD | TOP_TEN | FIELD_BEATEN | CUSTOM
  customPoints Int[]             points for 1st, 2nd, ... ; only for CUSTOM
  isLeagueCup  Boolean           the league's automatic Poolmaster Cup for that season
  status       CupStatus         OPEN | CROWNED
  crownedAt    DateTime?

CupContestSetting                a commissioner's change to one contest in one cup
  cupId, contestId               unique together
  included     Boolean           false drops a matching contest; true adds one to a HAND_PICKED cup
  weight       CupContestWeight  NORMAL (x1) | BONUS (x1.5) | DOUBLE (x2)

CupStanding                      frozen when the cup is crowned, like ContestEntryStanding
  cupId, squadId                 unique together
  position, displayPosition      1 best; "T2" for ties
  points                         Int (tenths of a point)
  wins, podiums, contestsCounted Int
  trophy       CupTrophy?        CHAMPION | RUNNER_UP | THIRD
  crownedAt
```

- **Which contests count** is worked out on read: the league's contests with the cup's
  `seasonYear` that match its scope, minus those with a setting `included = false`. A
  `HAND_PICKED` cup counts only contests with a setting `included = true`. A contest made next
  month joins the Golf Cup on its own, with no step for anyone.
- Database checks keep the scope honest: `sport` is set exactly when scope is `SPORT`,
  `sportLeagueId` exactly when `SPORT_LEAGUE`, `customPoints` is non-empty exactly when
  `CUSTOM`. One `isLeagueCup` per (league, season), as a partial unique index.
- **The Poolmaster Cup** is created by the cups service the first time a contest is created
  in a (league, season) that has no league cup yet; contest-management calls it (modules call
  each other's services, `rules/architecture-rules.md` §4 *Service Topology*). The migration
  creates one for every (league, season) that already has a contest. It can be renamed, never
  deleted, and its scope stays `ALL_SPORTS`.
- Enums mirror domain consts in `packages/shared/domain/enums.ts` with the `Prisma` prefix,
  like every other status column.
- **Cross-league cups** (one Poolmaster Cup across every league a person plays in) are out:
  squads, entries and places all live inside one league. See Q2.3.

Questions:

- **Q2.1** Every league gets a Poolmaster Cup each season automatically? Recommendation: yes.
  It makes the feature visible from the first Final contest, and a commissioner who doesn't care
  never has to set anything up.
- **Q2.2** Sport cups (Golf Cup, NFL Cup): created by the commissioner, or automatic for every
  sport the league plays? Recommendation: commissioner-created, one tap from a "Start a Golf
  Cup" suggestion on the cups page. A league that plays one squares pool doesn't want a Football
  Cup with one contest in it.
- **Q2.3** Cross-league cups for a person across all their leagues: later, or never?
  Recommendation: not in this ticket. It credits people, not squads, which no other screen does,
  and needs its own privacy rules (other leagues' names and members).
- **Q2.4** May a contest count toward several cups at once (Poolmaster Cup, Golf Cup and
  Derek's Cup)? Recommendation: yes, that is the point of sport cups. Each cup works out its own
  points.

## 3. Points

A squad's points from one contest come from its **best entry's place** in that contest:

```
points = scale(place, rankedEntries) x weight
```

| Scale | Points | Feel |
|---|---|---|
| `STANDARD` | 100, 80, 65, 55, 48, 42, 37, 33, 30, 27 for 1st to 10th; then 25 down by 2 to 7 for 11th to 20th; 5 for every place after | FedEx-like: winning matters most, everyone who plays gets something |
| `TOP_TEN` | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; nothing after 10th | Formula 1: simple, only the top ten score |
| `FIELD_BEATEN` | One point for every entry finished behind, plus one for finishing | Fair across a 6-entry pool and a 60-entry pool |
| `CUSTOM` | The commissioner's own list; places past the list score 0 | For leagues with their own tradition |

- **Ties share the points of the places they cover**, as the PGA Tour does: two entries tied
  for 2nd in `STANDARD` each get (80 + 65) / 2 = 72.5. Points are kept to one decimal place in
  the response and summed exactly (stored as tenths, `Int`, so no floating sums).
- **Weight** multiplies the contest's points. The commissioner sets it per contest per cup
  (Q3.2). It is shown beside the contest on the cup page ("x1.5").
- **Cancelled contests** (all events cancelled, no standings, #743) award nothing and don't
  count as played. The cup page lists them as "No result".
- **Squads with no submitted entry** in a contest get nothing from it. A squad that played no
  counted contest still appears at the bottom with 0, so the table shows the whole league.
- **Cup ties** are broken by more wins, then more podiums, then shared (a "T3"), matching the
  MVP rule that standings allow ties.
- **Minimum field:** a contest with fewer than 3 ranked entries awards no points (Q3.3).
- The points function is pure, lives in `packages/shared/domain/cup-points.ts` so the
  commissioner screen can preview a table, and is unit-tested place by place, tie by tie.

Questions:

- **Q3.1** Default points table for the Poolmaster Cup? Recommendation: `STANDARD`. It rewards
  winning without leaving anyone at zero, so the bottom half of the league still has a reason to
  enter the next pool.
- **Q3.2** Contest weights: three fixed choices (x1, x1.5, x2) or any number? Recommendation:
  the three choices. Typed, easy to read on a phone, and x1.5 is the FedEx majors ratio
  (750 against 500).
- **Q3.3** Do tiny contests (fewer than 3 entries) count? Recommendation: no. A two-entry pool
  between friends shouldn't hand out a full winner's 100 points. Shown on the cup page as "Too
  few entries to count".
- **Q3.4** Ties split points (72.5 each) rather than both getting 2nd-place points?
  Recommendation: split. It is what golf fans know, and it keeps the total points in a contest
  the same whether or not there were ties.
- **Q3.5** Should the multi-entry rule follow #837 Q3.2 (best entry only)? Recommendation: yes,
  the same function, so a squad that buys three entries can't collect three sets of points.

## 4. Season and lifecycle

A cup belongs to one `seasonYear` (#837 slice 1). It is `OPEN` from creation and its standings
move each time a counted contest goes Final.

**Crowning** is the commissioner's explicit action, `POST .../cups/:cupId/crown`. It refuses
while any counted contest is still `OPEN` or `ACTIVE` (typed error `CUP_HAS_UNFINISHED_CONTESTS`,
listing them), unless the commissioner drops them from the cup first. It writes the
`CupStanding` rows, hands out `CHAMPION`, `RUNNER_UP` and `THIRD` trophies (ties share a trophy),
and moves the cup to `CROWNED`. After that the cup's settings, its contest settings and the
`seasonYear` of its contests are frozen for that cup (typed error `CUP_CROWNED`). Changing a
contest's `seasonYear` after its cups are crowned is refused for the same reason.

Questions:

- **Q4.1** Crown by hand, or automatically when the year ends? Recommendation: by hand, with a
  "Ready to crown" banner once every counted contest is Final. It matches the rule that locks
  are explicit release actions, and an NFL league's season ends in February.
- **Q4.2** Can a crowned cup be un-crowned? Recommendation: no, like a released round. If a
  commissioner made a mistake, the root admin can fix it in the database; no screen for it.
- **Q4.3** A playoff finale, FedEx style (points reset before the last event)? Recommendation:
  no. It needs a "final event" concept and confuses a points table that is otherwise just a sum.
  A x2 weight on the last contest gives most of the drama.

## 5. API

All under `/leagues/:leagueId/cups`, members and root admin read, the commissioner writes; same
access check as the league's contests. Shapes in `packages/shared/dto/cups.dto.ts`, routes in a
new `cups` module (`rules/service-rules.md` §4 *DTOs, Mappers, OpenAPI*):

| Method and route | Who | Does |
|---|---|---|
| `GET /cups?seasonYear=` | Member | The league's cups for a season (default: the current one), each with its leader and the viewer's squad's place |
| `GET /cups/:cupId` | Member | Standings (`CupStandingRowDto[]`) and the counted contests (`CupContestRowDto[]`) |
| `GET /cups/:cupId/squads/:squadId` | Member | One squad's points contest by contest |
| `POST /cups` | Commissioner | Create a sport, sport league or hand-picked cup |
| `PATCH /cups/:cupId` | Commissioner | Name, points scale, custom points (open cups only) |
| `PUT /cups/:cupId/contests/:contestId` | Commissioner | Include, exclude or weight one contest |
| `POST /cups/:cupId/crown` | Commissioner | Crown the champion (section 4) |
| `DELETE /cups/:cupId` | Commissioner | Delete an open cup that isn't the league cup |
| `GET /cups/past` | Member | Crowned cups across every season, newest first, paged; used by history |

- `CupStandingRowDto`: squad ref (id, current name, icon, `isActive`), `position`,
  `displayPosition`, `points` (number, one decimal), `wins`, `podiums`, `contestsCounted`,
  `movement` (places gained or lost since the last Final contest, see Q6.2), `trophy`.
- `CupContestRowDto`: contest ref, sport, settled date, `weight`, `counts: CupContestCount`
  (`COUNTED`, `NO_RESULT`, `TOO_FEW_ENTRIES`, `NOT_FINAL`, `EXCLUDED`), and the winner.
- Typed errors: `CUP_NOT_FOUND`, `CUP_CROWNED`, `CUP_HAS_UNFINISHED_CONTESTS`,
  `CUP_LEAGUE_CUP_LOCKED` (deleting or rescoping the Poolmaster Cup), `CUP_SCOPE_INVALID`.
- Read cost: one query per page over the league's settled standings for the season, the same
  shape as #837 section 5. If a league ever gets slow, the escape hatch is the same cache keyed
  by its latest `settledAt`.

## 6. Pages

| Page | Route | Content |
|---|---|---|
| Cups | `/league/:code/cups` | This season's cups as cards: name, leader, viewer's place, contests counted of total. A "Start a Golf Cup" suggestion per sport the league plays without a cup |
| Cup | `/league/:code/cups/:cupId` | The leaderboard (place, movement, squad, points, wins, contests), a points-race chart of the top five across the season, and the counted contests with their weights and winners |
| Squad in a cup | sheet from a leaderboard row | That squad's points contest by contest |
| League home | existing | A small Poolmaster Cup card: top three and the viewer's place |
| Team page | existing | Cup trophies won, beside #837's contest trophies |
| History, Cups tab | `/league/:code/history/cups` | Crowned cups by season: champion, podium, link to the frozen table. Built with #837 |

Commissioner tools (slice 3) sit on the cup page behind the commissioner check: points table
with a live preview, include or exclude a contest, weight a contest, crown.

Questions:

- **Q6.1** Where do cups live in the menu? Recommendation: their own **Cups** item between
  Contests and History during the season, with the past cups also on the History page. Cups are
  an in-season feature; hiding them inside History would bury them.
- **Q6.2** Show movement arrows (up 3, down 1) beside each squad? Recommendation: yes, measured
  against the standings before the most recently settled counted contest. It's what makes a
  points race fun to check, and it needs only a second read without that contest.
- **Q6.3** Name the golf cup after a real one? Recommendation: no. "FedEx Cup" is a trademark;
  the defaults are "Golf Cup", "NFL Cup" and so on, which the commissioner can rename.

## 7. Slices

Each slice is one PR with its docs, unit tests of the pure points functions, integration tests
for each new query (`rules/testing-rules.md` §9), contract verification for each endpoint, and a
browser journey row once a page exists. All depend on #837 slice 1 (`seasonYear`, squad delete
guard).

1. **Model and read API.** `Cup`, `CupContestSetting`, `CupStanding` and their enums; migration
   creating each (league, season)'s Poolmaster Cup; automatic league cup on contest create;
   `cup-points.ts` with every scale, ties, weights and the minimum field; `GET /cups` and
   `GET /cups/:cupId` and the squad breakdown. Depends on Q2.1, Q3.1, Q3.3, Q3.4.
2. **Cup pages.** The Cups menu item, Cups page, Cup leaderboard with movement and the
   points-race chart, the squad sheet, the league home card. Depends on Q6.1, Q6.2.
3. **Commissioner cup tools.** Create, edit and delete cups; include, exclude and weight
   contests; points table preview; sport cup suggestions. Depends on Q2.2, Q3.2.
4. **Crowning, trophies and past cups.** `POST .../crown`, frozen `CupStanding`, trophies on
   team pages, `GET /cups/past` and the History Cups tab (with #837 slices 2 and 5), the
   `seasonYear` freeze. Depends on Q4.1, Q4.2.
5. **Projected points.** Points from live contests' current leaderboards, shown greyed as
   "if it ended now". Depends on Q7.1.

Slices 2 and 3 can go in parallel after 1; 4 after 2; 5 after 2.

Questions:

- **Q7.1** Projected points from contests still in play? Recommendation: yes, but last. It is
  the most exciting in-season view ("you'd jump to 2nd if Scheffler holds on") and the live
  leaderboard already computes places, but slices 1 to 4 stand on their own without it.
