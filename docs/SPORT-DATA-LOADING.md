# Loading test data

How test data gets onto a QA or local site: test sport leagues, players, "Test-" events and
fields, brackets and results, for trying contests by hand. Real events, fields and results never
come from a file: every enabled sport league is synced from its provider
([`LIVE-SPORTS-DATA-SYNC.md`](LIVE-SPORTS-DATA-SYNC.md)), and a league with no sync stays off
(#1850). Setting an event up and running it by hand, from release to results, is
[`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md) (and, for races,
[`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md)). Where a test data file's last-season
facts come from is [`SPORT-DATA-SOURCES.md`](SPORT-DATA-SOURCES.md).

## Loading test data

Every file in `packages/core-api/scripts/seed-golf/` is test data: last season as played, with
made-up odds, loaded a few re-dated "Test-" events at a time. It goes in through the same admin
API as the Manage screens, and no migration, deploy or reset loads it. Every run reads the
site's environment from `/version` first and refuses anything but QA or a local or test site.

- **QA:** *Actions → Load test data → Run workflow*, choosing the branch that has the file,
  the `file` (a path inside `packages/core-api/scripts/seed-golf/`, default
  `golf-2026.json`) or `all_test_data`, and the `mode`. It signs in as the E2E root admin.
- **Locally:** with the API running, `POOLMASTER_SEED_BASE_URL=http://localhost:3000
  POOLMASTER_SEED_ADMIN_IDENTIFIER=<root admin> POOLMASTER_SEED_ADMIN_PASSWORD=<password>
  npm run seed:golf -- --file golf-2026.json --mode apply`.

**Rebuilding QA.** Reset the database, turn on each synced league's sync and let it run, then
run *Load test data*. The sync puts the real events and fields on first, creating each feed
participant it does not know; the load then finds those participants by their feed ids rather
than creating a second (*Feed ids* below). Reset QA only on the owner's word.

**Dry run first.** `dry-run` (the default) reads the site and lists, per sport league,
player, event, field and bracket, what applying would add, update, skip, or leave as a conflict. It
writes nothing. The workflow's summary shows the list with the file's scope and sources.
`apply` writes it.

**What a run changes.** It compares the file with the site and fills in the difference:

- A missing sport league, player, event or field entry is added. A player new to the
  league joins at the file's ranking; one already on it keeps the ranking it has.
- A draft test event's field, odds, tiers, prices and stored scores are filled in; a run that
  stopped part-way is finished by the next.
- An event that has started, finished, or was cancelled or postponed is never changed, beyond
  the results of games played since (*Results go in as the games are played* below); a
  difference there is listed as a conflict for an admin to look at.
- A file only changes what its envelope's `contents` names.

Running the same file again lists everything as a skip.

**Feed ids.** A test player may carry `feedIds`, the provider's id for that team or player keyed
by provider (`"feedIds": { "balldontlie": "nfl-team-18" }`), in the form the provider's sync
stores them ([`LIVE-SPORTS-DATA-SYNC.md`](LIVE-SPORTS-DATA-SYNC.md) *Participants*). The run
reads each named provider's feed ids for the player's sport league once
(`GET /api/v1/participants/provider-mappings?sportLeagueId=…`) and takes the participant a player's feed id is
mapped to before any match by key or name, so the sync's participant is the test player too,
whatever the file calls them. A feed id no participant holds yet is bound to the player's
participant (`PUT /api/v1/participants/{id}/provider-mappings`), so a later sync fields that row
instead of creating a duplicate; the report lists each as "feed id … bound". A file that gives
one feed id to two players of one league is refused. A feed id names one participant per sport
league (#1853): a Clutch Card league's players carry their season league's feed ids, and each is
its own row, created in that league. Feed ids go on participants only, never on a "Test-"
event: a real game id would let the live score poll write real results onto it. They are added
as each provider serves them, league by league; a player with none is matched by key, then
name, as before.

**Brackets.** A file of a sport played as a bracket, with `BRACKET` in its `contents`, may
give each event its `matches`: each match's number, round, its two sides as player keys from
the event's field (`null` where an earlier match's winner fills the side), whether it is on a
neutral site, its `scheduledAt`, and `advancesTo` (the match and side its winner
moves on to; `null` for the final), and its `regionLabel` (the March Madness region or NFL
conference) where it has one. A league that reseeds gives `bracketAdvancement`
`RESEED_BY_SEED`, and its first-round games `advancesTo: null`; the run sets the rule on the
sport league, new or existing. A field entry may give its bracket `seed` (1-16 in each
March Madness region) where the seed is not its place in the field, and `isPlayInPlace` for a
First Four pairing. The run refuses a bracket the bracket endpoint would refuse, before any
write.

**Box scores.** A file of a championship stat pool, with `STATS` in its `contents`, loads a
sport league of players scored by the composite family (the League Championship Series, World
Series, NBA Conference Finals, NBA Finals, NHL Conference Finals, Stanley Cup Final, NFL
Championship Weekend, Super Bowl, CFP Semifinals, CFP National Championship, Men's Final Four,
Men's Basketball National Championship, Men's Frozen Four, Men's Hockey National Championship, Champions League Semifinals,
Champions League Final, Women's World Cup Semifinals, Women's World Cup Final, WNBA Semifinals and WNBA Finals
leagues the migrations create). Its players
may give their `team` and `position`, and each event may give its `games`: each game's number
and its box score, one `lines` row per field player who played, with that player's count of each
stat the sport's composite counts (`TOTAL_BASES`, `RUNS`, `RUNS_BATTED_IN`, `WALKS` and
`STOLEN_BASES` for baseball's Box Score; `POINTS`, `REBOUNDS`, `ASSISTS` for basketball's Triple
Threat; `GOALS`, `ASSISTS`, `SHOTS_ON_GOAL` for hockey's Power Play; `GOALS`, `ASSISTS`, `SHOTS_ON_TARGET` for
soccer's Hat Trick; touchdowns, receptions and
yards for football's Redzone). A stat left out counts 0. The run refuses a game beyond the
event's games, a player off the field, a stat the composite does not count, and a `STATS` file
for a league that is not a stat pool on the site. Each player's line for a game replaces the
stored one, and a stored line for a player the game leaves out is cleared.

Each test Clutch Card event names its parent itself (#1820): the latest test season event of its
season league ("Test- MLB Postseason" for the World Series). With none on the site yet, the run
lists the Clutch Card event as a conflict and leaves it out. Loading every test file loads the
box score files last, after the season leagues'.

**Released as it loads.** Each league's first new test event is released; the ones after it
are set up whole and left drafts (*A few "Test-" events at a time* below). When no active
player has a tier yet, the event's tiers are assigned by the field's ranking; when none has a
price, it gets the default prices. An event the site still refuses to release stays a draft,
and the report lists it as a conflict with the site's reason; the next run tries again. Any
other failure (a lost sign-in) stops the run. Every test event is created with automatic
lifecycle off: the run moves it to In Progress and Completed itself.

**Any sport.** A file may be any sport in the registry: rounds are the sport's count
(1 for a race), and par is golf's alone (`null` for every other sport). An event may give
`startsAt`, its exact start with a UTC offset (a race's post time); without it an event starts
at noon UTC on its start date. Every loaded event ends at noon UTC the day after its end date.
A test seed carries the results its sport is scored on: golf's made-up stroke rounds, a
bracket's match results (entered as each game is played; *Results go in as the games are
played* below), a race's real finishing order (each runner's `raceResult`, entered just before
release as the official result; *Seeded 2026 races* below), or a stat pool's real box scores
(*Seeded championship stat pools* below). Any sport may also have a test slate.

**The file says what it is.** Each file starts with an envelope: `schemaVersion`, a `scope`
(sport from the sport registry, season, sport leagues, and `contents` from `SCHEDULE`,
`PLAYERS`, `FIELDS`, `BRACKET`, `STATS`, `RESULTS`), `testData: true` and its `provenance`. A
test seed's `contents` hold at least `SCHEDULE`, `PLAYERS`, `FIELDS` and `RESULTS`; a test slate's
just `PLAYERS` and `FIELDS`. A run refuses the whole file before writing if anything strays
outside the scope: an event outside the season, a league the scope does not name, or a file
that does not say `testData: true`. The filename is for people and is never read. The shape is
in `packages/core-api/scripts/seed-golf/sport-data-file.ts`.

### Writing a test data file

Every sport league has a test data file of its last season as played (`rules/architecture-rules.md`
§6 *Manual-testing seed data goes through the admin API*); a new sport league gets its file in
the PR that adds it, and the seeded-template integration test fails until it has one. Its events,
fields and results are real, gathered as [`SPORT-DATA-SOURCES.md`](SPORT-DATA-SOURCES.md) says
(the "Fetch sport sources" workflow saves the pages a cloud session cannot reach, in
`sport-sources/` on the branch, which never reaches main); its odds are made up. What each kind
of sport carries:

- **A tournament** (golf): each field entry's made-up `oddsToWin` and `rounds` of strokes.
- **A bracket** (`american-football-2026-nfl-playoffs-test.json`): `contents` add `BRACKET`, each
  field entry made-up `oddsToWin` and each match its real `result`. A reseeded round's results
  name the side the server's reseed puts each team on (the 1 seed at home). A play-in place's
  entry names its winner in `playInWinner`, set after release, before any result. A bye is a
  team named straight into a later round's match. A match of a sport with periods may carry
  `periodScores`, the score at the end of each period but the last. A match level after extra
  time in a sport that settles it by shoot-out carries `homeShootoutScore` and
  `awayShootoutScore`. A match that stopped early says how in its result's `ending`
  (`RETIREMENT`, `WALKOVER`, `DEFAULT`), and a walkover's scores are null.
- **Weeks** (`american-football-2025-nfl-weeks-test.json`): each week its own event, every game
  a match that links nowhere. A drawn game's `result` has a null `winner`; a game postponed out
  of its week stays in it with `cancelled: true` and no result. A season spanning two years
  splits into one file per year its weeks start in.
- **A race**: each field entry's made-up `oddsToWin` and real `raceResult`, in grid or post
  order; a dead heat repeats a place and skips the next.
- **A stat pool**: `contents` add `STATS`, each field entry a `ranking` to tier by, and each
  game's box score.

Give each player the provider's feed id wherever the provider serves it today (*Feed ids*
above); never guess one. Validate the file with the unit tests in `tests/unit/core-api/` before
pushing.

### Loading every test file, with test players

Two options on *Load test data* load more than one file's events.

- **`all_test_data`** loads every test data file in the folder in one run, in place of `file`
  (the test slates are left out, since each fills one named event). A file that fails is
  listed in the summary and the rest still load. Locally it is `--all-test-data`.
- **`with_participants`** also loads the pool side of each test file: six test players
  (`qa-avery-adams` to `qa-finley-fox`, `@example.com` addresses that take no mail, all with
  the password in `test-participants.ts`), and for each sport league a league named
  "*sport league* *sport* test pool" (the sport in the name, since two sports can share a league name). The E2E root admin creates it and is its commissioner; each
  player joins with an invite link, which gives them their squad. Each of the league's next
  three events open for entries gets a contest from the sport league's default tiered or
  budget template offered on that kind of event (never a random draw, which deals the picks
  itself), opened, and every player's squad enters, picks a lineup and submits it. A week of
  games (the NFL weeks seed) offers no such template, since it is picked game by game, so its
  events get no test contest and the report lists them as skipped. Locally it is
  `--with-participants`.

### A few "Test-" events at a time

A test seed holds a whole season or playoff as played, but a run through *Load test data*
(one file, or `all_test_data`) loads only a few of its events, so test events stay a handful
beside the real ones and always lie just ahead (#1524). The rule is
`selectTestSeedEvents` in `seed-golf-data.ts`:

- **Named "Test- ..."**: every event a test seed creates is named `Test- <event name>`
  ("Test- Super Bowl LX"), so it reads as test data in every picker. The loader never matches a
  test event with a synced one, and the sync never touches a `Test-` event, which carries no
  provider link (#1850).
- **Two per sport league**: each league gets its next 2 events not yet on the site, in file
  order (`events_per_league` on the workflow, `--events-per-league` locally). Once every event
  of the file is on the site, the league starts over with numbered copies ("Test- Super Bowl LX
  (2)"), so a one-event seed can be loaded again and again.
- **Dates roll with the run**: the events keep their weekdays (an NFL week still starts on a
  Thursday, a tournament still runs Thursday to Sunday) and are laid about a week apart in the
  order they were played. The first week's land within the week after the run, the next on
  their weekdays nearest a week later (4 to 10 days). A league with several events (a season
  tour such as F1 or NASCAR) is laid out on its own, so every tour starts in the coming week.
  The one-event leagues of a file are the stages of one competition and share one sequence:
  the conference championships fall this coming Sunday and the Super Bowl the Sunday after. An event's
  start is when contests on it can no longer be created or opened, so a first event landing
  the next day leaves about a day to set one up.
- **Only the first is released**: each league's first event is released for contests; the
  ones after it are set up whole (field, odds, tiers, prices, stored scores) but left drafts.
  An admin can release one early on the Manage screens. A bracket event's play-in winners,
  cancellations and results go in only once a run releases it.
- **Results go in as the games are played** (#1720): a run enters a match's result only once its
  rolled kickoff (or, with none, the event's start) has passed, so a game still to come stays
  open for picks and a squares board. Each run first catches up the test events earlier runs
  loaded: it enters the results of the games played since, moves an event that has started to
  In Progress, and moves it to Completed, which settles its contests, once every result is in
  (any other sport's event: once its end has passed). The report lists each as an event update,
  such as "6 results entered; moved to In Progress". So a run after an event's last game leaves
  it played and settled, with nothing to do by hand.
- **Topped up, never piled up**: a league that still has a released test event yet to start is
  left alone, its drafts too, and the report says so. Run it again once that event has started
  and the league's draft moves into the coming week and is released, and a new event fills the
  league back to 2 as the next draft; a daily run adds nothing in between. Released test
  events are never changed, so their contests and entries stay. A draft counts toward the 2,
  whether a run held it back or stopped part-way through it.

Each section below says what a whole seed holds; a run loads it a few events at a time as
above. Loading a test seed's file straight through `loadSportData` (the functional tests) still
loads all of it, unprefixed, moved by whole weeks so its first event starts at least a week
after the run.

Both are re-entrant like every load: each step looks first and only adds what is missing, so a
second run lists everything as a skip, and a run after a failure part-way fills in the rest. A
draft entry gets the picks it lacks and is submitted; a submitted one is left alone.

### Test slates: a test field on an event that is already there

A test slate fills the field of one event on the site with a fixed list of players, for
trying contests before the real field is announced. There is one per sport league in
`packages/core-api/scripts/seed-golf/test-slates/`: `pga-tour.json` and `lpga-tour.json`
(the test seed's ranked golfers), and one per sport league of every other roster sport, named
for the league (`formula-1.json`, `us-thoroughbred.json`); a knockout has none, since a slate
fills a field but no bracket, and its test data is its last real bracket, whose players come from memory: they are
for trying contests only.
Its envelope says `testData` with `contents` `PLAYERS` and `FIELDS` and no events; any sport
in the registry can have one.

Run *Load test data* with the slate as `file` (`test-slates/pga-tour.json`) and the event's
name in `event`. The sport league and the event must already exist; a slate never creates
either, and only touches an event that has not started. Its players join the league if they
are new and fill the field in the file's order, at their rankings. Without `replace_field` it
fills in like any field load: a player the slate leaves out is withdrawn. With
`replace_field` ticked, every field row the slate does not list is removed instead, except
one a contest entry has picked, which is withdrawn so the entry keeps its pick. Such a row
stays in the field, so every later replace run lists it as removed and withdraws it again;
that is expected, not a failure. Dry run first, as always.

## Seeded 2026 tournaments

`golf-2026.json` is the test seed: the whole 2026 PGA TOUR (45 tournaments) and LPGA Tour
(31), each ready for contests. Load it as above with `mode` `apply`. It takes about two
minutes. Because its envelope says `testData`, each tournament also gets made-up parts:

- **Released** (Scheduled) with automatic lifecycle off, on tours named `PGA TOUR` and
  `LPGA Tour`, created if missing.
- **Dates rolled from the run** (*A few "Test-" events at a time* above), each tournament
  keeping its weekdays. The event year stays 2026.
- **A field** of 72 to 144 of the tour's ranked golfers, with rankings, made-up odds, seeds,
  six tiers filled by odds (10 per tier, the last takes the rest) and prices from 1,000 to
  10,000.
- **Final scores already stored:** four rounds (three for the two 54-hole events), a cut
  to the top 65 and ties after round 2 in full fields, two withdrawals, and par set for
  every round. Winners are the real 2026 winners where public results named one; everything
  else is made up.

To test a contest end to end: create and open it, submit entries, then from the tournament's
⚙ *Move to In Progress* (the contest goes live and its leaderboard shows the
stored scores straight away) and *Move to Completed* (the contest settles). The scores are
visible on the event's Field tab before that.

Running it again is safe, including straight after *Reset QA database*: a released
tournament keeps its dates and is skipped, and once a tour's released test tournament has
started, its draft moves into the coming week and is released, with a new draft a week after.
A tournament a run left a draft part-way is finished the same way. Only `Test-` tournaments count as the
seed's, so a tournament created by hand or imported from the provider is never touched.

The data file is `packages/core-api/scripts/seed-golf/golf-2026.json`, rebuilt by
`npm run seed:golf:build` from the mock provider's tour files (same answer every time).

## Seeded NFL playoffs

`american-football-2026-nfl-playoffs-test.json` is a test seed of a bracket: the NFL playoffs of
the 2025 season (played January and February 2026) as they went, for trying knockout contests
and the reseed. Seeds, pairings, kickoffs and scores are real; the odds are made up. Load it
with `mode` `apply` like any file. It loads into the `NFL` sport league, which the migrations
create with its reseed rule. Because its envelope says `testData`:

- **Dates rolled from the run** (*A few "Test-" events at a time* above), the kickoffs with them.
- **Released** with automatic lifecycle off, its 14 teams tiered by odds (seven tiers of two)
  and priced.
- **Every result entered as its game is played** (*Results go in as the games are played*
  above), round by round through the bracket's own calls: the Wild
  Card games, the Divisional round placed by the server's reseed (each 1 seed hosts the lowest
  seed left in its conference), the conference championships placed by a second reseed (the
  better seed left hosts), and Super Bowl LX, which the Seattle Seahawks win 29-13 over the New
  England Patriots. The Super Bowl also carries its score at the end of each of the first three
  quarters (Seahawks 3-0, 9-0, 12-0), entered before its result, for squares pools (#711).

To test a contest end to end, create and open it and submit entries before the first kickoff;
a run after the Super Bowl enters the rest and completes the event, which settles the contest.
To finish sooner, enter results and use the event's ⚙ *Move to In Progress* and
*Move to Completed* by hand. Running it again tops it up as above.

## Seeded NFL regular-season weeks

`american-football-2025-nfl-weeks-test.json` is a test seed of the 2025 NFL season's weeks 1 to
3 as played, for trying pick'em contests. Each week is its own event, `NFL Week 1` to `NFL Week
3`, of one round whose 16 games link nowhere. Kickoffs, home sides, neutral sites and scores are
real; the odds are made up. It loads into the `NFL` sport league beside the playoffs seed, and
keeps that seed's team rankings. Like the playoffs, each week is moved forward, released with its
32 teams tiered by odds and priced, and has each result entered once its game is played. To try a postponed game, cancel
it as [`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md) *Cancelling an event or a game*
says.

The seed carries no spreads. To try a pool scored against the spread (#720), set each game's
spread first with *Set spread* on its row of the Rounds and matches tab: the home team's spread in half
points, such as -3.5 for a favourite. Create contest refuses such a pool on a week with any game
still unspread. A game's spread can change until an entry picks it.

## Seeded College Football Playoff

`american-football-2025-cfp-test.json` is a test seed of the 2025-26 College Football Playoff
(played December 2025 and January 2026) as it went. Seeds, pairings, kickoffs and scores are
real; rankings are the final CFP rankings; the odds are made up. It loads into the `College
Football Playoff` sport league, which the migrations create with its round names (First Round,
Quarterfinals, Semifinals, National Championship) and six tiers. Load it with `mode` `apply`
like any file. Because its envelope says `testData`:

- **Dates rolled from the run** (*A few "Test-" events at a time* above), the kickoffs with them.
- **Released** with automatic lifecycle off, its 12 teams tiered by odds (six tiers of two) and
  priced.
- **Every result entered as its game is played**, round by round. Indiana, the 1 seed, comes in on a bye and
  beats Miami, the 10 seed, 27-21 in the National Championship.

Test a contest on it as for the NFL seed above. Running it again tops it up as above.

## Seeded NBA and WNBA playoffs

`basketball-2025-nba-playoffs-test.json` and `basketball-2025-wnba-playoffs-test.json` are test
seeds of the 2025 NBA and WNBA playoffs as they went, one file each. A series is one game of the
bracket: its winner moves on, and its scores are the games each side won (4-2). Seeds, pairings,
Game 1 tip-offs and series results are real; the odds are made up. They load into the `NBA` and
`WNBA` sport leagues, which the migrations create with their round names (First Round,
Conference Semifinals, Conference Finals, NBA Finals; First Round, Semifinals, WNBA Finals).
Load each with `mode` `apply` like any file. Because their envelopes say `testData`:

- **Dates rolled from the run** (*A few "Test-" events at a time* above), the tip-offs with them.
- **Released** with automatic lifecycle off, the field tiered by odds (four tiers) and priced.
- **The NBA's play-in places filled**: each conference's 7 and 8 seeds are play-in places
  ("West 8 seed (play-in)"), and after release each takes the team that won it (Golden State
  and Orlando the 7 seeds, Memphis and Miami the 8 seeds), keeping its seed, tier and price, as
  *Set winner* does. A field entry's `playInWinner` names that team; test data only.
- **Every series result entered as its Game 1 is played**, round by round. The Oklahoma City Thunder beat the
  Indiana Pacers 4-3 in the NBA Finals; the Las Vegas Aces beat the Phoenix Mercury 4-0 in the
  WNBA Finals.

Test a contest on either as for the NFL seed above. Running a file again tops it up as above.

## Seeded March Madness

`basketball-2026-ncaa-tournaments-test.json` is a test seed of the 2026 NCAA Division I men's and
women's tournaments as they went, one event each in the `NCAA Division I Men` and `NCAA Division I
Women` sport leagues that the migrations create. Each is six rounds of 63 games over 64 places,
seeded 1 to 16 in four regions (East, South, West and Midwest for the men; Fort Worth 1 and 3 and
Sacramento 2 and 4 for the women). Seeds, pairings, tip-offs and scores are real; the odds are made
up by seed. Load it with `mode` `apply` like any file. Because its envelope says `testData`:

- **Dates rolled from the run** (*A few "Test-" events at a time* above), the tip-offs with them.
- **Released** with automatic lifecycle off, the field tiered by odds and priced.
- **The First Four places filled**: each First Four pairing is a play-in place ("UMBC / Howard"),
  and after release each takes the team that won it, keeping its seed, tier and price.
- **Every game's result entered as it is played**, round by round. Michigan beat UConn 69-63 for the
  men's title; UCLA beat South Carolina 79-51 for the women's.

Test a contest on either as for the NFL seed above. Running the file again tops it up as above.

## Seeded hockey playoffs

Three test seeds hold the 2026 hockey playoffs as they went, one event each, in the four hockey
sport leagues the migrations create:

- `hockey-2026-nhl-playoffs-test.json`: the Stanley Cup playoffs, 16 teams in four rounds of
  series, seeded 1 to 3 in each division with both wild cards 4. The Carolina Hurricanes beat
  the Vegas Golden Knights 4-2 in the Stanley Cup Final.
- `hockey-2026-pwhl-playoffs-test.json`: the Walter Cup playoffs, four teams in best-of-five
  semifinals and a final. The Montreal Victoire beat the Ottawa Charge 3-1.
- `hockey-2026-ncaa-tournaments-test.json`: the NCAA Division I men's tournament, 16 teams in
  four regions (Albany, Loveland, Sioux Falls, Worcester), and the women's, five seeded teams
  and three quarterfinal places filled from a first round. Denver beat Wisconsin 2-1 for the
  men's title, and Wisconsin beat Ohio State 3-2 for the women's; both title games carry their
  first two periods' scores, for squares pools.

A series is one game of the bracket, scored in games won, as the NBA's. Seeds, pairings, scores
and first-round puck drops are real; later rounds' Game 1 times are an assumed 7 p.m. Eastern,
and the odds are made up. Each loads as the March Madness seed does: dates moved forward, the
event released and tiered by odds, each first-round place given the team that won it, and each
result entered round by round as its game is played.

## Seeded baseball postseason

`baseball-2025-mlb-postseason-test.json` holds the 2025 MLB postseason as it went, the last one
finished, in the MLB sport league the migrations create: 12 teams seeded 1 to 6 in each league,
the top two on byes into the Division Series, every round a series scored in games won. The Los
Angeles Dodgers beat the Toronto Blue Jays 4-3 in the World Series. Seeds, pairings, series
scores and each series' Game 1 first pitch are real, and the odds are made up. It loads as the
hockey seeds do.

## Seeded championship stat pools

Each championship stat pool league the migrations create has a test file of its last
championship as played, with every game's real box score:
`baseball-2026-league-championship-series-test.json` (the 2026 ALCS and NLCS as one event, game N
holding each series' Game N: Tampa Bay over Cleveland in six, Milwaukee over the Dodgers in four),
`baseball-2025-world-series-test.json`
(the Dodgers over the Blue Jays in seven), `basketball-2026-nba-conference-finals-test.json`
(both 2026 conference finals as one event, game N holding each series' Game N: the Spurs over the
Thunder in seven, the Knicks over the Cavaliers in four), `basketball-2026-nba-finals-test.json` (the Knicks
over the Spurs in five), `hockey-2026-nhl-conference-finals-test.json`
(both 2026 conference finals as one event, game N holding each series' Game N: Carolina over
Montreal in five, Vegas over Colorado in four), `hockey-2026-stanley-cup-final-test.json`
(Carolina over Vegas in six) and `american-football-2026-nfl-championships-test.json` (the 2025 season's Conference
Championship weekend and Super Bowl LX, one game each) and
`american-football-2026-cfp-semifinals-and-championship-test.json` (the 2025-26 College Football
Playoff's semifinals, both played as one event of one game, and Indiana over Miami in the
National Championship) and `basketball-2026-mens-final-four-test.json` (the 2026 men's semifinals, both
one event of one game, and Michigan over UConn in the title game) and
`hockey-2026-mens-frozen-four-test.json` (the 2026 men's Frozen Four semifinals, both one event of
one game, and Denver over Wisconsin in the title game) and
`soccer-2026-champions-league-semifinals-and-final-test.json` (the 2025-26 Champions League
semifinals as one event of two games, game 1 the first legs and game 2 the second legs, and Paris
Saint-Germain over Arsenal on penalties in the final) and
`soccer-2023-womens-world-cup-semifinals-and-final-test.json` (the 2023 Women's World Cup
semifinals, both one event of one game, and Spain over England in the final) and
`basketball-2026-wnba-semifinals-and-finals-test.json` (both 2026 WNBA semifinal series as one
event, game N holding each series' Game N: Atlanta's sweep of New York and Golden State's of Las
Vegas, and Golden State over Atlanta in seven in the Finals). The field is both teams' players who
can score the sport's composite, ranked by their regular-season composite total; tiers come
from that ranking and prices are the default curve, so no odds are made up. Each box score was
checked player by player against a second source, named in the file's provenance. A test load
creates each event with its field, writes every game's lines and releases it.

## Seeded soccer knockouts

Eight test seeds hold soccer knockout stages as they went, one event per sport league, in the
nine soccer bracket leagues the migrations create:

- `soccer-2022-fifa-world-cup-test.json`: the 2022 World Cup's 16-team knockout stage.
  Argentina beat France 4-2 on penalties after a 3-3 final.
- `soccer-2023-fifa-womens-world-cup-test.json`: the 2023 Women's World Cup's 16-team knockout
  stage. Spain beat England 1-0.
- `soccer-2024-uefa-euro-test.json`: Euro 2024's 16-team knockout stage. Spain beat England 2-1.
- `soccer-2024-copa-america-test.json`: Copa América 2024's eight-team knockout stage, from the
  quarter-finals. Argentina beat Colombia 1-0 after extra time.
- `soccer-2026-uefa-champions-league-test.json`: the 2025-26 Champions League knockout phase,
  from the knockout play-offs: 24 teams seeded by league phase place, the top eight waiting in
  the Round of 16. Each two-legged tie is one match scored on aggregate, kicking off at the
  first leg. Paris Saint-Germain beat Arsenal 4-3 on penalties after a 1-1 final.
- `soccer-2025-mls-cup-playoffs-test.json`: the 2025 MLS Cup playoffs, nine seeds a conference,
  from the wild card round. Each round one best-of-three series is one match scored in games
  won, with no half-time score. Inter Miami beat Vancouver 3-1 in MLS Cup, at home.
- `soccer-2025-nwsl-playoffs-test.json`: the 2025 NWSL playoffs, eight seeds. Gotham beat
  Washington 1-0 in the championship at a neutral site.
- `soccer-2025-ncaa-tournaments-test.json`: the 2025 NCAA Division I men's (48 teams, 16 national
  seeds waiting in the second round) and women's (64 teams, four brackets of eight seeds)
  tournaments, unseeded teams sharing the seed after the last. Washington beat NC State 3-2 after
  overtime, and Florida State beat Stanford 1-0. No half-time scores.

A match's score is the score after extra time; a match level after it carries its shoot-out,
kept apart. Every match carries its half-time score for squares pools, except a two-legged
tie, an MLS series and the NCAA games. The international tournaments are seeded by FIFA
ranking and every match is at a neutral site; the third-place match is left out. Kickoffs,
scores and shoot-outs are real, and the odds are made up. Each loads as the hockey seeds do.

## Seeded soccer weeks

Three test seeds hold soccer weeks as played (#787), for trying pick'em with draw picks and
Last Man Standing. Each week is its own event of one round whose games link nowhere, as an NFL
week is, and every week's field holds all the league's teams:

- `soccer-2025-premier-league-weeks-test.json` and `soccer-2026-premier-league-weeks-test.json`:
  the 2025-26 Premier League's matchweeks 1 to 19 and 20 to 38, `Premier League Matchweek 1` to
  `Premier League Matchweek 38`, split by the year each matchweek starts in, as a file holds one
  season year. Both rank the 20 clubs by the final table. Two matchweek 31 matches were
  rescheduled weeks later (Wolves v Arsenal and Manchester City v Crystal Palace), so they stay
  in their week marked `cancelled`, with no result, and the load cancels them once the week is
  released, as an admin cancels a postponed game. Release refuses a week with a team in none of
  its games, so a postponed game is never simply left out of the file.
- `soccer-2023-fifa-womens-world-cup-group-matchdays-test.json`: the 2023 Women's World Cup's
  three group matchdays, `FIFA Women's World Cup Matchday 1` to `3`, 16 neutral-site matches
  each. It loads into the same sport league as the knockout seed and keeps its FIFA rankings.

A drawn match's result has no `winner` (null), which only a week's game may have. Every match
carries its half-time score. Kickoffs and scores are real, and the odds are made up.

## Seeded tennis draws

`tennis-2026-us-open-test.json` holds the 2026 US Open men's and women's singles as played, one
event each in the ATP and the WTA. Each is a 128-player draw in seven rounds, every quarter of
the draw a region through the quarterfinals. The 32 seeds carry their seed (the men's 31: Ruud,
the 19th, withdrew and a lucky loser took his place) and everyone else is unseeded. Each draw's
16 qualifier places are play-in places that take their qualifier after release. A match's score
is sets won, and the men's two retirements count only the sets finished. Alexander Zverev beat
Ben Shelton 3-1 and Elena Rybakina beat Aryna Sabalenka 2-1. Pairings, winners, sets and match
times are real. The seeds' rankings are real; the unseeded players' are an ordering after the
seeds, and the odds are made up. It loads as the hockey seeds do.

`tennis-2025-ncaa-singles-test.json` holds the 2025 NCAA Division I men's and women's singles
championships as played (the 2025-26 championships' singles, played in the fall), one event each
in the two NCAA sport leagues. Each is a 64-player draw in six rounds, named as the NCAA names
them, every quarter a region through the quarterfinals. Seeds 1 to 8 carry their seed and the
eight seeded 9-16 as a group all carry 9. The women's Round of 16 walkover has no score. Michael
Zheng beat Trevor Svajda 2-1 and Reese Brantmeier beat Berta Passola Folch 2-0. Pairings,
winners and sets are real; neither source gives rankings or nationalities, so the rankings are an
ordering, every player is from the US, and the odds are made up. It loads as the hockey seeds do.

## Seeded 2026 races

To try racing contests without setting up a race, load a test seed of the 2026 season as run.
Four files in `packages/core-api/scripts/seed-golf/` hold every league's 2026 races with their
real finishing orders. The motor races, horse races and Tour de France carry the whole field;
Milano-Sanremo, both Giros and the marathons carry only their leading ten finishers:

| File | Sport leagues and races |
|---|---|
| `auto-racing-2026-test.json` | Formula 1 (17 Grands Prix, Australia to Singapore), NASCAR Cup Series (32 points races, the Daytona 500 to Charlotte in October), IndyCar (all 18 races, the Indianapolis 500 among them) |
| `horse-racing-2026-test.json` | US Thoroughbred: the Kentucky Derby, Preakness Stakes and Belmont Stakes, with jockeys and post positions; the Derby's scratched horses did not start |
| `cycling-2026-test.json` | UCI WorldTour: Milano-Sanremo, the Giro d'Italia and the Tour de France; UCI Women's WorldTour: the Giro d'Italia Women |
| `running-2026-test.json` | World Marathon Majors men and women: Tokyo, Boston, London, Sydney, Berlin and Chicago |

Load one with `mode` `apply` like any file. Because its envelope says `testData`:

- **Dates rolled from the run** (*A few "Test-" events at a time* above), post times with them.
- **Each race released**, with automatic lifecycle off, its field tiered by made-up odds and
  priced. The finishing order goes in just before release, so a run that stops between the two
  leaves a draft that the next run finishes.
- **The official finishing order already entered**: every runner's place (or did not finish,
  did not start), grid or post position, and jockey, as *The finishing order* in
  [`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md) step 4 would.

Then create a contest on a race, enter it, and move the race through *In Progress* and
*Completed* from its Manage page: it settles on the finishing order already there. Running the
file again tops it up as above.
