# Race Setup Procedures

How a root admin sets up a horse race in QA (or locally) and runs it from field to settled
contest, through the Manage pages. It is written for the first one, the **Pegasus World Cup**
on the **US Thoroughbred** circuit, and applies as it stands to any later race on that
circuit (the Kentucky Derby, the Breeders' Cup Classic).

An auto race (the Daytona 500, the Indy 500) follows the same steps with the differences in
[Auto racing](#auto-racing) at the end.

A cycling race (the Tour de France, a one-day Monument) does too, with the differences in
[Cycling](#cycling) at the end.

So does a marathon (Boston, New York), with the differences in [Running](#running) at the end.

Golf works differently, through a simulated score feed, and cancelling a race is the same as
cancelling any event: see [`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md). To try
racing contests on races already run, load a test seed
([`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md) *Seeded 2026 races*).

Every step is a root-admin screen under `/manage` unless it says otherwise. Horse racing's
pages sit under `/manage/sports/horse-racing/...`; in the side menu it is **Horse racing**
under *Sports*, and its three lists are **Races**, **Horses** and **Circuits**.

## What drives what

- **There is no racing feed.** No provider covers horse racing, so nothing is linked for
  ingestion and nothing arrives on its own: you enter the finishing order yourself. The
  race's *Score source* card reads "Not linked — results must be entered manually". Leave
  it that way. If horse racing is listed for scheduled ingestion, the API logs a warning that
  it has no provider once each time it starts; that is expected, and there is nothing to
  configure.
- **You move the race through its statuses.** Draft, then Scheduled (released), In Progress
  at post time, Completed when the result is official.
- **Contests settle once, when the race moves to Completed.** A settled contest keeps its
  standings, so enter and check the official finishing order *before* completing the race.

## Where races come from

No provider syncs horse racing, so its sport league stays off on a live site and no file loads
real races (#1850, [`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md)). On QA, races to try contests
on come from the racing test seeds through *Load test data* (*Seeded 2026 races* there), each
created as a draft with *Races* `1` and automatic lifecycle **off**: no feed sends a finishing
order, so a race that completed itself would settle its contests on no result. A test seed's
field is listed in post order with made-up odds, so it tiers and prices from the odds.

A race can also be built on the same screens (*Races → New race*, then *Field
→ Add more participants*). Untick *Move this race through Live and Completed automatically*
when you create it, for the reason above, and do not use *Seed field from circuit
roster*: it adds every horse on the circuit's roster, not only this race's runners.

## 1. Odds, tiers, prices and release

A test seed's field already carries odds, so it tiers and prices from them. On a field built by
hand, enter the odds first.

### Morning-line odds

On *Field*, give every horse its morning-line odds: its row's ⤢, then *Edit*, the **Odds**
field and *Save corrections*. Leave **Seed** as the load set it, or blank on a field built by hand.

- Enter odds as a number "to 1": 5-2 is `2.5`, 8-1 is `8`, 30-1 is `30`. Lower is shorter.
- Odds set the tiers (next step) and the budget prices, from the shortest odds down, once every
  horse has odds. Tiers and prices share one order: odds, then seed, then rank, decided by the
  first value every horse has; the dialogs say which.
- To set them all at once, use *Bulk upload* on the *Tools* tab: CSV or JSON with
  `playerName` (or `externalId`) and `oddsToWin` per row, *Preview*, then
  *Apply to field*. It only changes horses already in the field.

### Tiers

On *Field*, *Auto-assign tiers* in the Field section, then *Replace tier assignments*. A horse
race starts with three tiers, and auto-assign fills them three horses at a time from the
favourite, the last tier taking everyone left: a 12-runner field comes out 3/3/6. To move a horse
to another tier, open its row's ⤢, then *Edit*, choose the tier and *Save corrections*.

### Prices

Still on *Field*, press *Auto-assign prices*, keep or change the pricing profile and its
values, and press *Assign prices*. The ⚙ dialog's *Priced with* then names them. Prices are needed
before release even when every contest on the race will be a random draw.

### Release

On the race's page, the *Release ⤢* chip beside its name opens the Release checks; *Release
now*, then confirm. The button stays disabled, with each check marked ✓ or ✗, until the field has horses, every horse
still in it has a tier and a price, and no tier is empty ("Tier 3 has no horses": move horses
into it, since no entry could pick from it). Release moves the race to Scheduled, commissioners can
pick it, and **tiers and prices lock for good**. Odds, seeds and scratches stay editable.

## 2. Contests and entries

As a commissioner of a test league (root admin is not needed):

1. *Commissioner tools › Contests › Create contest* (`/league/:leagueCode/admin/contests/new`).
   Under *Sport*, choose **Horse racing**, then pick the Pegasus World Cup.
2. Choose the format: *Tiered* (one horse from each tier), *Budget* (offered once the race is
   priced) or *Random draw* (the sweep). *Start from* offers the horse racing preset for that
   format; every one scores Win / Place / Show, so *Rules* shows a *Points table* of
   `5, 3, 1` and *Points for not finishing* of `0`.
3. To score differently, edit the *Points table*: whole numbers, winner first, never
   increasing, at most 50 places. A place beyond the table scores 0. *Points for not
   finishing* is what a DNF, DQ, DNS or scratched pick scores.
4. Name it and press *Create contest*. It is saved as a draft; on its page press
   *Open to league*.
5. **Tiered and budget:** members enter from the contest page and press *Submit entry*. A
   submitted entry can be changed and saved (*Save entry*) until post time.
6. **Random draw:** members join from the contest page; there is nothing to pick or submit.
   Once entries are in and before post time, the commissioner presses *Run draw* on the
   commissioner's contest page (`/league/:leagueCode/admin/contests/:contestId`). The draw
   deals each entry its horses from the horses still in the field and submits every entry; it
   is final and can't be run again. It is refused when entries × horses per entry is more than
   the horses still in the field, so check the count after scratches.

## 3. Scratches

A horse withdrawn before the race is **scratched**. On *Field*, open its row's ⤢, press
*Withdraw* and confirm; its row then reads *Withdrawn*.

- **Before release:** scratch it before *Auto-assign tiers*. A scratched horse is
  not tiered or priced and does not hold up release.
- **After release, before post time:** it stays in its tier, but members can no longer pick
  it. A member whose tiered or budget entry holds it should click another horse in the same
  tier (*Replace selection*) and *Save entry*, up to post time; that keeps the entry
  submitted. Unselecting it instead leaves the lineup short, which returns the entry to Draft
  until it is completed and submitted again. The entry page shows the horse as *Scratched*,
  but no notification goes out, so let the commissioners know.
- **Random draw:** a horse scratched before the draw is not dealt. A horse scratched after the
  draw stays with the entry it was dealt to (dealt picks are final) and scores the contest's
  *Points for not finishing* once the result is official, as in a paper sweep.
- **At the gate, after post time:** leave the field alone and enter the horse as `DNS` in the
  result (step 4).

A scratched horse needs no row in the result. Once the result is official it scores
*Points for not finishing*, and the result card shows it as *Scratched*.

## 4. Run the race and enter the result

### At post time

From the race's ⚙, *Move to In Progress* and confirm. Open contests on the race go live.

### The finishing order

*Results* (`/manage/sports/horse-racing/events/:id/results`). The *Result* card shows what is
stored ("No results yet" at first). The *Finishing order* card loads it:

1. *Download CSV template*: one row per horse in the field. Fill in, per row:
   - `finishPosition`: the place, for a horse that finished;
   - `resultStatus`: blank for a finisher, otherwise `DNF` (did not finish), `DQ`
     (disqualified) or `DNS` (did not start);
   - `startPosition` (post position) and `riderName` (the jockey), both optional, shown on the
     Result card's *Start* and *Rider* columns.
   A row with neither a place nor a status is skipped.
2. Paste it (or upload the file) and press *Preview*. Every row should read *Matched*; fix
   any row marked *Several matches*, *Not in the field* or with a row error, and preview again.
   *Apply* stays disabled until nothing is marked.
3. Press *Apply result*.

**Provisional first.** With *This result is official* unticked, the result is stored as
**Provisional**: the contest leaderboard shows each pick's place with a note that places are
provisional, and no pick has points yet. When the stewards make the result official, tick
*This result is official*, paste the order again, *Preview*, and *Apply official result*. The
badge then reads **Official**, and contests score it. You can also go straight to official.

An official result needs a result for every horse still in the field: places 1 to N for
every finisher, not just the top three, and a status for every other runner. Scratched horses
need none.

- **Places** run 1, 2, 3 and on. A **dead heat** repeats a place and skips the next
  (1, 2, 2, 4); each horse in it scores that place's full points.
- **DNF, DQ and DNS** score *Points for not finishing*. A horse the stewards disqualify and
  place behind another (the usual US ruling) is entered at its official place as a finisher,
  not as `DQ`.
- **Corrections** before completing: paste only the changed rows, *Preview* and apply. Horses
  you leave out keep their place. *This result is official* starts ticked once the stored
  result is official; leave it ticked, because the box applies to the whole race and applying
  a correction with it unticked turns the race back to Provisional, and every pick loses its
  points.

### Complete

Once the official result is in and checked, *Move to Completed* from the race's ⚙. This
settles every contest on the race and cannot be undone: a correction entered after it updates
the race's result but not the settled standings.

## 5. Check the settled leaderboard

As a member or commissioner, open the contest's leaderboard
(`/league/:leagueCode/contests/:contestId`, which is the leaderboard once the contest is live). It shows "Final result, settled …",
each pick's place in the *Finish* column (`T2` for a dead heat, `DNF`, `DQ`, `DNS` or
*Scratched* otherwise), and each entry's points from the contest's points table. With the
Win / Place / Show preset an entry holding the winner and the third-placed horse scores 6.

## Later races

The circuit and the horses already exist, so a later race only needs the race and its field.
Each race is its own event (a Derby-day undercard race is a separate race).


## Auto racing

Car racing (NASCAR Cup Series, IndyCar, Formula 1) runs through the same steps under
`/manage/sports/auto-racing/...`: in the side menu it is **Auto racing**, and its three lists
are **Races**, **Drivers** and **Series**. What differs:

- **The series already exist.** **NASCAR Cup Series**, **IndyCar** and **Formula 1** are
  created by migrations, because each one's points presets belong to it. A schedule file names
  the series it loads into. Do not create a second series of the same name.
- **Drivers, not horses.** A driver who races in both series (Indy 500 and NASCAR) is one
  driver. Withdrawing one before the race reads
  *Withdrawn*, not *Scratched*.
- **Starts is the green flag.** It is the cutoff for release, contests and picks.
- **Five tiers of eight.** *Auto-assign tiers* fills them eight drivers at a time
  from the favourite, so a full 40-car NASCAR field comes out 8/8/8/8/8 and a 33-car Indy 500
  field 8/8/8/8/1. Move drivers by hand if the last tier is too thin. A race whose tier count
  you change is spread evenly instead (see Formula 1 below).
- **Presets per series.** On create contest, choose **Auto racing**, then the race. *Start
  from* offers only that series' presets: the tiered one (one driver from each tier, five
  counted) is the default, then budget (five drivers under the cap) and random draw (one
  driver each). NASCAR's points table is 40, 35, 34 and one fewer per place down to 1 at 36th,
  then 1 to 40th; IndyCar's is 50, 40, 35, 32, 30, 28, 26, 24, 22, 20, then 19 down to 6 for
  11th to 24th, then 5 to 33rd. No stage or bonus points.
- **The result names only the driver.** Leave `riderName` blank; the Result card has no
  *Rider* column. `startPosition` is the grid slot. A car out of the race is `DNF`.

### Formula 1

A Grand Prix runs through the same steps in the **Formula 1** series. What differs:

- **Set four tiers.** The sport starts every race on five tiers of eight, which a 22-car F1
  field cannot fill. Before the season's races are made, set the Formula 1 league's *Tier
  profile* to *4 tiers of 6* in its ⚙ on the League page: each race then starts on four tiers,
  and *Auto-assign tiers* fills them six at a time from the favourite, the last taking the
  rest: 22 drivers come out 6/6/6/4.
  The F1 tiered preset counts four picks, one per tier.
- **Budget is the default.** On create contest, an F1 race starts on *Budget* with the
  `Pick 5 drivers under the cap, F1 points` preset (five drivers, five counted). *Tiered*
  (one driver from each of the four tiers) and *Random draw* (one driver each) are the
  alternatives. Budget needs the field priced: until it is, the page starts on *Tiered*.
- **F1 points.** 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for the top ten, nothing below tenth, and 0
  for a car that does not finish. Enter the Grand Prix result only: the sprint race and the
  fastest lap are not scored.

## Cycling

Road racing (UCI WorldTour, UCI Women's WorldTour) runs through the same steps under
`/manage/sports/cycling/...`: in the side menu it is **Cycling**, and its three lists are
**Races**, **Riders** and **Tours**. What differs:

- **The tours already exist.** **UCI WorldTour** and **UCI Women's WorldTour** are created by
  the migration that adds cycling, because each one's presets belong to it. A schedule file names
  the tour it loads into. Do not create a second tour of the same name.
- **One race, one result.** A Grand Tour is one race with one round, whatever its stage count:
  its result is the **final overall classification** (GC), entered once after the last stage.
  Stages are not entered and not scored. A one-day race has the same shape.
- **Riders, not horses.** A rider who does not start
  is withdrawn from the field and reads *Withdrawn*. **Starts** is the start of the race (the
  first stage of a Grand Tour), the cutoff for release, contests and picks; copy reads
  "Entries close at the start".
- **Odds to win overall.** Give every rider their odds to win the race overall (*Bulk upload*
  with `oddsToWin` suits a field of about 175). Odds alone price an unseeded field.
- **Five tiers of ten.** *Auto-assign tiers* fills them ten riders at a time from the
  favourite, the last tier taking the rest: a 176-rider field comes out 10/10/10/10/136. The four
  tiers of contenders hold 40 riders; move riders by hand if a tier looks wrong.
- **Presets per tour.** On create contest, choose **Cycling**, then the race. *Start from*
  offers only that tour's presets: the tiered one (one rider from each tier, five counted) is
  the default, then budget (five riders under the cap) and random draw (one rider each). All
  three score **Top 10 points**: 10 for the winner, 9 for second, down to 1 for tenth, and 0
  below that.
- **The result names only the rider.** The Result card heads its columns *Finish*, *Rider*
  (the cyclist) and *Start*, with no jockey column; leave `riderName` and `startPosition`
  blank. Give every rider who reached the finish their overall place, 1 to N, not just the top
  ten. A rider who **abandoned** mid-race, or was eliminated outside the time limit, is `DNF`
  and scores 0; a disqualified rider is `DQ`.
- **Keep it In Progress for the three weeks.** Move the race to In Progress at the start and to
  Completed only once the final classification is official. A provisional GC after a stage
  shows on the leaderboard but scores nothing until the official result.

## Running

Marathons (World Marathon Majors) run through the same steps under
`/manage/sports/running/...`: in the side menu it is **Running**, and its three lists are
**Races**, **Runners** and **Series**. What differs:

- **The series already exist.** **World Marathon Majors (men)** and **World Marathon Majors
  (women)** are created by the migration that adds running, because each one's presets belong
  to it. A schedule file names the series it loads into. Do not create a second series of the
  same name.
- **One race, one result.** A marathon is one race with one round. Its result is the official
  finishing order; gun and chip times are not entered.
- **Elite field only.** Put only the elite
  field on the race: 20 to 40 runners, never the mass start. A runner who does not start is
  withdrawn from the field and reads *Withdrawn*. **Starts** is the elite start, the cutoff for
  release, contests and picks; copy reads "Entries close at the start".
- **Ranking and seed, not odds.** Odds are thin for marathons, so *Bulk upload* each runner's
  World Athletics ranking as `ranking` and the same order as `seedNumber`. Odds are optional:
  ranking and seed alone tier and price the field.
- **Four tiers of six, by seed.** On *Field*, press *Auto-assign tiers*. With no odds in the
  field it orders the runners by seed (the ranking order), and fills the tiers six at a time,
  the last tier taking the rest: a 30-runner field comes out 6/6/6/12. *Auto-assign prices* then
  prices in the same order, best seed first.
- **Presets per series.** On create contest, choose **Running**, then the race. *Start from*
  offers only that series' presets: the tiered one (one runner from each of the four tiers, all
  four counted) is the default, then budget (four runners under the cap) and random draw (one
  runner each). All three score **Top 10 points**: 10 for the winner, 9 for second, down to 1
  for tenth, and 0 below that.
- **The result names only the runner.** The Result card heads its columns *Finish*, *Runner*
  and *Start*, with no jockey column; leave `riderName` and `startPosition` blank. Give every
  runner who finished their place, 1 to N, not just the top ten. A runner who **dropped out** is
  `DNF` and scores 0; a disqualified runner is `DQ`.
