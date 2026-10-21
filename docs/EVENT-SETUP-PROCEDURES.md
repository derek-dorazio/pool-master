# Event Setup Procedures

How a root admin sets up an event by hand on the Manage screens and runs it through its
lifecycle, from draft to settled contests. The numbered steps follow a made-up golf tournament
in QA (or locally), scored by the mock provider's simulated live round, to test contests,
entries and the live leaderboard; nothing here depends on a real tournament being played that
week. Release, contests, the lifecycle moves and cancelling work the same way for every sport.

- **Races** (horse racing, auto racing, cycling, running) have no score feed, so a race's
  finishing order is entered by hand: see [`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md).
- **Knockouts** (basketball, American football) are resulted game by game on the event's Bracket
  tab: *Knockout brackets* below.
- **Loading instead of typing.** Events, fields and brackets can come from a data file, and
  ready-made test seeds hold played events to try contests on without any of this setup: see
  [`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md).

Every step is a root-admin screen under `/manage` unless it says otherwise.

## What drives a golf tournament

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
16/16/16/16/16. A sport league can start its events on its own tier count instead of the
sport's (the College Football Playoff: six tiers, so its 12 teams come out two to a tier). A
tier-pick contest's configuration is checked against this tier count.

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
   (`/league/:leagueCode/admin/contests/new`). The one page lists only events that are
   released and haven't started, soonest first; pick yours, then a format, keep or change the
   preset and rules, and the name follows the event until you type your own. The formats are
   the sport's own:
   - **Tiered**, **Budget** and **Random draw** for every sport. Budget is offered only on an
     event whose field has been priced; its salary cap is the event's and shows read-only. A
     random draw has nothing to pick: the commissioner runs the draw once entries are in.
   - **Bracket**, for a knockout (basketball, American football): every game picked before it
     starts, or a second-chance bracket from a later round once the knockout is under way.
   - **Pick'em** and **Survivor**, for a week of games (American football, basketball): every
     game's winner each week, or one team to win each week.

   A contest starts on one event. A tiered, budget, pick'em or survivor contest can cover
   more: its *Events* page in Commissioner tools adds the sport league's other released events
   (a season of weeks, or several tournaments) until the contest is final, and removes them
   only until one of them starts; the contest is final when the last one ends. A random draw
   and a bracket cover one event each.

   The contest is saved as a draft and you land on its page in Commissioner tools, which checks the event is ready;
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

## Knockout brackets

A basketball tournament or a playoff is a knockout bracket, resulted by hand on its **Bracket** tab. Its
field and games usually come from a sport data file ([`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md)
*Loading sport data*, *Brackets*);
otherwise the field is built on the Field tab and the games are loaded through
`loadEventBracket` ([`DOMAIN-OPERATIONS.md`](DOMAIN-OPERATIONS.md), *SportEventMatch*). Then
on the Bracket tab:

- **Before release**, *Edit pairing* changes a game's two teams. Only teams no other game holds
  are offered, so to swap two teams, empty one side first. A side an earlier game's winner fills
  cannot be edited. Under *Play-in places*, mark each field row that stands for a First Four
  pairing ("Texas / Xavier").
- **After release**, choose the team that won each game; the winner moves to its next game and
  the standings update. A wrong winner can be switched, or the result cleared, until the next
  game has a result. Each play-in place takes its winner once, from the sport's active teams
  not already in the tournament.
- **Quarter scores**, for American football (#772): under each released game with both teams,
  *Enter score* takes both teams' score at the end of the first, second and third quarters, as
  the scoreboard shows it, and the final score, overtime included, which saves the game's result
  with the higher score winning. A score can't go down as the game goes on, so a quarter's score
  is refused below an earlier quarter's or above a later one's or the final score. Squares pools
  read them. Men's college basketball takes a halftime score (#786), and hockey the scores at
  the end of the first and second periods (#788), and soccer a half-time score (#787), each
  before its final score.

The NBA and WNBA playoffs are basketball tournaments too, in their own sport leagues. A series
is one game of the bracket: choose the team that won the series, with the games each side won
as the score (4-2). The NBA's 7 and 8 seeds in each conference are play-in places until the
play-in tournament is played, as the First Four's are. Those leagues' rounds show their own
names (Conference Finals, NBA Finals), not March Madness's.

The College Football Playoff is a fixed bracket in its own American football sport league: 12
teams, the top four seeds placed straight into the quarterfinals (a bye scores nothing), the
first round at the higher seed's campus and every later game at a bowl site. Its rounds show its
own names (Quarterfinals, National Championship), not the NFL's. The 2026-27 playoff keeps 12
teams; a larger field would change its round count and need presets to match.

Hockey (#788) has four sport leagues, every bracket fixed. The NHL's 16 teams play four rounds
of best-of-seven series, seeded 1 to 3 in each division with both wild cards 4; the PWHL's four
play best-of-five semifinals and a final, the first seed choosing its semifinal opponent before
the bracket is loaded. Like the NBA's, each series is one game of the bracket, scored in games
won. The NCAA men's tournament is 16 teams in four regions of four, every game at a neutral
site; the women's seeds five teams, and the six others play a first round for three
quarterfinal places, which are play-in places until it is played. The PWHL starts on two tiers,
the others on four. Only the college title games, single games, take squares pools.

Baseball (#789) has one sport league, the MLB postseason, a fixed bracket of 12 teams in four
rounds of series: best-of-three Wild Card Series at the better seed's park, best-of-five
Division Series, best-of-seven League Championship Series and World Series. Each league's
teams are seeded 1 to 6, and the top two seeds are placed straight into the Division Series,
as the CFP's byes are (a bye scores nothing). Each series is one game of the bracket, scored in
games won, so baseball takes no squares pools. It starts on four tiers of three.

Soccer (#787) has five sport leagues, every bracket fixed: the FIFA World Cup, the FIFA
Women's World Cup, the UEFA European Championship and the Copa América, each event its
knockout stage at neutral sites seeded by FIFA ranking, and the UEFA Champions League. A
match's final score is the score after extra time. A match level after extra time asks for its
shoot-out too (4-3 pens), and the shoot-out's winner goes through; the score stays level. The
first half's score is entered for squares pools. The third-place match is not part of the
bracket. The Champions League starts at its knockout play-offs, naming its own rounds: its
league phase's top eight are placed straight into the Round of 16 (a bye scores nothing), and
each two-legged tie is one game of the bracket, scored on aggregate, scheduled at the first
leg, its home side the first leg's host. A tie level on aggregate goes to its shoot-out, as a
single match does. The Copa América starts at the quarter-finals; every other competition
starts on four tiers of four.

Tennis (#704) has two sport leagues, the ATP (men's singles) and the WTA (women's singles), each
holding the four Grand Slams; every bracket is fixed. A Slam singles draw is 128 players in seven
rounds, First round to Final, with the tournament's 32 seeds as seeds 1 to 32 and everyone else
unseeded (the admin's "derive seeds from ranking" action is not used, because it would overwrite
the real seeds). Each quarter of the draw is a region ("Top quarter" to "Bottom quarter")
through the quarterfinals. The draw's qualifier places are play-in places, named "qualifier"
on the Bracket tab, and are filled once qualifying ends. A match's score is sets won (3-1) and
is optional: choosing the winner is enough. A match that ended early is entered with **Ended
early**: a retirement, a walkover (no score) or a default; the winner advances in full. There
are no periods, so no squares pools. A draw starts on six tiers of eight by ranking, the last
taking everyone else, so the first four tiers are the seeds.

**Reseeded brackets.** A sport league that reseeds (the NFL, `bracketAdvancement`
`RESEED_BY_SEED`) loads each round that is placed by seed with no next game in the round
before it, and names only its byes. The NFL's Wild Card and Divisional games both link nowhere,
so the Divisional round and the conference championships are each placed by seed; the
conference winners link to the Super Bowl. Release lets those rounds wait. Once every game of
the round before has a result, the Bracket tab's *Reseeded rounds* card offers *Suggest games*
for that round (`proposeEventRoundMatchups`): in each conference the best seed left hosts the
worst, and each game's home and away team is filled in. Change any side to a pairing of your own
that keeps each team in its conference and each bye in place, then *Save games*
(`setEventRoundMatchups`), which sets every game of the round at once. Until the round before is
finished the card names the games still without a result; once a game of the round has started,
the round is no longer offered. A first-round result corrected after that moves the team it
placed, until that team has played.

## Cancelling an event or a game

An event that will not be played is cancelled from the Workflow card on its home page: *Move to
Cancelled*, then confirm. It is offered from Draft, Scheduled, In Progress and Postponed (*Move
to Postponed* parks an event whose date is moving; it goes back to Scheduled or In Progress
later). Cancelled is final: no move leads out of it, and a data file never changes the event
again.

A cancelled event counts for nothing, whatever scores or results it already holds:

- Its contests settle at once, as completing it would. A contest on that event alone ends
  **Final** with no scores and no standings.
- A contest that covers several events (a pick'em or survivor season, several tournaments)
  skips it: the event adds nothing to any entry's total, and the contest settles on the others
  once each of them has completed or been cancelled. A contest whose events are all cancelled
  ends Final with no scores.
- A contest still in draft is not settled; delete it from its page.

A single game is cancelled instead, for a week of games that forms no bracket (an NFL
regular-season week): *Cancel game* on its row of the week's results page, then confirm. It is
offered only on a released week (a draft's games are edited freely) and an unplayed game; clear
a result first. A cancelled game counts for nothing in any contest. A postponed game is cancelled
in its own week and added to the week it moves to while that week is still a draft. A bracket's
games cannot be cancelled: every one of them decides who goes on.
