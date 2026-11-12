# BALLDONTLIE fixtures

What the BALLDONTLIE adapter's tests read, and the vendor document they are held to. The
adapter was built before any account existed, so everything here comes from the vendor's
published OpenAPI document, not from recorded traffic.

- `openapi/pga.yml`, `openapi/nfl.yml`, `openapi/ncaab.yml`, `openapi/ncaaw.yml`,
  `openapi/nba.yml`, `openapi/wnba.yml`, `openapi/epl.yml` and `openapi/fifa.yml` are the vendor's PGA TOUR, NFL,
  NCAA men's and women's basketball, NBA, WNBA, Premier League and FIFA World Cup documents, each vendored unchanged below a three-line header that
  names its source, date and hash. `npm run balldontlie:contract-check` says when the live
  document differs; `-- --update-spec` refreshes the copy, and the contract tests then
  show whether anything the adapter reads moved.
- `pga/doc-example-*.json` are the document's own response examples, verbatim. A contract test
  fails if the document's example changes and the fixture does not.
- The other `pga/*.json` files are written to the document's schemas to cover what the examples
  do not: a stroke-play tournament in progress (41), a final one (40), a scheduled one (42), one
  whose state the vendor calls `unknown` (43), a team-format one (44), their fields, the players'
  world rankings, and results with a cut, a withdrawal, a back-nine start and a finished round.
  Every one must fit the document's response schema (`pga-contract.test.ts`).
- `nfl/*.json` are written to the NFL document's schemas, which give no response examples for
  games or teams: a 2026 regular season week with a final, a live, a scheduled and an `unknown`
  game; the complete 2025 postseason; the 2026 postseason part way through; and the teams in
  them. Every one must fit the document (`nfl-contract.test.ts`).
- `ncaab/*.json` are written to the NCAAB document's schemas, which give no response examples:
  the 2025 season's tournament as a few final games (a First Four game, two round of 64 games
  and the championship); the 2026 season's part way through, with a final, a live, a scheduled
  and an `unknown` game, a second round game with one side to be decided, and an undated
  championship with neither; and three teams. Every one must fit the document
  (`ncaa-tournament-contract.test.ts`). The document marks a bracket side nullable as
  `allOf: [{ $ref }, { nullable: true }]`, which the test support reads as that `$ref` or null.
- `ncaaw/*.json` are written to the NCAAW document's schemas the same way: the 2025 season's
  women's tournament as a round 0 First Four game, two round 1 games and the round 6
  championship, all final, and two teams. Duke's men's and women's teams share the vendor id 150
  and the name, as a school's teams do, which the adapter keeps apart by league.
- `nba/*.json` are written to the NBA document's schemas, which give no response examples:
  the 2024 season's playoffs as only their last series, the 2025 Finals (Oklahoma City over
  Indiana in seven, the real scores), so they read as complete; the 2025 season's first round
  under way, made up for the tests, with two finals, a live game and a scheduled one with no
  tip-off time; and eight teams. Every one must fit the document (`nba-contract.test.ts`).
- `wnba/*.json` are written to the WNBA document's schemas, which give no response examples:
  the 2025 season's playoffs as all seven series of that year's bracket, eight teams to Finals
  Las Vegas won four games to none, each series' games in a made-up order and score, with two
  regular season games the reader must leave out; the 2026 playoffs just begun, with a final, a
  live, a scheduled and an `unknown` game and a regular season game; and nine teams and a folded
  franchise in no conference. Every one
  must fit the document (`wnba-contract.test.ts`).

- `epl/*.json` are written to the EPL document's schemas, which give no response examples: the
  2026 season's matchweek 11 with two finals (one a draw), a live, a scheduled and a postponed
  match, matchweek 12 with a scheduled and an `unknown` match, a match with no round number, and
  the ten teams playing them. Every one must fit the document (`epl-contract.test.ts`).
- `fifa/*.json` are written to the FIFA document's schemas, which give no response examples: the
  2022 edition as a group match, two round of 16 matches (Japan and Croatia level, settled by a
  shoot-out), the third place play-off and the final (3-3, Argentina on penalties); the 2026
  edition part way through its round of 16, with a shoot-out final, a live, a scheduled and an
  `unknown` match and a quarter-final with one side to be decided; and four nations. Every one
  must fit the document (`fifa-world-cup-contract.test.ts`).

## Assumptions to confirm against the real API

The first things to check once a key exists, each read by `npm run balldontlie:contract-check`:

- A result's `position` is a place (`1`, `T4`), or marks a golfer out with `CUT`, `WD` or
  `DQ` (the first two are documented on the v1 results; `DQ` is assumed). Any other spelling,
  such as `MDF`, `W/D` or `DNS`, fails the scores sync rather than being read as still
  playing; add it to the mapping once seen.
- `thru` is `F`, a hole count, or a hole count with `*` for a back-nine start.
- A full field comes back across pages. The client stops at a page shorter than `per_page`,
  as the document's example does, so an endpoint that caps `per_page` below 100 would end a
  field after its first page with no error. `--tournament <id>` prints the field size: check
  it against the tournament's real field by eye.
- `format_type` is served only when `include_format=true` is sent, which every tournament read
  does (the fake drops it otherwise).
- NFL: `season_types[]=3` returns the 13 playoff games and nothing else (no Pro Bowl), since a
  postseason is called complete only once it has 13 games done. `--game-event nfl-2025-postseason`
  prints the count.
- NFL: a game's `id`, `season`, `week`, `postseason`, `date` and both teams' `id` and
  `full_name` are always sent, though the document requires none of them; a game missing one
  fails the sync with the field named. A score is sent once a game starts; before kickoff the
  adapter ignores any.

- NCAAB: `/ncaab/v1/bracket?season=<s>` lists the whole tournament, every round, from Selection
  Sunday on, with later rounds' sides null until they are decided. A tournament is called
  complete once its championship (round 7) is listed and every listed game is done.
  `--game-event ncaab-2025-tournament` prints the game count: a full tournament has 67.
- NCAAB: `/ncaab/v1/teams` returns every Division I team (about 360) in one response, as the
  document shows it with no paging. A cut-off list fails no check here, so count the teams
  `npm run balldontlie:contract-check` prints against the real number.
- NCAAW: `/ncaaw/v1/bracket` works as the men's does, but numbers the First Four round 0 and the
  championship round 6 (the document's own description). `--game-event ncaaw-2025-tournament`
  prints the game count: a full tournament has 67.
- NCAAW: `/ncaaw/v1/teams` returns every Division I women's team in one response, as the men's
  does.
- NCAAB: a decided bracket side's `full_name` is the name the teams list gives ("Duke Blue
  Devils"), which is what the site's teams loaded from data files are called, so the first
  import links them rather than adding new ones. The women's teams carry the same names, so a
  team links only to the site's team affiliated with its own league (NCAA Division I Men or
  Women, by match keyword).

- NBA: `season_type=playoffs` returns every playoff game of the season and no play-in game (the
  document lists `playin` as its own type), since playoffs are called complete only once the
  games pair one team fewer than they hold and a side has won four of the last series.
  `--game-event nba-2025-postseason` prints the game count: a full playoffs has 15 series of 4
  to 7 games.
- NBA: `season` is the year a season starts (2025 for 2025-26, whose playoffs run in 2026), and
  `datetime` is a game's tip-off, null until the league sets it; the adapter then takes `date`.
- NBA: `/nba/v1/teams` may list defunct franchises (ids above 30) with a blank `conference` and
  `division`, which the document's enums do not allow. The adapter reads both as any string and
  keeps only East and West teams, so either way passes; count the teams the check prints (30).
- NBA: the playoffs need no paid tier, but basketball's lists read the NCAA brackets in the same
  call, which need GOAT; on a lower plan that read fails and the NBA playoffs are not listed
  either. Confirm the plan in use reads both.
- NBA: a game's `id`, `season`, `date` and both teams' `id` and `full_name` are always sent,
  though the document requires none of them; a game missing one fails the sync with the field
  named. A team's `full_name` is the name the site's NBA teams are loaded under ("Oklahoma City
  Thunder").
- WNBA: `/wnba/v1/games` documents no `postseason` filter and no values for `season_type`, so a
  season's games are all read (about three pages) and the playoffs picked out by `postseason`,
  which every game is assumed to send; a game without it fails the sync. If `season_type`
  turns out to take a playoffs value, read with it instead and save the pages.
  `--game-event wnba-2025-postseason` prints the game count: a full playoffs has 7 series.
- WNBA: a game's `id`, `season`, `date` and both teams' `id` and `full_name` are always sent,
  as the NBA's are. A team's `full_name` is the name the site's WNBA teams are loaded under
  ("Las Vegas Aces"). `/wnba/v1/teams` may keep folded franchises (the Houston Comets, say); the
  adapter keeps only teams with a conference. Count the teams the contract check prints: 15.

- EPL: a match's `round_number` is its matchweek (1 to 38). The document does not say so; the
  adapter groups a season's matches into matchweek events by it, and leaves out a match with
  none. `--game-event epl-2026-matchweek-11` prints the match count: a full matchweek has 10.
- EPL: `season` is the year a season starts (2026 for 2026-27), as the NCAA documents number
  theirs.
- EPL: a team's `name` is the name the site's Premier League teams are loaded under
  ("Manchester City", "Brighton & Hove Albion"), so the first import links them rather than
  adding new ones. A team the vendor names otherwise is added beside the site's: rename one of
  them once seen.
- FIFA: a group stage match has a `group` and a knockout match has none; the event is the
  matches with none. The matches list holds every knockout match from the start, a side null
  until decided, so the bracket is called complete once every listed match is done.
  `--game-event fifa-wc-2026-knockout` prints the match count: 2026's knockout has 32 with the
  third place play-off.
- FIFA: `home_score` is the score after extra time, and `home_score_penalties` the shoot-out's,
  set only when a shoot-out was taken.
- FIFA: a nation's `name` is the name the site's World Cup teams are loaded under ("United
  States", "Netherlands"); one the vendor names otherwise is added beside the site's.

When an account exists, replace or add fixtures with recorded responses and keep the
doc-example files: the pair shows where the vendor's document and its API disagree.
