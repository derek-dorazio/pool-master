# Loading sport data and test seeds

How sport leagues, players, events, fields and brackets get onto a site from a data file
instead of being typed in on the Manage screens, and what each test seed loads for trying
contests by hand. Setting an event up and running it by hand, from release to results, is
[`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md) (and, for races,
[`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md)). Where each sport's real data comes
from is [`SPORT-DATA-SOURCES.md`](SPORT-DATA-SOURCES.md).

## Loading sport data

Sport leagues, players, events and fields can be loaded from a data file instead of typed
in. The `load-sport-data` skill gathers a real schedule or field from public sources,
cross-checks it and writes the file; the 2026 test seed below is one too. Either way it goes
in through the same admin API as the Manage screens, and no migration, deploy or reset loads it.

- **QA:** *Actions → Load sport data → Run workflow*, choosing the branch that has the file,
  the `file` (a path inside `packages/core-api/scripts/seed-golf/`, default
  `golf-2026.json`) and the `mode`. It signs in as the E2E root admin.
- **Locally:** with the API running, `POOLMASTER_SEED_BASE_URL=http://localhost:3000
  POOLMASTER_SEED_ADMIN_IDENTIFIER=<root admin> POOLMASTER_SEED_ADMIN_PASSWORD=<password>
  npm run seed:golf -- --file golf-2026.json --mode apply --allow-test-data`.

**Dry run first.** `dry-run` (the default) reads the site and lists, per sport league,
player, event, field and bracket, what applying would add, update, skip, or leave as a conflict. It
writes nothing. The workflow's summary shows the list with the file's scope and sources.
`apply` writes it.

**What a run changes.** It compares the file with the site and fills in the difference:

- A missing sport league, player, event or field entry is added. A player new to the
  league joins at the file's ranking; one already on it keeps the ranking it has.
- An event's name, dates, venue, location, rounds or par that differ are updated. An event
  is found by name, or, when a sponsor renamed it, by a start within three days.
- A field entry's ranking and seed (the file's order) are set. A player the file drops is
  marked withdrawn, never removed.
- An event that has started, finished, or was cancelled or postponed is never changed; a
  difference there is listed as a conflict for an admin to look at.
- A file only changes what its envelope's `contents` names: one without `SCHEDULE` never
  edits an event, so a file with next week's fields cannot rewrite the schedule.

An event whose `field` is empty has no field in this file yet, so its stored field is left
alone. A withdrawn player the file lists again is reinstated.

**Brackets.** A file of a sport played as a bracket, with `BRACKET` in its `contents`, may
give each event its `matches`: each match's number, round, its two sides as player keys from
the event's field (`null` where an earlier match's winner fills the side), whether it is on a
neutral site, its `scheduledAt` once announced, and `advancesTo` (the match and side its winner
moves on to; `null` for the final), and its `regionLabel` (the March Madness region or NFL
conference) where it has one. A league that reseeds gives `bracketAdvancement`
`RESEED_BY_SEED`, and its first-round games `advancesTo: null`; the run sets the rule on the
sport league, new or existing. A field entry may give its bracket `seed` (1-16 in each
March Madness region) where the seed is not its place in the field, and `isPlayInPlace` for a
First Four pairing. The run refuses a bracket the bracket endpoint would refuse, before any
write.

- **Before release**, a bracket that differs anywhere is loaded whole again, after the field.
  A match time the file leaves out keeps the one on the site.
- **After release** the field, seeds, play-in places and pairings are locked, so only a
  match's time and site are changed. A field that differs is listed as a conflict. A play-in
  place an admin has filled with its winner is found by its bracket place and left alone.

Running the same file again lists everything as a skip. A real data file never releases an
event or writes odds, tiers, prices or scores; those stay admin actions
([`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md)).

**Any sport.** A real file may be any sport in the registry: rounds are the sport's count
(1 for a race), and par is golf's alone (`null` for every other sport). An event may give
`startsAt`, its exact start with a UTC offset (a race's post time), which is the entry cutoff;
without it an event starts at noon UTC on its start date. An event of a sport whose finishing
order an admin enters (every racing sport) is created with automatic lifecycle off, and one
already on the site has it turned off, so it never completes, and settles, before its result
is in. A test seed carries the results its sport is scored on: golf's made-up stroke rounds, a
bracket's match results, or a race's real finishing order (each runner's `raceResult`, entered
just before release as the official result; *Seeded 2026 races* below). Any sport may also have a test slate.

**The file says what it is.** Each file starts with an envelope: `schemaVersion`, a `scope`
(sport from the sport registry, season, sport leagues, and `contents` from `SCHEDULE`,
`PLAYERS`, `FIELDS`, `BRACKET`, `RESULTS`), a `testData` flag and its `provenance`. A run refuses the
whole file before writing if anything strays outside the scope: an event outside the
season, a league the scope does not name, made-up odds or scores in a real file, or test
data on a target that does not take it. The filename is for people and is never read.
The shape is in `packages/core-api/scripts/seed-golf/sport-data-file.ts`.

### Loading every test file, with test players

Two options on *Load sport data* are for QA only. The run reads the site's environment from
`/version` first and refuses either anywhere but QA (or a local site).

- **`all_test_data`** loads every test data file in the folder in one run, in place of `file`
  (the test slates are left out, since each fills one named event). A file that fails is
  listed in the summary and the rest still load. Locally it is `--all-test-data`.
- **`with_participants`** also loads the pool side of each test file: six test players
  (`qa-avery-adams` to `qa-finley-fox`, `@example.com` addresses that take no mail, all with
  the password in `test-participants.ts`), and for each sport league a league named
  "*sport league* test pool". The E2E root admin creates it and is its commissioner; each
  player joins with an invite link, which gives them their squad. Each of the league's next
  three events open for entries gets a contest from the sport league's default tiered or
  budget template (never a random draw, which deals the picks itself), opened, and every
  player's squad enters, picks a lineup and submits it. Locally it is `--with-participants`.

Both are re-entrant like every load: each step looks first and only adds what is missing, so a
second run lists everything as a skip, and a run after a failure part-way fills in the rest. A
draft entry gets the picks it lacks and is submitted; a submitted one is left alone.

### Test slates: a test field on an event that is already there

A test slate fills the field of one event on the site with a fixed list of players, for
trying contests before the real field is announced. There is one per sport league in
`packages/core-api/scripts/seed-golf/test-slates/`: `pga-tour.json` and `lpga-tour.json`
(the test seed's ranked golfers), and one per sport league of every other sport, named for the
league (`formula-1.json`, `us-thoroughbred.json`), whose players come from memory: they are
for trying contests only.
Its envelope says `testData` with `contents` `PLAYERS` and `FIELDS` and no events; any sport
in the registry can have one.

Run *Load sport data* with the slate as `file` (`test-slates/pga-tour.json`) and the event's
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
- **Dates moved forward by whole weeks** from the 2026 calendar, so the first tournament
  starts at least a week after the run and the rest keep their order and weekdays. The
  event year stays 2026.
- **A field** of 72 to 144 of the tour's ranked golfers, with rankings, made-up odds, seeds,
  six tiers filled by odds (10 per tier, the last takes the rest) and prices from 1,000 to
  10,000.
- **Final scores already stored:** four rounds (three for the two 54-hole events), a cut
  to the top 65 and ties after round 2 in full fields, two withdrawals, and par set for
  every round. Winners are the real 2026 winners where public results named one; everything
  else is made up.

To test a contest end to end: create and open it, submit entries, then on the tournament's
Workflow card *Move to In Progress* (the contest goes live and its leaderboard shows the
stored scores straight away) and *Move to Completed* (the contest settles). The scores are
visible on the admin field page before that.

Running it again is safe, including straight after *Reset QA database*: a released
tournament keeps its dates and is skipped. A tournament a run left a draft part-way is
finished on the next run: moved to this run's dates, filled in and released. A tournament
you already created by hand or imported from the provider with the same tour, name and year
is treated as the seed's, so reset QA first for a clean set.

The data file is `packages/core-api/scripts/seed-golf/golf-2026.json`, rebuilt by
`npm run seed:golf:build` from the mock provider's tour files (same answer every time).

## Seeded NFL playoffs

`american-football-2026-nfl-playoffs-test.json` is a test seed of a bracket: the NFL playoffs of
the 2025 season (played January and February 2026) as they went, for trying knockout contests
and the reseed. Seeds, pairings, kickoffs and scores are real; the odds are made up. Load it
with `mode` `apply` like any file. It loads into the `NFL` sport league, which the migrations
create with its reseed rule. Because its envelope says `testData`:

- **Dates moved forward by whole weeks**, the kickoffs with them, so the Wild Card weekend
  starts at least a week after the run.
- **Released** with automatic lifecycle off, its 14 teams tiered by odds (seven tiers of two)
  and priced.
- **Every result already entered**, round by round through the bracket's own calls: the Wild
  Card games, the Divisional round placed by the server's reseed (each 1 seed hosts the lowest
  seed left in its conference), the conference championships placed by a second reseed (the
  better seed left hosts), and Super Bowl LX, which the Seattle Seahawks win 29-13 over the New
  England Patriots. The Super Bowl also carries its score at the end of each of the first three
  quarters (Seahawks 3-0, 9-0, 12-0), entered before its result, for squares pools (#711).

To test a contest end to end, create and open it and submit entries, then on the event's
Workflow card *Move to In Progress* and *Move to Completed*, as for the golf seed above.
Running it again skips everything.

## Seeded NFL regular-season weeks

`american-football-2025-nfl-weeks-test.json` is a test seed of the 2025 NFL season's weeks 1 to
3 as played, for trying pick'em contests. Each week is its own event, `NFL Week 1` to `NFL Week
3`, of one round whose 16 games link nowhere. Kickoffs, home sides, neutral sites and scores are
real; the odds are made up. It loads into the `NFL` sport league beside the playoffs seed, and
keeps that seed's team rankings. Like the playoffs, each week is moved forward, released with its
32 teams tiered by odds and priced, and has every result entered. To try a postponed game, cancel
it as [`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md) *Cancelling an event or a game*
says.

The seed carries no spreads. To try a pool scored against the spread (#720), set each game's
spread first with *Set spread* on its row of the results page: the home team's spread in half
points, such as -3.5 for a favourite. Create contest refuses such a pool on a week with any game
still unspread. A game's spread can change until an entry picks it.

## Seeded College Football Playoff

`american-football-2025-cfp-test.json` is a test seed of the 2025-26 College Football Playoff
(played December 2025 and January 2026) as it went. Seeds, pairings, kickoffs and scores are
real; rankings are the final CFP rankings; the odds are made up. It loads into the `College
Football Playoff` sport league, which the migrations create with its round names (First Round,
Quarterfinals, Semifinals, National Championship) and six tiers. Load it with `mode` `apply`
like any file. Because its envelope says `testData`:

- **Dates moved forward by whole weeks**, the kickoffs with them, so the first round starts at
  least a week after the run.
- **Released** with automatic lifecycle off, its 12 teams tiered by odds (six tiers of two) and
  priced.
- **Every result already entered**, round by round. Indiana, the 1 seed, comes in on a bye and
  beats Miami, the 10 seed, 27-21 in the National Championship.

Test a contest on it as for the NFL seed above. Running it again skips everything.

## Seeded NBA and WNBA playoffs

`basketball-2025-nba-playoffs-test.json` and `basketball-2025-wnba-playoffs-test.json` are test
seeds of the 2025 NBA and WNBA playoffs as they went, one file each. A series is one game of the
bracket: its winner moves on, and its scores are the games each side won (4-2). Seeds, pairings,
Game 1 tip-offs and series results are real; the odds are made up. They load into the `NBA` and
`WNBA` sport leagues, which the migrations create with their round names (First Round,
Conference Semifinals, Conference Finals, NBA Finals; First Round, Semifinals, WNBA Finals).
Load each with `mode` `apply` like any file. Because their envelopes say `testData`:

- **Dates moved forward by whole weeks**, the tip-offs with them, so the first round starts at
  least a week after the run.
- **Released** with automatic lifecycle off, the field tiered by odds (four tiers) and priced.
- **The NBA's play-in places filled**: each conference's 7 and 8 seeds are play-in places
  ("West 8 seed (play-in)"), and after release each takes the team that won it (Golden State
  and Orlando the 7 seeds, Memphis and Miami the 8 seeds), keeping its seed, tier and price, as
  *Set winner* does. A field entry's `playInWinner` names that team; test data only.
- **Every series result already entered**, round by round. The Oklahoma City Thunder beat the
  Indiana Pacers 4-3 in the NBA Finals; the Las Vegas Aces beat the Phoenix Mercury 4-0 in the
  WNBA Finals.

Test a contest on either as for the NFL seed above. Running a file again skips everything.

## Seeded March Madness

`basketball-2026-ncaa-tournaments-test.json` is a test seed of the 2026 NCAA Division I men's and
women's tournaments as they went, one event each in the `NCAA Division I Men` and `NCAA Division I
Women` sport leagues that the migrations create. Each is six rounds of 63 games over 64 places,
seeded 1 to 16 in four regions (East, South, West and Midwest for the men; Fort Worth 1 and 3 and
Sacramento 2 and 4 for the women). Seeds, pairings, tip-offs and scores are real; the odds are made
up by seed. Load it with `mode` `apply` like any file. Because its envelope says `testData`:

- **Dates moved forward by whole weeks**, the tip-offs with them, so the First Four starts at
  least a week after the run.
- **Released** with automatic lifecycle off, the field tiered by odds and priced.
- **The First Four places filled**: each First Four pairing is a play-in place ("UMBC / Howard"),
  and after release each takes the team that won it, keeping its seed, tier and price.
- **Every game's result already entered**, round by round. Michigan beat UConn 69-63 for the
  men's title; UCLA beat South Carolina 79-51 for the women's.

Test a contest on either as for the NFL seed above. Running the file again skips everything.

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

- **Dates moved forward by whole weeks**, post times with them, so the first race starts at
  least a week after the run.
- **Each race released**, with automatic lifecycle off, its field tiered by made-up odds and
  priced. The finishing order goes in just before release, so a run that stops between the two
  leaves a draft that the next run finishes.
- **The official finishing order already entered**: every runner's place (or did not finish,
  did not start), grid or post position, and jockey, as *The finishing order* in
  [`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md) step 7 would.

Then create a contest on a race, enter it, and move the race through *In Progress* and
*Completed* from its Manage page: it settles on the finishing order already there. Running the
file again skips everything.
