# Event Setup Procedures

How a root admin sets up a made-up golf tournament in QA (or locally) and runs it through a
simulated live round, to test contests, entries and the live leaderboard by hand. Nothing
here depends on a real tournament being played that week.

Horse racing, auto racing, cycling and running have no score feed, so a race is set up and resulted by hand instead: see
[`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md).

Every step is a root-admin screen under `/manage` unless it says otherwise. To skip the setup
and test contests on ready-made tournaments, use the seed instead (*Seeded 2026 tournaments*
at the end).

## What drives what

- **PoolMaster owns the event.** You create it, build its field, and move it between
  statuses yourself.
- **The mock provider owns the scores.** It scores golfers hole by hole once a live
  simulation is started for the provider event your tournament is linked to.
- **The live-score sync carries scores across.** It polls every linked tournament that is
  *In progress* and has a field. It does not look at dates.
- **Golfers are matched by provider id, never by name.** A score only lands on a golfer
  whose player record came from the mock, so the field must be loaded from the mock (step 4).
  Golfers added by hand from the roster get no scores.

## Before you start

1. **Live-score sync is on, every 60 seconds.** Open *Settings → Global
   Ingestion Schedule* (`/manage/settings/ingestion-schedule`). On the **Event live
   scores** row, tick *Enabled* and set *Seconds* to `60`. The default is 300. This one
   setting applies to every sport and every linked tournament in the environment. Then on
   *Sport Ingestion Overrides* (`/manage/settings/sport-overrides`), check that Event
   live scores is not switched off for Golf. A new interval starts only after the current
   wait runs out, so the first poll after the change can take up to the old 300 seconds.
2. **Field sync is off by default.** The *Event participants* row on the same page is
   unticked in a new environment (#123), so a field changes only when you load or refresh
   it (step 4). An environment that saved its schedule before that keeps its saved value;
   untick it there.
3. **No mock event to pick in advance.** Each tournament gets its own simulated event when
   you link it (step 2), so its dates do not have to match anything in the mock.

## 1. Create the tournament

*Golf → Tournaments → New* (`/manage/sports/golf/events/new`).

| Field | Set it to |
|---|---|
| Tour, Event year, Name | Any tour, the current year, and a name of your own (for example "Derek's Golf Tournament") |
| Starts, Ends | A start far enough ahead to finish releasing the tournament and creating contests and entries. The start time is the cutoff: the tournament can't be released, and contests can't be created or opened, once it has passed. Nothing compares the dates with the mock |
| Rounds | 4 |
| Move this tournament through Live and Completed automatically | **Unchecked** |

The tournament is saved as a **draft**: commissioners can't see it until step 6.

Leave automatic lifecycle off. With it on, a background job moves the tournament to
In progress and Completed from its round dates, which takes the timing out of your hands.
You can turn it off later with *Manage lifecycle manually* on the Workflow card.

## 2. Link it to the mock provider

On the tournament's home page, choose *Link to a new simulated event* on the score-source
card. That links the tournament to its own mock event, `sandbox-<tournament id>`, which the
mock builds on request with its 80-golfer field. The card then says "Linked to
mock-contest-feed event sandbox-…" and the badge reads *Scores synced*.

*Link to provider event* is still there for linking to one of the mock's listed events
instead; that list shows only events that start inside the tournament's own dates. The
mock lists the 2026 and 2027 PGA TOUR and LPGA Tour schedules, and their fields are each
tour's ranked players (about 150), not the 80-golfer field used below.

To create a whole year of those listed events at once, open the tour's page (`/manage/sports/golf/leagues/:leagueId`),
pick the year on its tournament calendar, and choose *Import {year} from provider*. Every
event the mock lists for that tour and year is created and linked for scores; ones the tour
already has are skipped, so it is safe to run again. The tour's match keyword must be the
mock's tour name exactly, `PGA TOUR` or `LPGA Tour` (#385). The single-event browse
accepts that keyword too, as well as a substring of event names.

## 3. Check the rounds

The Workflow card's *Rounds* list should show R1 to R4. Scores for a round with no round
row are skipped, so add any that are missing with *Edit schedule*.

## 4. Load the field from the mock

*Field* (`/manage/sports/golf/events/:id/field`), then *Load Participant Field*. This loads
the mock's 80 golfers and records each one's mock id, which is what the score sync matches
on. Then:

- each golfer arrives with the mock's ranking, so tiers can be auto-assigned straight away;
  you can change rankings, odds, seeds or withdrawals in the field grid, but a later
  *Refresh Participant Field* replaces them with the provider's values for every golfer
  it reports (it asks you to confirm first);
- do not use *Add more participants* or *Seed field from league roster*: the golfers they
  add have no mock id and will never score.

The field load matches players by mock id only. If the roster already holds a hand-made
player with the same name as a mock golfer, you will see both.

**Optional: adjust the field by bulk upload.** To set many rankings, odds, seeds or
withdrawals at once (copied from a tournament site, say), use *Bulk upload* on the same
page. Paste or upload CSV or JSON with `externalId` or `playerName` per row, preview it,
then apply. It only changes golfers already on the field: a golfer it cannot find shows as
unresolved, and Apply stays disabled until every row matches one golfer, once. A blank cell
leaves a value alone; `null` clears it. Load the field first — the upload never adds a
golfer. A later *Refresh Participant Field* replaces rankings, odds, seeds and withdrawals
with the provider's again, as it does grid edits (#415).

## 5. Build tiers

*Tiers* (`/manage/sports/golf/events/:id/tiers`), then *Auto-assign tiers from ranking*. A golf
event starts with six tiers. Auto-assign fills them in ranking order, ten golfers at a time,
and the last tier takes everyone left. The mock's 80 golfers therefore come out as
10/10/10/10/10/30. If you add or delete tiers first, auto-assign instead spreads the field
evenly over them from the top, larger tiers first: the same 80 golfers on five tiers come out
16/16/16/16/16. A tier-pick contest's configuration is checked against this tier count.

## 6. Release it for contests

On the tournament's home page, the Workflow card's *Release for contests*, then confirm. The
button stays disabled, with a list of what is missing, until the field is loaded, every
active golfer has a tier, and every tier has an active golfer in it ("Tier 6 has no golfers":
no entry could pick from an empty tier, so move golfers into it or delete it). Release moves the tournament from Draft to Scheduled, and
commissioners can now pick it. It also **locks the tiers and prices for good**: the tier
board and price cells turn read-only. Rankings, odds and withdrawals stay editable, and a
golfer added after release stays untiered and can't be picked (#431).

## 7. Create contests and entries

As a commissioner of a test league (root admin is not needed):

1. In *Commissioner tools* › *Contests*, press *Create contest*
   (`/league/:leagueCode/admin/contests/new`). The one page lists only tournaments that are
   released and haven't started, soonest first; pick yours, choose Tiered or Budget, keep or
   change the preset and rules, and the name follows the event until you type your own. Budget
   is offered only on an event whose field has been priced; its salary cap is the event's and
   shows read-only. The contest is saved
   as a draft and you land on its page in Commissioner tools, which checks the event is ready;
   press *Open to league* there to let members enter. Until then *Edit* changes its name and
   rules, and *Delete contest* sits in its danger zone.
2. Submit entries from one or more test accounts while the contest is open. A budget entry
   lists the field by price under a spend bar; it may go over the cap while you rearrange it,
   but Submit stays disabled until it fits. To test the over-cap path, raise a few prices in
   the Field grid before releasing the event, so a few dear picks are enough to go over.
   Auto-pricing places golfers on the price curve by seed; unseeded golfers fill the cheaper
   places, shortest odds first.

## 8. Go live

Do these two in this order.

1. On the score-source card, *Start live simulation*. The card shows the round under way
   and when the simulation finishes, and it refreshes that every 30 seconds, including
   after you leave and come back. By default each round takes 20 minutes, so a full
   tournament takes 80 minutes.
2. On the Workflow card, *Move to In Progress*. Open contests on the tournament
   become active, and the live-score sync starts polling it.

Start the simulation first anyway. A simulated event has no scores until its simulation
starts, so polls before then bring nothing in. An event linked from the provider list
instead answers with fixed scores until a simulation runs, and a poll that stores those
mixes them with the simulated ones.

Golfers tee off across the first third of each round, so the first poll or two may bring
no scores.

## 9. Watch it

- The contest leaderboard should change about once a minute as holes are played.
- The cut is made after round 2: the top 65 and ties go through, the rest show as missed
  cut. A few golfers withdraw mid-round.
- *Sync* (`/manage/sync?sport=GOLF`) shows each live-score run. A run that brings nothing
  in usually means the tournament is not In progress, has no field, or its golfers did not
  come from the mock.

## 10. Finish

When the score-source card says "Simulation finished at …", *Move to Completed* on the
Workflow card.
Final standings are built from the scores PoolMaster has already received.

## Running it again

- **Use a fresh tournament for each run.** Restarting a simulation part-way through starts
  again from round 1. PoolMaster keeps the rounds it has already stored, so the leaderboard
  mixes the two runs until the new one overwrites them.
- **Restart after a mock restart.** The simulation is held in the mock's memory. If the
  mock restarts (a QA deploy does this), press *Start live simulation* again.
- **Don't re-link a tournament to reuse it.** The mock remembers a simulation by event id,
  and a tournament always gets the same `sandbox-<id>`, so unlinking and linking it again
  picks up the old simulation's scores at once. A fresh tournament gets a fresh event.
- **Unlink only listed events.** A finished tournament linked from the provider list keeps
  that mock event, which blocks the next tournament from using it. *Unlink score source*
  frees it. Simulated events are one per tournament and never need this.

## Basketball tournaments

A basketball tournament is a knockout bracket, resulted by hand on its **Bracket** tab. Its
field and games usually come from a sport data file (*Loading sport data* below, *Brackets*);
otherwise the field is built on the Field tab and the games are loaded through
`loadEventBracket` ([`DOMAIN-OPERATIONS.md`](DOMAIN-OPERATIONS.md), *SportEventMatch*). Then
on the Bracket tab:

The NBA and WNBA playoffs are basketball tournaments too, in their own sport leagues. A series
is one game of the bracket: choose the team that won the series, with the games each side won
as the score (4-2). The NBA's 7 and 8 seeds in each conference are play-in places until the
play-in tournament is played, as the First Four's are. Those leagues' rounds show their own
names (Conference Finals, NBA Finals), not March Madness's.

- **Before release**, *Edit pairing* changes a game's two teams. Only teams no other game holds
  are offered, so to swap two teams, empty one side first. A side an earlier game's winner fills
  cannot be edited. Under *Play-in places*, mark each field row that stands for a First Four
  pairing ("Texas / Xavier").
- **After release**, choose the team that won each game; the winner moves to its next game and
  the standings update. A wrong winner can be switched, or the result cleared, until the next
  game has a result. Each play-in place takes its winner once, from the sport's active teams
  not already in the tournament.

**Reseeded brackets.** A sport league that reseeds (the NFL, `bracketAdvancement`
`RESEED_BY_SEED`) loads each round that is placed by seed with no next game in the round
before it, and names only its byes. The NFL's Wild Card and Divisional games both link nowhere,
so the Divisional round and the conference championships are each placed by seed; the
conference winners link to the Super Bowl. Release lets those rounds wait. Once every game of
the round before has a result, ask the server for the reseed (`proposeEventRoundMatchups`): in
each conference the best seed left hosts the worst. Set it, or a pairing of your own that keeps each team in its conference and each bye
in place, with `setEventRoundMatchups`, before the round starts. A first-round result corrected
after that moves the team it placed, until that team has played. The Bracket tab does not have a
reseed button yet, so the two calls go through the API.

## Loading sport data

Sport leagues, players, events and fields can be loaded from a data file instead of typed
in. The `load-sport-data` skill gathers a real schedule or field from public sources,
cross-checks it and writes the file; the 2026 test seed below is one too. Either way it goes
in through the same admin API as these screens, and no migration, deploy or reset loads it.

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
event or writes odds, tiers, prices or scores; those stay admin actions here.

**Any sport.** A real file may be any sport in the registry: rounds are the sport's count
(1 for a race), and par is golf's alone (`null` for every other sport). An event may give
`startsAt`, its exact start with a UTC offset (a race's post time), which is the entry cutoff;
without it an event starts at noon UTC on its start date. An event of a sport whose finishing
order an admin enters (every racing sport) is created with automatic lifecycle off, and one
already on the site has it turned off, so it never completes, and settles, before its result
is in. A test seed is golf's or a bracket sport's, because its made-up results are stroke
rounds or match results; any sport may have a test slate.

**The file says what it is.** Each file starts with an envelope: `schemaVersion`, a `scope`
(sport from the sport registry, season, sport leagues, and `contents` from `SCHEDULE`,
`PLAYERS`, `FIELDS`, `BRACKET`, `RESULTS`), a `testData` flag and its `provenance`. A run refuses the
whole file before writing if anything strays outside the scope: an event outside the
season, a league the scope does not name, made-up odds or scores in a real file, or test
data on a target that does not take it. The filename is for people and is never read.
The shape is in `packages/core-api/scripts/seed-golf/sport-data-file.ts`.

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
  England Patriots.

To test a contest end to end, create and open it and submit entries, then on the event's
Workflow card *Move to In Progress* and *Move to Completed*, as for the golf seed above.
Running it again skips everything.

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
