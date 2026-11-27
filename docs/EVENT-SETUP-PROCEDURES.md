# Event Setup Procedures

How a root admin takes an event on the Manage screens through its lifecycle, from draft to
settled contests. The numbered steps follow a golf tournament of a tour synced from its provider
(BALLDONTLIE), so the tournament, its field and its live scores come from that provider's feed.
An event made by hand is a test event: no provider has an id for it, so no feed loads its field
or scores it (#2004). No provider simulates a live round (`rules/architecture-rules.md` §3 *Provider and
Adapter Registry Discipline*): live scores arrive only while the real tournament is being
played, and contests on past events are tried from the test seeds instead (*Loading instead of
typing*, below). Release, contests, the lifecycle moves and cancelling work the same way for
every sport.

- **Races** (horse racing, auto racing, cycling, running) have no score feed here, so a test
  race's finishing order comes from the test-data loader; Manage has no results entry (#2008):
  see [`RACE-SETUP-PROCEDURES.md`](RACE-SETUP-PROCEDURES.md).
- **Knockouts** (basketball, American football) are resulted game by game on the event's Bracket
  tab: *Knockout brackets* below.
- **Loading instead of typing.** Events, fields and brackets can come from a data file, and
  ready-made test seeds hold real past events to try contests on without any of this setup,
  their results entered and the events completed by a later run once their game times pass: see
  [`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md).

Every step is a root-admin screen under `/manage` unless it says otherwise.

## What drives a golf tournament

- **The tour's sync creates the event.** Each tournament it creates is kept under the
  provider's id for it, which is what every later sync of it goes by. No screen links an event
  to a provider event by hand, or unlinks one (#2004).
- **The provider owns the scores.** Its feed scores golfers hole by hole while the real
  tournament is being played.
- **The live-score sync carries scores across.** It polls every tournament its provider has an
  id for that is *In progress* and has a field. It does not look at dates.
- **Golfers are matched by provider id, never by name.** A score only lands on a golfer
  whose player record came from the provider, so the field must be loaded from it (step 4).
  Golfers added by hand from the roster get no scores.

## Before you start

1. **Live-score sync is on, every 60 seconds.** Open *Manage → Providers*
   (`/manage/providers`). Under *Sync schedules*, open the **Live scores** row, choose *Edit*,
   tick *Runs on its schedule* and set *Every, seconds* to `60`. The default is 300. This one setting applies to every
   sport and every synced tournament in the environment: there are no per-sport overrides
   (#1871). A new interval starts only after the current wait runs out, so the first poll
   after the change can take up to the old 300 seconds.
2. **Fields load on the Field row's schedule.** The **Field** row on the same section sets
   how often fields refresh and how many days ahead. The Field sync has no switch (#2086): it
   always runs, for synced sport leagues only, and leagues that are not synced are off. The
   API says which syncs have a switch, and the page draws only those.
3. **The tour is synced.** Its League page names the provider league it is synced from. A tour
   with none is off, and a hand-made tournament on it is a test event.

## 1. Create the tournament

A hand-made tournament is a **test event**: it is made on a **test slot** of the tour's current
Season, a labelled slot that is QA only and that the sync never reads or writes (#2004). Open the
tour's League page, its Events tab, and choose *New test event*
(`/manage/sports/golf/events/new?sportLeagueId=…`).

1. Under **New test slot**, pick the slot definition it plays (*Plays*, for a test tour its
   TEST_EVENT slot), a label of your own, and its start and end. The start is the cutoff: the
   tournament can't be released, and contests can't be created or opened, once it has passed.
   *Add test slot* adds it to the current Season and picks it above.
2. Under **Test event**:

| Field | Set it to |
|---|---|
| Tour | Prefilled from the League page |
| Test slot | The slot added in 1 (only free test slots of the current Season are listed) |
| Name, Venue, Location | A name of your own (for example "Derek's Golf Tournament") |
| Rounds | **4**, the tournament's rounds, all played in its one slot |
| Move this tournament through Live and Completed automatically | **Unchecked** |

The tournament takes its dates from its slot, and its round count is the rounds it was made with
(its Round rows, #2008); neither changes later in its ⚙ dialog. Its **Slots** tab lists the slot.

The tournament is saved as a **draft**: commissioners can't see it until step 6.

Leave automatic lifecycle off. With it on, a background job moves the tournament to
In progress and Completed from its round dates, which takes the timing out of your hands.
You can turn it off later from the tournament's ⚙: *Automatic lifecycle on*, *Turn off*.

## 2. The provider's id for it

The tour's sync creates its tournaments, so step 1 is for a test event only; a synced
tournament is already there, a draft, with the provider's id for it. Its ⚙ dialog lists that id
under *Feed ids*, and its badge reads *Scores synced*. A test event lists none, and its sync
button is refused (`EVENT_NOT_LINKED`).

To create a whole year of the provider's events at once, rather than wait for the sync, open the tour's page (`/manage/sports/golf/leagues/:leagueId`),
pick the year on its tournament calendar, and choose *Import {year} from provider*. Every
event the provider lists for that tour and year is created under the provider's id for it; ones the tour
already has are skipped, so it is safe to run again. The import needs the tour synced: its
selected provider league mapping names the provider and the provider league, and the import asks
that provider for that league alone, keeping only events stamped with its code (#1997). A tour
with no selected mapping is refused (`SPORT_LEAGUE_NOT_SYNCED`); when the provider's plan does
not include that league, the dialog says so (#1797).

## 3. Check the rounds

The *Rounds* grid on the Rounds and matches tab should show R1 to R4; scores for a round with no
round row are skipped. Open a round (⤢) to see its dates, and *Edit* in its dialog to move them on
an event no feed syncs.

## 4. Load the field from the provider

*Field* (`/manage/sports/golf/events/:id/field`), then *Load Participant Field*. This loads
the provider's field and records each golfer's provider id, which is what the score sync
matches on. Then:

- each golfer arrives with the provider's ranking, so tiers can be auto-assigned straight away;
  you can correct a golfer's rank or seed with ⤢ › *Edit* on its Field row (odds come only from
  the feed, so the dialog shows them but never edits them), or withdraw it
  with ⤢ › *Withdraw*, but a later
  *Refresh Participant Field* replaces them with the provider's values for every golfer
  it reports (it asks you to confirm first);
- do not use *Add more participants*: the golfers it adds have no provider id and will never
  score.

The field load matches players by provider id only. If the roster already holds a hand-made
player with the same name as a provider golfer, you will see both.

There is no field upload (#2008): rankings, seeds and odds come from the feed. Correct one
golfer in their dialog; a later *Refresh Participant Field* replaces those values with the
provider's again (#415).

## 5. Build tiers

On *Field*, press *Auto-assign tiers* in the Field section. A golf event starts with six
tiers. Auto-assign fills them in the field's order (odds, then seed, then rank, by the first
value every golfer has; the dialog says which), ten golfers at a time, and the last tier takes
everyone left. An 80-golfer field therefore comes out as 10/10/10/10/10/30. The layout is the
sport league's tier profile (#1844), chosen in the league's ⚙ on its League page, and an event
takes its tiers from it when it is made: another league can start its events on its own (the
College Football Playoff's "6 tiers of 2": its 12 teams come out two to a tier). A tier-pick
contest's configuration is checked against this tier count.

One event can override them: the ⚙ dialog's *Edit tiers* (until release) renames, reorders,
adds and removes this event's tiers. While no tier was set by hand, *Save tiers* places the
field in the new tiers at once, as *Auto-assign tiers* would. Once one was, everyone keeps their
place and the dialog asks which tier a removed tier's participants move to.

To move one golfer to another tier, open its Field row's ⤢, then *Edit*, choose the tier and
*Save corrections*. It goes last in that tier, and its **Set by** reads *Manual*: a manual tier
stops automatic tiering for the event. *Auto-assign prices*, beside *Auto-assign tiers*,
prices the field the same way, and a golfer's price is corrected in the same dialog. The ⚙
dialog's *Priced with* says which values priced it.

## 6. Release it for contests

On the tournament's page, the *Release ⤢* chip beside its name opens the Release checks;
*Release now*, then confirm. The button stays disabled, with each check marked ✓ or ✗, until the field is loaded, every
active golfer has a tier, and every tier has an active golfer in it ("Tier 6 has no golfers":
no entry could pick from an empty tier, so move golfers into it). Release moves the tournament from Draft to Scheduled, and
commissioners can now pick it. It also **locks the tiers and prices for good**: automatic
tiers and prices leave the Field section, and a golfer's dialog no longer edits its tier or price. Rankings, odds and withdrawals stay editable, and a
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
   - **Bracket**, for a knockout (basketball, American football): every game, from the first
     round to the final, picked before it starts.
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

When the real tournament tees off, *Move to In Progress* from the tournament's ⚙. Open
contests on the tournament become active, and the live-score sync starts polling it.

## 9. Watch it

- The contest leaderboard changes as the provider reports holes played, about once a minute
  at the 60-second live-score interval.
- The cut is made after round 2, as the provider reports it; golfers who miss it show as
  missed cut.
- *Activity* (`/manage/activity`, filter Kind to Sync) shows each live-score run. A run that brings nothing
  in usually means the tournament is not In progress, has no field, or its golfers did not
  come from the provider.

## 10. Finish

When the provider's tournament is final, *Move to Completed* from the tournament's ⚙.
Final standings are built from the scores PoolMaster has already received.

## Running it again

- **A test slot holds one event.** A finished test event keeps its slot; add another test slot,
  with a new label, for the next run.

## Knockout brackets

A basketball tournament or a playoff is a knockout bracket. Its field, games and results come
from the provider's feed, and nothing on the Event page enters or corrects them (ADR 0013,
#2074): the Bracket tab, its pairing editor, *Withdrawals*, the quarter-score rows
and the Tools tabs are gone. The Rounds and matches tab shows each game's score, winner and where
the result came from, and a wrong result is fixed by the feed and applied with *Settle again*.
Test data still loads through a sport data file ([`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md)
*Loading sport data*, *Brackets*), which writes through the admin result routes
([`DOMAIN-OPERATIONS.md`](DOMAIN-OPERATIONS.md), *SportEventRoundMatch*).

- **Before releasing a provider-synced NCAA men's tournament**, check which regions meet in
  national semifinals 61 and 62 against the official bracket's Final Four pairing. The provider's
  bracket pairs them by its region order, which the provider does not promise; the sync logs the
  pairing it loaded ("check them against the official bracket before release",
  `crossRegionPairings`). If it is wrong, hold the release: the links come from the code
  (`toNcaaBracket`), so it needs a fix there. The First Four is the event's round 1, its four
  pairings' teams in the field, and each winner advances into its round of 64 side (#2184).
- **Withdrawals**: a team or player who withdraws is the feed's to report; one that withdraws
  once their game has started is a walkover in the feed's result.
- **Period scores** (quarters in American football, halves in men's college basketball and
  soccer, periods in hockey) come from the feed, and squares pools read them.

The NBA and WNBA playoffs are basketball tournaments too, in their own sport leagues. A series
is one game of the bracket: the feed records the team that won the series, with the games each
side won as the score (4-2). The NBA's play-in tournament is not a round of the bracket: the feed's
bracket starts once it is played, its winners the 7 and 8 seeds. Those leagues' rounds show their own
names (Conference Finals, NBA Finals), not March Madness's.

The College Football Playoff is a fixed bracket in its own American football sport league: 12
teams, the top four seeds placed straight into the quarterfinals (a bye counts as a win), the
first round at the higher seed's campus and every later game at a bowl site. Its rounds show its
own names (Quarterfinals, National Championship), not the NFL's. The 2026-27 playoff keeps 12
teams; a larger field would change its round count and need presets to match.

Hockey (#788) has four sport leagues, every bracket fixed. The NHL's 16 teams play four rounds
of best-of-seven series, seeded 1 to 3 in each division with both wild cards 4; the PWHL's four
play best-of-five semifinals and a final, the first seed choosing its semifinal opponent before
the bracket is loaded. Like the NBA's, each series is one game of the bracket, scored in games
won. The NCAA men's tournament is 16 teams in four regions of four, every game at a neutral
site; the women's seeds five teams, and the six others play a first round for three
quarterfinal places. The PWHL starts on two tiers,
the others on four. Only the college title games, single games, take squares pools.

Baseball (#789) has one sport league, the MLB postseason, a fixed bracket of 12 teams in four
rounds of series: best-of-three Wild Card Series at the better seed's park, best-of-five
Division Series, best-of-seven League Championship Series and World Series. Each league's
teams are seeded 1 to 6, and the top two seeds are placed straight into the Division Series,
as the CFP's byes are (a bye counts as a win). Each series is one game of the bracket, scored in
games won, so baseball takes no squares pools. It starts on four tiers of three.

Soccer (#787) has five sport leagues, every bracket fixed: the FIFA World Cup, the FIFA
Women's World Cup, the UEFA European Championship and the Copa América, each event its
knockout stage at neutral sites seeded by FIFA ranking, and the UEFA Champions League. A
match's final score is the score after extra time. A match level after extra time carries its
shoot-out too (4-3 pens), and the shoot-out's winner goes through; the score stays level. The
first half's score, from the feed, feeds squares pools. The third-place match is not part of the
bracket. The Champions League starts at its knockout play-offs, naming its own rounds: its
league phase's top eight are placed straight into the Round of 16 (a bye counts as a win), and
each two-legged tie is one game of the bracket, scored on aggregate, scheduled at the first
leg, its home side the first leg's host. A tie level on aggregate goes to its shoot-out, as a
single match does. The Copa América starts at the quarter-finals; every other competition
starts on four tiers of four. Where the World Cup's sync is live, the feed loads its knockout
bracket instead, in FIFA's own order rather than by ranking, once every round of 32 team is
decided (`LIVE-SPORTS-DATA-SYNC.md` *Games and brackets*).

Soccer's club and college playoffs are four more sport leagues, each naming its own rounds:
MLS, the NWSL, and the NCAA Division I men's and women's tournaments. MLS starts at its wild
card round, the 8 and 9 seeds of each conference playing for the 1 seed's place. Its round one
is a best-of-three series entered as one game, scored in games won (a drawn game goes straight
to penalties, and the shoot-out's winner takes that game), so it has no half-time score. The
NCAA men's 16 seeds are placed straight into the second round. The higher seed is the home side
until a neutral-site final (the NWSL championship, each College Cup).

Soccer's league seasons and group matchdays (#787) are week events, as an NFL week is: one event
per Premier League matchweek, and one per group matchday of the World Cup, the Euros and the Copa
América, or per Champions League league phase matchday, each in its competition's own sport
league. A week takes pick'em, with draw picks, and the Premier League's also takes Last Man
Standing, a survivor pool whose teams can be picked again once an entry has used all 20. A drawn
game's result has no winner. A postponed match is cancelled from its week; when it is
replayed later, it is a game of the week it is played in.

**Squares slots.** Each slot definition says whether its Games take squares
(`squaresEligible`, #2050): a slot whose ties are two legs does not, so the Champions League
takes squares on its final only and MLS from its conference semifinals. The API offers a squares
contest only the Games of an eligible slot, and create refuses any other. Every other league's
slots take squares.

**Series rounds.** A playoff round that is a best-of series takes its length from the Season
slot it is played in (`seriesGames`, from the slot definition the migration seeds, #2006): the
NBA and NHL 7, 7, 7, 7, MLB 3, 5, 7, 7, the WNBA 3, 5, 7, MLS 1, 3, 1, 1, 1. A series is still one bracket match whose score is games won; a
synced event counts its games' winners against the length and records the series once a side has
won more than half. A test data file gives a series' result as the games won (4-2).
When a league changes its format, change its slot definitions' lengths by migration before the playoffs start.

Tennis (#704) has two sport leagues, the ATP (men's singles) and the WTA (women's singles), each
holding the four Grand Slams; every bracket is fixed. A Slam singles draw is 128 players in seven
rounds, First round to Final, with the tournament's 32 seeds as seeds 1 to 32 and everyone else
unseeded (the admin's "derive seeds from ranking" action is not used, because it would overwrite
the real seeds). Each quarter of the draw is a region ("Top quarter" to "Bottom quarter")
through the quarterfinals. Qualifying is not a round of the draw: the draw's qualifiers are in its
field once qualifying ends. A player who withdraws before their first
match is replaced by the lucky loser the feed reports. A match's score is sets won (3-1) and
is optional: a winner alone is enough. A match that ended early carries how it ended: a
retirement, a walkover (no score) or a default; the winner advances in full. There
are no periods, so no squares pools. A draw starts on six tiers of eight by ranking, the last
taking everyone else, so the first four tiers are the seeds.

**Reseeded brackets.** An event whose rounds are played in slots paired `RESEEDED` (the NFL's
postseason slot definitions, #2006) loads each round that is placed by seed with no next game in the round
before it, and names only its byes. The NFL's Wild Card and Divisional games both link nowhere,
so the Divisional round and the conference championships are each placed by seed; the
conference winners link to the Super Bowl. Release lets those rounds wait. Once every game of
the round before has a result, the feed places each such round: in each conference the best seed
left hosts the worst. Test data sets a round through `proposeEventRoundMatchups` and
`setEventRoundMatchups`, which set every game of the round at once; the Bracket tab's *Reseeded
rounds* card is gone (#2074).

## Cancelling an event or a game

An event that will not be played is cancelled from the ⚙ on its page: *Move to
Cancelled*, then confirm. It is offered from Draft, Scheduled, In Progress and Postponed (*Move
to Postponed* parks an event whose date is moving; it goes back to Scheduled or In Progress
later, and while its start is ahead its live contests take entries and pick changes again). Cancelled is final: no move leads out of it, and a data file never changes the event
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
regular-season week): the feed cancels it (test data through `cancelEventMatch`), only on a
released week (a draft's games are edited freely) and an unplayed game. A
cancelled game counts for nothing in any contest. A game put off to a later day of its own week,
or of a bracket round, is postponed by the feed, which sets its new time; its picks stay open
until then. A game that moves to another
week is cancelled in its own week and added to the week it moves to while that week is still a
draft. A bracket's
games cannot be cancelled: every one of them decides who goes on.
