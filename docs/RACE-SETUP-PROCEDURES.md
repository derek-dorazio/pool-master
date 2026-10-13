# Race Setup Procedures

How a root admin sets up a horse race in QA (or locally) and runs it from field to settled
contest, through the Manage pages. It is written for the first one, the **Pegasus World Cup**
on the **US Thoroughbred** circuit, and applies as it stands to any later race on that
circuit (the Kentucky Derby, the Breeders' Cup Classic).

An auto race (the Daytona 500, the Indy 500) follows the same steps with the differences in
[Auto racing](#auto-racing) at the end.

Golf works differently, through a simulated score feed: see
[`EVENT-SETUP-PROCEDURES.md`](EVENT-SETUP-PROCEDURES.md).

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

## 1. Create the US Thoroughbred circuit

Once only. *Horse racing → Circuits* (`/manage/sports/horse-racing/leagues`), then
*New circuit*.

| Field | Set it to |
|---|---|
| Circuit name | `US Thoroughbred` |
| Match keyword | Leave blank (it filters a provider's catalog, and there is none) |

Press *Create circuit*. Every US Thoroughbred race (Pegasus World Cup, Kentucky Derby,
Preakness, Belmont, Breeders' Cup Classic) goes on this one circuit.

## 2. Add the horses

*Horse racing → Horses* (`/manage/sports/horse-racing/participants`), then *Add horse* for
each runner. Only *Name* is required; *Short name*, *Nationality* and *External ID* are
optional (leave External ID blank: there is no provider to match).

A horse is created once and runs in many races, so check the list (*Find a horse*) before
adding one.

**Optional: put them on the circuit's roster.** On the circuit's page
(`/manage/sports/horse-racing/leagues/:leagueId`), the *Roster* card's *Add horse* adds a
horse to US Thoroughbred. A horse that is not on the roster still runs; the field grid
just badges it *Guest*. The roster makes the next step quicker, because the field's add
dialog can list it.

## 3. Create the Pegasus World Cup

*Horse racing → Races → New race* (`/manage/sports/horse-racing/events/new`), *Build manually*.

| Field | Set it to |
|---|---|
| Name | `Pegasus World Cup` |
| Venue, Location | `Gulfstream Park`, `Hallandale Beach, Florida` |
| Starts | Post time, in your browser's local time. The race is late January 2027: **confirm the date and post time with Gulfstream Park when you create it.** Post time is the cutoff: the race can't be released, and contests can't be created or opened, once it has passed. Picks close then too |
| Ends (optional) | Leave blank |
| Races | `1` (the default for horse racing) |
| Circuit | US Thoroughbred |
| Event year | `2027` |
| Move this race through Live and Completed automatically | **Untick it** (it starts ticked) |

Press *Create race*. The race is saved as a **draft** that only admins can see.

Turn automatic lifecycle off. With it on, a background job moves the race to In Progress at
post time on its own; with *Ends* blank and no end time on the race it never completes the
race, so you would still complete it by hand. Running the whole lifecycle by hand keeps the
two steps together and lets you choose the moment. If you forget, the Workflow card's
*Manage lifecycle manually* turns it off.

**Post time is the race's *Starts*.** To change it (a delayed post, a date confirmed late),
use the *Details* card's **Edit** on the race's page. The Workflow card's *Edit schedule*
only moves the dates on the *Races* list (the race rounds), not *Starts*, so it does not move
the release, contest or picks cutoff.

## 4. Build the field

### Add the runners

*Field* (`/manage/sports/horse-racing/events/:id/field`), then *Add more participants*. Pick
US Thoroughbred to browse its roster, or type at least two letters under *Search all horses*,
tick each runner, and press *Add selected (n)*, then *Done*.

Do not use *Seed field from circuit roster*: it adds every horse on the circuit's roster,
not only this race's runners, and it derives seeds and odds from circuit rankings, which
horses don't have.

### Morning-line odds

In the field grid, give every horse its morning-line odds in the **Odds** column, then press
*Save changes*. Leave **Seed** blank.

- Enter odds as a number "to 1": 5-2 is `2.5`, 8-1 is `8`, 30-1 is `30`. Lower is shorter.
- Odds set the tiers (next step) and the budget prices: *Auto-assign prices* prices from the
  shortest odds down. A seed, if you give one, comes first: seeded horses are priced by seed
  ahead of every unseeded one, so give every horse a seed in market order or none.
- To set them all at once, use *Bulk upload* on the same page: CSV or JSON with
  `playerName` (or `externalId`) and `oddsToWin` per row, *Preview*, then
  *Apply to field*. It only changes horses already in the field.

### Tiers

*Tiers* (`/manage/sports/horse-racing/events/:id/tiers`), then *Auto-assign tiers from odds*
and *Replace tier assignments*. A horse race starts with three tiers, and auto-assign fills
them three horses at a time from the favourite, the last tier taking everyone left: a
12-runner field comes out 3/3/6. To move a horse to another tier, choose the tier in the select on
its card, then *Save changes*.

### Prices

Still on *Tiers*, press *Auto-assign prices*, keep or change the pricing profile and its
values, and press *Assign prices*. The page then reads "Priced with …". Prices are needed
before release even when every contest on the race will be a random draw.

### Release

On the race's page, the Workflow card's *Release for contests*, then confirm. The button
stays disabled, with a list of what is missing, until the field has horses and every horse
still in it has a tier and a price. Release moves the race to Scheduled, commissioners can
pick it, and **tiers and prices lock for good**. Odds, seeds and scratches stay editable.

## 5. Contests and entries

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

## 6. Scratches

A horse withdrawn before the race is **scratched**. On *Field*, untick *In field* on its row
(the reason reads *Scratched*) and press *Save changes*.

- **Before release:** scratch it before *Auto-assign tiers from odds*. A scratched horse is
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
  result (step 7).

A scratched horse needs no row in the result. Once the result is official it scores
*Points for not finishing*, and the result card shows it as *Scratched*.

## 7. Run the race and enter the result

### At post time

On the Workflow card, *Move to In Progress* and confirm. Open contests on the race go live.

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

Once the official result is in and checked, *Move to Completed* on the Workflow card. This
settles every contest on the race and cannot be undone: a correction entered after it updates
the race's result but not the settled standings.

## 8. Check the settled leaderboard

As a member or commissioner, open the contest's leaderboard
(`/league/:leagueCode/contests/:contestId/leaderboard`). It shows "Final result, settled …",
each pick's place in the *Finish* column (`T2` for a dead heat, `DNF`, `DQ`, `DNS` or
*Scratched* otherwise), and each entry's points from the contest's points table. With the
Win / Place / Show preset an entry holding the winner and the third-placed horse scores 6.

## Later races

The circuit and the horses already exist, so a later race starts at step 3. Each race is its
own event (a Derby-day undercard race is a separate race).

## Auto racing

Car racing (NASCAR Cup Series, IndyCar) runs through the same steps under
`/manage/sports/auto-racing/...`: in the side menu it is **Auto racing**, and its three lists
are **Races**, **Drivers** and **Series**. What differs:

- **The series already exist.** **NASCAR Cup Series** and **IndyCar** are created by the
  migration that adds auto racing, because each one's points presets belong to it. Skip step 1
  and choose the series when creating the race. Do not create a second series of the same name.
- **Drivers, not horses.** Add each driver once (*Auto racing → Drivers*); a driver who races
  in both series (Indy 500 and NASCAR) is one driver. Withdrawing one before the race reads
  *Withdrawn*, not *Scratched*.
- **Starts is the green flag.** It is the cutoff for release, contests and picks.
- **Five tiers of eight.** *Auto-assign tiers from odds* fills them eight drivers at a time
  from the favourite, so a full 40-car NASCAR field comes out 8/8/8/8/8 and a 33-car Indy 500
  field 8/8/8/8/1. Move drivers by hand if the last tier is too thin.
- **Presets per series.** On create contest, choose **Auto racing**, then the race. *Start
  from* offers only that series' presets: the tiered one (one driver from each tier, five
  counted) is the default, then budget (five drivers under the cap) and random draw (one
  driver each). NASCAR's points table is 40, 35, 34 and one fewer per place down to 1 at 36th,
  then 1 to 40th; IndyCar's is 50, 40, 35, 32, 30, 28, 26, 24, 22, 20, then 19 down to 6 for
  11th to 24th, then 5 to 33rd. No stage or bonus points.
- **The result names only the driver.** Leave `riderName` blank; the Result card has no
  *Rider* column. `startPosition` is the grid slot. A car out of the race is `DNF`.
