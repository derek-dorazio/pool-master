# Championship stat pools

**Tracking issue:** #932

Written 2026-10-23 for Derek's idea: a pool on a championship series that plays like a golf
tournament. Each game is a round, each player is a participant, and the sport's one named
composite score stands in for strokes, except that more is better. Status: design. The
questions in section 8 carry a recommendation each. The ones Derek has answered are marked
**Decided**.

---

## TL;DR

- **What it is:** pick players, not teams, for the World Series, the NBA Finals, the Stanley Cup
  Final, or the NFL's Conference Championship weekend and the Super Bowl (two events). Each
  game, each player scores one whole number, the sport's named composite. A roster's total over
  the games is its score, highest wins. It is fantasy cut down to one score.
- **One composite per sport, no configuration (Decided):** **Box Score** for baseball, **Triple
  Threat** for the NBA, **Power Play** for hockey, **Redzone** for the NFL. A commissioner picks
  the format and roster size as for golf, but not the stat. Every stat pool in a sport scores
  the same way.
- **Fit:** golf's shape almost as it is. An event of rounds, a field of individuals, tiered,
  budget and quick pick rosters, and per-round scores with a counted total. What is new is a
  fourth scoring family, *composite*, where higher is better, plus a kind of sport league whose
  field is players.
- **The stats come from a feed (Decided).** At launch, a live data provider feeds every
  player's stats in-game, through the ingestion module's provider seam. Until then, box scores
  are loaded after each game with the "Fetch sport sources" and "Load sport data" workflows, so
  the pools can be built and tried first. Both paths write the same stat lines.
- **Scope (Decided):** championship rounds only, for MLB, the NBA, the NHL and the NFL.
- **Size:** five slices, the fifth the live provider before launch. The first deadline is the
  NFL's Conference Championship weekend in late January 2027, then the NBA Finals and the
  Stanley Cup Final in June and the World Series in October.

---

## 1. How a stat pool plays

1. Before the series, an admin loads the event: the series' games as its rounds, and every
   eligible player on both teams as its field. Players are ranked by their regular-season
   composite, so tiers and budget prices work as they do for golf (Q4). The admin releases it.
2. A commissioner creates a contest on it, choosing the format as today: Tiered by default,
   Budget, or Quick pick. The setup says how it scores ("Box Score: total bases + runs + RBI +
   walks + stolen bases"). There is no stat to choose.
3. Members pick their players before the first pitch, tip-off, puck drop or kickoff of Game 1.
   Picks close for the whole event at that point, as they do at a golf tournament's first tee
   time.
4. As each game is played, its stats come in: live from the provider at launch, and from a
   box score loaded after the game until then. Each player's composite for the game becomes
   that round's score, shown as Game 1, Game 2 and so on beside one another, as golf's R1 to R4
   are. Each entry's counted players' totals give the leaderboard.
5. Games that are never played (a sweep) score nothing for anyone. When the series ends and the
   last box score is in, the contest settles and goes Final. Ties are allowed, as everywhere.

The NFL's version (Decided, Derek 2026-10-23) is two events of one round each, a week apiece.
**Conference Championship weekend** has the AFC and NFC title games together: its field is the
four teams' players, and its one round is both games. The **Super Bowl** is its own event, with
the two teams' players as its field. A commissioner runs a pool on either one, or one contest
over both, since a contest can already cover several events (#713). Each team plays once an
event, so a player's round is simply their game.

---

## 2. The composites

Each composite is a fixed formula of whole-number stats, so it is a whole number per game.
Nobody edits it (Q3, Decided).

| Sport | Composite | Formula (proposed, Q11) |
|---|---|---|
| Baseball | **Box Score** | Total bases + Runs + RBI + Walks + Stolen bases |
| Basketball (NBA) | **Triple Threat** | Points + Rebounds + Assists |
| Hockey (NHL) | **Power Play** | 2 × Goals + Assists + Shots on goal |
| American football (NFL) | **Redzone** | 6 × Touchdowns + Receptions + Scrimmage and passing yards ÷ 10, rounded down, per game |

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
- `ParticipantInactiveReason`: an injured or scratched player is withdrawn, as a golfer is.
- The leaderboard's per-round columns (R1 to R4) read Game 1 to Game 7 from the event's round
  labels. An NFL event has one round, so it shows the single game's score.

**New:**
- **Scoring family `COMPOSITE`**, beside stroke play, finish position and head to head. It has
  one scoring definition, `COMPOSITE_TOTAL`, with no settings: the sport fixes the formula.
  Its direction is `HIGHER_IS_BETTER`, and an unplayed round scores 0.
- **`SportEventParticipantStatLine`** (new table), an extension of `SportEventParticipantRound`
  the way `SportEventParticipantGolfRound` is. It holds one row per player, per game, per
  component stat, with a typed stat key (a Postgres enum, per the decided rule that status
  columns are enums) and an integer value. The composite is computed from the components and
  never stored. Storing the components lets the leaderboard show how a score was made
  ("2 TB, 1 R, 1 RBI"), lets an admin correct one stat rather than a total, and is what both
  the feed and a box score give.
- **The composite per sport** in the sport definition: `composite: { name, stats, score(line) }`.
  Each sport's component stats are one typed enum. The name, the formula and its description
  live there together, so the copy and the scoring read one place.
- **A player-stats kind of sport league.** Baseball, basketball, hockey and American football are
  team sports, whose fields are teams. Rather than change that, each gets one more sport league
  whose field is players and whose scoring family is composite: "World Series players", "NBA
  Finals players", "Stanley Cup Final players" and "NFL Championship players". `SportLeague`
  gains `participantType` and `scoringFamily` overrides, null meaning the sport's (Q7). Players
  are new `Participant` rows with `role` (position) and `teamAffiliation` (their team), which
  the table already has.
- **Contest templates** per new league: one default per format (Tiered, Budget, Quick pick),
  each scored on the league's composite.

---

## 4. Data: fields and box scores

**At launch (Decided):** a live data provider feeds the stats. It plugs into the ingestion
module as golf's live scores do. The provider seam (`ingestion/core/provider-interface.ts`)
gains a stat-line live-score category, and the composite family registers a `LiveScoreWriter`
for it that writes `SportEventParticipantStatLine` rows while the game is played. Choosing the
provider is its own ticket (Q10).

**Until then, for testing (Decided):** the same rows are written by the sport data file loader,
through the admin API per `rules/architecture-rules.md` §6, from pages fetched by the "Fetch
sport sources" workflow and cross-checked against two sources per the `load-sport-data` skill.
Scoring reads the rows and never knows which path wrote them, so nothing built for testing is
thrown away at launch.

- **The field** (one load when both teams are known): rosters from the league's API (MLB Stats
  API rosters, ESPN team rosters, NHL's roster API), with each player's regular-season composite
  for ranking. The file uses today's `PLAYERS` and `FIELDS` contents.
- **Box scores** (interim, one load per game): a new `STATS` content, each game's player lines
  of component stats. Sources: MLB Stats API `game/<pk>/boxscore` against the ESPN game summary;
  ESPN against NBA.com for basketball; NHL's `api-web.nhle.com` gamecenter boxscore against
  ESPN; ESPN against the NFL's game book for football. A stat the two sources disagree on is
  left out and listed, as always, and the admin enters it.
- **Corrections:** an admin corrects a stat on the event's results page, and the contest
  rescores, as golf's score corrections do (an admin enters every value).
- **Test data:** every new sport league needs its last-season test data file
  (`rules/architecture-rules.md` §6). Those are the 2025 World Series, the 2025 NBA Finals, the
  2025 Stanley Cup Final, and the 2026 NFL Conference Championship weekend and Super Bowl LX
  (two events), as played, with real box scores. They are also how the pools get tried before a
  real series.

---

## 5. Screens

- **Create contest:** golf's format cards, with the composite's name and formula shown on the
  setup. There is no stat picker.
- **Entry page:** golf's player picker, with each player's team, position and regular-season
  composite beside their tier.
- **Leaderboard:** golf's, with Game 1 to Game 7 columns and a dash for a game not yet played.
  A player's row opens to their component stats for each game.
- **Admin results:** a per-game stat grid on the event's results page for checking and
  correcting loaded lines.
- **How to Play and Contest types:** a stat pools paragraph naming each sport's composite and
  formula, and each sport's blurb in `sport-blurbs.ts` names its championship stat pool.

---

## 6. Slices

1. **Model and scoring.** The `COMPOSITE` family and definition, the composites and stat enums
   in the sport definitions, `SportEventParticipantStatLine`, the sport league overrides, the
   four new sport leagues, and templates. Unit tests for every composite formula, and
   integration tests for rescoring.
2. **Loader and admin.** `STATS` content in the data file and loader, the admin stat grid, and
   the four test data files (five events) with real box scores.
3. **Contest screens.** The formula on Create contest, the entry page's composite column,
   leaderboard game columns with the component breakdown, and copy (How to Play, blurbs).
4. **First real load.** The 2027 NFL Conference Championship weekend and Super Bowl LXI fields
   and box scores through the workflows, with a `docs/SPORT-DATA-SOURCES.md` row per sport.
5. **Live provider (before launch).** The provider's adapter, the stat-line live-score category
   and the family's writer, after Q10 picks the provider.

Each slice is a normal PR. Slice 2 starts once slice 1's schema is merged, and slice 3 can run
beside slice 2.

---

## 7. Out of scope

- Earlier playoff rounds: championship series only (Decided).
- A commissioner's choice of stat, or their own weights (Decided: one composite per sport).
- Pitchers, goalies, defensive players and kickers (Q5).
- The WNBA Finals, the PWHL Final and college championships (Decided).

---

## 8. Questions

Each has a recommendation. The ones Derek has already answered are marked **Decided**.

- **Q0. Composite names. Decided:** Box Score (baseball), Triple Threat (NBA), Power Play
  (hockey), Redzone (NFL).
- **Q1. The NFL composite's name. Decided:** Redzone.
- **Q2. Default stat. Decided, then superseded by Q3:** there is no stat to choose. Every pool
  scores its sport's composite.
- **Q3. Configurable stat? Decided:** no. The composite only, with no configuration (Derek:
  "It's different").
- **Q4. What ranks the field for tiers and prices?** *Recommend the regular-season total of the
  sport's composite, loaded with the field and editable by the admin. Odds are never loaded.*
- **Q5. Who is in the field?** *Recommend position players, all NBA players, skaters, and
  QB/RB/WR/TE, as in section 2. Pitchers and goalies need their own formulas and could come
  later.*
- **Q6. When do scores update? Decided:** live from a data provider at launch. Until then, after
  each game, through the workflows. *Recommend that a thread prepares each game's box score file
  and Derek says "Load" once per game, which keeps the rule that a load runs only on his go.*
- **Q7. Player leagues as sport leagues, or a new sport?** *Recommend a sport league with
  participant-type and scoring-family overrides. A new sport ("Baseball players") would split
  baseball's pages and copy in two.*
- **Q8. Which leagues? Decided:** MLB, NBA, NHL and NFL. No WNBA.
- **Q9. Roster size and counted players.** *Recommend Tiered: one player from each of six tiers,
  best four count. Budget: six players under the cap, best four count. Quick pick: three players
  each.* All are editable by the commissioner, as today.
- **Q10. Which live data provider?** *Recommend its own research ticket before slice 5:
  Sportradar, SportsDataIO and Stats Perform all cover the four leagues' player stats live.
  Compare price, licence terms for a pool site, and push versus polling, then pick one for
  every sport, golf included.*
- **Q11. The formulas.** Now that each sport has one score, its formula matters more. *Recommend
  the table in section 2. Box Score rewards getting on base and producing runs. Triple Threat is
  the betting world's familiar points + rebounds + assists. Power Play weights a goal double an
  assist, with shots so a quiet game still scores. Redzone is close to standard fantasy points,
  kept to whole numbers.*
