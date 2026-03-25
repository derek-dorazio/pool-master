# PoolMaster — Contest Structures: In-Scope for v1

## Scope Definition

PoolMaster v1 focuses on three contest categories:

1. **Office / tournament pools** — participants pick teams or players once per event with no ongoing roster management.
2. **Knockout / survivor pools** — participants are eliminated on wrong picks. Can be season-long but one pick per period max; no trades or waivers.
3. **Tiered / budget squad pools** — participants build a roster from tiers or within a budget for a single event. Picks lock at the start; no mid-contest changes.

**Deferred:** Season-long fantasy with weekly management, DFS, full bracket games (already saturated by major platforms).

---

## Two Core Mechanics — Consistent Across Sports

### A. Tournament Squad Selection Types

Every tournament pool where participants build a squad supports three selection mechanics. These are sport-agnostic and share one domain model:

| Mechanic | How it works | Exclusive? |
|---|---|---|
| **Snake Draft** | Turn-based selection; each team/player owned by one manager only | ✅ Yes |
| **Tiered Pick** | Field grouped into tiers (by seed, rank, or odds); pick 1 from each tier | ❌ No — same pick available to all |
| **Budget Pick** | Each team/player assigned a cost; build a roster within a total budget | ❌ No — same picks available to all |

All three mechanics are applied consistently to every applicable tournament in this document.

### B. Survivor / Knockout Pick Styles

Every survivor pool supports two pick submission styles:

| Style | How it works |
|---|---|
| **Live Pick** | One pick per period (week/round/race), submitted before each period begins. Future picks unknown and uncommitted. |
| **Locked Pick** | All picks submitted upfront before the event starts. Eliminated when any pick in the sequence loses. |

**Shared survivor config options** (all survivor contests):
- `one_entity_per_season` — each team/player usable only once (standard: true)
- `picks_per_period` — 1 standard; 2 = Double Pick (both must win)
- `strikes` — N wrong picks allowed before elimination (0 = instant)
- `buybacks` — allow one re-entry after elimination (commissioner setting)

---

### Tag Legend

| Tag | Meaning |
|---|---|
| `#single-event` | Contest covers one game, race, match, or tournament |
| `#season-long` | Contest spans a full competition season |
| `#snake-draft` | Exclusive turn-based selection; each pick owned by one manager |
| `#tiered` | Pick N teams/players from defined tier groups; non-exclusive |
| `#budget-pick` | Build a roster within a cost budget; non-exclusive |
| `#pick-em` | Predict winners or outcomes; no squad to build |
| `#survivor` | Participants are eliminated on wrong picks |
| `#live-pick` | Survivor picks submitted one per period as play progresses |
| `#locked-pick` | All survivor picks submitted upfront before the event starts |
| `#one-and-done` | Each team/player usable at most once per season |
| `#cumulative-scoring` | Points accumulate across events or rounds |
| `#knockout-scoring` | Wrong pick ends participation |
| `#confidence-weighted` | Participants assign priority weights to their predictions |
| `#best-ball` | Auto-selects best scorers from a submitted pick set |
| `#low-score-wins` | Lowest combined score wins (stroke-play golf) |
| `#exclusive` | Each team/player owned by only one participant |

---

# 🇺🇸 US Sports

---

## 🏈 NFL (American Football)

### NFL-2: Survivor Pool

**Tags:** `#season-long` `#survivor` `#knockout-scoring` `#one-and-done` `#live-pick` `#locked-pick`

The most popular non-DFS football contest. Pick one NFL team per week to win straight-up. Wrong pick = eliminated. Each team usable only once per season.

**How it works:**
- Each week: pick one NFL team to win (no spread)
- Wrong pick = eliminated; each team usable only once per season
- Last survivor wins; tiebreaker by highest cumulative score if multiple survive

**Pick style variants:**
- **Live Pick (standard):** One pick submitted each week before kickoff
- **Locked Pick:** Full season pick sequence submitted before Week 1; eliminated when any pick loses

**Other variants:** Double Pick (2 wins required per week); Strikes (N wrong picks before elimination); Buybacks

**Platforms:** Yahoo, Splash Sports, PoolGenius, ESPN, OfficePoolStop

```
contest_type: SEASON_LONG | survivor_style: LIVE_PICK | LOCKED_PICK (configurable)
picks_per_week: 1–2 (configurable) | one_team_per_season: true
strikes_before_elimination: 0–3 (configurable) | buybacks: configurable
```

---

## 🏀 NBA (Basketball)

### NBA-3: Playoffs Bracket Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Submit all series winner predictions before Game 1. Bonus points for predicting correct series length. A compact single-submission office pool — 15 series predictions at most.

**How it works:**
- All predictions before Game 1 tips off
- Points per correct series winner; more in later rounds
- Bonus: correct series length (+1 or +2 pts per correct prediction)
- Tiebreaker: total points in the NBA Finals deciding game

**Platforms:** Yahoo, ESPN, CBS Sports, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
round_values: [1, 2, 4, 8] (configurable) | series_length_bonus: configurable
tiebreaker: FINALS_TOTAL_SCORE
```

---

### NBA-T1: Playoffs Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time pre-playoffs snake draft of all 16 playoff teams. Each team earns points for every series win. Draft-and-done — no management after draft day.

**How it works:**
- Snake draft before Round 1; 16 teams distributed among managers
- Points per series win; round multiplier increases later (e.g. 1, 2, 4, 8)
- Exclusive: each team owned by exactly one manager

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-playoffs)
is_exclusive: true | scoring_type: CUMULATIVE (wins × round_value)
round_values: [1, 2, 4, 8] (configurable)
```

---

### NBA-T2: Playoffs Tiered Team Pool

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Playoff field divided into tiers by seed. Pick one team per tier before Round 1. Non-exclusive; earn points per series win.

**How it works:**
- Tiers by seed: Tier 1 = 1–2 seeds each conference, Tier 2 = 3–4 seeds, Tier 3 = 5–6 seeds, Tier 4 = 7–8 seeds (commissioner configurable)
- Pick 1 team per tier; lock before Round 1
- Points per series win; round multiplier increases later
- Non-exclusive: same team on multiple entries is fine

```
contest_type: SINGLE_EVENT | draft_type: TIERED
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
tier_assignment_method: SEED | CONFERENCE | COMMISSIONER
```

---

### NBA-T3: Playoffs Budget Team Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each playoff team assigned a cost based on championship odds or seed. Build a team portfolio within a budget before Round 1. Non-exclusive.

**How it works:**
- Favorites (top seeds / short odds) cost more; underdogs are cheap
- Pick any combination of teams within the budget (e.g. $100 cap)
- Points per series win; round multiplier increases later
- Non-exclusive: same teams on multiple entries is fine

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
budget: configurable | pricing_method: ODDS | SEED | COMMISSIONER
```

---

### NBA-5: Survivor (Playoff Edition)

**Tags:** `#single-event` `#survivor` `#knockout-scoring` `#live-pick` `#locked-pick`

Pick one team per round to advance. Wrong pick = eliminated. Each team usable only once across the playoffs.

**Pick style variants:**
- **Live Pick (standard):** One pick per round, submitted before each round begins
- **Locked Pick:** All 4 round picks submitted before Round 1; eliminated when any round's pick loses their series

```
contest_type: SINGLE_EVENT | survivor_style: LIVE_PICK | LOCKED_PICK (configurable)
one_team_per_playoffs: true | picks_per_round: 1–2 (configurable)
```

---

## ⚾ MLB (Baseball)

### MLB-3: Home Run Derby Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Predict the winner of each bracket matchup in the MLB All-Star Home Run Derby before the event begins.

**How it works:**
- Full bracket submitted before Derby starts
- Points per correct round advancement; more for later rounds
- Tiebreaker: predict total HR count for the winner (closest without going over)

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
bonus_prediction: TOTAL_HRS (tiebreaker)
```

---

## 🏒 NHL (Hockey)

### NHL-3: Stanley Cup Playoff Bracket

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Predict all series winners and series lengths before puck drop of Game 1.

**How it works:**
- Full bracket submitted before first game
- Points per correct series winner; more in later rounds
- Bonus: correct series length prediction
- Tiebreaker: total goals in the Cup-deciding game

**Platforms:** Yahoo, ESPN, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
series_length_bonus: configurable | round_values: [1, 2, 4, 8] (configurable)
tiebreaker: CUP_DECIDING_GAME_TOTAL_GOALS
```

---

### NHL-T1: Playoffs Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time pre-playoffs snake draft of all 16 playoff teams. Each series win earns points for the owning manager. Draft-and-done.

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-playoffs)
is_exclusive: true | scoring_type: CUMULATIVE (wins × round_value)
round_values: [1, 2, 4, 8] (configurable)
```

---

### NHL-T2: Playoffs Tiered Team Pool

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Playoff field divided into tiers by seed or division. Pick one team per tier before Round 1. Non-exclusive; earn points per series win.

```
contest_type: SINGLE_EVENT | draft_type: TIERED
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
tier_assignment_method: SEED | DIVISION | COMMISSIONER
```

---

### NHL-T3: Playoffs Budget Team Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each playoff team priced by seed or championship odds. Build a team portfolio within a budget before Round 1. Non-exclusive.

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
budget: configurable | pricing_method: ODDS | SEED | COMMISSIONER
```

---

### NHL-5: Survivor (Playoff Edition)

**Tags:** `#single-event` `#survivor` `#knockout-scoring` `#live-pick` `#locked-pick`

Pick one team per round to advance. Wrong pick = eliminated. Each team usable only once across the playoffs.

**Pick style variants:**
- **Live Pick (standard):** One pick per round, submitted before each round begins
- **Locked Pick:** All 4 round picks submitted before Round 1; eliminated when any round's pick loses

```
contest_type: SINGLE_EVENT | survivor_style: LIVE_PICK | LOCKED_PICK (configurable)
one_team_per_playoffs: true | picks_per_round: 1–2 (configurable)
```

---

## 🏌️ Golf (PGA Tour, Majors, LPGA)

### GOLF-T1: Tiered Pick Pool

**Tags:** `#single-event` `#tiered` `#best-ball` `#low-score-wins` `#cumulative-scoring`

The most popular casual golf pool format for majors. Field split into tiers by ranking or odds; pick one golfer per tier. Only the best N scores count (lower is better).

**How it works:**
- 4–10 tiers by world ranking or odds; pick 1 golfer per tier
- Best N scores count (e.g. Pick 6, Use Best 4); lowest combined strokes wins
- Missed cut = penalty score (typically 80 per missed round)
- Non-exclusive; picks lock before round 1 tee time

**Platforms:** EasyOfficePools, BuzzFantasyGolf

```
contest_type: SINGLE_EVENT | draft_type: TIERED | scoring_type: STROKE_PLAY (lower wins)
is_exclusive: false | best_ball_n: configurable | missed_cut_score: 80
tier_assignment_method: WORLD_RANKING | ODDS | COMMISSIONER
```

---

### GOLF-T2: Budget Pick Pool

**Tags:** `#single-event` `#budget-pick` `#best-ball` `#low-score-wins` `#cumulative-scoring`

Each golfer in the field assigned a cost based on ranking or odds. Build a roster of 6–8 golfers within a budget. Only the best N scores count. Office pool format — single submission, no platform fees.

**How it works:**
- Each golfer assigned a cost (commissioner-set or auto from odds); favorites cost more
- Pick 6–8 golfers within the total budget
- Best N scores count (same best-ball mechanic as GOLF-T1)
- Lowest combined strokes wins; missed cut = penalty score
- Non-exclusive; picks lock before round 1

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK | scoring_type: STROKE_PLAY (lower wins)
is_exclusive: false | best_ball_n: configurable | missed_cut_score: 80
budget: configurable | pricing_method: WORLD_RANKING | ODDS | COMMISSIONER
```

---

### GOLF-T3: Snake Draft Golfer Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#low-score-wins` `#cumulative-scoring`

Pre-tournament snake draft where each golfer is exclusively owned by one manager. Lowest combined strokes from your drafted golfers across the full tournament wins.

**How it works:**
- Snake draft before the tournament (commissioner sets roster size per manager, e.g. 6 golfers)
- Each golfer's actual stroke total counts for the manager who drafted them
- Missed cut = penalty score (configurable)
- Lowest total combined strokes wins
- Exclusive: each golfer owned by exactly one manager

**Best for:** Medium private leagues (6–12 managers) where the draft is part of the fun.

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-tournament)
is_exclusive: true | scoring_type: STROKE_PLAY (lower wins)
missed_cut_score: configurable | roster_size_per_manager: configurable
```

---

## 🏀 NCAA Basketball (March Madness)

### NCAA-2: Tournament Survivor

**Tags:** `#single-event` `#survivor` `#knockout-scoring` `#live-pick` `#locked-pick`

Pick one team per day (or per round) to win their game. Wrong pick = eliminated. Each team usable only once.

**Pick style variants:**
- **Live Pick (standard):** One pick per day/round as play progresses
- **Locked Pick:** Full pick sequence for all 6 rounds submitted before the tournament; eliminated when any round's pick loses

**Variants:** Per-round vs. per-day; Double Pick (2 teams per period, both must win)

**Platforms:** ESPN, Splash Sports, OfficePoolStop

```
contest_type: SINGLE_EVENT | survivor_style: LIVE_PICK | LOCKED_PICK (configurable)
one_team_per_tournament: true | picks_per_period: 1–2 (configurable)
elimination_frequency: DAILY | PER_ROUND (configurable)
```

---

### NCAA-T1: Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time pre-tournament snake draft of the 68-team field. Each team exclusively owned by one manager. Points per win; round multiplier increases later.

**How it works:**
- Pre-tournament snake draft; all teams distributed among managers
- Points per win, multiplied by round value
- Exclusive; manager with most cumulative points wins

**Platforms:** ActionNetwork, custom leagues

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-tournament)
is_exclusive: true | scoring_type: CUMULATIVE (wins × round_value)
round_values: [1, 2, 4, 8, 16, 32] (configurable)
```

---

### NCAA-T2: Tiered Team Pool

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Field naturally tiers by seed. Pick one team per tier before the tournament. Non-exclusive; earn points per win.

**How it works:**
- Tiers by seed (e.g. Tier 1 = seeds 1–2, Tier 2 = 3–4, Tier 3 = 5–8, Tier 4 = 9–16) or commissioner-defined
- **Open selection variant (Pick N):** Pick any N teams from the full field instead of strict tiers — the classic "Pick 8" format
- Non-exclusive; same teams on multiple entries fine
- Points per win; round multiplier increases in later rounds

```
contest_type: SINGLE_EVENT | draft_type: TIERED | OPEN_SELECTION (configurable)
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
tier_assignment_method: SEED | COMMISSIONER | pick_count: configurable
```

---

### NCAA-T3: Budget Team Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each tournament team assigned a cost based on seed or championship odds. Build a team portfolio within a budget before the tournament. Non-exclusive.

**How it works:**
- 1-seeds (most expensive) through 16-seeds (cheapest); budget forces tradeoffs
- Non-exclusive; same teams on multiple entries fine
- Points per win; round multiplier increases later

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
budget: configurable | pricing_method: SEED | ODDS | COMMISSIONER
```

---

### NCAA-5: Sweet 16 Second-Chance Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Fresh predictions for all 15 remaining games starting from the Sweet 16 through the championship — submitted after first-weekend upsets.

**Platforms:** SimplySportsware, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | start_round: SWEET_16
round_values: [1, 2, 4, 8] (configurable)
```

---

## 🏒 NCAA Hockey (Frozen Four)

16-team single-elimination bracket. Identical domain model to March Madness — same three squad selection types and both survivor styles apply.

---

### NCAAH-2: Tournament Survivor

**Tags:** `#single-event` `#survivor` `#knockout-scoring` `#live-pick` `#locked-pick`

Pick one team per round. Wrong pick = eliminated. Each team usable only once. The compact 4-round, 16-team format makes the use constraint very meaningful.

**Pick style variants:**
- **Live Pick:** One pick per round as play progresses
- **Locked Pick:** All 4 round picks submitted before the tournament

```
contest_type: SINGLE_EVENT | survivor_style: LIVE_PICK | LOCKED_PICK (configurable)
one_team_per_tournament: true | picks_per_round: 1–2 (configurable)
```

---

### NCAAH-T1: Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time pre-tournament snake draft of all 16 teams. The small field makes this ideal for small groups — every team can be owned.

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-tournament)
is_exclusive: true | scoring_type: CUMULATIVE (wins × round_value)
round_values: [1, 2, 4, 8] (configurable)
```

---

### NCAAH-T2: Tiered Team Pool

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Field grouped into tiers by seed. Pick one team per tier before the tournament. Non-exclusive.

**Variants:**
- Strict tiered: Tier 1 = 1–2 seeds, Tier 2 = 3–4, Tier 3 = 5–8, Tier 4 = 9–16
- Open selection (Pick 4): pick any 4 teams from the 16-team field

```
contest_type: SINGLE_EVENT | draft_type: TIERED | OPEN_SELECTION (configurable)
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
pick_count: configurable
```

---

### NCAAH-T3: Budget Team Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each team priced by seed or odds. Build a team portfolio within a budget before the tournament. Non-exclusive.

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK
is_exclusive: false | scoring_type: CUMULATIVE (wins × round_value)
budget: configurable | pricing_method: SEED | ODDS | COMMISSIONER
```

---

## 🏈 NCAA Football (College Football Playoff)

12-team bracket over 4 rounds (December–January). Seeds 1–4 have first-round byes. Bracket fixed at Selection Day — no re-seeding. Player-based squad formats are especially compelling given the multi-week cadence.

---

### NCAAF-T1: Snake Draft Player Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time pre-playoff snake draft of CFP players. Each player exclusively owned by one manager. Points from real game stats; players stop scoring when their team is eliminated. No waiver wire — draft only.

**How it works:**
- Snake draft before round 1; 8–12 managers draft 10–15 players from the full CFP player pool
- Exclusive: once drafted, a player is off the board
- Players score from real stats each round they play
- Players stop scoring when their team is eliminated — drafting players on teams likely to advance deep is as important as raw talent

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-playoffs)
is_exclusive: true | scoring_type: CUMULATIVE
scoring_stops_on_elimination: true | waiver_wire: false
```

---

### NCAAF-T2: Tiered Player Draft

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

CFP players grouped into 4–6 tiers by season stats and projected output. Pick one player per tier before round 1. Non-exclusive. Points from real game stats across the full CFP.

**How it works:**
- Tier 1: Elite QBs and top RBs/WRs; Tier 2: Strong starters; Tier 3: Solid contributors; Tier 4: Value/dark horses
- Pick 1 player per tier; lock before round 1 kickoff
- Non-exclusive: same player on multiple entries fine
- Players stop scoring when their team is eliminated
- Optional Captain: one pick earns 2× points across all rounds

**Platforms:** EasyOfficePools (tiered format adapted for CFP), custom leagues

```
contest_type: SINGLE_EVENT | draft_type: TIERED | scoring_type: CUMULATIVE
is_exclusive: false | tier_count: 4–6 (configurable)
captain_slot: optional | scoring_stops_on_elimination: true
```

---

### NCAAF-T3: Budget Player Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each CFP player assigned a cost based on season stats or projected fantasy output. Build a roster within a budget before round 1. Non-exclusive. Points from real game stats.

**How it works:**
- Top QBs most expensive; depth players cheap — budget forces tradeoffs
- Pick any combination of players within the total budget
- Non-exclusive: same players on multiple rosters fine
- Players stop scoring when their team is eliminated

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK | scoring_type: CUMULATIVE
is_exclusive: false | budget: configurable
pricing_method: SEASON_STATS | COMMISSIONER
scoring_stops_on_elimination: true
```

---

### NCAAF-5: Post-Season Hold'em (Multiplier Survivor)

**Tags:** `#single-event` `#survivor` `#live-pick` `#cumulative-scoring`

Pick one player per CFP round. Players who advance carry a growing multiplier (2×, 3×, 4×). Eliminated team = forced replacement at 1×. No salary cap, no draft.

**Note:** Inherently a `#live-pick` only format — the player pool changes as teams are eliminated, so all picks cannot be submitted upfront.

**How it works:**
- Each round: pick one player from any remaining CFP team
- If their team advances: player carries to next round at higher multiplier
- If their team is eliminated: pick a replacement from a surviving team — resets to 1×
- Highest cumulative total across all 4 rounds wins

**Platforms:** Inspired by NFFC Post-Season Hold'em; custom leagues

```
contest_type: SINGLE_EVENT | survivor_style: LIVE_PICK (only)
scoring_type: CUMULATIVE (with round multiplier)
multipliers: [1×, 2×, 3×, 4×] per round
replacement_on_elimination: true | replacement_multiplier: 1× (resets)
```

---

## 🏎️ Formula 1

### F1-5: Race Winner Pick'em

**Tags:** `#season-long` `#pick-em` `#cumulative-scoring` `#confidence-weighted`

One prediction per race weekend for the full season. No roster management. Season-long cumulative total wins.

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: CUMULATIVE
predictions_per_race: [P1, P2, P3, FASTEST_LAP, POLE] (configurable)
confidence_weighting: optional
```

---

## 🏁 NASCAR

### NASCAR-4: Race Survivor Pool

**Tags:** `#season-long` `#survivor` `#knockout-scoring` `#one-and-done` `#live-pick` `#locked-pick`

Each race: pick one driver to finish in the top N. Outside the threshold = eliminated. Each driver usable only once per season.

**Pick style variants:**
- **Live Pick (standard):** One driver pick submitted before each race
- **Locked Pick:** Full season-long pick sequence submitted before race 1

```
contest_type: SEASON_LONG | survivor_style: LIVE_PICK | LOCKED_PICK (configurable)
finish_threshold: TOP_N (configurable) | one_driver_per_season: true
```

---

### NASCAR-5: Head-to-Head Driver Matchup Pool

**Tags:** `#season-long` `#pick-em` `#cumulative-scoring`

4 featured H2H driver matchups per race. Pick which driver finishes higher. Season-long cumulative total wins.

**Platforms:** NASCAR Fantasy Live (official feature)

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: CUMULATIVE
matchups_per_race: 4 (configurable) | pts_per_correct_pick: 10 (configurable)
```

---

## ⛳ Horse Racing (Kentucky Derby, Triple Crown, Breeders' Cup)

### HR-T1: Tiered Pick Pool

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Field grouped into tiers by morning-line odds. Pick one horse per tier. Points by finish position. Non-exclusive; single submission before post time.

```
contest_type: SINGLE_EVENT | draft_type: TIERED | scoring_type: POSITION
is_exclusive: false | tier_assignment_method: ODDS | COMMISSIONER
```

---

### HR-T2: Budget Pick Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each horse assigned a cost by morning-line odds. Build a roster within a budget before post time. Points by finish position. Non-exclusive.

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK | scoring_type: POSITION
is_exclusive: false | budget: configurable | pricing_method: ODDS | COMMISSIONER
```

---

### HR-T3: Snake Draft Horse Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

Pre-race snake draft of the full field. Each horse exclusively owned by one manager. Points by finish position. Works well for marquee races with 15–20 horse fields.

**How it works:**
- Snake draft before the race; all horses distributed among managers
- Points by finish position (1st = most; configurable scale)
- Exclusive: each horse owned by one manager only

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-race)
is_exclusive: true | scoring_type: POSITION
```

---

### HR-3: Win / Place / Show Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Predict the top 3 finishers in exact order (trifecta-style) or any order. Office pool equivalent of the trifecta bet.

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM
exact_order_bonus: true | prediction_depth: 3–4 (configurable)
```

---

---

# 🌍 International Sports

---

## ⚽ Soccer / Football (World Cup, Euros, Champions League)

### SOC-4: Tournament Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Predict group stage results and knockout round winners through a major tournament. Single submission before the tournament begins; one of the most popular global office pool formats.

**How it works:**
- Group stage: predict W/D/L for every match; points per correct result
- Knockout stage: predict winner of each match; points increase each round
- Bonus: predict correct scoreline
- Tiebreaker: predict Final score or total goals in the tournament

**Platforms:** PoolTracker, OfficePoolStop, Yahoo, ESPN

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
group_stage_predictions: true | correct_score_bonus: configurable
tiebreaker: FINAL_SCORE | TOTAL_GOALS
```

---

### SOC-T1: Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

Pre-tournament snake draft of all 32 World Cup (or 24 Euros) teams. Each team's wins and goals earn points for their owner. Draft-and-done.

**How it works:**
- Snake draft before the tournament; all teams distributed among managers
- Group stage: points for wins, draws, and goals scored
- Knockout stage: points per match win; later rounds worth more
- Exclusive; teams distributed among managers

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (one-time pre-tournament)
is_exclusive: true | scoring_type: CUMULATIVE
group_stage_scoring: WINS + DRAWS + GOALS (configurable)
knockout_round_values: [1, 2, 4, 8] (configurable)
```

---

### SOC-T2: Tiered Team Pool

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Tournament field grouped into tiers by FIFA ranking or pot assignment. Pick one team per tier. Non-exclusive; earn points per win/draw/goal.

```
contest_type: SINGLE_EVENT | draft_type: TIERED
is_exclusive: false | scoring_type: CUMULATIVE
tier_assignment_method: FIFA_RANKING | POT | COMMISSIONER
```

---

### SOC-T3: Budget Team Pool

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each team priced by their championship odds or FIFA ranking. Build a team portfolio within a budget. Non-exclusive.

```
contest_type: SINGLE_EVENT | draft_type: BUDGET_PICK
is_exclusive: false | scoring_type: CUMULATIVE
budget: configurable | pricing_method: ODDS | FIFA_RANKING | COMMISSIONER
```

---

## 🎾 Tennis (Grand Slams)

Tennis is inherently player-based — there are no "teams" to pick. All squad pool formats (snake, tiered, budget) apply naturally: you pick players and score from their round-by-round advancement. The scoring unit is **rounds won** (or sets won for finer granularity) rather than goals or points, but the pool mechanic is identical.

### Squad Selection Formats (Player-Based)

---

### TEN-T1: Grand Slam Snake Draft Player Pool *(new)*

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time exclusive draft of Grand Slam players before Round 1. Each player owned by one manager. Points per round won. Every manager gets a mix of top seeds and longshots.

**How it works:**
- Snake draft before Round 1; players distributed across managers
- Exclusive: each player owned by exactly one manager
- Points per round won; multiplier increases in later rounds (e.g. R1=1, R2=2, R3=4, QF=8, SF=16, F=32, W=64)
- Golfers who withdraw before playing score 0; mid-tournament withdrawals score for completed rounds only
- Best for smaller leagues where the draft can distribute the full field

```
contest_type: SINGLE_EVENT | squad_selection: SNAKE_DRAFT | is_exclusive: true
scoring_type: CUMULATIVE (rounds_won × round_multiplier)
round_multipliers: [1, 2, 4, 8, 16, 32, 64] (configurable — 7 rounds in a Slam)
```

---

### TEN-T2: Grand Slam Tiered Player Pool *(new)*

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Players grouped into tiers by seeding (or world ranking). Pick one player per tier before Round 1. Non-exclusive; earn points per round won.

**How it works:**
- Tiers by seeding: Tier 1 (seeds 1–4), Tier 2 (seeds 5–8), Tier 3 (seeds 9–16), Tier 4 (seeds 17–32), Tier 5 (unseeded — optional)
- Pick 1 player per tier before Round 1 begins; no changes after
- Non-exclusive: same player valid across multiple entries
- Points per round won; optional upset bonus for unseeded players beating seeds

```
contest_type: SINGLE_EVENT | squad_selection: TIERED | is_exclusive: false
tier_assignment_method: SEED | WORLD_RANKING | COMMISSIONER
scoring_type: CUMULATIVE (rounds_won × round_multiplier)
upset_bonus: optional
```

---

### TEN-T3: Grand Slam Budget Player Pool *(new)*

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each player priced by their odds to win the tournament. Build a stable of players within a budget before Round 1. Non-exclusive; score from rounds won.

**How it works:**
- Top-ranked/favored players cost more; qualifiers and deep-draw longshots are cheap
- Pick any combination of players within a total budget (e.g. $100 credits)
- Non-exclusive: same roster valid across entries
- Points per round won × round multiplier; players who withdraw mid-tournament score for completed rounds

```
contest_type: SINGLE_EVENT | squad_selection: BUDGET_PICK | is_exclusive: false
budget: 100 (configurable) | pricing_method: ODDS | SEED | WORLD_RANKING
scoring_type: CUMULATIVE (rounds_won × round_multiplier)
roster_size: 3–6 (configurable)
```

---

### Knockout Formats

---

### TEN-3: Season-Long One-and-Done

**Tags:** `#season-long` `#one-and-done` `#pick-new-each-period` `#cumulative-scoring`

Pick one player per ATP/WTA tournament across the season. Each player limited to N uses. One pick per event; no roster management.

```
contest_type: SEASON_LONG | knockout_style: PICK_NEW_EACH_PERIOD
use_limit_per_player: 1–2 (configurable) | events: ALL | SLAMS_ONLY | MASTERS_ONLY
scoring_type: CUMULATIVE
```

---

### TEN-5: Grand Slam Late-Stage Survivor *(new)*

**Tags:** `#single-event` `#survivor` `#pick-new-each-period` `#knockout-scoring`

Pick one player per round of the Grand Slam. Wrong pick = eliminated. Each player usable only once. Scoped to the final rounds (Quarterfinals onward) to keep the field manageable — 8 players, 4 rounds.

**How it works:**
- Begins at the Quarterfinals (8 players remaining); 4 rounds total (QF, SF, F, Champion)
- Each round: pick one player you believe will win their match; wrong pick = eliminated
- Each player can only be used once across all rounds
- Last survivor wins; tiebreaker by most correct round picks remaining

**Why scoped to QF onward:** A full-draw 128-player survivor (7 rounds) creates too many use-limit decisions across too many weeks. Starting at the Quarterfinals gives a clean 4-round sprint with a recognizable field of 8 players — comparable to a playoffs survivor for NBA or NHL.

```
contest_type: SINGLE_EVENT | knockout_style: PICK_NEW_EACH_PERIOD
start_round: QUARTERFINALS | field_size: 8
one_player_per_tournament: true | elimination_frequency: PER_ROUND
```

---

---

# 🌐 Cross-Sport Player Stat Pools

The formats below introduce a new scoring mechanic that applies across multiple sports: **pick individual players before a tournament; score from their personal stats** (goals, assists, points, rebounds, etc.) as they play through the event. Players score 0 once their team is eliminated.

This is distinct from all previous squad pools, which score by team wins/advancement. These score by what the player personally does on the field/court/ice.

All three squad selection styles (snake draft, tiered, budget) apply to player stat pools exactly as they do to team pools. The only difference is the scoring engine reads player stats rather than team win/loss results.

---

## ⚽ Soccer Tournament Player Pool (World Cup, Euros, Champions League)

---

### SOC-P1: Snake Draft Player Pool *(new)*

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring` `#player-stats`

One-time exclusive draft of tournament players before Round 1. Score from each owned player's goals, assists, and clean sheets across all games they play. Players stop scoring when their national team is eliminated.

**How it works:**
- Snake draft of the full tournament squad list before kick-off of the first game
- Exclusive: each player owned by one manager
- Scoring: goal (6 pts), assist (3 pts), clean sheet GK/DEF (4 pts), clean sheet MID (1 pt), yellow card (−1 pt), red card (−3 pts) — commissioner configurable
- Players stop scoring after their national team is eliminated; group stage + knockouts both count
- Tiebreaker: total goals scored by owned players

```
contest_type: SINGLE_EVENT | squad_selection: SNAKE_DRAFT | is_exclusive: true
scoring_type: PLAYER_STATS
stat_weights: { goal: 6, assist: 3, clean_sheet_gk: 4, clean_sheet_def: 4,
                yellow_card: -1, red_card: -3 } (configurable)
scoring_stops_on_elimination: true
```

---

### SOC-P2: Tiered Player Pool *(new)*

**Tags:** `#single-event` `#tiered` `#cumulative-scoring` `#player-stats`

Tournament players grouped into tiers by international reputation, goals scored in qualifying, or commissioner assignment. Pick one player per tier. Non-exclusive; score from personal stats.

**How it works:**
- Tiers: e.g. Tier 1 (elite strikers and playmakers — Mbappé, Bellingham, Vinicius level), Tier 2 (strong starters from contending nations), Tier 3 (key players from mid-tier nations), Tier 4 (value picks / dark horses)
- Pick 1 player per tier before the first game
- Non-exclusive: same player valid across entries
- Score from goals, assists, and defensive contributions across all matches played

```
contest_type: SINGLE_EVENT | squad_selection: TIERED | is_exclusive: false
tier_assignment_method: REPUTATION | QUALIFYING_GOALS | COMMISSIONER
scoring_type: PLAYER_STATS
scoring_stops_on_elimination: true
```

---

### SOC-P3: Budget Player Pool *(new)*

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring` `#player-stats`

Each player priced by their prominence and expected goal contribution. Build a player portfolio within a budget. Non-exclusive; score from personal stats across all games played.

**How it works:**
- Players priced by goal contribution in qualifying, world ranking of their nation, or commissioner-set values
- Pick any combination within a budget (e.g. $100 credits); roster size configurable (e.g. pick 6–11 players)
- Non-exclusive: same roster valid across entries
- Score from goals, assists, and defensive stats; players stop scoring when their team is eliminated
- Tiebreaker: total goals by portfolio players

```
contest_type: SINGLE_EVENT | squad_selection: BUDGET_PICK | is_exclusive: false
budget: 100 (configurable) | pricing_method: GOAL_CONTRIBUTION | COMMISSIONER
scoring_type: PLAYER_STATS | roster_size: 6–11 (configurable)
scoring_stops_on_elimination: true
```

---

### SOC-4: Tournament Pick'em

**Tags:** `#single-event` `#pick-em` `#pick-all-upfront` `#cumulative-scoring`

Predict group stage results and knockout round progression. Single submission before the tournament. Points per correct W/D/L result; more points in later rounds.

**Platforms:** PoolTracker, OfficePoolStop, Yahoo, ESPN

```
contest_type: SINGLE_EVENT | knockout_style: PICK_ALL_UPFRONT
group_stage_predictions: true | correct_score_bonus: configurable
scoring_type: CUMULATIVE | tiebreaker: FINAL_SCORE | TOTAL_GOALS
```

---

### SOC-T1: Snake Draft Team Pool
### SOC-T2: Tiered Team Pool
### SOC-T3: Budget Team Pool
*(see Soccer section above — team-based squad pools score from team wins/advancement)*

---

### SOC-5: Tournament Knockout-Stage Survivor *(new)*

**Tags:** `#single-event` `#survivor` `#pick-new-each-period` `#knockout-scoring`

Pick one team per knockout round (Round of 16 onward). Wrong pick = eliminated. Each team usable only once. Scoped to the knockout stage only — group stage W/D/L doesn't suit a survivor mechanic.

**How it works:**
- Begins at Round of 16 (16 teams remaining); 4 rounds to the Final
- Each round: pick one team to win their match; wrong pick = eliminated
- Each team can only be used once across the knockout stage
- Last survivor wins; tiebreaker by most correct picks remaining

**Why knockout-stage only:** Group stage results are W/D/L — a draw doesn't eliminate a team, making traditional survivor mechanics ambiguous. Starting at the Round of 16 gives a clean single-elimination format.

```
contest_type: SINGLE_EVENT | knockout_style: PICK_NEW_EACH_PERIOD
start_stage: ROUND_OF_16 | one_team_per_tournament: true
elimination_frequency: PER_ROUND
```

---

## 🏀 NBA Playoffs Player Stat Pool

---

### NBA-P1: Snake Draft Player Pool *(new)*

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring` `#player-stats`

One-time exclusive draft of playoff players before Round 1. Score from points, rebounds, and assists across all playoff games played. Players stop scoring when their team is eliminated.

**How it works:**
- Snake draft before Round 1 tip-off; all active playoff players available
- Exclusive: each player owned by one manager
- Scoring: point (1 pt), rebound (1.25 pts), assist (1.5 pts), steal/block (2 pts), turnover (−0.5 pts) — commissioner configurable
- Players stop scoring after their team is eliminated from the playoffs
- Managers with players on deep-run teams have a significant advantage

```
contest_type: SINGLE_EVENT | squad_selection: SNAKE_DRAFT | is_exclusive: true
scoring_type: PLAYER_STATS
stat_weights: { point: 1, rebound: 1.25, assist: 1.5, steal: 2, block: 2, turnover: -0.5 } (configurable)
scoring_stops_on_elimination: true
```

---

### NBA-P2: Tiered Player Pool *(new)*

**Tags:** `#single-event` `#tiered` `#cumulative-scoring` `#player-stats`

Playoff players grouped into tiers by regular season scoring average or All-Star status. Pick one player per tier before Round 1. Non-exclusive.

**How it works:**
- Tiers: e.g. Tier 1 (All-NBA first team / MVP candidates), Tier 2 (All-Stars and near-All-Stars), Tier 3 (strong starters), Tier 4 (key role players / deep sleepers)
- Pick 1 player per tier; lock before Round 1
- Non-exclusive: same player valid across entries
- Points from personal stats across all games played; stops on team elimination

```
contest_type: SINGLE_EVENT | squad_selection: TIERED | is_exclusive: false
tier_assignment_method: SCORING_AVERAGE | ALL_STAR | COMMISSIONER
scoring_type: PLAYER_STATS | scoring_stops_on_elimination: true
```

---

### NBA-P3: Budget Player Pool *(new)*

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring` `#player-stats`

Each playoff player priced by their regular season scoring average or championship odds. Build a player portfolio within a budget. Non-exclusive.

```
contest_type: SINGLE_EVENT | squad_selection: BUDGET_PICK | is_exclusive: false
budget: 100 (configurable) | pricing_method: SCORING_AVERAGE | ODDS | COMMISSIONER
scoring_type: PLAYER_STATS | scoring_stops_on_elimination: true
roster_size: 5–8 (configurable)
```

---

## 🏒 NHL Playoffs Player Stat Pool

---

### NHL-P1: Snake Draft Player Pool *(new)*

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring` `#player-stats`

One-time exclusive draft of playoff players before Round 1. Score from goals and assists across all playoff games. One of the most popular informal pool formats in hockey-passionate markets (Canada especially).

**How it works:**
- Snake draft before Round 1; all playoff roster players available
- Exclusive: each player owned by one manager
- Scoring: goal (6 pts), assist (3 pts), power play goal (+1 bonus), game-winning goal (+2 bonus), goalie win (5 pts), goalie shutout (+3 bonus) — commissioner configurable
- Players stop scoring when their team is eliminated

```
contest_type: SINGLE_EVENT | squad_selection: SNAKE_DRAFT | is_exclusive: true
scoring_type: PLAYER_STATS
stat_weights: { goal: 6, assist: 3, pp_goal_bonus: 1, gwg_bonus: 2,
                goalie_win: 5, shutout_bonus: 3 } (configurable)
scoring_stops_on_elimination: true
```

---

### NHL-P2: Tiered Player Pool *(new)*

**Tags:** `#single-event` `#tiered` `#cumulative-scoring` `#player-stats`

Playoff players grouped into tiers by point-per-game average or All-Star status. Pick one player per tier. Non-exclusive.

```
contest_type: SINGLE_EVENT | squad_selection: TIERED | is_exclusive: false
tier_assignment_method: PPG | ALL_STAR | COMMISSIONER
scoring_type: PLAYER_STATS | scoring_stops_on_elimination: true
```

---

### NHL-P3: Budget Player Pool *(new)*

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring` `#player-stats`

Each player priced by regular season point total or championship odds. Build a player portfolio within a budget. Non-exclusive.

```
contest_type: SINGLE_EVENT | squad_selection: BUDGET_PICK | is_exclusive: false
budget: 100 (configurable) | pricing_method: SEASON_POINTS | ODDS | COMMISSIONER
scoring_type: PLAYER_STATS | scoring_stops_on_elimination: true
roster_size: 5–8 (configurable)
```

---

## 🏀 NCAA Basketball Tournament Player Stat Pool

---

### NCAA-P1: Snake Draft Player Pool *(new)*

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring` `#player-stats`

One-time exclusive draft of tournament players before Round 1. Score from points (and optionally rebounds/assists) across all games played. Players stop scoring when their team is eliminated — meaning a star from a No. 16 seed that gets upset in Round 1 scores for exactly one game.

**How it works:**
- Snake draft before Round 1; all 68-team tournament rosters available as the player pool
- Exclusive: each player owned by one manager
- Scoring: point scored (1 pt); optional: rebound (+0.5), assist (+0.75) — commissioner configurable
- Players stop scoring when their team is eliminated
- Strategic depth: a deep run by a mid-seed team can make a lesser-known player a pool winner

```
contest_type: SINGLE_EVENT | squad_selection: SNAKE_DRAFT | is_exclusive: true
scoring_type: PLAYER_STATS
stat_weights: { point: 1, rebound: 0.5, assist: 0.75 } (configurable)
scoring_stops_on_elimination: true
```

---

### NCAA-P2: Tiered Player Pool *(new)*

**Tags:** `#single-event` `#tiered` `#cumulative-scoring` `#player-stats`

Tournament players grouped into tiers by season scoring average or national profile. Pick one player per tier. Non-exclusive. A less committal format than a live snake draft — great for large office pools.

**How it works:**
- Tiers: e.g. Tier 1 (All-American / projected lottery picks), Tier 2 (conference Player of the Year caliber), Tier 3 (strong starters from top-16 seeds), Tier 4 (sleeper scorers from mid-majors), Tier 5 (deep value picks)
- Pick 1 player per tier before Round 1 tip-off; no changes after
- Non-exclusive; players stop scoring when their team is eliminated

```
contest_type: SINGLE_EVENT | squad_selection: TIERED | is_exclusive: false
tier_assignment_method: SCORING_AVERAGE | ALL_AMERICAN | COMMISSIONER
scoring_type: PLAYER_STATS | scoring_stops_on_elimination: true
```

---

### NCAA-P3: Budget Player Pool *(new)*

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring` `#player-stats`

Each player priced by their season scoring average and their team's odds of advancing. Build a player portfolio within a budget before Round 1. Non-exclusive.

```
contest_type: SINGLE_EVENT | squad_selection: BUDGET_PICK | is_exclusive: false
budget: 100 (configurable) | pricing_method: SCORING_AVERAGE | SEED_ADJUSTED | COMMISSIONER
scoring_type: PLAYER_STATS | scoring_stops_on_elimination: true
roster_size: 5–8 (configurable)
```

---

## 🥊 UFC / MMA (Single Event)

UFC and boxing are naturally suited to office pools: bounded single events with a clear field of known participants, results that happen in minutes, and strong casual fan interest during major cards. The existing squad selection mechanics apply cleanly.

---

### UFC-T1: Fight Card Snake Draft *(new)*

**Tags:** `#single-event` `#snake-draft` `#exclusive` `#cumulative-scoring`

One-time exclusive draft of fighters on a single UFC or boxing card. Each fighter owned by one manager. Score based on their fight result — win by KO earns more than a decision win.

**How it works:**
- Snake draft of all fighters on the card before the first fight begins (main card + prelims optional)
- Exclusive: each fighter owned by one manager
- Scoring: KO/TKO win (10 pts), submission win (9 pts), decision win (7 pts), split decision win (6 pts), loss (0 pts), draw (3 pts)
- Bonus: finish in Round 1 (+2 pts), first-round KO (+3 pts) — commissioner configurable
- Tiebreaker: total bonus points accumulated

**Best for:** Groups of 4–10 where the card's fighter count can be reasonably distributed.

```
contest_type: SINGLE_EVENT | squad_selection: SNAKE_DRAFT | is_exclusive: true
scoring_type: FIGHT_RESULT
result_weights: { ko_tko: 10, submission: 9, decision: 7, split_decision: 6,
                  draw: 3, loss: 0 } (configurable)
bonus_weights: { round1_finish: 2, round1_ko: 3 } (configurable)
```

---

### UFC-T2: Tiered Fighter Pick Pool *(new)*

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Fighters on the card grouped by bout significance (main event, co-main, featured prelims). Pick one fighter per tier. Non-exclusive; score from fight result.

**How it works:**
- Tiers by bout position: Tier 1 (main event fighters), Tier 2 (co-main fighters), Tier 3 (featured prelim fighters), Tier 4 (remaining card — optional)
- Pick 1 fighter per tier before the card begins
- Non-exclusive: same fighter valid across entries
- Scoring: same result weights as UFC-T1

```
contest_type: SINGLE_EVENT | squad_selection: TIERED | is_exclusive: false
tier_assignment_method: BOUT_POSITION | RANKING | COMMISSIONER
scoring_type: FIGHT_RESULT
```

---

### UFC-T3: Budget Fighter Pick Pool *(new)*

**Tags:** `#single-event` `#budget-pick` `#cumulative-scoring`

Each fighter priced by their odds to win. Build a fighter portfolio within a budget before the card. Non-exclusive; score from fight results.

**How it works:**
- Favorites priced highest; underdogs cheapest
- Pick any combination within a budget (e.g. $100 credits)
- Non-exclusive: same picks valid across entries
- Scoring: same result weights as UFC-T1; underdogs winning generates big returns relative to cost

```
contest_type: SINGLE_EVENT | squad_selection: BUDGET_PICK | is_exclusive: false
budget: 100 (configurable) | pricing_method: ODDS | RANKING | COMMISSIONER
scoring_type: FIGHT_RESULT
```

---

### UFC-5: Card Survivor *(new)*

**Tags:** `#single-event` `#survivor` `#pick-all-upfront` `#knockout-scoring`

Submit a survival card before the event — pick one fighter to win each bout on the main card. If any pick loses, you're out. All picks committed before the first fight.

**How it works:**
- Before the card: pick one fighter per main card bout (5 bouts typical)
- All picks submitted and locked before the opening bell
- If any pick's fighter loses their bout, participant is eliminated
- Last remaining participant (all picks correct) wins; tiebreaker by most finish bonuses accumulated

```
contest_type: SINGLE_EVENT | knockout_style: PICK_ALL_UPFRONT
bouts_covered: MAIN_CARD | ALL_CARD (configurable)
elimination_trigger: FIRST_WRONG_PICK
```

---

---

# Contest Format Matrix

This matrix shows which selection mechanics apply per sport/tournament. Use this as a build checklist for v1.

## Team-Based Squad Pools

| Tournament / Sport | 🐍 Snake Draft | 🎯 Tiered | 💰 Budget | Pick'em / Bracket | Survivor (Live) | Survivor (Locked) |
|---|---|---|---|---|---|---|
| **NFL Season** | — | — | — | — | NFL-2 ✅ | NFL-2 ✅ |
| **NBA Playoffs** | NBA-T1 ✅ | NBA-T2 ✅ | NBA-T3 ✅ | NBA-3 ✅ | NBA-5 ✅ | NBA-5 ✅ |
| **NHL Playoffs** | NHL-T1 ✅ | NHL-T2 ✅ | NHL-T3 ✅ | NHL-3 ✅ | NHL-5 ✅ | NHL-5 ✅ |
| **MLB Home Run Derby** | — | — | — | MLB-3 ✅ | — | — |
| **NCAA Basketball** | NCAA-T1 ✅ | NCAA-T2 ✅ | NCAA-T3 ✅ | NCAA-5 ✅ | NCAA-2 ✅ | NCAA-2 ✅ |
| **NCAA Hockey** | NCAAH-T1 ✅ | NCAAH-T2 ✅ | NCAAH-T3 ✅ | — | NCAAH-2 ✅ | NCAAH-2 ✅ |
| **Soccer Tournament** | SOC-T1 ✅ | SOC-T2 ✅ | SOC-T3 ✅ | SOC-4 ✅ | SOC-5 ✅ | — |

## Player-Based Squad Pools (Stat Accumulation)

| Tournament / Sport | 🐍 Snake Draft | 🎯 Tiered | 💰 Budget | Key Scoring Stats |
|---|---|---|---|---|
| **Golf Major** | GOLF-T3 ✅ | GOLF-T1 ✅ | GOLF-T2 ✅ | Stroke total (lower wins) |
| **NCAA Football (CFP)** | NCAAF-S2 ✅ | NCAAF-T1 ✅ | NCAAF-B3 ✅ | Passing/rushing/receiving yards + TDs |
| **NBA Playoffs** | NBA-P1 ✅ | NBA-P2 ✅ | NBA-P3 ✅ | Points, rebounds, assists |
| **NHL Playoffs** | NHL-P1 ✅ | NHL-P2 ✅ | NHL-P3 ✅ | Goals, assists |
| **NCAA Basketball** | NCAA-P1 ✅ | NCAA-P2 ✅ | NCAA-P3 ✅ | Points scored |
| **Soccer Tournament** | SOC-P1 ✅ | SOC-P2 ✅ | SOC-P3 ✅ | Goals, assists, clean sheets |
| **Tennis Grand Slam** | TEN-T1 ✅ | TEN-T2 ✅ | TEN-T3 ✅ | Rounds won (player = the team) |
| **UFC / MMA Card** | UFC-T1 ✅ | UFC-T2 ✅ | UFC-T3 ✅ | Win method (KO/sub/decision) |

## Knockout / Survivor Pools

| Sport / Event | Pick New Each Period | Pick All Upfront |
|---|---|---|
| **NFL Season** | NFL-2 ✅ | NFL-2 ✅ |
| **NBA Playoffs** | NBA-5 ✅ | NBA-5 ✅ |
| **NHL Playoffs** | NHL-5 ✅ | NHL-5 ✅ |
| **NCAA Basketball** | NCAA-2 ✅ | NCAA-2 ✅ |
| **NCAA Hockey** | NCAAH-2 ✅ | NCAAH-2 ✅ |
| **NCAA Football (CFP)** | NCAAF-5 (multiplier) ✅ | — |
| **NASCAR Season** | NASCAR-4 ✅ | — |
| **F1 Season** | F1-5 ✅ | — |
| **Soccer Tournament** | SOC-5 (knockout stage) ✅ | SOC-4 ✅ |
| **Tennis Grand Slam** | TEN-5 (QF onward) ✅ | — |
| **Tennis Season** | TEN-3 ✅ | — |
| **Horse Racing** | — | HR-3 ✅ |
| **UFC Card** | — | UFC-5 ✅ |

---

# Cross-Sport Tag Index

### `#single-event`
NBA-3, NBA-T1–T3, NBA-P1–P3, NBA-5, MLB-3, NHL-3, NHL-T1–T3, NHL-P1–P3, NHL-5, GOLF-T1–T3, HR-T1–T3, HR-3, NCAA-2, NCAA-T1–T3, NCAA-P1–P3, NCAA-5, NCAAH-2, NCAAH-T1–T3, NCAAF-T1–T3, NCAAF-5, SOC-4, SOC-T1–T3, SOC-P1–P3, SOC-5, TEN-T1–T3, TEN-5, UFC-T1–T3, UFC-5

### `#season-long`
NFL-2, F1-5, NASCAR-4, NASCAR-5, TEN-3

### `#snake-draft` + `#exclusive`
GOLF-T3, HR-T3, NBA-T1, NBA-P1, NHL-T1, NHL-P1, NCAA-T1, NCAA-P1, NCAAH-T1, NCAAF-S2, SOC-T1, SOC-P1, TEN-T1, UFC-T1

### `#tiered`
GOLF-T1, GOLF-T2 (best-ball variant), HR-T1, NBA-T2, NBA-P2, NHL-T2, NHL-P2, NCAA-T2, NCAA-P2, NCAAH-T2, NCAAF-T1 (tiered players), SOC-T2, SOC-P2, TEN-T2, UFC-T2

### `#budget-pick`
GOLF-T2, HR-T2, NBA-T3, NBA-P3, NHL-T3, NHL-P3, NCAA-T3, NCAA-P3, NCAAH-T3, NCAAF-B3, SOC-T3, SOC-P3, TEN-T3, UFC-T3

### `#player-stats`
NBA-P1–P3, NHL-P1–P3, NCAA-P1–P3, SOC-P1–P3, NCAAF-S2, NCAAF-T1, NCAAF-B3, TEN-T1–T3 (rounds won), UFC-T1–T3 (fight result)

### `#survivor`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, NCAAF-5, SOC-5, TEN-5, UFC-5

### `#pick-new-each-period`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, NCAAF-5, SOC-5, TEN-5, TEN-3

### `#pick-all-upfront`
NBA-5, NHL-5, NCAA-2, NCAAH-2, MLB-3, NHL-3, NBA-3, HR-3, NCAA-5, SOC-4, UFC-5

### `#one-and-done`
NFL-2, NASCAR-4, TEN-3

### `#knockout-scoring`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, SOC-5, TEN-5, UFC-5

### `#confidence-weighted`
F1-5 (optional)

### `#best-ball`
GOLF-T1, GOLF-T2 (use best N of submitted picks)

### `#low-score-wins`
GOLF-T1, GOLF-T2, GOLF-T3 (stroke play)

---

## Domain Model Notes

### Two Pool Scoring Engines

All v1 squad contests resolve through one of two scoring engines:

**1. Advancement Scoring** — score accumulates when selected teams/players advance (win series, win rounds). Used by: all team pools (NBA, NHL, NCAA, Soccer, Horse Racing), Tennis (rounds won = advancement).

**2. Stat Accumulation** — score accumulates from personal performance stats regardless of advancement. Used by: CFP player pools, NBA/NHL/NCAA/Soccer player stat pools, UFC.

The key shared mechanic: `scoring_stops_on_elimination: true` — players/teams score 0 once their side is eliminated. This applies to both engines.

```typescript
interface SquadSelectionContest {
  selection_type: 'SNAKE_DRAFT' | 'TIERED' | 'BUDGET_PICK' | 'OPEN_SELECTION';
  scoring_engine: 'ADVANCEMENT' | 'STAT_ACCUMULATION';
  is_exclusive: boolean;
  scoring_stops_on_elimination: boolean;

  // Snake draft config
  roster_size_per_manager?: number;

  // Tiered config
  tiers?: Tier[];
  best_ball_n?: number;             // golf: use best N of your tier picks

  // Budget config
  budget?: number;
  pricing_method?: 'ODDS' | 'SEED' | 'RANKING' | 'STATS' | 'COMMISSIONER';
  roster_size?: number;             // budget: min/max picks allowed

  // Stat accumulation config
  stat_weights?: Record<string, number>;  // e.g. { goal: 6, assist: 3 }
}
```

### Survivor Contest Model

```typescript
interface SurvivorContest {
  survivor_style: 'PICK_NEW_EACH_PERIOD' | 'PICK_ALL_UPFRONT' | 'MULTIPLIER';
  picks_per_period: number;
  one_entity_per_season: boolean;
  strikes_before_elimination: number;
  buybacks_allowed: boolean;

  // Multiplier survivor (NCAAF-5 only)
  multipliers?: number[];            // [1, 2, 3, 4] per round
  replacement_on_elimination?: boolean;
}
```

### CFP Structural Note

Seeds 1–4 skip round 1; bracket is fixed with no re-seeding. Player scoring engine needs:

```typescript
interface CFPStructure {
  bye_seeds: number[];
  first_round_matchups: [number, number][];
  no_reseeding: boolean;
}
```

---

*Generated by Claude — PoolMaster Contest Structures v4 (In-Scope for v1)*
*Scope: Office pools, knockout/survivor pools, tiered/budget/snake squad pools for single events and tournaments — applied consistently across all sports. Two scoring engines: advancement (team wins) and stat accumulation (personal stats).*
*Sources: ESPN, Yahoo, Splash Sports, PoolGenius, EasyOfficePools, BuzzFantasyGolf, OfficePoolStop, RunYourPool, SimplySportsware, PoolTracker, ActionNetwork, NASCAR Fantasy Live, NFFC Post-Season Hold'em, FantasyPostseason.com*

This matrix shows which selection mechanics apply per sport/tournament. Use this as a build checklist for v1.

| Tournament / Sport | Pick'em / Bracket | 🐍 Snake Draft | 🎯 Tiered | 💰 Budget | Survivor (Live) | Survivor (Locked) |
|---|---|---|---|---|---|---|
| **NFL Season** | — | — | — | — | NFL-2 ✅ | NFL-2 ✅ |
| **NBA Playoffs** | NBA-3 ✅ | NBA-T1 ✅ | NBA-T2 ✅ | NBA-T3 ✅ | NBA-5 ✅ | NBA-5 ✅ |
| **NHL Playoffs** | NHL-3 ✅ | NHL-T1 ✅ | NHL-T2 ✅ | NHL-T3 ✅ | NHL-5 ✅ | NHL-5 ✅ |
| **MLB Home Run Derby** | MLB-3 ✅ | — | — | — | — | — |
| **Golf Majors** | — | GOLF-T3 ✅ | GOLF-T1 ✅ | GOLF-T2 ✅ | — | — |
| **NCAA Basketball** | NCAA-5 ✅ | NCAA-T1 ✅ | NCAA-T2 ✅ | NCAA-T3 ✅ | NCAA-2 ✅ | NCAA-2 ✅ |
| **NCAA Hockey** | — | NCAAH-T1 ✅ | NCAAH-T2 ✅ | NCAAH-T3 ✅ | NCAAH-2 ✅ | NCAAH-2 ✅ |
| **NCAA Football (CFP)** | — | NCAAF-T1 ✅ | NCAAF-T2 ✅ | NCAAF-T3 ✅ | NCAAF-5 ✅ | — ⚠️ |
| **Horse Racing** | HR-3 ✅ | HR-T3 ✅ | HR-T1 ✅ | HR-T2 ✅ | — | — |
| **NASCAR Season** | NASCAR-5 ✅ | — | — | — | NASCAR-4 ✅ | NASCAR-4 ✅ |
| **F1 Season** | F1-5 ✅ | — | — | — | — | — |
| **Soccer Tournament** | SOC-4 ✅ | SOC-T1 ✅ | SOC-T2 ✅ | SOC-T3 ✅ | — ⚠️ | — ⚠️ |
| **Tennis Season** | TEN-3 ✅ | — | — | — | — | — |

**Notes:**
- ⚠️ **NCAAF-5 (Hold'em)** is live-pick only — locked pick not applicable because the player pool changes each round as teams are eliminated.
- ⚠️ **Soccer Tournament Survivor** — not included because the group stage's W/D/L format doesn't map cleanly to a single-elimination survivor mechanic. Could be added for knockout rounds only in a future iteration.
- **NFL, NASCAR, F1, Tennis** are season-long pick formats — squad selection (snake/tiered/budget) doesn't apply to season-long formats, only to bounded tournaments.
- **MLB HRD** is a single-night event; squad formats don't apply.

---

# Cross-Sport Tag Index

### `#single-event`
NBA-3, NBA-T1–T3, NBA-5, MLB-3, NHL-3, NHL-T1–T3, NHL-5, GOLF-T1–T3, HR-T1–T3, HR-3, NCAA-2, NCAA-T1–T3, NCAA-5, NCAAH-2, NCAAH-T1–T3, NCAAF-T1–T3, NCAAF-5, SOC-4, SOC-T1–T3

### `#season-long`
NFL-2, F1-5, NASCAR-4, NASCAR-5, TEN-3

### `#snake-draft` + `#exclusive`
GOLF-T3, HR-T3, NCAA-T1, NCAAH-T1, NCAAF-T1, NBA-T1, NHL-T1, SOC-T1

### `#tiered`
GOLF-T1, GOLF-T2 (best-ball variant), HR-T1, NCAA-T2, NCAAH-T2, NCAAF-T2, NBA-T2, NHL-T2, SOC-T2

### `#budget-pick`
GOLF-T2, HR-T2, NCAA-T3, NCAAH-T3, NCAAF-T3, NBA-T3, NHL-T3, SOC-T3

### `#survivor`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, NCAAF-5

### `#live-pick`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, NCAAF-5 (only)

### `#locked-pick`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2

### `#pick-em`
MLB-3, NHL-3, NBA-3, NASCAR-5, HR-3, NCAA-5, SOC-4, TEN-3, F1-5

### `#one-and-done`
NFL-2, NASCAR-4, TEN-3

### `#knockout-scoring`
NFL-2, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2

### `#confidence-weighted`
F1-5 (optional)

### `#best-ball`
GOLF-T1, GOLF-T2 (use best N of submitted picks)

### `#low-score-wins`
GOLF-T1, GOLF-T2, GOLF-T3 (stroke play)

---

## Domain Model Notes

### Three Generic Selection Mechanics

Snake draft, tiered, and budget-pick are sport-agnostic. A single `SquadSelectionContest` model powers all three:

```typescript
interface SquadSelectionContest {
  selection_type: 'SNAKE_DRAFT' | 'TIERED' | 'BUDGET_PICK';
  is_exclusive: boolean;                    // snake = true; tiered/budget = false
  scoring_stops_on_elimination: boolean;    // true for player pools (CFP)

  // Snake draft
  roster_size_per_manager: number;

  // Tiered pick
  tiers: Tier[];                            // label, entity list, pick_count per tier
  best_ball_n?: number;                     // use best N scores (golf)

  // Budget pick
  budget: number;
  pricing_method: 'ODDS' | 'SEED' | 'RANKING' | 'COMMISSIONER';
}
```

### Two Generic Survivor Styles

```typescript
interface SurvivorContest {
  survivor_style: 'LIVE_PICK' | 'LOCKED_PICK';
  picks_per_period: number;                 // 1 standard; 2 = double pick
  one_entity_per_season: boolean;           // true = can't reuse a team/player
  strikes_before_elimination: number;       // 0 = instant elimination
  buybacks_allowed: boolean;
}
```

`LOCKED_PICK` — all picks for the full season/tournament submitted before period 1 and stored. Participant is eliminated automatically when any pick in the sequence loses.

### CFP Structural Note

Seeds 1–4 skip round 1; bracket is fixed with no re-seeding. Player scoring engine needs:

```typescript
interface CFPStructure {
  bye_seeds: number[];                       // [1, 2, 3, 4]
  first_round_matchups: [number, number][];  // [[5,12],[6,11],[7,10],[8,9]]
  no_reseeding: boolean;                     // true
}
```

---

*Generated by Claude — PoolMaster Contest Structures v4 (In-Scope for v1)*
*Scope: Office pools, knockout/survivor pools, tiered/budget/snake squad pools for single events and tournaments. Three squad selection types and two survivor styles applied consistently across all sports.*
*Sources: ESPN, Yahoo, Splash Sports, PoolGenius, EasyOfficePools, BuzzFantasyGolf, OfficePoolStop, RunYourPool, SimplySportsware, PoolTracker, ActionNetwork, NASCAR Fantasy Live, NFFC Post-Season Hold'em, FantasyPostseason.com*
