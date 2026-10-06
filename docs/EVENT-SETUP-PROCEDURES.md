# Event Setup Procedures

How a root admin sets up a made-up golf tournament in QA (or locally) and runs it through a
simulated live round, to test contests, entries and the live leaderboard by hand. Nothing
here depends on a real tournament being played that week.

Every step is a root-admin screen under `/manage` unless it says otherwise.

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

1. **Live-score sync is on, every 60 seconds.** Open *Sync config → Ingestion schedule*
   (`/manage/sync-config/ingestion-schedule`). For Golf, check the live-scores feed is
   enabled and set its interval to `60` seconds. The default is 300. The setting is
   per sport and applies to every linked golf tournament in the environment.
2. **Know which mock event you will link to.** Today the link dialog lists only mock events
   that start inside your tournament's own start and end dates, and each mock event can be
   linked to one PoolMaster tournament at a time. Near any given date the mock offers two
   generated events: *Rolling QA Weekend 1* (the most recent Thursday to Sunday) and
   *Rolling QA Weekend 2* (the following Thursday to Sunday). Pick dates in step 1 that span
   one of them, normally the coming Thursday. If another tournament already uses it,
   unlink that one first (*Unlink score source* on its score-source card).

## 1. Create the tournament

*Golf → Tournaments → New* (`/manage/golf/tournaments/new`).

| Field | Set it to |
|---|---|
| Tour, Event year, Name | Any tour, the current year, and a name of your own (for example "Derek's Golf Tournament") |
| Starts | On or before the Thursday of the mock event you picked |
| Ends | After that Thursday (the Sunday is fine) |
| Field release | Any time in the past. Contests cannot be created before it |
| Field locks | Far enough ahead to finish creating contests and entries. Contests cannot be created after it |
| Rounds | 4 |
| Move this tournament through Live and Completed automatically | **Unchecked** |

Leave automatic lifecycle off. With it on, a background job moves the tournament to
In progress and Completed from its round dates, which takes the timing out of your hands.
You can turn it off later with *Manage lifecycle manually* on the Workflow card.

## 2. Link it to the mock provider

On the tournament's home page, open the score-source card and choose *Link to provider event*. Pick the
*Rolling QA Weekend* event you chose. The card then says "Linked to mock-contest-feed event
…". The tournament now takes live scores from the mock and its badge reads
*Scores synced*.

If the list says no provider events fall in the tournament's date window, its dates do not span a mock event. Edit them and try
again.

## 3. Check the rounds

The Workflow card's *Rounds* list should show R1 to R4. Scores for a round with no round
row are skipped, so add any that are missing with *Edit schedule*.

## 4. Load the field from the mock

*Field* (`/manage/golf/tournaments/:id/field`), then *Load Participant Field*. This loads
the mock's 80 golfers and records each one's mock id, which is what the score sync matches
on. Then:

- set rankings or odds in the field grid as you like;
- do not add golfers from the roster with *Add golfers*: they have no mock id and will
  never score.

The field load matches players by mock id only. If the roster already holds a hand-made
player with the same name as a mock golfer, you will see both.

## 5. Build tiers

*Tiers* (`/manage/golf/tournaments/:id/tiers`), then *Auto-assign tiers from ranking*. This
builds tiers from ranking order, ten golfers per tier by default.

## 6. Create contests and entries

As a commissioner of a test league (root admin is not needed):

1. *Create Contest* (`/league/:leagueCode/contests/new`) and pick the tournament. Creation
   is refused before *Field release* or after *Field locks*, or when the field is empty.
2. Submit entries from one or more test accounts while the contest is open.

## 7. Go live

1. On the Workflow card, *Move to In Progress*. Open and locked contests on the tournament
   become active, and the live-score sync starts polling it.
2. On the score-source card, *Start live simulation*. The card shows the round under way
   and when the simulation finishes. By default each round takes 20 minutes, so a full
   tournament takes 80 minutes.

The order of these two does not matter. Scores only reach PoolMaster while the tournament
is In progress, and the simulation runs on its own clock from the moment it is started.

Golfers tee off across the first third of each round, so the first poll or two may bring
no scores.

## 8. Watch it

- The contest leaderboard should change about once a minute as holes are played.
- The cut is made after round 2: the top 65 and ties go through, the rest show as missed
  cut. A few golfers withdraw mid-round.
- *Sync* (`/manage/sync?sport=GOLF`) shows each live-score run. A run that brings nothing
  in usually means the tournament is not In progress, has no field, or its golfers did not
  come from the mock.

## 9. Finish

When the card shows the simulation has finished, *Move to Completed* on the Workflow card.
Final standings are built from the scores PoolMaster has already received.

## Running it again

- **Use a fresh tournament for each run.** Restarting a simulation part-way through starts
  again from round 1. PoolMaster keeps the rounds it has already stored, so the leaderboard
  mixes the two runs until the new one overwrites them.
- **Restart after a mock restart.** The simulation is held in the mock's memory. If the
  mock restarts (a QA deploy does this), press *Start live simulation* again.
- **Unlink finished tournaments.** A completed tournament keeps its link, which blocks the
  next tournament from using the same mock event. Use *Unlink score source* on its score-source card.

## Planned changes

- #402: link any tournament to its own simulated mock event, whatever its dates. This
  replaces the date-matching in "Before you start" and step 2.
- #386: removes the *Rolling QA Weekend* events. Until #402 lands, link to a seeded event
  (#383) whose week your dates span.
