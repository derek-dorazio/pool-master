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

1. **Live-score sync is on, every 60 seconds.** Open *Sync Configuration → Global
   Ingestion Schedule* (`/manage/sync-config/ingestion-schedule`). On the **Event live
   scores** row, tick *Enabled* and set *Seconds* to `60`. The default is 300. This one
   setting applies to every sport and every linked tournament in the environment. Then on
   *Sport Ingestion Overrides* (`/manage/sync-config/sport-overrides`), check that Event
   live scores is not switched off for Golf. A new interval starts only after the current
   wait runs out, so the first poll after the change can take up to the old 300 seconds.
2. **No mock event to pick in advance.** Each tournament gets its own simulated event when
   you link it (step 2), so its dates do not have to match anything in the mock.

## 1. Create the tournament

*Golf → Tournaments → New* (`/manage/golf/tournaments/new`).

| Field | Set it to |
|---|---|
| Tour, Event year, Name | Any tour, the current year, and a name of your own (for example "Derek's Golf Tournament") |
| Starts, Ends | Any dates you like. Nothing compares them with today or with the mock |
| Field release | Any time in the past. Contests cannot be created before it |
| Field locks | Far enough ahead to finish creating contests and entries. Contests cannot be created after it |
| Rounds | 4 |
| Move this tournament through Live and Completed automatically | **Unchecked** |

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

To create a whole year of those listed events at once, open the tour's page (`/manage/golf/leagues/:leagueId`),
pick the year on its tournament calendar, and choose *Import {year} from provider*. Every
event the mock lists for that tour and year is created and linked for scores; ones the tour
already has are skipped, so it is safe to run again. The tour's match keyword must be the
mock's tour name exactly, `PGA TOUR` or `LPGA Tour` (#385). The single-event browse
accepts that keyword too, as well as a substring of event names.

## 3. Check the rounds

The Workflow card's *Rounds* list should show R1 to R4. Scores for a round with no round
row are skipped, so add any that are missing with *Edit schedule*.

## 4. Load the field from the mock

*Field* (`/manage/golf/tournaments/:id/field`), then *Load Participant Field*. This loads
the mock's 80 golfers and records each one's mock id, which is what the score sync matches
on. Then:

- each golfer arrives with the mock's ranking, so tiers can be auto-assigned straight away;
  change rankings or odds in the field grid if you like;
- do not use *Add more participants* or *Seed field from league roster*: the golfers they
  add have no mock id and will never score.

The field load matches players by mock id only. If the roster already holds a hand-made
player with the same name as a mock golfer, you will see both.

## 5. Build tiers

*Tiers* (`/manage/golf/tournaments/:id/tiers`), then *Auto-assign tiers from ranking*. A golf
event starts with six tiers. Auto-assign fills them in ranking order, ten golfers at a time,
and the last tier takes everyone left. The mock's 80 golfers therefore come out as
10/10/10/10/10/30. A tier-pick contest's configuration is checked against this tier count.

## 6. Create contests and entries

As a commissioner of a test league (root admin is not needed):

1. *Create Contest* (`/league/:leagueCode/contests/new`) and pick the tournament. Creation
   is refused before *Field release* or after *Field locks*, or when the field is empty.
2. Submit entries from one or more test accounts while the contest is open.

## 7. Go live

Do these two in this order.

1. On the score-source card, *Start live simulation*. The card shows the round under way
   and when the simulation finishes, and it refreshes that every 30 seconds, including
   after you leave and come back. By default each round takes 20 minutes, so a full
   tournament takes 80 minutes.
2. On the Workflow card, *Move to In Progress*. Open and locked contests on the tournament
   become active, and the live-score sync starts polling it.

Start the simulation first anyway. A simulated event has no scores until its simulation
starts, so polls before then bring nothing in. An event linked from the provider list
instead answers with fixed scores until a simulation runs, and a poll that stores those
mixes them with the simulated ones.

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
