# Next sport adoption: research and recommendation

**Tracking issue:** #599

Written 2026-10-10 for Derek's question: which sports fit Poolmaster's current design best,
first among tournaments of individual players (tennis and others), then among tournaments of
teams (soccer, March Madness). Open questions sit under the section they belong to; nothing
here blocks on an answer.

**Status 2026-10-24:** most of this has been built. For what is left, read §6 first.

## TL;DR: ranked recommendation

| Rank | Sport / event | Group | Why | Next date it could run |
|---|---|---|---|---|
| 1 | **March Madness "pick teams" pool** (tiered by seed, or budget) | Teams | Biggest office-pool event in the US by far; reuses the tiered and budget selection engines as they are; only ~67 games to score | Selection Sunday, mid-March 2027 |
| 2 | **Tennis Grand Slams** (men's and women's singles) | Individuals | Closest fit to the golf pool shape (a field of individuals, seeds as tiers, rankings as prices); 4 Slams x 2 draws a year; almost no pool-site competition | Australian Open, January 2027 (a good pilot before March) |
| 3 | **Races with a finishing order:** horse racing (Triple Crown, Breeders' Cup), auto racing (Daytona 500, Indy 500, NASCAR), then cycling, marathons, triathlons | Individuals (not a tournament, but a field) | Structurally the easiest fit after golf: one field, one finishing order; odds set tiers and prices | Daytona 500 (Feb 2027), Kentucky Derby (May 1, 2027) |
| 4 | **Soccer knockout tournaments** (Champions League, Women's World Cup 2027, Euro 2028, World Cup 2030) | Teams | Large and growing US following and good cheap data, but group stages and draws need more model work, and the biggest event (2026 World Cup) just ended | UCL knockouts Feb 2027; Women's World Cup June 2027 |
| 5 | **March Madness full bracket pick'em** | Teams | The format most people know, but a new selection type and a crowded market of free giants (ESPN, CBS, Yahoo) | March 2028 realistically |

**Recommended order of work:** build one shared "knockout advancement" foundation (below), pilot
it on the 2027 Australian Open (tennis, individuals, low stakes, reuses golf screens), then launch
March Madness team pools on it in March 2027. Racing and soccer follow on the same foundation;
full bracket pick'em is a later, separate selection type.

The core reason for this order: the **selection** side of Poolmaster (tiered, budget, and
soon snake) already works for any field of participants, individual or team. What is
golf-specific is the **scoring and results** side (strokes, to-par, rounds, the 80-stroke rule).
Every recommended sport except racing scores the same way, by **how far a pick advances**, so one
new scoring path unlocks tennis, March Madness, and soccer knockouts together.

---

## 1. How well the current design fits

Read from the code on `main` (2026-10-10), not from plans.

**Already sport-neutral (reusable as is):**

- The sport side of the model already anticipates other sports: `Sport` lists 14 sports
  including `TENNIS`, `NCAA_BASKETBALL`, `SOCCER`, `NASCAR`, `F1`, `HORSE_RACING`
  (`packages/shared/domain/enums.ts`); `Participant.participantType` is `INDIVIDUAL` or `TEAM`.
- `TournamentFormat` already has `MATCHES` (`KNOCKOUT_BRACKET` until #715), `GROUP_STAGE_KNOCKOUT`, `TIME_TRIAL_RACE`,
  and `packages/shared/domain/contest-validity.ts` maps tennis and NCAA basketball to knockout,
  soccer to group stage plus knockout, racing to races.
- A pick points at a `SportEventParticipant` (a member of one event's field) with `ranking`,
  `seedNumber` and `oddsToWin`. A golfer, a tennis player, an NCAA team or a NASCAR driver are
  all just field members.
- **Tiers and prices live on the event** (`SportEventTier`, `SportEventParticipantValuation`,
  with `AUTO_RANKING` and `AUTO_ODDS` sources). Seed lines as tiers (seeds 1-4, 5-8, ...) and
  ranking-based budget prices (the #93 curve) work unchanged.
- The **SelectionEngine** seam (`modules/selections/selection-engines`) only decides roster
  rules; exclusivity, pick windows and persistence are shared. Tiered and budget engines need no
  sport knowledge.
- `SportEventRound` is a cross-sport schedule (golf Round 1-4 maps to tennis R128..Final or NCAA
  First Round..Championship). `ParticipantInactiveReason.ELIMINATED` and the standing status
  `ELIMINATED` already cover "knocked out".
- Standings rank on a direction-free `position` (1 is best), and participant scoring
  definitions declare `LOWER_IS_BETTER` / `HIGHER_IS_BETTER` (`contest-scoring.ts`), so a
  points-based sport slots in without touching the ranking code.

**Golf-specific (needs work for any new sport):**

- Results are stored only in golf extension tables (`SportEventParticipantGolfRound`,
  `...GolfStanding`, `ContestEntryGolfStanding`). Each new scoring style needs its own extension.
- The leaderboard calculator reads `GolfContestConfig` (`contest-leaderboard-calculator.ts`).
  Its counting rule (`BEST_N`) and settlement (`contest-settlement-service.ts`) carry
  sport-neutral names since #604.
- There is **no match entity**: nothing records "A played B in round 2 and won". Advancement
  scoring can live without it (a per-participant "rounds won" is enough), but bracket pick'em
  and soccer group tables cannot.
- No real data provider is wired: scores come from admin entry or the mock feed provider
  (`packages/mock-contest-feed-provider`). Any new sport needs either an admin results screen
  sized for its event or a paid/free feed adapter.
- UI copy says golfer, to-par, rounds, cut. (Inferred from the golf-first build; not swept.)
- Many enum values (`BRACKET_PICK_EM`, `PICK_EM`, `ADVANCEMENT`, `POSITION`, ...) are catalog
  entries with no implementation. Per the dead-code goal they should either get built by this
  work or be deleted.

### The shared foundation: "knockout advancement"

One slice of work that tennis, March Madness and soccer knockouts all need:

1. A `KNOCKOUT_ADVANCEMENT` participant scoring definition, `HIGHER_IS_BETTER`, with a
   configurable points-per-round table (for example 1, 2, 4, 8, 16, 32) and an optional seed
   bonus (see *Knockout scoring rules* below).
2. A match entity (`SportEventMatch`: round, two sides, winner) plus, if useful for fast reads,
   a knockout extension on the field member with rounds won and round reached (same 1:1
   pattern as golf).
3. An admin results screen: per round, mark the winner of each pairing (or mark losers out).
   A March Madness event is 67 games; a Slam singles draw is 127 matches per draw.
4. A knockout scoring-family module. Settlement, contest scoring and the leaderboard already
   dispatch through the event's scoring family (#606), and the counting rule and settlement
   service have sport-neutral names (#604).
5. Sport-aware labels for the picker, leaderboard and event screens.

**Added ahead of the sport (2026-10-13, #606):** the scoring-family interface and registry are
built, with stroke play (golf) as the only family. A family scores the event's field for the
contest, writes a provider's live scores, stores and reads back an entry's settled total, and
supplies the leaderboard's detail blocks. The interface was checked against knockout
advancement: the knockout module implements it and adds its match reads (who beat whom, for
the seed bonus) as its own field read.

#### Knockout scoring rules (Derek, 2026-10-11)

Two rules from March Madness pools. Both are **scoring rules**: settings on the knockout
scoring definition a contest uses, not selection rules and not contest formats. They apply to
any event that runs in rounds (round values) and any event with seeds (seed bonus): tennis
draws, the NFL and NBA playoffs, soccer and rugby knockouts, darts.

1. **Round values.** Each win is worth the value of the round it was won in, set per round:
   for example 1, 2, 4, 8, 16, 32 (doubling), or flat 1s. A team that wins the title in a
   64-team field earns 1+2+4+8+16+32 = 63.
2. **Seed bonus.** When a higher-numbered (worse) seed beats a lower-numbered (better) seed,
   the winner earns the seed difference on top of the round value: a 12 seed beating a 5 seed
   in round 1 earns 1 + (12 - 5) = 8. No bonus when the better seed wins or seeds are equal
   (two 1 seeds in the Final Four).

How they fit:

- Both live in the contest's typed scoring configuration (a round-value table and a
  seed-bonus switch, perhaps with a multiplier), so a commissioner picks the flavour per
  contest, and contest templates ship presets ("Doubling", "Doubling + seed bonus", "Flat").
- A pick's score is the sum over its wins of `roundValue[round] + seedBonus(win)`; the entry
  sums its counting picks as today. Ranking stays `HIGHER_IS_BETTER`.
- The seed comes from `SportEventParticipant.seedNumber`, which already exists, as it stood at
  the event's release (seeds do not change mid-event).
- The bonus needs the loser's seed, so wins must be recorded as matches (Q1.1).
- The same two rules can score pick'em and bracket pick'em games (#607): a correct pick earns
  the round value plus the upset bonus.

Questions:

- **Q1.3** Unseeded participants (tennis has 32 seeds in a 128 draw): no bonus when either side
  is unseeded, or treat unseeded as seed 33? Recommendation: no bonus involving unseeded
  players; for tennis, offer a ranking-based bonus later if wanted.
- **Q1.4** Should the seed bonus have a multiplier or a cap (some pools cap it, or count it
  only from round 2 on)? Recommendation: a multiplier setting defaulting to 1, no cap in the
  first version.

Questions for this section:

- **Q1.1** Do we want a real match entity now (`SportEventMatch`: round, bracket slot, two
  sides, winner, score), or only per-participant advancement for the first launch?
  *Updated 2026-10-11:* the seed bonus below needs to know **who each win was against**, which
  per-participant advancement cannot record. Recommendation is now: build the match entity as
  part of the foundation. The pick'em epic (#607) needs the same table, so it is built once.
- **Q1.2** Should unused catalog enums (`PICK_EM`, `FIGHT_RESULT`, `CUMULATIVE`, extra `Sport`
  values such as `UFC`, `MLB`) be deleted now under the dead-code goal, and re-added only when a
  sport is actually built?

---

## 2. Group 1: tournaments of individual players

### 2.1 Tennis (Grand Slams) — recommended, rank 2

- **Fit:** the closest analogue to golf among true tournaments. A 128-player singles draw with 32
  seeds; tiers by seed line or ranking; budget prices from ATP/WTA ranking or odds. Each Slam
  gives two contests (men's and women's), which suits leagues where people want more to play.
- **Scoring:** advancement points per round won (for example "Grand Slam DFS" points: winner
  40, finalist 30, SF 25, QF 20, R16 15, R32 10, R64 5). Stat bonuses (aces, double faults)
  need a stats feed; recommend leaving them
  out.
- **Following:** solid but smaller than golf in the US. 2026 US Open averaged 1.2M viewers across
  ESPN networks; the men's final drew 3.2M on ABC, ESPN's largest ever for it.
- **Pool competition:** thin. PoolTracker offers Wimbledon and US Open brackets; otherwise mostly
  informal survivor pools and spreadsheets. That is an opening rather than a risk.
- **Data:** no free licensed live feed. Paid options: Goalserve tennis ~$150/month (published),
  api-tennis.com reportedly from ~$40/month (unverified), Sportradar by quote. Jeff Sackmann's
  open tennis datasets are historical and non-commercial licensed, so not usable for live scoring.
  Admin entry is workable but heavy: 254 singles matches per Slam over two weeks, though only
  ~16-32 per day once the first week is done.
- **Calendar:** Australian Open (Jan), Roland Garros (May-Jun), Wimbledon (Jun-Jul), US Open
  (Aug-Sep).

Questions:

- **Q2.1** Men's and women's draws as two separate events (two contests), or one event with both
  fields? Recommendation: two events; it matches how tiers and the leaderboard work today.
- **Q2.2** Admin entry or a paid feed for the pilot? Recommendation: admin entry for the
  Australian Open pilot (mark winners per round), decide on a feed after seeing the effort.
- **Q2.3** Grand Slams only, or also the bigger ATP/WTA 1000 events (Indian Wells, Miami)?
  Recommendation: Slams only to start.

### 2.2 Races with a finishing order: the shared approach — rank 3

Auto racing, horse racing, cycling, marathons and triathlons are not tournaments, but they match
the golf shape even more closely: one event, one field of individuals, one finishing order. They
share one build, separate from knockout advancement:

- **Odds set tiers and prices.** The event-level tiers and the budget pricing curve already accept
  `AUTO_ODDS` valuations, so a field ordered by odds to win gets tiers and prices the same way a
  golf field does. Where a sport has thin betting markets, ranking or `MANUAL` valuations fill
  in.
- **Finish-position scoring.** A `FINISH_POSITION` participant scoring definition: points by
  finishing place, or sum of places (lower is better). Did-not-finish and scratched map onto the
  existing `WITHDRAWN` / `ELIMINATED` states, and the leaderboard needs a fixed score for them
  (like golf's 80-stroke rule).
- **Results entry.** A finishing order typed in by an admin; feasible for every sport here
  because only the order (or the top N) matters.
- **Multi-day events** (stage races, the Breeders' Cup weekend) map onto `SportEventRound` the way
  golf rounds do.
- `POSITION` scoring and the `TIME_TRIAL_RACE` format are already catalog entries; `HORSE_RACING`
  is already a `Sport`. Cycling, running and triathlon would be new `Sport` values.

This ranks below tennis because it does not help any team sport, but it opens the most new
events per unit of work.

### 2.3 Auto racing

- **NASCAR:** 36 Cup races a year plus the Daytona 500; established pool culture (PoolTracker
  season and playoff pools, OfficeFootballPool, NASCAR's own fantasy game). A ~40-car field fits
  tiers well. Weekly one-race contests would give leagues something every Sunday.
- **Indy 500:** a single big-day event (33 cars), popular for one-off pools.
- **F1:** global following, but US viewing is in flux: Apple took exclusive US rights in 2026 and
  third-party household data shows sharp drops after the first races. Lower priority for a
  US office-pool product.

Questions:

- **Q2.4** Is a weekly NASCAR pool (36 small events a season) something leagues would want, or
  should racing be only the marquee races (Daytona 500, Indy 500)? Recommendation: marquee races
  first.
- **Q2.5** Season-long contests (sum across many events) are not modelled (a contest runs on one
  event). Out of scope for now?

### 2.4 Horse racing (added 2026-10-11 on Derek's request)

Its own sport (`HORSE_RACING` already exists). The fit is the best of the racing group for
pricing: every race has a published morning line and live pari-mutuel odds, so odds-based tiers
and prices are exact. Fields are small (usually 8 to 20 runners), so a pick-one-per-tier entry
would use 3 or 4 tiers.

**The big races, each an event** (usual calendar slots; confirm dates when setting events up):

| Race | Usual timing | Field | Notes |
|---|---|---|---|
| Pegasus World Cup | late January | ~12 | Season opener for US dirt racing |
| Dubai World Cup | late March | ~12-14 | Richest race card in the world |
| Grand National (UK) | April | up to 34 | Huge UK office-pool tradition (sweepstakes) |
| **Kentucky Derby** | first Saturday in May (May 1, 2027) | up to 20 | The biggest US office-pool race; Triple Crown leg 1 |
| **Preakness Stakes** | two weeks after the Derby | ~8-14 | Triple Crown leg 2 |
| **Belmont Stakes** | early June | ~8-12 | Triple Crown leg 3 |
| Royal Ascot (UK) | mid-June, five days | many races | A meeting, not one race |
| Prix de l'Arc de Triomphe | first Sunday in October | ~15-20 | Europe's top race |
| **Breeders' Cup** | early November, two days | 14 races | The Classic is the headline race |
| Melbourne Cup | first Tuesday in November | 24 | "The race that stops a nation" |

- **Single races** (Derby, Preakness, Belmont, Grand National, Melbourne Cup) are one event with
  one field, the simplest case. The race lasts minutes, so the "live leaderboard" is the result;
  the pool's interest is in the build-up and the picks.
- **A Triple Crown contest** (best picks across all three legs) would need a contest spanning
  three events, which is the same season-long gap as Q2.5.
- **Race cards** (Breeders' Cup, Royal Ascot, Derby day undercard) are several races with
  different fields. Each race could be its own event, or one event with a round per race, but the
  field is per race, which the model does not have today.

Questions:

- **Q2.6** Start with the Triple Crown races as three separate events, plus the Breeders' Cup
  Classic as a single race? Recommendation: yes; leave full race cards and Triple Crown
  combined contests until multi-event contests exist.
- **Q2.7** Include the UK and international races (Grand National, Melbourne Cup, Arc) from the
  start? Recommendation: add them as events when there is a league asking; they cost only data.
- **Q2.8** Late scratches are common. A scratched horse shows as withdrawn; should the entry get a
  free replacement pick before post time, or take a fixed last-place score? Recommendation: allow
  a replacement until post time, as most Derby pools do.

### 2.5 Cycling, marathons and triathlons (added 2026-10-11 on Derek's request)

Smaller US followings and few office pools today, but the same odds-and-finishing-order approach
handles them with no extra build beyond adding the sport and its events.

- **Cycling.** Grand Tours: Tour de France (July), Giro d'Italia (May), Vuelta a España (late
  August to September), each 21 stages with ~175 riders. Stages map onto `SportEventRound`; score
  on final overall (GC) position, or on stage finishes for a livelier leaderboard. One-day
  "Monuments" (Milan-San Remo, Tour of Flanders, Paris-Roubaix, Liège-Bastogne-Liège, Il Lombardia)
  are single races. Betting markets for the Tour are deep, so odds pricing works.
- **Marathons.** The World Marathon Majors: Tokyo (March), Boston (April), London (April), Sydney
  (late August or September), Berlin (September), Chicago (October), New York (November). Elite
  fields of ~20-40 per race, men's and women's as two events (like tennis draws). Odds exist for
  the biggest races but are thin; ranking or manual prices fill in.
- **Triathlons.** Ironman World Championship (autumn), the T100 series, and the Olympics (2028).
  Odds are sparse, so valuations would be mostly ranking or manual.

Question:

- **Q2.9** Add these sports only when a league asks, or seed the marquee events (Tour de France,
  Boston, New York, Ironman World Championship) up front? Recommendation: after horse racing,
  seed the Tour de France and the Boston and New York marathons; the rest on request.

### 2.6 Considered and not recommended

- **UFC / boxing:** a card of separate fights, not a field; needs pick'em per fight
  (`FIGHT_RESULT`). Different product.
- **Darts, snooker, bowling, pickleball:** real tournaments of individuals, but small US
  followings and almost no office-pool demand.
- **Olympics:** multi-sport and multi-event; too broad for this model as a whole (single Olympic
  races such as the marathon fit section 2.5).

### 2.7 Bowling, cornhole and other bar and lawn games (added 2026-10-11 on Derek's question)

These have real pro tours and TV slots, but small audiences and almost no pool culture. They fit
the existing shapes, so the cost is only data; the question is whether anyone would play.

| Game | Pro events | Shape in our terms | Signs of following or pool use |
|---|---|---|---|
| **Bowling (PBA Tour)** | ~10 televised events a year on The CW (from 2026); PBA World Championship, Tournament of Champions, U.S. Open | Qualifying then a stepladder final: a field ranked by finish, so finishing-order scoring (section 2.2) | 2026 PBA World Championship drew ~1M viewers on CBS. BowlingLife already runs a season fantasy game where managers pick **five tier players plus a wildcard per event**, which is our tiered format exactly |
| **Disc golf (DGPT)** | Disc Golf Pro Tour, ~25 events, plus majors | **Stroke play, scored to par, exactly like golf.** Could run on the current golf scoring with no new scoring work | Growing niche with streaming coverage (inferred); fantasy games exist among fans (inferred, not verified) |
| **Cornhole (ACL)** | ACL World Championships (late July, Rock Hill SC) on ESPN networks; ~9 ESPN events a year | Singles and doubles brackets: tennis shape; doubles pairs would be a "team" participant | ESPN coverage is real but no ratings or pool or betting activity found |
| **Darts** | Covered in section 3.7 | Tennis shape | The strongest of this group: UK sweepstakes, deep odds |
| **Pool / billiards** | World Pool Championship (128-player knockout); Mosconi Cup (USA v Europe, teams) | Tennis shape (Worlds); Mosconi Cup is a team match, no field | Small; mostly UK and Europe |
| **Pickleball** | PPA Tour, Major League Pickleball | Tennis shape (singles and doubles draws) | Fast-growing to play, but a small TV audience and no pool culture found |

**Takeaway:** disc golf is the surprise: it is golf's scoring model with a different ball, so it
could be the cheapest second sport of all. Bowling has the clearest evidence that tiered picking
appeals to its fans. The rest are "add as data if a league asks".

Question:

- **Q2.10** Worth a small experiment with disc golf, since it reuses golf scoring outright?
  Recommendation: only if a league asks; it is a niche audience, but the cost is close to zero.

---

## 3. Group 2: tournaments of teams

Teams fit the model directly: a team is a `Participant` with `participantType = TEAM`, entered in
an event's field like a golfer. Your instinct is right that they "still fit the model"; the new
pieces are scoring and, for brackets, a new selection type.

### 3.1 March Madness team pools — recommended, rank 1

- **Following:** the biggest office-pool event in the US. ESPN's Tournament Challenge alone took
  26.6 million brackets before the 2026 tournament (a fourth straight record); the American
  Gaming Association estimated 45 million US adults would bet on the 2025 tournament.
- **Fit:** strong, using what already exists:
  - *Tiered by seed:* 4 tiers (seeds 1-4, 5-8, 9-12, 13-16), pick one or two per tier. This is
    the existing tiered engine with seed lines as event tiers.
  - *Budget:* teams priced by seed or odds with the #93 pricing curve.
  - *Snake draft (#199):* the classic "draft the 64 teams" office pool; a natural second use of
    snake once it is built.
- **Scoring options** (all advancement-based, all just configs of one definition):
  - points per win doubling by round (1, 2, 4, 8, 16, 32);
  - "seed multiplier" (round points x seed), which rewards upsets heavily;
  - "3 + seed" per win, the common Pick-X pool rule.
  Pool analysts note scoring choice changes strategy a lot, which is a selling point: the
  commissioner picks the flavour.
- **Pool competition:** full brackets are dominated by ESPN, CBS, Yahoo and NCAA.com, all free.
  "Pick X teams", tiered and Calcutta-style pools are mostly run on spreadsheets or a few hosts
  (RunYourPool, OfficePoolStop). Poolmaster's niche is exactly these golf-style alternatives.
- **Data:** 68 teams, 67 games over three weekends; admin entry is easy. Feeds (SportsDataIO,
  Sportradar) exist if wanted; an unofficial ESPN scoreboard API is widely used but not licensed
  (inferred from common practice, not checked).
- **Calendar:** Selection Sunday is about March 14, 2027; picks would lock at the First Round tip
  (the First Four can be excluded). The women's tournament runs at the same time and can be a
  second event at no extra build cost.

Questions:

- **Q3.1** Include the First Four teams in the field (68) or only the 64 after it? Recommendation:
  64; lock picks at the first First Round game.
- **Q3.2** Which scoring presets ship first? Recommendation: doubling-by-round and seed-multiplier,
  as two contest config templates.
- **Q3.3** Run the women's tournament as a second event from day one? Recommendation: yes, it is
  only data.

### 3.2 Soccer tournaments — rank 4

- **Following:** fast-growing in the US. Gallup's 2026 poll has soccer at a record 9% as
  favourite sport to watch (basketball 11%, baseball 10%); the 2026 World Cup final drew ~62.8M
  US viewers across Fox and Telemundo, a US soccer record.
- **Timing problem:** the biggest event just ended. Upcoming: Champions League knockouts
  (Feb-May 2027, 16 teams from the round of 16), Women's World Cup 2027 (Brazil, June-July,
  32 teams), Gold Cup 2027, Euro 2028, men's World Cup 2030.
- **Fit:** knockout rounds are identical to March Madness once the foundation exists. Group stages
  are not: they have draws, points tables and "best third place" rules, and need the match entity
  from Q1.1. A practical first step is knockout-stage-only pools (Champions League round of 16
  onward), which need nothing beyond the foundation.
- **Data:** the best of any sport here. football-data.org's free tier covers the World Cup,
  Euros, Champions League and top leagues (delayed scores, 10 calls/minute); live scores are a
  ~€12/month add-on (third-party figures; check before relying).
- **Pool competition:** strong for World Cups (FIFA's own predictor, Fox/ESPN bracket games,
  "Office World Cup" for Google Chat, RunYourPool). Thin for Champions League in US office
  settings.

Questions:

- **Q3.4** Is a Champions League knockout pool interesting to your users, or is soccer only worth
  it for World Cups? If only World Cups, soccer drops behind racing until 2030 (the 2027 Women's
  World Cup aside). Decided 2026-10-21: both. Derek wants every soccer competition supported,
  built in order of shape; the scope and slices are on #787.
- **Q3.5** For group stages, score teams by group-stage points (3 for a win, 1 for a draw) plus
  knockout advancement? That is the usual pool rule but it needs per-match results.
  Decided 2026-10-21: no. Group matchdays are pick'em only, and roster and bracket pools start at
  the knockout round (#787).

### 3.3 March Madness full bracket pick'em — rank 5

- The format almost everyone plays, but a different product: each entry predicts all 63 games,
  scoring compares predictions against results, and picks are not participants but outcomes.
- **Needs:** the `BRACKET_PICK_EM` selection type for real, a bracket structure (which game feeds
  which), the match entity, a tiebreaker (championship total points), and a bracket-filling UI
  that works on a phone. The largest build in this document.
- **Competition:** free, polished, and huge (ESPN, CBS, Yahoo). Hard to win users on this alone;
  worth it later because leagues already on Poolmaster would rather not leave for it.

Question:

- **Q3.6** Is it important that a league can run its bracket pool inside Poolmaster in 2027, or is
  the team-pool alternative enough for the first March? Recommendation: team pools only in 2027.

### 3.4 Other team knockouts (follow-ons on the same foundation)

Once advancement scoring exists these are mostly data: **College Football Playoff** (12 teams,
Dec-Jan, huge following), **NFL playoffs** (14 teams), **NBA and NHL playoffs** (16 teams, series
rather than single games; advancement scoring still works). None needs a new selection type for a
"pick teams by seed" pool.

---

### 3.5 NFL (added 2026-10-11 on Derek's question)

NFL splits into three very different pools, and only one fits the current design.

- **Playoff pool (fits; recommended).** 14 teams, single-game knockout, Wild Card weekend
  mid-January through the Super Bowl in February. "Pick teams by seed" (tiers by seed, or budget
  by odds) scored by wins per round is exactly the knockout advancement foundation in section 1,
  with 13 games to enter by hand. It could even be the foundation's first live event, a week
  ahead of the Australian Open.
- **Weekly pick'em, confidence and survivor (does not fit yet).** These are the most common NFL
  office pools, but a pick is a game outcome, not a field member, and the contest runs all
  season across 18 weeks. That needs the match entity (Q1.1), a new pick'em selection type, and
  season-long contests spanning many events (Q2.5). `WEEKLY_GAMES_SEASON`, `PICKEM_CONFIDENCE`
  and `SURVIVOR` exist in the enums but nothing behind them. It is also the most crowded pool
  market (ESPN, Yahoo, CBS, OfficePoolStop, RunYourPool, OfficeFootballPool all do it well).
- **Fantasy player stats (does not fit; not recommended).** Scoring individual players' yards
  and touchdowns needs a paid live stats feed and a stat-accumulation scoring engine; this is
  ESPN/Yahoo/Sleeper fantasy territory.

Question:

- **Q3.7** Is an NFL playoff pool in January 2027 worth targeting as the first knockout event?
  Recommendation: yes if the foundation is ready by early January; otherwise go straight to
  March Madness. Weekly NFL pick'em only after the match entity and season-long contests exist.

### 3.6 NFL DFS-style weekly contests (added 2026-10-11 on Derek's question)

Leaving the data feed aside, a weekly DFS contest is a close fit, closer than weekly pick'em.

**Already fits:**

- A week's slate is one `SportEvent` (for example "NFL Week 6, Sunday main slate"); its field is
  the players in those games. Each week stands alone, like a golf tournament.
- A salary-cap lineup is budget selection, which already shipped (#93, closed 2026-10-11): cap, per-player prices, non-exclusive picks,
  over-budget lineups blocked at submit. Prices would be set by hand or imported, not from the
  ranking curve.
- Release, pick lock, reveal, live leaderboard and settled standings all carry over, and the
  ranking code already handles higher-is-better scores.

**Needs building:**

1. **Positions and roster slots.** DFS lineups are QB, 2 RB, 3 WR, TE, FLEX (RB/WR/TE) and a team
   defence. Participants have only a free-text `role`; this needs a typed position per sport and
   a slot rule in the selection engine (budget plus position slots, with FLEX accepting several
   positions). This is the biggest selection-side change.
2. **Team defence alongside players.** One field mixes individual players and a team; the model
   allows it (`participantType`), but nothing has done it yet.
3. **Per-game pick locks.** Golf locks every pick at tee-off. A slate spans Sunday 1pm to Monday
   night, so either the whole lineup locks at the first kickoff (simple, acceptable for v1) or
   each player locks at his own game's kickoff (the DFS norm; new rule).
4. **Stat-based scoring.** A football extension per player per game (yards, touchdowns,
   receptions, turnovers) and a scoring definition that turns stats into fantasy points (PPR or
   standard). Every pick counts, not best N.
5. **Weekly event creation.** 18 slates a season need creating from the schedule, ideally
   automatically.

The same work would also unlock golf DFS (salary-cap golfer lineups scored by DFS points).

Question:

- **Q3.8** Whole-lineup lock at first kickoff for a first version, or per-player locks from the
  start? Recommendation: whole-lineup lock first.

### 3.7 International sports (added 2026-10-11 on Derek's question)

Outside the US, the office pool is usually a **sweepstake**: everyone draws a team or a player
from a hat, and whoever holds the winner takes the pot. Prediction games (Superbru, ESPN
footytips) are the other big habit. Most international events map onto shapes this doc already
covers, so the deciding question is pool demand, not fit.

| Sport | Big tournaments | Shape in our terms | Signs of pool use |
|---|---|---|---|
| **Rugby union** | Rugby World Cup 2027 (Australia, 1 Oct - 13 Nov 2027; 24 teams in 6 pools, then a new round of 16; draw 3 Dec 2026). Six Nations every Feb-Mar | World Cup = soccer shape (pools, then knockout). Six Nations = round robin, weekly pick'em only | Strong. Superbru runs rugby predictors with ~20k-40k players per competition and private pools "for office sweepstakes"; World Cup sweepstakes are routine in UK, Ireland, Australia, NZ, South Africa (inferred, common practice) |
| **Cricket** | Men's ODI World Cup 2027 (South Africa, Zimbabwe, Namibia; Oct-Nov 2027, two groups of six then a "Super 7" round robin, then semis and final). T20 World Cup every two years. IPL every Mar-May | World Cup = groups plus a round-robin stage, awkward for advancement scoring. IPL = a season with a 4-team playoff | Very large but mostly paid fantasy: Dream11 (India) is the ICC's official fantasy game with 100M+ users. That is the DFS shape (section 3.6), not office pools |
| **Australian rules (AFL)** | Season Mar-Sep; Finals series of 8 teams; Grand Final late September | Weekly "tipping" = pick'em (doesn't fit yet, section 3.5). Finals = small knockout (fits the foundation) | Huge: footy tipping is Australia's office pool; ESPN footytips reported ~870k players in one national competition (older figure). Rugby league (NRL) tipping is the same |
| **Table tennis** | World Championships (singles draws of 128), WTT Champions and Finals, Olympics | Tennis shape (knockout of individuals) | Weak. Only hobby forum prediction threads found; big in China, Japan, Germany, but no evidence of pool sites or sweepstakes |
| **Darts** | PDC World Championship, 128 players, mid-December to early January (2026/27 edition: 11 Dec - 3 Jan) | Tennis shape | Good in the UK and Ireland (sweepstakes at Christmas, inferred); bookmakers price every player, so odds-based tiers work |
| **Snooker** | World Championship, 32 players, late April to early May (Sheffield) | Tennis shape | Moderate in the UK; similar sweepstake culture to darts (inferred) |
| **Ice hockey** | IIHF World Championship (May, 16 teams), Olympic tournament (2030) | Soccer shape (groups, then knockout) | Moderate in Canada and Europe (inferred) |

**What this means for the plan:**

- **Knockouts of individuals (darts, snooker, table tennis)** need nothing beyond the tennis work.
  Darts is the best of these: a big field, deep odds, a holiday-season event, and a real
  sweepstake habit.
- **Team tournaments (Rugby World Cup, cricket World Cup, ice hockey)** follow soccer: knockout
  rounds work on the foundation; group stages need the match entity (Q1.1). The Rugby World Cup
  2027 is the strongest international team event in reach, and its 24 teams are seeded 1-24 by
  World Rugby ranking, which gives tiers for free.
- **Weekly tipping (AFL, NRL, Super Rugby, Six Nations)** is the largest international pool habit
  but needs pick'em (section 3.5), the same work as weekly NFL.
- **A random-draw selection type** would match the sweepstake directly: the commissioner (or the
  app) deals the field out to entries at random, one or more each. It is cheap (no picking UI)
  and would suit the World Cups, the Grand National and Melbourne Cup, and darts. This is a new
  idea worth weighing against tiered for international leagues.
- **Going international** also means currencies in budget prices, date and time formats (the
  user settings already carry date and time format), and kickoff times in other time zones.
  None of this blocks a first event.

Questions:

- **Q3.9** Is an international audience a goal, or should international events be added only
  where US users care (Rugby World Cup, darts)? Recommendation: US first; add the Rugby World Cup
  2027 and the PDC darts as events once the foundation exists, since they cost only data.
- **Q3.10** Should a random-draw (sweepstake) selection type go on the list? Decided 2026-10-11:
  filed as #601, which has the table of where sweepstakes are actually used. It works on golf
  today, so it does not need to wait for the knockout foundation.
- **Q3.11** Cricket's World Cup format (a round-robin "Super 7" stage) does not suit advancement
  scoring. Skip cricket unless a league asks? Recommendation: skip for now.

## 4. Pool sites already covering each sport

| Sport | Who covers it today |
|---|---|
| Golf (for comparison) | RunYourPool, PoolTracker (majors), Easy Office Pool, Splash Sports; Masters pools vary by format (tiers, snake, auction) with no single dominant one |
| March Madness brackets | ESPN Tournament Challenge, CBS, Yahoo, NCAA.com; RunYourPool, OfficePoolStop |
| March Madness alternatives (pick X, tiers, Calcutta) | Mostly spreadsheets; some hosts' custom formats; strategy content from PoolGenius and Action Network shows demand |
| Tennis | PoolTracker (Wimbledon, US Open brackets); little else |
| Soccer | FIFA predictor, Fox/ESPN bracket games, Office World Cup (Google Chat), RunYourPool, OfficePoolStop (Premier League pick'em) |
| NFL | ESPN, Yahoo, CBS (pick'em, survivor, fantasy); OfficePoolStop, RunYourPool, OfficeFootballPool (pick'em, confidence, survivor, squares) |
| NASCAR / auto racing | PoolTracker, OfficeFootballPool, NASCAR Fantasy |
| Horse racing | OfficePoolStop Kentucky Derby prop pool; mostly paper sweepstakes and draw-a-horse pools |
| Rugby, cricket, AFL (international) | Superbru (rugby, cricket, soccer predictors with private pools), ESPN footytips (AFL, NRL), Dream11 (cricket fantasy) |
| Cycling, marathons, triathlons | Official fantasy games (for example Tour de France fantasy); almost no office-pool hosts |

---

## 5. Suggested tickets (not filed)

1. Knockout advancement foundation: scoring definition, knockout extension, cross-sport counting
   rule and settlement, admin results screen, sport-aware labels.
2. Tennis Grand Slam events: player roster seeding (ATP/WTA), seed-line tiers, Australian Open
   2027 event set up as the pilot.
3. March Madness team pool: team roster seeding, seed-line tiers, scoring config templates, men's
   and women's 2027 events.
4. Finish-position scoring with odds-based tiers and prices: horse racing (Triple Crown, Breeders'
   Cup) and auto racing (Daytona 500, Indy 500), then cycling, marathons and triathlons as data.
5. NFL playoff pool on the knockout foundation (January).
6. Random-draw (sweepstake) selection type: filed as #601; works on golf now.
7. Later: match entity, soccer knockout pools, bracket pick'em, then weekly NFL pick'em and survivor.

Question:

- **Q5.1** Should this go to a planning thread now, with ticket 1 sized against the January
  Australian Open? Recommendation: yes; budget selection (#93) merged 2026-10-11, so nothing
  blocks it, and the deadline that matters is mid-March 2027.

---

## 6. What is left, and Derek's calls (2026-10-24)

Built since this was written: golf, March Madness, NBA/WNBA, NFL and CFP, hockey, baseball (MLB),
soccer, tennis, horse racing, auto racing, cycling and marathons, with tiered, budget, quick pick,
bracket, pick'em, survivor, ATS and squares pools. Each remaining sport has its own ticket under
#599 listing its leagues and slices. The one-page matrix of what could be added per sport, with
effort, is the artifact https://claude.ai/artifact/UYtNyhBK8LjCkWroWDN29k.

Recommended order:

1. Leagues that are data only, timed to their seasons: Indian Wells and Miami tennis (#820), LIV
   and DP World golf (#640), Liga MX and the Gold Cup (#818), the College World Series from the
   super regionals on (#793 comment on #789).
2. Rugby (#794): Six Nations pick'em, then the Men's Rugby World Cup in October 2027.
3. UFC fight-card pick'em (#798).
4. NCAA women's volleyball (#799), December 2027.
5. #793, playoffs where a loser can still advance (full NCAA baseball and softball, NRL finals).
6. Olympics (#821) before LA28.
7. On request: other soccer leagues, lacrosse (#801), esports (#800), baseball squares.

Decided by Derek 2026-10-24:

- **UK and Australian sports are skipped for now**, since US office pools are the core users:
  darts (#796), snooker (#797), cricket (#795), AFL (#710), and the UK and Australian horse races
  (§2.4). The ideas stay here and in their tickets for later.
- **Rugby is one sport**, `RUGBY`, with union and league competitions as separate leagues (#794).
- **Props (#712) are parked**, deferred with no target date.

---

## Sources

- PBA viewership and the BowlingLife tiered fantasy game: https://11thframe.com/news/article/16851/2026-PBA-World-Championship-drew-solid-viewership-of-1-million , https://bowlinglife.eu/fantasy/rules
- ACL World Championships on ESPN: https://www.sportsvideo.org/?p=175062

- Rugby World Cup 2027 format and dates: https://www.rugbyworldcup.com/es/news/1017765/rugby-world-cup-2027-all-you-need-to-know-about-the-draw-format-pools-and-dates , https://www.rugby.com.au/news/rugby-world-cup-2027-new-format-changes-24-teams-20231024
- Superbru games and private pools: https://www.superbru.com
- ESPN footytips: https://www.bandt.com.au/espn-celebrates-25-years-of-footy-tipping-as-new-afl-nrl-season-kicks-off/ , https://standard.net.au/story/8678224/warrnambool-mans-afl-tipping-success-sees-chance-to-win-50k
- Dream11 and the ICC: https://www.dreamsports.group/media-and-blog/dream11-becomes-the-exclusive-official-fantasy-game-partner-for-icc
- ICC Men's Cricket World Cup 2027 schedule and format: https://www.icc-cricket.com/news/fixture-schedule-announced-for-icc-men-s-cricket-world-cup-2027 , https://www.icc-cricket.com/news/new-icc-men-s-cricket-world-cup-format-explained
- PDC World Darts Championship 2026/27: https://www.skysports.com/darts/news/12040/13570429/world-darts-championship-2026-27-dates-confirmed-for-alexandra-palace-with-sunday-final-in-great-hall-for-first-time
- Table tennis prediction contests (forum only): https://pingskills.com/table-tennis-forum/pingskills---pick-the-world-championships-winners

- ESPN press room, 2026 Tournament Challenge record (26.6M brackets): https://espnpressroom.com/us/press-releases/2026/03/26-6-million-brackets-espn-tournament-challenge-sets-new-record-for-fourth-consecutive-year/
- AGA 2025 March Madness estimate (45M bettors, $3.1B): https://cheddar.com/media/american-gaming-association-says-45-million-americans-to-wager-3-1-billion-on-march-madness
- Pick-X and Calcutta pool formats: https://poolgenius.teamrankings.com/ncaa-bracket-picks/articles/ncaa-tournament-pick-x-pool-strategy/ , https://www.actionnetwork.com/ncaab/best-alternative-march-madness-pools , https://www.cbssports.com/college-basketball/news/2024-ncaa-tournament-calcutta-pool-rules-format-how-to-play-the-twist-on-your-classic-bracket-pool/
- 2026 US Open viewership: https://www.tvtechnology.com/insights/analysis/espn-reports-record-u-s-open-mens-championship-viewing , https://www.sportsmediawatch.com/?p=1346514
- Tennis data pricing: https://goalserve.com/en/sport-data-feeds/tennis-api/prices , https://sportsapis.dev/apis/live-tennis-api
- 2026 World Cup final US audience: https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/more-than-62-million-u-s-viewers-watched-2026-world-cup-final , https://www.newscaststudio.com/2026/07/22/fox-2026-world-cup-final-ratings/
- Gallup 2026 favourite sport (soccer 9%): https://www.fox5dc.com/news/poll-reveals-americans-favorite-sports-watch-2026
- football-data.org free tier: https://www.thestatsapi.com/blog/football-data-org-free-tier-limits-2026 , https://getbruin.com/docs/ingestr/soccer-sources/football-data-org.html
- F1 US viewing on Apple TV: https://www.mactech.com/2026/08/25/f1s-u-s-viewership-is-down-in-its-first-season-on-apple-tv-but/
- Pool hosts: https://officepoolstop.com/kentucky-derby-pool , https://bch.pooltracker.com/about_us.asp , https://www.cbinsights.com/company/officefootballpool , https://workspace.google.com/marketplace/app/office_world_cup/540577245291
- Masters pool formats: https://www.actionnetwork.com/golf/masters-pool-ideas
