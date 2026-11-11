# BALLDONTLIE fixtures

What the BALLDONTLIE adapter's tests read, and the vendor document they are held to. The
adapter was built before any account existed, so everything here comes from the vendor's
published OpenAPI document, not from recorded traffic.

- `openapi/pga.yml`, `openapi/nfl.yml` and `openapi/ncaab.yml` are the vendor's PGA TOUR, NFL
  and NCAA men's basketball documents, each vendored unchanged below a three-line header that
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
  (`ncaab-contract.test.ts`). The document marks a bracket side nullable as
  `allOf: [{ $ref }, { nullable: true }]`, which the test support reads as that `$ref` or null.

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
- NCAAB: a decided bracket side's `full_name` is the name the teams list gives ("Duke Blue
  Devils"), which is what the site's teams loaded from data files are called, so the first
  import links them rather than adding new ones.

When an account exists, replace or add fixtures with recorded responses and keep the
doc-example files: the pair shows where the vendor's document and its API disagree.
