# Racing sports: horse racing, auto racing, cycling, marathons

**Tracking issue:** #599 (umbrella). Per-sport tickets: finish-position scoring #622,
horse racing #623, NASCAR #624, Formula 1 #625, cycling #626, marathons #627.

Written 2026-10-12 for Derek's ask to plan racing as separate sports, each with its own sport
leagues, in the order horse racing, Formula 1 and NASCAR, then cycling and marathons. This is
the "quick refinement" step of the per-sport loop (refine, implement, reflect; see §8). It
builds on `plans/next-sport-adoption.md` §2.2 to §2.5 (why racing fits) and the sport
extension design behind #602 to #606 (sport registry, scoring families). Open questions sit
under the section they belong to, each with a recommendation; nothing waits on an answer.

Read from the code on `main` at `adea0a9`.

---

## TL;DR

- **Four racing sports, one scoring family.** Horse racing, auto racing, cycling and running
  each become a `Sport`. All four score by **finish position**, so they share one new scoring
  family and one set of extension tables. Golf stays stroke play.
- **Sport leagues follow the golf pattern** (PGA Tour and LPGA Tour under golf):
  - Horse racing has **no single league**. Racing is run country by country, so a sport league
    is a **racing circuit**: start with **US Thoroughbred** (Triple Crown, Breeders' Cup,
    Pegasus); add UK and Ireland, Australia, and International only when a pool asks.
  - **Formula 1 and NASCAR are sport leagues under one Auto racing sport**, with IndyCar beside
    them for the Indy 500. Drivers, vocabulary, screens and scoring are the same; only the
    events and the official points tables differ. (Q2.1, decided by Derek 2026-10-12.)
  - Cycling: men's and women's WorldTour. Running: men's and women's World Marathon Majors.
- **Scoring:** points by finishing place from a per-contest **points table**, with presets per
  sport league (F1's 25-18-15..., NASCAR's 40-35-34..., Win/Place/Show 5-3-1 for horses).
  DNF, DQ and scratched starters score the table's "did not finish" value (default 0).
- **Selection:** tiers and budget prices from **odds** (morning line for horses), both already
  built; the random-draw sweepstake (#601) is a natural fit for horse racing.
- **Build order:** the finish-position family and horse racing together (first sport, so this
  PR also extracts the scoring-family interface, #606), then NASCAR and F1 as data plus
  presets, then cycling and marathons. First real events: Pegasus World Cup (late January
  2027) as the pilot, Daytona 500 (February 21, 2027), F1 Bahrain (March 14, 2027), Kentucky
  Derby (May 1, 2027).
- **One consequence for the groundwork:** #606 was planned around knockout advancement as the
  second scoring family. If racing goes first, finish position is the second family and
  shapes that interface instead (§1.4).

---

## 1. What all racing shares: the finish-position scoring family

### 1.1 The shape

A race is one event, one field of individuals, one finishing order. That is closer to golf than
any knockout sport: a pick is a field member, and its score comes from one result.

| Concept | Golf today | Racing |
|---|---|---|
| Event | A tournament (4 rounds) | One race (1 round); a stage race is N rounds |
| Field member | A golfer | A horse, a driver, a rider, a runner |
| Result | Strokes per round, to-par total | Finishing place (and status: finished, DNF, DQ, did not start) |
| Live updates | Hole by hole | Running order during a race (F1, NASCAR, cycling); none for a 2-minute horse race |
| Missing result | 80-stroke unplayed round | The points table's "did not finish" value |
| Seeding source | World ranking | Odds to win; series standings where they exist |

### 1.2 Storage

One extension per scoring family, never per sport (`plans/sport-extension-architecture.md` §3.5):

- `SportEventParticipantRaceResult`, 1:1 with a field member: `finishPosition` (null until
  official), `startPosition` (post position, grid slot, starting spot), `resultStatus`
  (a Postgres enum: `FINISHED`, `DID_NOT_FINISH`, `DISQUALIFIED`, `DID_NOT_START`),
  `isOfficial`. A stage race also keeps one row per stage keyed to `SportEventRound`.
- `ContestEntryRaceStanding`, 1:1 with an entry, beside `ContestEntryGolfStanding`.
- The existing participant states still apply: a horse scratched before the start is
  `WITHDRAWN` on the field, exactly like a golfer withdrawing.

**Q1.1** Horse racing shows a jockey and trainer per start, and the jockey can change from race
to race. Where should they live? *Recommendation:* the trainer on the participant's existing
`teamAffiliation` (stable over a career, like an F1 constructor), and the jockey as a nullable
`riderName` on the race result row. It is a display field for one sport, but it belongs to one
start, which is exactly that row. No jockey participants, no jockey picks.

### 1.3 Scoring definitions and contest scoring rules

- One new participant scoring definition, `FINISH_POSITION_POINTS`: `HIGHER_IS_BETTER`, unit
  points. A pick's score is `pointsTable[finishPosition]`, or the table's `didNotFinish` value.
- The **points table** is a typed contest scoring setting (the same home as the knockout round
  values in `plans/next-sport-adoption.md` §1), so a commissioner picks the flavour per contest.
  Contest templates ship presets per sport league:

| Preset | Table | Used by |
|---|---|---|
| Win / Place / Show | 5, 3, 1 | Horse racing default |
| Official F1 | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 | F1 default |
| NASCAR finishing points | 40, 35, 34, 33 ... 1 (finishing points only, no stage points) | NASCAR default |
| Top 10 linear | 10, 9 ... 1 | Cycling, marathons default |

- An entry's score is the sum of its counting picks, under the cross-sport `BEST_N` counting
  rule (renamed from `BEST_N_GOLFERS` in #604).
- **Dead heats** (horse racing, photo finishes): every horse in the dead heat scores the full
  points for the place. Entry standings already allow ties (MVP decision).
- **Official result:** a race's result counts when an admin marks it official. A later
  stewards' change (a disqualification, a placing change) is a correction the admin enters,
  following the score-correction pattern of #116: the admin enters every value and the server
  derives nothing.

**Q1.2** Also offer "sum of finishing places, lower is better" (common in marathon and Tour de
France pools)? *Recommendation:* not in the first version. Under the dead-code goal a
definition is added with the sport that uses it; a points table already expresses "places
matter", and sum of places needs a made-up value for DNFs.

**Q1.3** An **odds bonus**, the racing counterpart of the seed bonus: a winning longshot earns
extra, for example points times the decimal odds at release, or a flat bonus above set odds.
Horse pools like rewarding the 30-1 winner. *Recommendation:* design the scoring setting so a
bonus can be added (the same shape as the seed-bonus switch), but ship without it; add it
after the first Derby pool if commissioners ask.

**Q1.4** NASCAR stage points, F1 fastest lap and F1 sprint races: score them? *Recommendation:*
no. They need a live feed and add rules few office pools use. The F1 sprint is its own short
race and could later be its own event.

### 1.4 How this changes the groundwork (#606)

`plans/sport-extension-architecture.md` §3.3 says the `ScoringFamilyModule` interface is
extracted in its own PR, shaped by the second family, and assumed that family was knockout
advancement. If racing is built first, **finish position is the second family** and shapes
the interface. It suits that job well: racing has a result per participant and per round, like
golf, so the interface is a close cousin of golf's (persist results, load field results, score
participants, leaderboard detail). Knockout's match entity then arrives as the third family
and may add a method. Recommendation: keep #606 as its own PR, opened as soon as the horse
racing ticket is planned in detail, shaped by finish position.

**Added ahead of the sport (2026-10-13, #606):** Derek chose to build the interface before
racing. It exists with stroke play as the only family, and was checked against finish position
and knockout advancement. A family scores the event's field for the contest (racing: the
points table, with the "did not finish" value as its missing-result rule), writes a provider's
live scores, stores and reads back an entry's settled total (racing: `ContestEntryRaceStanding`),
and supplies the leaderboard's detail blocks. #622 implements it for finish position.

### 1.5 Results entry and data sources

- **Admin entry first, for every racing sport.** The admin results card is the finishing order:
  enter or paste the order (or the top N), mark DNF, DQ and did-not-start, mark official. Fields
  are small (8 to 40, ~175 for cycling stages) so this is minutes of work per race.
- **Odds** go in through the existing field upload, which already accepts `oddsToWin` per field
  member (#128). Tiers and budget prices then use `AUTO_ODDS` valuations unchanged.
- **Feeds later,** per sport (each its own provider adapter under
  `rules/architecture-rules.md` §3): Jolpica-F1 (the free successor to the Ergast API) for F1
  results and standings; NASCAR and horse racing have no free official API (Equibase sells US
  horse racing data), so they stay on admin entry until a paid feed is justified.

### 1.6 Selection types

| Selection | Fit for racing | Notes |
|---|---|---|
| Tiered | Yes, all sports | Tiers by odds. 3 to 4 tiers for horse fields, 4 to 6 for F1, NASCAR, cycling |
| Budget | Yes, all sports | The #93 curve on odds-ranked fields; F1 and Tour de France fans know budget fantasy |
| Random draw (#601) | Horse racing especially | The Derby, Grand National and Melbourne Cup sweep. Works once #601 lands, with no racing-specific work |
| Snake (#199) | Later | Deferred for all sports |

**Picks close at the start** (the existing rule: tee-off becomes post time or green flag).
**Scratches** (common in horse racing, rare in auto racing): a pick whose field member is
withdrawn before the start may be replaced until the start; after the start, a non-starter
scores as did-not-start. This was the recommendation of `plans/next-sport-adoption.md` Q2.8.

**Q1.5** Should the free replacement be automatic for every racing sport, or a contest setting?
*Recommendation:* the same rule for every sport, as part of the family: a withdrawn pick can be
swapped until the start. Golf already lets an entry edit until tee-off, so this is the existing
behaviour, stated for racing.

### 1.7 Gaps this plan does not close

- **Season-long and multi-race contests** (an F1 season, NASCAR playoffs, a Triple Crown
  contest): a contest runs on one event today (`plans/next-sport-adoption.md` Q2.5). Racing is
  where this hurts most, because many F1 and NASCAR pools are season-long.
  *Recommendation:* launch race-by-race contests; file "multi-event contests" as its own
  cross-sport ticket once the first racing sport is live. Golf majors seasons and the Triple
  Crown would use it too.
- **Race cards** (Breeders' Cup, Derby day undercard): several races with different fields.
  Each race is its own event for now.

---

## 2. Horse racing

### 2.1 Refinement

| Question | Answer |
|---|---|
| Sport | `HORSE_RACING`, re-added by this ticket after #605 deletes the unbuilt values (Q2.0) |
| Participant | The horse (`INDIVIDUAL`). Trainer as affiliation, jockey per start (Q1.1) |
| Sport leagues | Racing circuits, not leagues (§2.2) |
| Event | One race. Event series per race: "Kentucky Derby", "Preakness Stakes" ... |
| Field | 8 to 20 runners; final at the post-position draw, days before the race; scratches up to post time |
| Seeding | Morning line odds (published by the track at the draw); no meaningful ranking list |
| Selection | Tiered (3-4 tiers), budget, random draw (#601) |
| Scoring | Win / Place / Show preset (5, 3, 1); odds bonus later (Q1.3) |
| Results | Admin enters the official order; dead heats tie |
| Vocabulary | horse / horses; race; "Scratched" for withdrawn; "Post time" for the start |

**Q2.0** #605 deletes unbuilt `Sport` values. `HORSE_RACING`, `F1` and `NASCAR` are among them.
*Recommendation:* let #605 delete them as planned; each racing ticket adds its sport back in
its own migration with its registry entry. That is the add-sport skill's normal path, and it
keeps #605 simple.

### 2.2 Is there a sport league for horse racing?

No. There is no horse racing league the way there is a PGA Tour. Racing is governed and run per
country: in the US each state has a racing commission and each track runs its own races
(Churchill Downs runs the Derby, NYRA runs the Belmont, Breeders' Cup Ltd runs the Breeders'
Cup). The Triple Crown is a series of three races at three tracks, not a league.

What the model's `SportLeague` is used for: it groups recurring event series, scopes
participant rankings, and carries the "current event year". The grouping that does that job
for horse racing is the **racing circuit**, by country:

| Sport league | Event series | When |
|---|---|---|
| **US Thoroughbred** (first) | Pegasus World Cup, Kentucky Derby, Kentucky Oaks, Preakness Stakes, Belmont Stakes, Breeders' Cup Classic | Late Jan; May 1, 2027; early-mid May; June; early November |
| UK and Ireland (on request) | Grand National, Cheltenham Gold Cup, Epsom Derby, Royal Ascot races | March to June |
| Australia (on request) | Melbourne Cup, Cox Plate | October, November |
| International (on request) | Dubai World Cup, Prix de l'Arc de Triomphe, Japan Cup | March, October, November |

Thoroughbreds that ship abroad (a US horse in the Dubai World Cup) simply hold two
affiliations, which the model already allows. Harness racing (the Hambletonian) and quarter
horses (the All American Futurity) would be further sport leagues of the same sport if a pool
ever asks; no one has.

**Q2.1a** Split US Thoroughbred into "Triple Crown" and "Breeders' Cup" leagues? *Recommendation:*
no. They are event series in one circuit, run on the same horses in the same season.

### 2.3 Events to set up first

Pegasus World Cup (pilot, late January 2027, ~12 runners), then the Kentucky Derby
(May 1, 2027), Preakness, Belmont, and the Breeders' Cup Classic. Kentucky Oaks (the day before
the Derby) is cheap to add since it is the same weekend. Confirm each date when the event is
created.

---

## 3. Auto racing: Formula 1, NASCAR, IndyCar

**Status (2026-10-13, #624).** The sport is built as `AUTO_RACING`, "Auto racing", and covers car
racing only: Derek decided on 2026-10-13 that motorbike racing is out of this sport for now and
deferred it to #641. It reuses the finish-position family and the `RACE` format, so it needed
no new tables:

- The sport definition: driver / drivers, race / races, series / series, "Withdrawn", "green
  flag". The result names only the driver, so there is no Rider column and no name for the top
  places. One round, and five tiers of eight, which a full 40-car NASCAR field fills exactly.
- The reference-data migration seeds the sports row and two sport leagues, **NASCAR Cup
  Series** and **IndyCar**. Sport leagues are normally created by an admin, but a league's
  points presets are contest templates that must name their league, so these two are
  reference data, inserted idempotently on the (sport, name) unique.
- Six templates, three per series, each with its league set and its own key:
  `nascar-cup-tiered-points` (the NASCAR default), `nascar-cup-budget-points`,
  `nascar-cup-random-draw-points`, `indycar-tiered-points` (the IndyCar default),
  `indycar-budget-points`, `indycar-random-draw-points`. Tiered picks one driver per tier and
  counts five; budget picks five; the draw deals one. NASCAR's table has 40 places (40, 35, 34
  ... 1 at 36th, then 1 to 40th); IndyCar's has 33 (50, 40, 35, 32, 30, 28, 26, 24, 22, 20, then
  19 down to 6, then 5 to 33rd). A non-finisher scores 0.
- Setting a template as the default now clears only the defaults of its own sport league, so
  each series keeps its own default preset.

Formula 1 (#625) added its league and presets the same way (§3.3). The Daytona 500 and the Indy
500 are created by an admin through the Manage pages (`docs/RACE-SETUP-PROCEDURES.md`).

### 3.1 One sport or three?

**Q2.1** (**Answered 2026-10-12 by Derek: one sport, as recommended.**) Should Formula 1 and
NASCAR be **sport leagues under one Auto racing sport**, or **two separate sports**?

*Recommendation: one sport, `AUTO_RACING`, with sport leagues Formula 1, NASCAR Cup Series and
IndyCar.* The reasons:

- It mirrors golf: PGA Tour and LPGA Tour are leagues under golf because the participant kind,
  vocabulary, screens and scoring are the same. That is equally true of F1 and NASCAR: drivers,
  races, grid, DNF, finish-position points.
- Drivers cross over. Participants belong to a sport, and an IndyCar or NASCAR driver who runs
  the Indy 500 (Kyle Larson has entered both the Indy 500 and NASCAR's Coca-Cola 600 on the same day) stays one
  participant with two affiliations, as a golfer on two tours does.
- What does differ (official points tables, field sizes, data sources) lives in contest
  presets per sport league and in each league's events, not in a sport definition.
- A separate sport per series would need two registry entries, two vocabularies and two sets of
  admin routes that say the same thing.

The cost is that a per-league difference cannot hide in the sport definition. Contest
templates already carry a sport; they would also need an optional sport league so the F1
template defaults to F1 points (Q3.2).

**Q3.2** (**Answered and built in #624: yes, as recommended.**) Contest templates per sport
league (F1 points preset vs NASCAR preset)? *Recommendation:* yes: an optional `sportLeagueId` on
contest templates, and the create-contest screen picks the template from the event's league. Golf
gets the same ability for free (an LPGA template).

What was built: `contest_config_templates.sport_league_id`, nullable, so every existing template
stays sport-wide. The template list takes an optional `sportLeagueId` and answers that league's
templates plus the sport-wide ones, never another league's. The create-contest page asks for the
chosen event's league and starts each format on the league's own default, then the sport-wide
default, then the first preset; since #625 it also starts on the format of the league's own
default. Creating a contest from another league's template is refused with
422 `CONTEST_CONFIG_TEMPLATE_LEAGUE_MISMATCH`. Root admins still edit templates but cannot yet set
a template's league; a league's presets arrive in the reference-data migration that seeds the
league itself (auto racing's, above).

### 3.2 NASCAR (sport league: NASCAR Cup Series)

| Question | Answer |
|---|---|
| Field | About 40 cars; the Daytona 500 field is set by the Duel races three days before |
| Seeding | Odds (deep markets for every race) and the Cup points standings as the league ranking |
| Selection | Tiered (5 tiers of 8), budget |
| Scoring | NASCAR finishing-points preset (40, 35, 34 ... 1); no stage points (Q1.4) |
| Results | Admin enters the finishing order; DNF for cars out of the race |
| Events first | **Daytona 500, February 21, 2027** (moved a week later to avoid the Super Bowl), then the Coca-Cola 600 and the other crown jewels; all 38 Cup races only if leagues ask (`plans/next-sport-adoption.md` Q2.4) |
| Vocabulary | driver / drivers; race; "DNF"; "Green flag" for the start |

### 3.3 Formula 1 (sport league: Formula 1)

| Question | Answer |
|---|---|
| Field | 22 drivers (11 teams since Cadillac joined in 2026), the same all season |
| Seeding | Odds; the drivers' championship standings as the league ranking; constructor as `teamAffiliation` |
| Selection | Budget fits best (F1's own fantasy game is budget-based); tiered with 4 tiers of 5-6 |
| Scoring | Official F1 preset (25, 18 ... 1); Grand Prix only, no sprint or fastest lap (Q1.4) |
| Results | Admin entry first; Jolpica-F1 feed adapter as a follow-up |
| Events first | 2027 opens in **Bahrain on March 14** (Australia moves to round 3, April 4); then Monaco and the US races (Miami, Austin, Las Vegas) |
| Vocabulary | driver / drivers; Grand Prix; "DNF"; "Lights out" for the start |

**Q3.3** (**Answered in the #625 refinement: budget default, as recommended.**) F1 is dominated
by a few teams, so a pick-one-per-tier pool can feel decided. *Recommendation:* default F1
contests to budget selection with the points preset, and offer tiered as the alternative. Treat
this as a product default, not a rule.

**Status (2026-10-14, #625).** Derek resumed the racing work on 2026-10-14 and Formula 1 is built
as data, the way #624 built NASCAR and IndyCar:

- One reference-data migration seeds the **Formula 1** sport league under auto racing
  (idempotent on the (sport, name) unique) and three templates scoped to it:
  `formula-1-budget-points` (the F1 default, sorted first; five drivers under the cap, five
  counted), `formula-1-tiered-points` (one driver per tier, four counted) and
  `formula-1-random-draw-points` (one driver dealt). Each carries the Grand Prix table 25, 18,
  15, 12, 10, 8, 6, 4, 2, 1, nothing below tenth, and 0 for a non-finisher. Sprint races and
  the fastest lap are not scored.
- The sport's tier layout stays five tiers of eight. An F1 race is set to four tiers on the
  event's Tiers card (6/6/5/5 for 22 drivers), which is what the tiered preset's four counted
  scores assume. Auto-assign from odds still fills eight per tier (the sport's tier size), so
  on four tiers it gives 8/8/6/0 and the admin evens the tiers out by hand; a per-league tier
  layout would remove that step if F1 pools find it a chore.
- The create-contest page used to start every event on Tiered and apply that format's default,
  so an F1 race opened on the tiered preset. It now starts on the format of the event's sport
  league's own default template (budget for F1) when the sport offers it and the event is
  priced, and otherwise as before. NASCAR and IndyCar, whose defaults are tiered, are
  unchanged.
- Events, the Jolpica-F1 feed and loader support stay follow-ups; races are created by an admin
  (`docs/RACE-SETUP-PROCEDURES.md`).

### 3.4 IndyCar (sport league, for the Indy 500 only)

One marquee race (33 cars, Memorial Day weekend). Same as NASCAR in every respect. Add the
league and the Indy 500 event with the NASCAR ticket; it costs only data.

---

## 4. Cycling

**Status (2026-10-14, #626).** The sport is built as `CYCLING`, "Cycling". It reuses the
finish-position family and the `RACE` format, so it needed no new tables. Q4.1 is answered: the
final overall classification only, so the table below is superseded where it says stages are
rounds:

- A Grand Tour is one event with one result, the final overall (GC) order entered once after the
  last stage. The sport definition gives a new race one round; the 21 stages are not modelled. A
  one-day Monument has the same shape. Stage scoring waits for a results feed.
- The sport definition: rider / riders, race / races, tour / tours, "Withdrawn" (a non-starter),
  and "start" as the event start ("Entries close at the start"). The result names only the rider,
  so there is no Rider column word and no name for the top places. A rider who abandons is
  entered as `DNF`, so nothing is called "Abandoned". Five tiers of ten: four tiers of contenders
  hold 40 riders, and the last tier takes the rest of a ~175-rider field.
- The reference-data migration seeds the sports row and two sport leagues, **UCI WorldTour** and
  **UCI Women's WorldTour**, idempotently on the (sport, name) unique, as auto racing's are.
- Six templates, three per tour, each with its own key: `uci-worldtour-tiered-top-10` (the
  default), `uci-worldtour-budget-top-10`, `uci-worldtour-random-draw-top-10`, and the same three
  as `uci-womens-worldtour-...`. Tiered picks one rider per tier and counts five; budget picks
  five; the draw deals one. All score Top 10 linear (10, 9 ... 1 over ten places), with 0 below
  that and for an abandon.

The Tour de France (July 2027) is loaded later through the sport data loader, with a dry run
first; the setup by hand is `docs/RACE-SETUP-PROCEDURES.md`.

| Question | Answer |
|---|---|
| Sport | `CYCLING` (new value) |
| Sport leagues | UCI WorldTour (men), UCI Women's WorldTour, split like PGA Tour and LPGA Tour |
| Events first | Tour de France (July); Giro and Vuelta on request; one-day Monuments on request |
| Field | ~175 riders (23 teams of 8); riders abandon during the race |
| Rounds | A Grand Tour is 21 stages, each a `SportEventRound` |
| Seeding | Odds for the overall win (deep market for the Tour); UCI ranking as league ranking |
| Selection | Budget (the official Tour fantasy game is budget-based), tiered |
| Scoring | Final overall (GC) position with the Top 10 preset; stage scoring later (Q4.1) |
| Vocabulary | rider / riders; stage; "Abandoned" for DNF |

**Q4.1** (**Answered 2026-10-14 in the #626 refinement: final overall only, as recommended.**)
Score only the final overall standings, or each stage too? *Recommendation:* final
overall only. Stage scoring makes a livelier leaderboard over three weeks but needs 21 results
entered per race; it is the case for a feed, not for admin entry. The live leaderboard can
still show the riders' overall position after each stage if the admin enters it.

---

## 5. Marathons (later)

| Question | Answer |
|---|---|
| Sport | `RUNNING` (new value, so track and other road races can join later without a rename) |
| Sport leagues | World Marathon Majors (men), World Marathon Majors (women) |
| Events first | Boston (April) and New York (November); the other Majors (Tokyo, London, Sydney, Berlin, Chicago) on request |
| Field | Elite field of 20 to 40 per race; the mass field is not modelled |
| Seeding | Thin odds; World Athletics ranking or manual valuations fill in |
| Selection | Tiered |
| Scoring | Top 10 preset |
| Vocabulary | runner / runners; race; "DNF" |

**Q5.1** Triathlon (Ironman World Championship, T100) follows the same pattern as running.
*Recommendation:* no ticket until someone asks; it is a new sport value plus data.

---

## 6. Tickets

Each is a sub-issue of #599. The family ticket and horse racing land together (one PR or two
in a row, same plan), because a scoring family is not built without a sport that uses it.

| Ticket | Contents | Depends on |
|---|---|---|
| #622 Finish-position scoring family | Extension tables, `FINISH_POSITION_POINTS`, points-table setting and presets, admin finishing-order card, race leaderboard detail, withdrawn-pick replacement, `ScoringFamilyModule` implementation | #602-#606 |
| #623 Horse racing | Sport, US Thoroughbred league, event series, Pegasus pilot and Derby events, jockey and trainer display, Win/Place/Show preset | #622 |
| #624 Auto racing: NASCAR Cup (plus IndyCar for the Indy 500) | `AUTO_RACING` sport, two leagues, Daytona 500 event, NASCAR preset, contest template per league | #622 |
| #625 Auto racing: Formula 1 | F1 league, 2027 events, F1 preset; Jolpica-F1 adapter as a follow-up | #624 (sport exists) |
| #626 Cycling | Sport, two leagues, Tour de France, stage rounds | #622 |
| #627 Marathons | `RUNNING` sport, two leagues, Boston and New York | #622 |

Not filed: multi-event contests (§1.7), triathlon (Q5.1), odds bonus (Q1.3).

---

## 7. Order and dates

1. #602-#605 (groundwork, in progress), then #606 shaped by finish position.
2. Finish-position family plus horse racing: pilot on the **Pegasus World Cup** (late January
   2027).
3. NASCAR with IndyCar: **Daytona 500, February 21, 2027**.
4. Formula 1: **Bahrain, March 14, 2027**.
5. Kentucky Derby, **May 1, 2027**: horse racing's big day, with random draw (#601) by then.
6. Cycling for the **Tour de France** (July 2027) and marathons for **Boston** (April 2027) or
   New York (November 2027), whichever is closer when they are picked up.

**Q7.1** This order puts racing ahead of the knockout foundation that tennis (Australian Open,
January 2027) and March Madness (March 2027) need. Both could run in parallel after #606, but
#606 can only be shaped by one family first. *Recommendation:* racing first, as Derek has
prioritised, because it is the smaller step from golf; knockout follows on the extracted
interface, and the March Madness date still holds if knockout starts by early January.

---

## 8. The per-sport loop in the add-sport skill

Derek's loop is refine, implement, reflect. **Derek approved the Refine and Reflect steps on
2026-10-12.** The "Sport extension groundwork" thread owns the skill and folds them in with
#602. Suggested encoding in `.claude/skills/add-sport`
(lands with #602; the draft is in the project files):

1. **Step 0, Refine** (new, before "classify the sport"): fill a refinement table like §2.1
   for the sport: participant, sport leagues, event and field, seeding source, selection
   types, scoring rules and presets, results source, vocabulary. Each open point is written as
   a question with a recommendation in the ticket. The table goes in the ticket, or in a plan
   only when the sport needs a new scoring family or a model change.
2. **Steps 1-2, Implement**: the existing classify and chain steps, unchanged.
3. **Last step, Reflect** (new, in the same PR): before the PR is marked ready, compare what
   was built against the skill: steps that were missing, wrong or unused, and traps hit. Fix
   the skill in the same PR (it is repository content, so the review sees it), and record a
   one-line "what changed in the skill" in the PR body. A sport PR that changes nothing in the
   skill says so explicitly.

The refinement table in §2.1 is a good template for step 0: every row is something a sport
ticket has needed to decide.

---

## 9. Build slices for #622 and #623 (added 2026-10-13)

Read from `main` at `b757b98`. Mapping the code turned up five places where the groundwork
still assumes golf. Each slice below is green and mergeable on its own, and golf behaves the
same after every one of them.

1. **Web scoring-family registry (the web half of #606).** The contest leaderboard response
   gains the event's `sport`. The web gets a `SCORING_FAMILY_UI` registry keyed by scoring
   family. Stroke play's entry is today's golf leaderboard code, moved and unchanged. Round
   labels come from the sport definition, which is the first step of #636.
2. **Backend interface prep, golf only.**
   - A family scores the field per contest, given that contest's scoring settings, because a
     points table belongs to the contest. Settlement scores inside its per-contest loop.
   - A participant score carries a per-family detail instead of golf's unplayed rounds.
   - A family declares which live-score category it accepts, or none.
   - The sport definition carries its default rounds and tier count instead of golf
     constants.
   - The golf score routes refuse an event of another scoring family.
3. **Finish position plus horse racing, backend.**
   - `HORSE_RACING` and a `RACE` tournament format.
   - The race result and entry race standing tables, the `FINISH_POSITION_POINTS`
     definition, and the module.
   - The finishing-order results route, and the Win/Place/Show templates.
   - The web's finish-position registry entry, a place-and-points leaderboard, which the
     exhaustive map forces into the same slice.
4. **Racing in the web admin and create flow.** The admin finishing-order card, a sport picker
   on create contest, a points-table field, and sport vocabulary in the shared selection
   screens. Includes one browser journey: event, field with odds, contest, entry, results,
   settled standings.
5. **Close-out.** The US Thoroughbred league and the Pegasus pilot event, set up through
   admin. Docs, and the Reflect step on the add-sport skill.

**Where it stands (2026-10-13).** Slices 1 to 4 are merged: the web scoring-family registry
(#648), the backend interface prep (#649), finish position and horse racing on the backend
(#650), and racing in the web admin and create flow (#651). Slice 5 delivered what an agent can
do without the QA environment:

- `docs/RACE-SETUP-PROCEDURES.md`, the procedure a root admin follows to create the US
  Thoroughbred circuit, add horses, create the Pegasus World Cup, build and release its field,
  run contests on it, handle scratches, enter the finishing order and settle. It sits beside
  the golf procedure, which is about the mock feed and simulated rounds throughout.
- The Reflect step on the add-sport skill, folding in what slices 3 and 4 taught.

**What remains, by hand in QA:** an admin follows that procedure to create the US Thoroughbred
circuit and the Pegasus World Cup (confirming the date and post time with Gulfstream Park when
creating it), enters the field and morning-line odds once the post-position draw is published,
and runs the race through to a settled contest. Writing the procedure turned up one thing for
a follow-up ticket rather than this slice: budget prices came from seed numbers, not odds, so an
admin had to enter seeds in market order before pricing a race. #653 now prices unseeded entries
by odds.

**Q9.1** Where does a contest's points table live? *Recommendation:* in the contest's
participant scoring rule `config`, which exists today and is always `{}`. Each scoring
definition gets its own Zod schema for it, keyed by scoring definition id, so the column is
typed end to end on read as well as write: `FINISH_POSITION_POINTS` takes
`{ pointsTable, didNotFinishPoints }`, stroke play takes `{}`. Contest templates carry the
presets the same way.

**Q9.2** Tournament format for a race? *Recommendation:* a new `RACE` value. Stroke play would
be wrong, and the validity matrix keys on it.

**Q9.3** Vocabulary. The sport definition has no word for withdrawn (horse racing says
"Scratched"), and racing has no "eliminated". *Recommendation:* add `withdrawn` to the
vocabulary (golf "Withdrawn"), and make `eliminated` optional, absent for racing. The
participant status label then handles an absent word explicitly.

**Q9.4** A live-score arm for racing? *Recommendation:* none until a racing feed exists
(Jolpica-F1 is the first candidate). The family declares no live-score category, and the
score publisher skips and warns on a mismatch. The add-sport skill's step 4 changes in the
Reflect step to say a family adds a live-score variant only with a provider.

**Q9.5** A scratched horse dealt in a random draw. Dealt picks are final (#601), so a
scratched horse cannot be replaced. *Recommendation:* it scores as did-not-start (the table's
"did not finish" value), as in a paper sweep. Tiered and budget entries can already swap a
withdrawn pick until the start, which satisfies Q1.5.

**Q9.6** The admin area is built as `/manage/golf/...`. *Recommendation:* decide inside slice 4
after a closer look. The default is sport-generic event pages, `/manage/sports/:sport/...`,
with the results card chosen through the scoring-family registry. The golf URLs redirect to
them, so nobody keeps two copies of the event and field pages.

*Decided in slice 4: sport-generic pages, as recommended.* A closer look found that every
event, field, tier, participant and sport league page already read and wrote the shared
`SportEvent`, `SportEventParticipant` and `Participant` contracts; only their words, a few
golf-only settings and the results card were golf's. So one copy of each page now serves every
sport under `/manage/sports/:sport/{events,participants,leagues}`, where `:sport` is the enum
value in lower case with hyphens (`golf`, `horse-racing`). The page reads its words from the
sport definition's vocabulary (tournament or race, golfer or horse, tour or circuit), and the
Manage menu lists one entry per supported sport. An event's results page takes its body, its
name ("Scores" or "Results") and whether the event has a par per round from a web
`SCORING_FAMILY_ADMIN_UI` registry keyed by scoring family, exhaustive like `SCORING_FAMILY_UI`:
round scores for stroke play, the finishing-order card for finish position. No page compares
sports. The old `/manage/golf/...` links redirect to the same page under
`/manage/sports/golf/...` (tournaments become events, players participants, scores results).

Why not a second set of racing pages: they would have copied about thirty golf pages and cards
whose only differences were words, and every later fix would have had to land twice. Why not
leave golf's URLs and add racing beside them: the pages are the same pages, so two URL shapes
would only have hidden that.

What was deliberately left as it is: the internal `golf-` prefix on these files, components,
test ids and query keys. Renaming them touches about nine hundred test-id uses across the unit
and browser suites and changes nothing anyone sees, so it is a mechanical follow-up of its
own rather than part of this slice.
