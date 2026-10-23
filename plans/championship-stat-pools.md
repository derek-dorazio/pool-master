# Championship stat pools

**Tracking issue:** #932

Written 2026-10-23 for Derek's idea: a pool on a championship series that plays like a golf
tournament. Each game is a round, each player is a participant, and one stat chosen by the
commissioner stands in for strokes, except that more is better. Status: design. The questions in
section 8 carry a recommendation each, and none is answered yet except the ones marked
**Decided**.

---

## TL;DR

- **What it is:** pick players, not teams, for the World Series, the NBA Finals, the Stanley Cup
  Final, or the NFL's conference championships plus the Super Bowl. Each game, each player
  scores one whole number: hits, points, goals, or the sport's named composite. A roster's total
  over the games is its score, highest wins. It is fantasy cut down to one stat.
- **Named composites (Decided):** **Box Score** for baseball, **Triple Threat** for the NBA,
  **Power Play** for hockey, **Redzone** for the NFL.
- **Fit:** golf's shape almost as it is. An event of rounds, a field of individuals, tiered,
  budget and quick pick rosters, per-round scores with a counted total. What is new is a fourth
  scoring family, *stat total*, where higher is better and every stat a player had in each game
  is stored. Plus a kind of sport league whose field is players.
- **The stats come from a feed (Decided).** At launch, a live data provider feeds every
  player's stats in-game, through the ingestion module's provider seam. Until then, box scores
  are loaded after each game with the "Fetch sport sources" and "Load sport data" workflows, so
  the pools can be built and tried first. Both paths write the same stat lines.
- **Scope (Decided):** championship rounds only, and only major sports that fit well.
- **Size:** five slices, the fifth the live provider before launch. The first deadline is the NFL conference championships in late
  January 2027, then the NBA Finals and the Stanley Cup Final in June and the World Series in
  October.

---

## 1. How a stat pool plays

1. Before the series, an admin loads the event: the series' games as its rounds, and every
   eligible player on both teams as its field. Players are ranked by a regular-season stat, so
   tiers and budget prices work as they do for golf (Q4). The admin releases it.
2. A commissioner creates a contest on it. They choose the format as today (Tiered by default,
   Budget, Quick pick), then the **stat**: one of the sport's stats, or its composite. The stat
   is fixed once the contest is released.
3. Members pick their players before the first pitch, tip-off, puck drop or kickoff of Game 1.
   Picks close for the whole event at that point, as they do at a golf tournament's first tee
   time.
4. As each game is played, its stats come in (live from the provider at launch, after the game
   from a loaded box score until then), and each player's line becomes that round's score: Game 1, Game 2 and so on, beside one another as golf's R1 to R4 are. Each entry's
   counted players' totals give the leaderboard.
5. Games that are never played (a sweep) score nothing for anyone. When the series ends and the
   last box score is in, the contest settles and goes Final. Ties are allowed, as everywhere.

The NFL's version (Derek, 2026-10-23) is one event of two rounds: conference championship
weekend (AFC and NFC games together), then the Super Bowl. The field is the four teams' players.
The two teams that lose in round 1 play no round 2, so their players stop scoring, which works
like golf's cut. Picking a player from the AFC and NFC losers is a real risk, and that is what
makes it interesting.

---

## 2. The stats and composites

Every stat is a whole number per game. The composite is a fixed, named formula per sport, not
something the commissioner edits (Q3).

| Sport | Stats offered | Composite | Composite formula (proposed) |
|---|---|---|---|
| Baseball | Hits, Total bases, Home runs, Runs, RBI | **Box Score** | Total bases + Runs + RBI + Walks + Stolen bases |
| Basketball (NBA) | Points (default), Rebounds, Assists, Three-pointers made | **Triple Threat** | Points + Rebounds + Assists |
| Hockey (NHL) | Goals, Assists, Points, Shots on goal | **Power Play** | 2 × Goals + Assists + Shots on goal |
| American football (NFL) | Touchdowns, Receptions, Scrimmage yards, Passing yards | **Redzone** | 6 × Touchdowns + Receptions + Yards ÷ 10, rounded down, per game |

The default stat on each sport's default setup is the composite (Box Score, Power Play,
Redzone), except the NBA, where Derek named Points as the default and the most popular (Q2).

Who is in the field (Q5): baseball's position players, not pitchers; every NBA player on the
roster; NHL skaters, not goalies; the NFL's quarterbacks, running backs, wide receivers and
tight ends.

---

## 3. Where it fits in the existing model

**Reused unchanged:** league, squad, contest, entry, `ContestSportEvent`, contest setup and
release, the Tiered, Budget and Quick pick selection engines (golf's), tiers and pricing from
ranking, counted scores (best N of a roster), `ContestEntryStanding` for the settled result, and
the sport data file loader and its two workflows.

**Reused with one new case:**
- `SportEventRound` and `SportEventParticipantRound`: a game is a round, and a player's game is
  their participant round, exactly as a golfer's round is.
- `ParticipantInactiveReason`: a player whose team is out (the NFL's round 1 losers) is
  eliminated, as a golfer who misses the cut is. An injured player is withdrawn.
- The leaderboard's per-round columns (R1 to R4) read Game 1 to Game 7, or Conference and Super
  Bowl, from the event's round labels.

**New:**
- **Scoring family `STAT_TOTAL`**, beside stroke play, finish position and head to head, with one
  scoring definition, `STAT_TOTAL`. Its contest settings name the stat:
  `{ stat: BaseballStat.HITS }` or `{ stat: BaseballStat.BOX_SCORE }`. Its direction is
  `HIGHER_IS_BETTER`, and an unplayed round scores 0.
- **`SportEventParticipantStatLine`** (new table), an extension of `SportEventParticipantRound`
  the way `SportEventParticipantGolfRound` is. It holds one row per player, per game, per stat,
  with a typed stat key (a Postgres enum per the decided rule that status columns are enums) and
  an integer value. Storing every stat, not only the contest's, lets two contests on one event
  score different stats, and lets a commissioner's choice be any stat without reloading.
  Composites are computed from the stored stats, never stored.
- **Stat keys per sport** in the sport definition: `statLine: { stats, composite }`. Each sport's
  stats are one typed enum. The composite's name and formula live there too, so the copy and the
  scoring read one place.
- **A player-stats kind of sport league.** Baseball, basketball, hockey and American football are
  team sports, whose fields are teams. Rather than change that, each gets one more sport league
  whose field is players and whose scoring family is stat total: "World Series players", "NBA
  Finals players", "Stanley Cup Final players", "NFL Championship players". `SportLeague` gains
  `participantType` and `scoringFamily` overrides, null meaning the sport's (Q7). Players are new
  `Participant` rows with `role` (position) and `teamAffiliation` (their team), which the table
  already has.
- **Contest templates** per new league: one default per format (Tiered, Budget, Quick pick), each
  scored on the league's default stat. The stat is a setting on Create contest, so no template
  per stat is needed.

---

## 4. Data: fields and box scores

**At launch (Decided):** a live data provider feeds the stats. It plugs into the ingestion
module as golf's live scores do. The provider seam (`ingestion/core/provider-interface.ts`)
gains a stat-line live-score category, and the stat total family registers a `LiveScoreWriter`
for it that writes `SportEventParticipantStatLine` rows while the game is played. Choosing the
provider is its own ticket (Q10).

**Until then, for testing (Decided):** the same rows are written by the sport data file loader,
through the admin API per `rules/architecture-rules.md` §6, from pages fetched by the "Fetch
sport sources" workflow and cross-checked against two sources per the `load-sport-data` skill.
Scoring reads the rows and never knows which path wrote them, so nothing built for testing is
thrown away at launch.

- **The field** (one load when both teams are known): rosters from the league's API (MLB Stats
  API rosters, ESPN team rosters, NHL's roster API), with each player's regular-season stat for
  ranking. The file uses today's `PLAYERS` and `FIELDS` contents.
- **Box scores** (interim, one load per game): a new `STATS` content, each match's player lines.
  Sources: MLB Stats API `game/<pk>/boxscore` against the ESPN game summary; ESPN against
  NBA.com for basketball; NHL's `api-web.nhle.com` gamecenter boxscore against ESPN; ESPN against
  the NFL's game book for football. A stat the two sources disagree on is left out and listed,
  as always, and the admin enters it.
- **Corrections:** an admin corrects a stat on the event's results page, and the contest
  rescores, as golf's score corrections do (an admin enters every value).
- **Test data:** every new sport league needs its last-season test data file
  (`rules/architecture-rules.md` §6). Those are the 2025 World Series, the 2025 NBA Finals, the
  2025 Stanley Cup Final and the 2026 NFL conference championships plus Super Bowl LX, as played,
  with real box scores. They are also how the pools get tried before a real series.

---

## 5. Screens

- **Create contest:** a **Stat** picker under the format, listing the sport's stats with the
  composite first and its formula under it ("Box Score: total bases + runs + RBI + walks + stolen
  bases").
- **Entry page:** golf's player picker, with each player's team and position, and their season
  stat for the contest's stat beside their tier.
- **Leaderboard:** golf's, with Game 1 to Game 7 columns, a scored-on-stat line under the contest
  name, and a dash for a game not yet played.
- **Admin results:** a per-game stat grid on the event's results page for checking and
  correcting loaded lines.
- **How to Play and Contest types:** a stat pools paragraph, and each sport's blurb in
  `sport-blurbs.ts` names its championship stat pool.

---

## 6. Slices

1. **Model and scoring.** `STAT_TOTAL` family and definition, stat enums and composites in the
   sport definitions, `SportEventParticipantStatLine`, the sport league overrides, the four new
   sport leagues, and templates. Unit tests for every composite formula and integration tests
   for rescoring.
2. **Loader and admin.** `STATS` content in the data file and loader, the admin stat grid, and
   the four test data files with real box scores.
3. **Contest screens.** The Stat picker, the entry page's stat column, leaderboard game columns,
   and copy (How to Play, blurbs).
4. **First real load.** The 2027 NFL conference championship field and box scores through the
   workflows, with a `docs/SPORT-DATA-SOURCES.md` row per sport.
5. **Live provider (before launch).** The provider's adapter, the stat-line live-score category
   and the family's writer, after Q10 picks the provider.

Each slice is a normal PR. Slices 1 and 2 can go in parallel once slice 1's schema is merged.

---

## 7. Out of scope

- Earlier playoff rounds: championship series only (Decided).
- Pitchers, goalies, defensive players and kickers (Q5).
- Commissioner-built composites with their own weights (Q3).
- The WNBA Finals, the PWHL Final and college championships (Q8).

---

## 8. Questions

Each has a recommendation. The ones Derek has already answered are marked **Decided**.

- **Q0. Composite names. Decided:** Box Score (baseball), Triple Threat (NBA), Power Play
  (hockey), Redzone (NFL).
- **Q1. The NFL composite's name. Decided:** Redzone.
- **Q2. Default stat. Decided:** the composite for baseball, hockey and the NFL; Points for the
  NBA.
- **Q3. Fixed composite or editable weights?** *Recommend fixed, one per sport. Editable weights
  turn this back into fantasy, and the names stop meaning one thing.*
- **Q4. What ranks the field for tiers and prices?** *Recommend the regular-season total of the
  sport's composite, loaded with the field and editable by the admin. Odds are never loaded.*
- **Q5. Who is in the field?** *Recommend position players, all NBA players, skaters, and
  QB/RB/WR/TE, as in section 2. Pitchers and goalies need their own stats and could be a later
  stat set.*
- **Q6. When do scores update? Decided:** live from a data provider at launch. Until then, after
  each game, through the workflows. *Recommend that a thread prepares each game's box score file
  and Derek says "Load" once per game, which keeps the rule that a load runs only on his go.*
- **Q7. Player leagues as sport leagues, or a new sport?** *Recommend a sport league with
  participant-type and scoring-family overrides. A new sport ("Baseball players") would split
  baseball's pages and copy in two.*
- **Q8. Which leagues?** Derek said only major sports that fit well. *Recommend MLB, NBA, NHL and
  NFL now. The WNBA Finals fit just as well (points, rebounds, assists) and could be a fifth
  league, kept separate from the NBA as men's and women's always are. Want it?*
- **Q9. Roster size and counted players.** *Recommend Tiered: one player from each of six tiers,
  best four count. Budget: six players under the cap, best four count. Quick pick: three players
  each.* All are editable by the commissioner, as today.
- **Q10. Which live data provider?** *Recommend its own research ticket before slice 5:
  Sportradar, SportsDataIO and Stats Perform all cover the four leagues' player stats live.
  Compare price, licence terms for a pool site, and push versus polling, then pick one for
  every sport, golf included.*
