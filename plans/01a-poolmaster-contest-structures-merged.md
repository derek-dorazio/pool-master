# PoolMaster — Contest Structures by Sport (Full Edition)

## How to Read This Document

Each contest structure includes a **tag block** identifying properties shared across sports. The cross-sport tag index at the end groups structures by shared mechanics — useful for identifying which domain model constructs need to support multiple sports without duplication.

### Tag Legend

| Tag | Meaning |
|---|---|
| `#single-event` | Contest covers one game, race, match, or tournament |
| `#multi-event` | Contest spans a defined set of events, not a full season |
| `#season-long` | Contest spans a full competition season |
| `#salary-cap` | Roster built within a virtual budget; non-exclusive by default |
| `#snake-draft` | Exclusive turn-based draft; once taken, unavailable to others |
| `#auction-draft` | Exclusive live-bidding draft |
| `#tiered` | Participants pick N players from each defined tier |
| `#pick-em` | Participants predict winners or outcomes; no roster to manage |
| `#survivor` | Participants are eliminated on incorrect or low-scoring picks |
| `#best-ball` | System auto-selects each week's best performers from a roster |
| `#one-and-done` | Each player/team can be selected at most once per season |
| `#cumulative-scoring` | Points accumulate across events or rounds |
| `#knockout-scoring` | Incorrect or low picks eliminate participants |
| `#head-to-head` | Direct weekly matchup between two teams |
| `#bracket` | Predict outcomes through a knockout tournament structure |
| `#weekly-lineup` | Participants set a new lineup each event or round |
| `#waiver-wire` | In-season player acquisition after initial draft |
| `#captain-slot` | One roster slot earns a scoring multiplier |
| `#confidence-weighted` | Participants assign priority weights to their picks |
| `#use-limit` | Each player can only be selected N times per season |
| `#transfers` | Roster changes mid-season governed by rules or penalties |
| `#low-score-wins` | Lowest combined score wins (e.g. stroke-play golf) |
| `#dynasty` | Multi-season format; players carry over year to year |
| `#keeper` | Season-to-season with limited player retention |
| `#double-elimination` | Tournament format where one loss does not eliminate a team |

---

# 🇺🇸 US Sports

---

## 🏈 NFL (American Football)

---

### NFL-1: Season-Long Redraft

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

The most played fantasy format in the world. A one-time pre-season snake draft populates rosters. Managers compete head-to-head each week; the best regular-season record advances to a playoff bracket.

**How it works:**
- Pre-season snake draft; teams of 15–20 players
- Weekly starting lineup across QB, RB, WR, TE, Flex, K, D/ST positions
- Real NFL stats convert to fantasy points (passing yards, TDs, receptions, turnovers, etc.)
- W/L record determines playoff seeding; 3-week playoff bracket crowns champion
- Waivers and trades active all season

**Scoring variants:** Standard (non-PPR), PPR, Half-PPR, Superflex (2 QBs start), IDP (individual defensive players)

**Platforms:** ESPN, Yahoo, Sleeper, NFL.com

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
waiver_wire: true | roster_positions: configurable | playoff_bracket: true
```

---

### NFL-2: Survivor Pool (Eliminator / Last Man Standing)

**Tags:** `#season-long` `#pick-em` `#survivor` `#knockout-scoring` `#one-and-done`

One pick per week; pick wrong and you're out. Each team can only be used once. The last player standing wins. Millions of entries annually — the most popular non-DFS football contest.

**How it works:**
- Pick one NFL team to win straight-up each week (no spread)
- Wrong pick = eliminated; each team usable only once per season
- Last survivor wins; multi-survivor tiebreaker by highest cumulative score

**Variants:** Double Pick (2 wins required); Triple Pick; Strikes (N wrong picks before elimination); Buyback re-entry

**Platforms:** Yahoo, Splash Sports, PoolGenius, ESPN, OfficePoolStop

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: KNOCKOUT
picks_per_week: 1–3 (configurable) | one_team_per_season: true
strikes_before_elimination: 0–3 (configurable) | buybacks: configurable
```

---

### NFL-3: Confidence Pick'em

**Tags:** `#season-long` `#pick-em` `#confidence-weighted` `#cumulative-scoring`

Pick every NFL game winner each week and assign a confidence rank (1–16). More confident picks earn more points if correct. Weekly and season-long prizes both common.

**How it works:**
- Each week: pick winner of every game plus assign confidence rank 1–N_games
- Correct pick scores the confidence value; wrong pick scores 0
- Weekly high scorer wins weekly prize; season cumulative wins main prize
- Optional: against-the-spread variant; Pick N (subset of games only)

**Platforms:** PoolTracker, Yahoo, ESPN, OfficePools.com

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: CUMULATIVE
confidence_range: [1, N_games] | against_the_spread: optional
weekly_prize: configurable
```

---

### NFL-4: Best Ball Draft

**Tags:** `#season-long` `#snake-draft` `#best-ball` `#cumulative-scoring`

Draft a large roster and do nothing else all season. The system automatically starts the best-scoring players at each position every week. No waivers, trades, or lineup decisions.

**How it works:**
- Pre-season snake draft of 20–25 players
- System auto-selects the optimal weekly lineup from each manager's roster
- Cumulative season total (no head-to-head); top N scorers win

**Platforms:** Underdog Fantasy ($15M Best Ball), DraftKings, ESPN

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: CUMULATIVE
lineup_management: AUTO_BEST_BALL | waiver_wire: false
```

---

### NFL-5: Guillotine League

**Tags:** `#season-long` `#snake-draft` `#weekly-lineup` `#waiver-wire` `#knockout-scoring`

Each week the lowest-scoring team is eliminated and their entire roster drops to the waiver wire. Combines survivor tension with full fantasy roster management.

**How it works:**
- Pre-season snake draft; 16–18 teams (ideally matching the 18-week NFL season)
- Each week: lowest-scoring team eliminated; all their players hit waivers
- Remaining teams can bid for dropped talent; last team standing wins

**Platforms:** Fantrax, Sleeper (commissioner-managed)

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: KNOCKOUT
elimination_trigger: LOWEST_SCORE_WEEKLY | waiver_wire: true (after elimination)
```

---

## 🏀 NBA (Basketball)

---

### NBA-1: Season-Long Redraft

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Identical structure to NFL Redraft applied to the NBA season. Points league or 9-category rotisserie format. Head-to-head weekly matchups; season-end playoff bracket.

**How it works:**
- Pre-season snake draft; 13–15-player rosters
- Points league: stats → fantasy points (points 1pt, rebounds 1.25pt, assists 1.5pt, etc.)
- 9-category roto variant: win or lose each of 9 stat categories per week
- Waiver wire all season; playoff bracket weeks 22–24

**Platforms:** ESPN, Yahoo, Sleeper, Fantrax

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
format: POINTS_LEAGUE | NINE_CATEGORY_ROTO (configurable)
waiver_wire: true | playoff_bracket: true
```

---

### NBA-2: DFS Single Slate Salary Cap

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

Fresh lineup for one night's games within a $50,000 cap. Classic (multi-game) or Showdown (single-game with Captain slot). Non-exclusive.

**How it works:**
- Pick 8 players (PG, SG, SF, PF, C, G, F, UTIL) within $50,000 cap
- Scoring: pts (1), reb (1.25), ast (1.5), stl/blk (2), TO (−0.5), 3PM (+0.5), DD (+1.5), TD (+3)
- Showdown variant: pick 6 from one game only; Captain earns 1.5× points/salary

**Platforms:** DraftKings, FanDuel

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | scoring_type: CUMULATIVE
is_exclusive: false | captain_slot: true (Showdown only) | budget: 50000
```

---

### NBA-3: Playoffs Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Fill out the full 16-team NBA playoff bracket before the first tip-off. Bonus points for predicting the correct number of games in each series.

**How it works:**
- All predictions before Game 1 tips off
- Points per correct series winner; more in later rounds
- Exact series length bonus (e.g. +2 for correct game count)
- Tiebreaker: total combined points in the NBA Finals deciding game

**Platforms:** Yahoo, ESPN, CBS Sports, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
round_values: [1, 2, 4, 8] (configurable) | series_length_bonus: configurable
```

---

### NBA-4: Best Ball Draft

**Tags:** `#season-long` `#snake-draft` `#best-ball` `#cumulative-scoring`

Same as NFL Best Ball applied to NBA. Large pre-season draft; auto-roster management all season. Popular for managers who love the draft but not the weekly grind.

**Platforms:** Underdog Fantasy, DraftKings

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: CUMULATIVE
lineup_management: AUTO_BEST_BALL | waiver_wire: false
```

---

### NBA-5: Survivor (Playoff Edition)

**Tags:** `#single-event` `#pick-em` `#survivor` `#knockout-scoring`

Pick one team to advance each playoff round. One wrong series prediction eliminates you. Each team usable only once per playoffs.

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM | scoring_type: KNOCKOUT
one_team_per_playoffs: true | elimination_frequency: PER_ROUND
```

---

## ⚾ MLB (Baseball)

---

### MLB-1: Season-Long Rotisserie (Roto)

**Tags:** `#season-long` `#snake-draft` `#cumulative-scoring` `#waiver-wire`

The original fantasy sports format. Teams are ranked in each of 10 statistical categories (5 hitting, 5 pitching); cumulative season-long rankings in each category produce a standings table.

**How it works:**
- Pre-season snake draft; 23–28 player rosters
- 10 scoring categories: AVG, HR, R, RBI, SB (hitting) + ERA, WHIP, W, K, SV (pitching)
- Each week, teams are ranked 1–N in each category; category ranks are summed
- Highest cumulative rank total at season end wins
- Daily or weekly lineup changes; waiver wire and trade system

**Platforms:** Yahoo, ESPN, Fantrax, CBS Sports

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: ROTISSERIE
categories: [AVG, HR, R, RBI, SB, ERA, WHIP, W, K, SV] (configurable)
waiver_wire: true | daily_lineup_changes: configurable
```

---

### MLB-2: Season-Long Head-to-Head Points

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Points version of MLB season-long fantasy. Weekly head-to-head matchups using stat-to-point conversions instead of category counting. More familiar to NFL fantasy players.

**How it works:**
- Same draft and roster structure as Roto but with point values per stat
- Scoring: HR (+4), RBI (+1), SB (+2), BB (+1), K as batter (−0.5), IP (+3), strikeout (+2), etc.
- Weekly H2H matchups; regular season record → playoff bracket

**Platforms:** Yahoo, ESPN, Sleeper

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
waiver_wire: true | playoff_bracket: true
```

---

### MLB-3: Home Run Derby Pick'em

**Tags:** `#single-event` `#pick-em` `#bracket` `#cumulative-scoring`

Predict the winner of the MLB All-Star Home Run Derby. Bracket format; participants pick the winner of each round matchup. Bonus points for predicting total HRs hit.

**How it works:**
- Full bracket submitted before the Derby begins
- Points per correct round advancement prediction; more for later rounds
- Bonus: predict total HR count for winner (closest without going over = tiebreaker)

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
bonus_prediction: TOTAL_HRS (tiebreaker)
```

---

### MLB-4: Daily Fantasy Single Slate

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring`

Classic DFS format for one night of MLB games. Build a roster of 10 players within a $50,000 cap; score from real game stats.

**How it works:**
- Roster: P, P, C, 1B, 2B, 3B, SS, OF, OF, OF within $50,000
- Scoring: HR (+10), RBI (+2), R (+2), BB (+2), SB (+5), H (+3), IP (+2.25), K (+2), etc.
- Non-exclusive; fresh lineup every slate

**Platforms:** DraftKings, FanDuel

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | scoring_type: CUMULATIVE
is_exclusive: false | budget: 50000
```

---

### MLB-5: Dynasty League

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#dynasty` `#waiver-wire` `#cumulative-scoring`

Multi-season keeper league where rosters carry over year to year. Includes a rookie draft each off-season from newly eligible players. True long-term franchise management.

**How it works:**
- Start-up draft assigns full rosters the first year; subsequent years use a rookie draft only
- Players kept indefinitely; trade market active all year
- Minor league system: prospect tracking before players hit the majors
- Deep rosters (35–40 players) reflect full franchise depth

**Platforms:** Fantrax, MFL, Sleeper

```
contest_type: SEASON_LONG | draft_type: SNAKE (start-up) + ROOKIE_DRAFT (annual)
scoring_type: HEAD_TO_HEAD | ROTISSERIE | dynasty: true | waiver_wire: true
```

---

## 🏒 NHL (Hockey)

---

### NHL-1: Season-Long Salary Cap

**Tags:** `#season-long` `#salary-cap` `#weekly-lineup` `#transfers` `#cumulative-scoring`

Build a team within a salary cap at the season start. Players' prices fluctuate based on performance. Limited weekly transfers keep roster management active without full waivers.

**How it works:**
- Build a squad of 18–22 players within a virtual budget
- Select a starting lineup each gameweek; bench players don't score
- Limited transfers per week (typically 2); extra transfers penalise total
- Scoring: goals, assists, +/−, hits, blocked shots, shots on goal, wins (G), save % (G)
- Captain earns 2× points

**Platforms:** OfficePools.com (hockey focus), DraftKings, Yahoo

```
contest_type: SEASON_LONG | draft_type: SALARY_CAP | scoring_type: CUMULATIVE
free_transfers_per_week: 2 | captain_slot: true | price_fluctuation: true
```

---

### NHL-2: Season-Long Redraft

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Standard snake-draft season-long format applied to hockey. Weekly head-to-head matchups across stat categories or points. Playoffs in the final weeks of the season.

**Platforms:** Yahoo, ESPN, Fantrax

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
waiver_wire: true | playoff_bracket: true
```

---

### NHL-3: Stanley Cup Playoff Bracket

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict every series winner and series length through the full NHL playoffs before puck drop of Game 1. Bonus points for exact series game counts.

**How it works:**
- Full 16-team bracket submitted before first game
- Points per correct series winner; more in later rounds
- Bonus: correct series length prediction (+1 or +2)
- Tiebreaker: total goals scored in the Stanley Cup deciding game

**Platforms:** Yahoo, ESPN, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
series_length_bonus: configurable | round_values: [1, 2, 4, 8] (configurable)
```

---

### NHL-4: DFS Single Slate Salary Cap

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

Fresh lineup for one night of NHL games. Pick skaters and a goalie within the salary cap.

**How it works:**
- Roster: C, C, W, W, W, D, D, G within $50,000 cap
- Scoring: goals (+8), assists (+5), shots on goal (+1.5), +/− (+1), blocked shots (+1.3), saves (G, +0.7), etc.
- Showdown variant: one game only; Captain earns 1.5×

**Platforms:** DraftKings, FanDuel

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
captain_slot: optional (Showdown) | budget: 50000
```

---

### NHL-5: Survivor (Playoff Edition)

**Tags:** `#single-event` `#pick-em` `#survivor` `#knockout-scoring`

Pick one team per round of the NHL playoffs. Wrong pick = eliminated. Each team used only once across the playoffs.

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM | scoring_type: KNOCKOUT
one_team_per_playoffs: true | elimination_frequency: PER_ROUND
```

---

## 🏌️ Golf (PGA Tour, Majors, LPGA)

---

### GOLF-1: Pick X, Use Best N (Tiered Office Pool)

**Tags:** `#single-event` `#tiered` `#best-ball` `#low-score-wins` `#cumulative-scoring`

The most popular casual golf pool format, especially for majors. Field split into tiers by ranking or odds; pick one from each. Only the best N of your picks count.

**How it works:**
- 4–10 tiers based on world ranking or odds
- Pick 1 golfer per tier (e.g. Pick 6 from 6 tiers)
- Best N scores count (e.g. Use Best 4 of 6); lowest combined strokes wins
- Missed cut = penalty score (typically 80 per missed round)
- Non-exclusive; lock before round 1

**Platforms:** EasyOfficePools, BuzzFantasyGolf

```
contest_type: SINGLE_EVENT | draft_type: TIERED | scoring_type: STROKE_PLAY (lower wins)
is_exclusive: false | best_ball_n: configurable | missed_cut_score: 80
```

---

### GOLF-2: DFS Salary Cap (Single Tournament)

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

DraftKings / FanDuel model. 6 golfers under a $50,000 cap; one Captain earns 1.5× points. Points-based scoring across all four rounds.

**How it works:**
- 6 golfers within $50,000 cap; 1 Captain (1.5× points, 1.5× cost)
- Scoring: birdie (+3), eagle (+5), bogey (−0.5), finish position bonus, streak bonuses
- Non-exclusive; golfers who miss the cut score 0 for rounds 3–4

**Variants:** Weekend Only (rounds 3–4); Single Round (Sunday only); Match Play (matchup-based scoring)

**Platforms:** DraftKings, FanDuel

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
captain_slot: true (1.5×) | budget: 50000
```

---

### GOLF-3: One-and-Done (Season-Long)

**Tags:** `#season-long` `#one-and-done` `#use-limit` `#weekly-lineup` `#cumulative-scoring`

Pick one golfer per tournament all season. Each golfer can only be used once (or N times). Highest cumulative earnings or fantasy points at season end wins.

**How it works:**
- Pick 1 golfer per PGA Tour event throughout the season
- Once used, that golfer is unavailable again (or limited to N uses)
- Score per week = golfer's prize money or fantasy points; 0 if no pick submitted

**Variants:** N-and-Done (2–10 uses per golfer); Mulligans (free extra usages); Segments (sub-prizes per 4–6-tournament block)

**Platforms:** Splash Sports, PoolGenius, ProTourFantasyGolf

```
contest_type: SEASON_LONG | draft_type: OPEN_PICK (weekly)
use_limit_per_participant: 1 (configurable) | segments: configurable
```

---

### GOLF-4: Season-Long Draft with Weekly Lineup

**Tags:** `#season-long` `#snake-draft` `#weekly-lineup` `#waiver-wire` `#use-limit` `#cumulative-scoring`

Pre-season snake draft assigns a stable of golfers per manager. Each week activate 3 golfers; post-cut substitution allowed. Use limits create strategic depth.

**How it works:**
- Pre-season snake draft; 6–10-player stables
- Weekly starters earn 2× points; post-cut sub earns 1×
- Each golfer limited to N uses per season; mulligans add extra uses
- Waivers allow acquisition of unowned golfers

**Platforms:** ProTourFantasyGolf Pick 3 Classic

```
contest_type: SEASON_LONG | draft_type: SNAKE | weekly_starters: 3
use_limit_per_golfer: 2 | mid_cut_substitution: true | waiver_wire: true
```

---

### GOLF-5: Calcutta Auction Pool

**Tags:** `#single-event` `#auction-draft` `#cumulative-scoring`

Participants bid in a live auction to own golfers for a major event. Payout tied to golfer's actual finish position. High stakes; typically run within established groups.

**How it works:**
- Each golfer in the field auctioned in a live session
- Highest bidder owns that golfer for the event; cost deducted from bankroll
- Payout: golfer's finish position determines owner's share of the total pot

**Platforms:** Private/custom leagues

```
contest_type: SINGLE_EVENT | draft_type: AUCTION | is_exclusive: true
payout_by_finish: true
```

---

## 🏀 NCAA Basketball (March Madness)

---

### NCAA-1: Full Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

The most widely played sports contest in the US. Predict all 63 games before tip-off. Champion pick worth 32× a Round 1 pick in standard format.

**Scoring variants:** Standard (1-2-4-8-16-32); Upset Bonus (seed difference added); Seed Multiplier (round value × seed); Flat (1 pt per correct pick); Late Heavy (1-2-3-4-6-10)

**Platforms:** ESPN Tournament Challenge, Yahoo, CBS, PoolTracker, RunYourPool

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
round_values: [1, 2, 4, 8, 16, 32] (configurable) | upset_bonus: configurable
tiebreaker: CHAMPIONSHIP_TOTAL_SCORE
```

---

### NCAA-2: Tournament Survivor (Daily Eliminator)

**Tags:** `#single-event` `#pick-em` `#survivor` `#knockout-scoring`

Pick one team per day to win their game. Wrong pick = out. Each team usable only once. ESPN's Tournament Challenge Eliminator is a major national example.

**Variants:** Per-round (not per-day); Multi-pick survivor (2 per day)

**Platforms:** ESPN, Splash Sports ($3M Survivor Madness), OfficePoolStop

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM | scoring_type: KNOCKOUT
one_team_per_tournament: true | elimination_frequency: DAILY | PER_ROUND
```

---

### NCAA-3: Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#cumulative-scoring`

Participants draft tournament teams via snake draft. Each team earns points for wins. Every manager gets a mix of seeds.

**How it works:**
- Pre-tournament snake draft; one team per pick
- Points per win, multiplied by round value
- Exclusive; tiebreaker by total points at tournament end

**Platforms:** ActionNetwork, custom leagues

```
contest_type: SINGLE_EVENT | draft_type: SNAKE | is_exclusive: true
scoring_type: CUMULATIVE (wins × round_value)
```

---

### NCAA-4: Pick 8 (Select-a-Few)

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Pick exactly 8 teams; earn points for every win by a selected team. No bracket structure required. Great for casual players.

**Platforms:** SimplySportsware, OfficePoolStop

```
contest_type: SINGLE_EVENT | draft_type: OPEN_SELECTION (pick exactly N=8)
is_exclusive: false | scoring_type: CUMULATIVE
```

---

### NCAA-5: Sweet 16 Second-Chance Bracket

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Fresh bracket after first-weekend upsets. Submit predictions for the final 15 games from the Sweet 16 through the championship. Popular second-chance format.

**Platforms:** SimplySportsware, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | start_round: SWEET_16
round_values: [1, 2, 4, 8] (configurable)
```

---

## 🏒 NCAA Hockey (Frozen Four)

The NCAA Hockey Tournament is a 16-team single-elimination bracket that plays identically in structure to March Madness. Pool formats map 1:1 with basketball equivalents. The four structures below are noted explicitly so the PoolMaster configuration system treats them as first-class — same sport category, different scoring rules.

---

### NCAAH-1: Full Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict all 15 games of the 16-team NCAA Hockey Tournament from Regional rounds through the National Championship before the first puck drops.

**How it works:**
- Full 16-team bracket submitted before the first Regional game
- Points per correct pick; points increase each round (identical scale to basketball)
- Standard scoring: 1, 2, 4, 8 (Regionals → Regional Final → Frozen Four → Championship)
- Champion pick worth 8× a Regional round pick
- Tiebreaker: predict total goals scored in the championship game

**Key difference from basketball:** Fewer upsets historically; top seeds advance more consistently, lowering variance. Upset bonus scoring is a useful option to reward bold picks.

**Platforms:** D1 college hockey pool sites; custom leagues via PoolTracker, OfficePoolStop

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
field_size: 16 | round_values: [1, 2, 4, 8] (configurable)
upset_bonus: optional | tiebreaker: CHAMPIONSHIP_TOTAL_GOALS
```

---

### NCAAH-2: Tournament Survivor (Per-Round)

**Tags:** `#single-event` `#pick-em` `#survivor` `#knockout-scoring`

Pick one team per round to advance. Wrong pick eliminates you. Each team usable only once across the tournament.

**How it works:**
- Each round: pick one team to win their game; wrong pick = eliminated
- Each team can only be used once per tournament
- With only 4 rounds and 16 teams, the use constraint is very meaningful — losing a top seed early forces hard decisions

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM | scoring_type: KNOCKOUT
one_team_per_tournament: true | elimination_frequency: PER_ROUND
```

---

### NCAAH-3: Snake Draft Team Pool

**Tags:** `#single-event` `#snake-draft` `#cumulative-scoring`

Pre-tournament snake draft of all 16 teams. Each win earns the owning manager points. Everyone gets a mix of seeds — no one locks up all the top seeds.

**How it works:**
- Snake draft before the tournament (16 rounds for 8 managers = every team owned)
- Each team earns points per win; round multiplier increases later in the tournament
- Exclusive: each team owned by exactly one manager
- The 16-team field makes this more feasible than basketball's 68-team version for small groups

**Best for:** Small private leagues (4–16 managers) where the tight field size means every team has an owner.

```
contest_type: SINGLE_EVENT | draft_type: SNAKE (16 rounds for full field ownership)
is_exclusive: true | scoring_type: CUMULATIVE (wins × round_value)
```

---

### NCAAH-4: Pick 4 (Select-a-Few)

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Pick 4 teams before the tournament. Earn points for every win by any of your selected teams. Non-exclusive; same teams can appear on multiple entries. Simple and approachable for casual fans.

**How it works:**
- Each participant selects exactly 4 teams from the 16-team field
- Non-exclusive; same team can be on multiple entries
- Points per win; more points in later rounds
- Good format for smaller tournaments where a full bracket feels like overkill

```
contest_type: SINGLE_EVENT | draft_type: OPEN_SELECTION (pick exactly N=4)
is_exclusive: false | scoring_type: CUMULATIVE
```

---

## 🏈 NCAA Football (College Football Playoff)

The 12-team CFP is structurally distinct from basketball and hockey in ways that shape which contest formats work best:

- **4 seeds get a first-round bye** — not all teams play in round 1, which breaks a standard bracket pick'em
- **Games are spaced weeks apart** — December first round, New Year's Six quarterfinals, January semifinals, January championship. This multi-week cadence enables round-by-round draft formats that don't work in condensed single-weekend tournaments
- **Player-based contests work well** — DFS-style salary cap contests have existed for college football via DraftKings and FantasyPostseason.com
- **Bracket is fixed (no re-seeding)** — paths are set on Selection Day and don't reseed after each round

The most interesting and differentiated formats for CFP are **player-based** (salary cap and tiered) rather than pure team pick'em, because the multi-week structure creates time to draft, track, and engage with player performance across rounds.

---

### NCAAF-1: 12-Team Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict every game in the 12-team CFP from first round through the National Championship. The bye structure means round 1 only has 8 teams playing; the top 4 seeds are automatic entries in the quarterfinals.

**How it works:**
- Full bracket submitted before the first round kicks off in mid-December
- Round 1: predict 4 games among seeds 5–12; top 4 seeds have byes
- Quarterfinals: predict 4 games (4 bye teams vs. 4 first-round winners)
- Semifinals: predict 2 games; National Championship: predict 1 game
- 11 total games to predict (vs. 63 in basketball)
- Points per correct prediction; increase each round

**Scoring variant — Upset Bonus:** Correct upset predictions earn bonus points based on seed difference.

**Key configuration note:** The 12-team CFP does not re-seed after round 1. Bracket paths are fixed at Selection Day. The PoolMaster bracket engine must model this correctly — a No. 9 seed who wins round 1 plays the No. 1 seed in the quarterfinals, not the lowest remaining seed.

**Tiebreaker:** Predict the total combined points in the National Championship game.

**Platforms:** ESPN College Football Bracket Challenge, PoolTracker, CBS Sports, custom leagues

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
field_size: 12 | bye_seeds: [1, 2, 3, 4]
rounds: [FIRST_ROUND, QUARTERFINALS, SEMIFINALS, CHAMPIONSHIP]
round_values: [1, 2, 4, 8] (configurable)
total_games: 11 | no_reseeding: true
upset_bonus: optional | tiebreaker: CHAMPIONSHIP_TOTAL_SCORE
```

---

### NCAAF-2: Per-Round Player Salary Cap (CFP DFS Style)

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot` `#weekly-lineup`

The flagship player-based CFP contest. Build a lineup of college football players within a salary cap before each round. Points from real game stats. The multi-week CFP structure is uniquely well-suited — managers draft fresh each round as the field shrinks and stakes rise.

**How it works:**
- Before each round, participants build a lineup from players on the remaining CFP teams
- Roster: QB, RB, RB, WR, WR, TE, FLEX within a $50,000 salary cap (configurable)
- Players priced based on season stats and projected role; top QBs most expensive
- Players on eliminated teams removed from the pool after each round
- Captain/Multiplier slot: designate one player to earn 1.5× points
- Scoring: passing yards/TDs, rushing yards/TDs, receiving yards/TDs — same as NFL DFS
- Non-exclusive; same player can appear across multiple entries
- Each round is a standalone scoring event; managers submit a fresh lineup per round

**Variants:**
- Single round only (e.g. just the Championship game)
- Full playoff cumulative: one roster submitted before round 1 carries through all four rounds
- Round-by-round: fresh salary cap lineup each round (most engaged format)

**Platforms:** DraftKings (CFB DFS for bowl and playoff games), FantasyPostseason.com, custom leagues

```
contest_type: SINGLE_EVENT | MULTI_EVENT | draft_type: SALARY_CAP
scoring_type: CUMULATIVE | is_exclusive: false
captain_slot: true (1.5×) | budget: 50000 (configurable)
rounds: configurable (1 round only, or all CFP rounds)
player_pool: PLAYERS_ON_REMAINING_TEAMS_ONLY
```

---

### NCAAF-3: Tiered Player Draft (CFP Player Pool)

**Tags:** `#single-event` `#tiered` `#cumulative-scoring` `#captain-slot`

Players from all CFP teams are grouped into tiers by season stats and projected scoring upside. Each manager picks one player from each tier. Non-exclusive. Points from real game stats across the full CFP.

**How it works:**
- All CFP players grouped into 4–6 tiers by projected fantasy scoring:
  - Tier 1: Elite QBs and top RBs/WRs (e.g. Heisman-caliber players)
  - Tier 2: Strong starters with high upside
  - Tier 3: Solid contributors, value plays
  - Tier 4: Deeper options, potential breakout players
  - Tier 5 (optional): Dark horses / special teams value
- Each manager picks 1 player per tier (e.g. Pick 5 from 5 tiers)
- Non-exclusive: same player can appear on multiple rosters
- Picks lock before first round kickoff; no changes after
- Points accumulate from each player's stats across every game they play in the CFP
- Players on eliminated teams stop scoring

**Captain option:** Designate one pick as Captain before submission; that player earns 2× points across all rounds.

**Best for:** Groups who want player engagement without a live salary cap draft. The tier structure ensures every entry has a mix of chalk and value.

**Platforms:** EasyOfficePools (tiered format adapted for CFP), custom leagues

```
contest_type: SINGLE_EVENT | draft_type: TIERED | scoring_type: CUMULATIVE
is_exclusive: false | tier_count: 4–6 (configurable)
captain_slot: optional | picks_lock: BEFORE_FIRST_ROUND
player_pool: ALL_CFP_PLAYERS
```

---

### NCAAF-4: Snake Draft Player Pool (CFP)

**Tags:** `#single-event` `#snake-draft` `#cumulative-scoring` `#weekly-lineup`

Live or async snake draft of CFP players before the first round. Each player exclusively owned by one manager. Points accumulate across all rounds; managers whose players are on eliminated teams lose that scoring source. Optional waiver pickup per round.

**How it works:**
- Pre-playoff snake draft; 8–12 managers draft 10–15 players from the full CFP player pool
- Exclusive: once drafted, a player is off the board
- Players accrue points from real game stats across every round they play
- When a player's team is eliminated, they stop scoring — a key strategic wrinkle
- Optional waiver wire: after each round, managers can drop one player and add one from an advancing team

**Strategic depth:** Drafting players from teams likely to advance deep is as important as raw talent. A WR from a No. 12 seed upset in round 1 scores for one game; a QB from the No. 1 seed could score across four games.

**Platforms:** FantasyPostseason.com (live draft mode), custom leagues

```
contest_type: SINGLE_EVENT | draft_type: SNAKE | is_exclusive: true
scoring_type: CUMULATIVE | scoring_stops_on_elimination: true
waiver_wire: optional (1 add/drop per round after eliminations)
```

---

### NCAAF-5: Post-Season Hold'em (Multiplier Survivor)

**Tags:** `#single-event` `#pick-em` `#survivor` `#cumulative-scoring`

Inspired by the NFFC Post-Season Hold'em format. Pick one player per CFP round. Players who advance carry a growing multiplier — 2× in round 2, 3× in round 3, 4× in the championship. Players on eliminated teams must be replaced but reset to 1×.

**How it works:**
- Round 1: pick one player from any CFP team; they earn base (1×) stats points
- If your player's team advances, that player carries into the next round at 2× multiplier
- Each subsequent round the player advances: multiplier increases (3× semifinals, 4× championship)
- If your player's team is eliminated: must replace with a player from a surviving team; new player starts at 1×
- No salary cap; no draft — just pick the player you want each round
- Highest cumulative total across all 4 rounds wins

**Why it works:** The multiplier mechanic creates an enormous incentive to identify players on deep-run teams early. Correctly picking a Cinderella QB from round 1 and riding them to the championship generates massive points. The replacement mechanic keeps everyone in the contest regardless of early eliminations.

**Platforms:** Inspired by NFFC Post-Season Hold'em; custom leagues

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM (one player per round)
scoring_type: CUMULATIVE (with round multiplier)
multipliers: [1×, 2×, 3×, 4×] per round | replacement_on_elimination: true
replacement_multiplier: 1× (resets)
```

---

## ⚾ NCAA Baseball (College World Series)

The NCAA Baseball Tournament has a unique double-elimination hybrid format that is the most structurally complex of any NCAA tournament:

- **Regionals:** 64 teams → 4-team double-elimination at 16 host sites → 16 regional winners
- **Super Regionals:** 16 winners → best-of-3 series → 8 CWS qualifiers
- **College World Series (Omaha):** 8 teams in two 4-team double-elimination brackets → CWS Finals (best-of-3)

A team can lose a game and still advance — a "full bracket" pick'em is significantly harder to model than basketball because of the loser's bracket. The formats below are designed around this reality.

---

### NCAAB-1: Regional Winner Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Rather than predicting the full double-elimination bracket, this format predicts the **winner of each Regional** (16), the **winner of each Super Regional** (8), and the **CWS bracket** (8 teams). This is the approach used by D1Baseball.com's official bracket challenge.

**How it works:**
- Stage 1 — Regionals: predict the winner of each of the 16 Regionals (1 pt each)
- Stage 2 — Super Regionals: predict the winner of each of the 8 Super Regionals (2 pts each)
- Stage 3 — CWS: predict the winner of each CWS bracket (4 pts) and the CWS Champion (8 pts)
- All predictions submitted before the first Regional game
- Internal double-elimination games within each Regional are not predicted — only the Regional winner

**Tiebreaker:** Predict the total combined runs scored across the CWS Finals series.

**Platforms:** D1Baseball.com Bracket Challenge (official), PoolTracker, custom leagues

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
stages: [REGIONAL_WINNERS, SUPER_REGIONAL_WINNERS, CWS_BRACKET, CWS_CHAMPION]
stage_values: [1, 2, 4, 8] (configurable)
tiebreaker: CWS_FINALS_TOTAL_RUNS
```

---

### NCAAB-2: CWS Only Bracket Pick'em (Second-Chance Pool)

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Starts fresh once the 8 CWS teams are known. Predict the full CWS bracket including both double-elimination groups and the Finals. Runs identically to the NCAA Basketball Sweet 16 Second-Chance format.

**How it works:**
- Submissions open after all 8 CWS teams are determined (after Super Regionals)
- Predict the winner of each CWS game including both bracket groups and the best-of-3 Finals
- Points per correct prediction; more points for later games
- Non-exclusive: same predictions available to all managers
- Excellent standalone contest or second-chance layer for managers who got Regionals wrong

**Platforms:** Custom leagues; OfficePoolStop, PoolTracker

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM
start_stage: CWS_ONLY | field_size: 8
round_values: [1, 2, 4] (configurable) | cws_finals_bonus: configurable
```

---

### NCAAB-3: Snake Draft Team Pool (Full Tournament)

**Tags:** `#single-event` `#snake-draft` `#cumulative-scoring` `#double-elimination`

Pre-tournament snake draft of all 64 teams. Points per win across every stage. Teams that advance through Regionals and Super Regionals earn more because they play more games. The double-elimination format means a team can lose one game and still win their Regional.

**How it works:**
- Pre-tournament snake draft; 64 total teams (8-manager league = 8 rounds each)
- Each win across Regionals, Super Regionals, and CWS earns points
- Round multiplier: Regional wins 1pt, Super Regional wins 2pt, CWS wins 3pt, CWS Finals wins 4pt
- Exclusive: each team owned by exactly one manager
- Double-elimination wrinkle: a team can lose one game and still advance, meaning a manager might root for their team to lose a game if they face an easier draw in the loser's bracket

**Best for:** Groups with 8–16 managers who want engagement across the full 2–3 week tournament period.

```
contest_type: SINGLE_EVENT | draft_type: SNAKE | is_exclusive: true
scoring_type: CUMULATIVE (wins × round_multiplier)
round_multipliers: [1×, 2×, 3×, 4×] per stage (configurable)
double_elimination: true (team can earn points after first loss)
```

---

### NCAAB-4: Regional Survivor Pool

**Tags:** `#single-event` `#pick-em` `#survivor` `#knockout-scoring` `#double-elimination`

Each day of play, pick one team to win their game. Wrong pick = eliminated. Each team usable only once. The double-elimination format adds a unique twist — you can pick a team in their first game or their second-chance loser's bracket game.

**How it works:**
- Each day of Regional/Super Regional/CWS play: pick one team to win their game
- Wrong pick = eliminated from the pool; each team can only be used once
- The double-elimination format means teams play more games, creating more pick windows and more use-limit pressure

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM | scoring_type: KNOCKOUT
one_team_per_tournament: true | elimination_frequency: DAILY
double_elimination_format: true
```

---

### NCAAB-5: CWS Player Pick'em (Player of the Day)

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Each day of the College World Series, pick one player you believe will be the top performer that day. Correct predictions earn points; cumulative total across all CWS days wins.

**How it works:**
- Each day of the CWS: pick one player from any participating team
- Scoring: top performer of the day (hits, RBIs, runs, Ks for pitchers) earns the picker the most points
- Graded: top pick earns full points; close picks earn partial credit based on rank
- Picks must be submitted before first pitch each day
- Optional use limit: each player can only be picked once during the CWS

**Best for:** Groups who want daily engagement during the CWS without the complexity of full roster management.

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM (daily player pick)
scoring_type: CUMULATIVE | player_pool: ALL_CWS_ACTIVE_PLAYERS
use_limit_per_player: 1 (configurable) | picks_lock: BEFORE_FIRST_PITCH_EACH_DAY
```

---

## 🏎️ Formula 1

---

### F1-1: Season-Long Salary Cap with Transfers (Official F1 Fantasy Style)

**Tags:** `#season-long` `#salary-cap` `#transfers` `#cumulative-scoring` `#captain-slot`

The official F1 Fantasy model. Build 5 drivers + 1 constructor within a budget. Carry the team across the season with limited race-weekend transfers and a captain multiplier.

**How it works:**
- 5 drivers + 1 constructor within a £100M (configurable) budget
- Prices fluctuate during the season based on performance
- 3 free transfers per race weekend; extra transfers penalise total score (−10 pts)
- Captain earns 2× that race; DRS Boost chip (double one driver once per season)
- Scoring: race finish, qualifying position, overtakes, laps led, fastest lap, beat teammate

**Platforms:** Official F1 Fantasy, GridRival

```
contest_type: SEASON_LONG | draft_type: SALARY_CAP | free_transfers_per_race: 3
transfer_penalty: -10 pts | captain_slot: true (2×) | includes_constructors: true
```

---

### F1-2: Race-by-Race DFS (Single Race Salary Cap)

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

Fresh $50,000 lineup per race. Captain earns 1.5× points at 1.5× cost. Scoring matches the real F1 Championship point structure for top-10 finishers.

**Platforms:** DraftKings

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
captain_slot: true (1.5×) | budget: 50000 | includes_constructors: true
```

---

### F1-3: Contract-Based Season League (GridRival Style)

**Tags:** `#season-long` `#salary-cap` `#transfers` `#cumulative-scoring` `#use-limit`

Sign drivers to 1–5 race contracts. When a contract expires, that driver is unavailable for one race before re-signing. Forces strategic timing throughout the season.

**Platforms:** GridRival

```
contest_type: SEASON_LONG | draft_type: SALARY_CAP (contract system)
contract_length_range: [1, 5] races | cooldown_after_expiry: 1 race
price_fluctuation: PERFORMANCE_BASED
```

---

### F1-4: Driver Stable Season Draft

**Tags:** `#season-long` `#snake-draft` `#weekly-lineup` `#use-limit` `#cumulative-scoring`

Pre-season snake draft assigns a stable of drivers. Activate all or a subset each race. Optional use limits per driver add depth strategy.

```
contest_type: SEASON_LONG | draft_type: SNAKE | weekly_starters: ALL | SUBSET
use_limit_per_driver: configurable
```

---

### F1-5: Race Winner Pick'em

**Tags:** `#season-long` `#pick-em` `#cumulative-scoring` `#confidence-weighted`

Predict top finishers and race events each weekend. Season-long cumulative total wins. Confidence weighting optional.

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: CUMULATIVE
predictions_per_race: [P1, P2, P3, FASTEST_LAP, POLE] (configurable)
confidence_weighting: optional
```

---

## 🏁 NASCAR

---

### NASCAR-1: Season-Long Driver Stable with Use Limits

**Tags:** `#season-long` `#tiered` `#weekly-lineup` `#use-limit` `#cumulative-scoring`

Pick from 5 tiered driver groups pre-season. Each week activate 5 drivers. Use each driver a maximum of 10 times per regular season (5 in playoffs). Official NASCAR Fantasy Live format.

**Platforms:** NASCAR Fantasy Live (official)

```
contest_type: SEASON_LONG | draft_type: TIERED (5 groups)
use_limit_per_driver: 10 regular / 5 playoffs | weekly_starters: 5
garage_driver: 1 (swap through Stage 2)
```

---

### NASCAR-2: Race-by-Race DFS Salary Cap

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring`

Fresh 6-driver lineup within a $50,000 cap each race. Scoring rewards finish position, place differential, laps led, and fastest laps.

**Platforms:** DraftKings, FanDuel

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
budget: 50000 | place_differential: ±1 pt per position vs. start
```

---

### NASCAR-3: Season Championship Pool (Best 3 of 4 Stable)

**Tags:** `#season-long` `#snake-draft` `#cumulative-scoring`

Pre-season snake draft of 4 drivers per team. Season winner = highest combined real-world NASCAR championship points from the best 3 of 4 drivers.

```
contest_type: SEASON_LONG | draft_type: SNAKE (4 rounds)
scoring_type: CUMULATIVE (official NASCAR pts) | counting_method: BEST_3_OF_4
```

---

### NASCAR-4: Race Survivor Pool

**Tags:** `#season-long` `#pick-em` `#survivor` `#knockout-scoring` `#one-and-done`

Each race: pick one driver to finish in the top 10. Outside the threshold = eliminated. Each driver usable only once per season.

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: KNOCKOUT
finish_threshold: TOP_N (configurable) | one_driver_per_season: true
```

---

### NASCAR-5: Head-to-Head Driver Matchup Pool

**Tags:** `#season-long` `#pick-em` `#head-to-head` `#cumulative-scoring`

4 featured H2H driver matchups per race. Pick which driver finishes higher. Correct pick = bonus points toward a season cumulative total.

**Platforms:** NASCAR Fantasy Live (official feature)

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: CUMULATIVE
matchups_per_race: 4 (configurable) | pts_per_correct_pick: 10 (configurable)
```

---

## ⛳ Horse Racing (Kentucky Derby, Triple Crown, Breeders' Cup)

---

### HR-1: Tiered Pick Pool (Single Race)

**Tags:** `#single-event` `#tiered` `#cumulative-scoring`

Field grouped into tiers by morning-line odds. Pick one from each tier. Points based on finish position of selected horses. Non-exclusive.

```
contest_type: SINGLE_EVENT | draft_type: TIERED | scoring_type: POSITION
is_exclusive: false | tier_assignment_method: ODDS | COMMISSIONER
```

---

### HR-2: DFS Salary Cap (Single Race)

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring`

Each horse assigned a salary inversely proportional to their odds. Pick 4–6 horses within a $50,000 cap. Non-exclusive.

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false | budget: 50000
```

---

### HR-3: Win / Place / Show Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring`

Predict the top 3 finishers in order (trifecta-style) or any order. Exact order earns maximum points; partial credit for partial correctness.

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM
exact_order_bonus: true | prediction_depth: 3–4 (configurable)
```

---

### HR-4: Triple Crown Season Pool

**Tags:** `#multi-event` `#salary-cap` `#cumulative-scoring`

Build a roster before the Kentucky Derby; carry it through all three Triple Crown races. Cumulative finish position points across the series.

```
contest_type: MULTI_EVENT (3 races) | draft_type: SALARY_CAP | TIERED
scoring_type: CUMULATIVE | mid_series_transfer: 0–1 (configurable)
```

---

### HR-5: Daily Featured Race Pick'em (Season-Long)

**Tags:** `#season-long` `#pick-em` `#one-and-done` `#cumulative-scoring`

Configured list of graded stakes races for the season. Pick one horse to win each race. Limited use per horse per season.

```
contest_type: SEASON_LONG | draft_type: PICK_EM | use_limit_per_horse: 1–2
featured_races: COMMISSIONER_DEFINED
```

---

---

# 🌍 International Sports

---

## ⚽ Soccer / Football (EPL, Champions League, World Cup, MLS)

---

### SOC-1: Classic Season-Long (FPL Style)

**Tags:** `#season-long` `#salary-cap` `#weekly-lineup` `#transfers` `#captain-slot` `#cumulative-scoring`

The global gold standard played by 10+ million managers. Build a 15-player squad within a £100M budget. Manage weekly transfers, chips, and a captain each gameweek.

**How it works:**
- 15 players (2 GK, 5 DEF, 5 MID, 3 FWD) within £100M; max 3 from any club
- Start 11 per gameweek; 4 bench players auto-sub if starters don't play
- 1 free transfer per week (rollover up to 5); extras cost −4 pts each
- Captain earns 2× points; Vice-Captain backup 2× if captain doesn't play
- Chips: Wildcard (unlimited transfers, once per half-season), Bench Boost, Triple Captain, Free Hit

**Variants:** Head-to-head mini-league (weekly W/L matchup record); FPL Cup (knockout cup within the season)

**Platforms:** Official Fantasy Premier League, FanTeam (paid entry), Sorare (blockchain)

```
contest_type: SEASON_LONG | draft_type: SALARY_CAP | free_transfers_per_week: 1 (rollover ≤5)
extra_transfer_penalty: -4 pts | captain_slot: true (2×) | chips: WILDCARD, BENCH_BOOST,
TRIPLE_CAPTAIN, FREE_HIT | squad_size: 15 | starters: 11
```

---

### SOC-2: Draft Mode (Exclusive Snake Draft Season-Long)

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Players are exclusively assigned via a snake draft — only one manager can own each player. Head-to-head weekly matchups; waiver system replaces free transfers. FPL Draft is the official version.

**How it works:**
- Pre-season 15-round snake draft; exclusive player ownership
- Draft order can use last-season standings (last place picks first)
- Weekly H2H: winner earns 3 league points
- Waivers for unowned/dropped players; trades optional
- Up to 3 additional mid-season drafts (commissioner-scheduled)

**Platforms:** Official FPL Draft, Draft Fantasy Football

```
contest_type: SEASON_LONG | draft_type: SNAKE (15 rounds) | scoring_type: HEAD_TO_HEAD
waiver_wire: true | mid_season_drafts: 0–3 (configurable)
```

---

### SOC-3: Single Gameweek DFS (Salary Cap)

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

Build a team for one gameweek within a salary cap. Non-exclusive; score from real player stats that gameweek only.

**How it works:**
- Select 7–8 players within $50,000–$100,000 cap; GK, DEF, MID, FWD composition
- Scoring: goals, assists, clean sheets (GK/DEF), saves, bonus, minutes played, cards
- Captain slot earns 2× points

**Platforms:** DraftKings, FanDuel

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
captain_slot: true | budget: 50000–100000 (configurable)
```

---

### SOC-4: Tournament / World Cup Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict group stage results and knockout round progression through a major tournament (World Cup, Euros, Champions League). One of the most popular office pool formats globally during tournament years.

**How it works:**
- Group stage: predict W/D/L for every match; points per correct result
- Knockout stage: predict winner of each match; points increase each round
- Bonus: predict correct scoreline for additional points
- Tiebreaker: predict Final score or total goals in the tournament

**Platforms:** PoolTracker, OfficePoolStop, Yahoo, ESPN

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
group_stage_predictions: true | correct_score_bonus: configurable
tiebreaker: FINAL_SCORE | TOTAL_GOALS
```

---

### SOC-5: Season-Long Results Predictor

**Tags:** `#season-long` `#pick-em` `#confidence-weighted` `#cumulative-scoring`

Predict the outcome (Win/Draw/Loss or exact score) of every EPL/league fixture each gameweek. Season-long cumulative correct predictions determine standings.

```
contest_type: SEASON_LONG | draft_type: PICK_EM
prediction_type: WIN_DRAW_LOSS | EXACT_SCORE | confidence_weighting: optional
weekly_prize: configurable
```

---

## 🏏 Cricket (IPL, T20 World Cup, Test Series, Big Bash)

---

### CRI-1: Match-by-Match DFS Salary Cap (Dream11 / T20 Style)

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

The dominant format in Indian fantasy cricket. Build a team of 11 players within a budget for one match. Captain earns 2× points; Vice-Captain earns 1.5×. This is the Dream11 model played by 100M+ users.

**How it works:**
- Select 11 players (WK, BAT, ALL, BOWL with composition rules) within a virtual credit budget
- Non-exclusive; same player can appear on all teams
- Captain earns 2×; Vice-Captain earns 1.5×
- Scoring covers batting (runs, fours, sixes, strike rate bonus), bowling (wickets, maiden overs, economy bonus), fielding (catches, run-outs, stumpings)
- Lineup locks before toss; players not in the playing XI score 0

**Platforms:** Dream11, My11Circle, MyTeam11, MPL

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
captain_slot: true (2×) | vice_captain_slot: true (1.5×)
lineup_lock: BEFORE_TOSS
position_rules: [WK: 1–4, BAT: 3–6, ALL: 1–4, BOWL: 3–6]
```

---

### CRI-2: Tournament-Long Salary Cap (ICC / IPL Official Style)

**Tags:** `#multi-event` `#salary-cap` `#transfers` `#cumulative-scoring` `#captain-slot`

Build a squad for the full duration of a T20 tournament (IPL, T20 World Cup, Big Bash). Make unlimited transfers between defined "Sets" of matches; transfers locked during a Set.

**How it works:**
- Squad of 11 players within a $100 credit budget
- Tournament divided into "Sets" (groups of matches); unlimited transfers between Sets
- Within a Set: squad locked (no changes once first match of Set begins)
- Captain earns 2×; Boosters available once per Set (e.g. double fielding points for one match)
- Mini-League variant: start fresh after group stage ("Super Eight Mini League")

**Platforms:** ICC Official Fantasy, IPL Official Fantasy (My11Circle), CricBattle

```
contest_type: MULTI_EVENT | draft_type: SALARY_CAP | transfers: UNLIMITED_BETWEEN_SETS
captain_slot: true (2×) | booster_chips: 1 per set | squad_size: 11
```

---

### CRI-3: Season-Long Draft League (Snake / Auction)

**Tags:** `#season-long` `#snake-draft` `#auction-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Season-long cricket fantasy with exclusive player ownership via a snake or auction draft. Weekly head-to-head matchups across a domestic T20 season. Similar to NFL redraft but applied to IPL or Big Bash.

**How it works:**
- Pre-season snake or auction draft; each player owned by one manager only
- Weekly head-to-head matchups based on players' performances in that round's matches
- Waiver system for unowned players; trade window during the season
- Cumulative H2H record determines playoff seeding; bracket playoff for championship

**Platforms:** CricBattle, CricketXI, custom leagues

```
contest_type: SEASON_LONG | draft_type: SNAKE | AUCTION | scoring_type: HEAD_TO_HEAD
waiver_wire: true | playoff_bracket: true
```

---

### CRI-4: Test Series Prediction Pool

**Tags:** `#multi-event` `#pick-em` `#bracket` `#cumulative-scoring` `#confidence-weighted`

Predict the result of each Test match in a bilateral series or multi-nation tournament. Points for correct W/D/L predictions; bonus for predicting margin of victory or player of the match.

**How it works:**
- Each Test: predict match result (Win/Draw/Loss) for each team
- Bonus predictions: top run-scorer, top wicket-taker, player of the match
- Series winner prediction earns bonus points
- Confidence weighting optional; overall series pick submitted before the series begins

**Platforms:** ESPNcricinfo fantasy, custom leagues

```
contest_type: MULTI_EVENT | draft_type: PICK_EM
prediction_type: WIN_DRAW_LOSS | confidence_weighting: optional
bonus_predictions: TOP_SCORER, TOP_WICKET_TAKER, POTM (configurable)
```

---

### CRI-5: One-and-Done (Season-Long T20)

**Tags:** `#season-long` `#one-and-done` `#use-limit` `#cumulative-scoring`

Pick one player per T20 match throughout an entire domestic season. Each player can be used only once (or N times). Highest cumulative fantasy points at season end wins.

**How it works:**
- Each scheduled match: pick one player from the full squad of either team
- Once a player is used, unavailable again (or limited to N uses)
- Score: that player's fantasy points from the match
- Mulligan option: each participant gets M bonus uses to reuse a player once

**Platforms:** Custom leagues; modeled on golf One-and-Done

```
contest_type: SEASON_LONG | draft_type: OPEN_PICK (per match)
use_limit_per_player: 1–2 (configurable) | mulligans: configurable
```

---

## 🏉 Rugby Union (Six Nations, Super Rugby, World Cup)

---

### RU-1: Tournament Salary Cap (Six Nations / Rugby Championship)

**Tags:** `#multi-event` `#salary-cap` `#weekly-lineup` `#transfers` `#captain-slot` `#cumulative-scoring`

The official Six Nations and Rugby Championship format. Build a 15-player squad within a budget at the tournament start. Set a weekly lineup; limited transfers between rounds.

**How it works:**
- Select 15 players (matching rugby positions: props, hooker, locks, back row, half-backs, backs) within a budget
- Max N players from any one nation (typically 6 max, 3 min per nation)
- Set a starting XV and one "Supersub" each round; Supersub earns 3× points if they come off the bench
- Limited transfers between rounds (typically 3 free)
- Captain earns 2× points
- Scoring: tries (10 pts backs, 15 pts forwards), conversions, penalty goals, tackles, carries, turnovers, yellow/red cards (negative)

**Platforms:** Official Six Nations Fantasy, Official Rugby Championship Fantasy (PlayFantasyRugby.com)

```
contest_type: MULTI_EVENT | draft_type: SALARY_CAP | free_transfers_per_round: 3
captain_slot: true (2×) | supersub_slot: true (3× off bench) | squad_size: 15
max_players_per_nation: 6 | min_players_per_nation: 3
```

---

### RU-2: World Cup Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict all pool stage and knockout round results through a Rugby World Cup. Points increase in later rounds; bonus for correct scoreline or try-scorer predictions.

**How it works:**
- Pool stage: predict W/D/L for every match; points per correct result
- Knockout stage: predict winner; multiplier increases each round
- Bonus: predict bonus-point outcomes (4 tries scored, lose within 7), correct score margin
- Tiebreaker: predict final score of the championship match

**Platforms:** Superbru (dominant platform for rugby prediction pools), custom leagues

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
pool_stage_predictions: true | bonus_point_prediction: configurable
tiebreaker: FINAL_SCORE
```

---

### RU-3: Season-Long Draft League (Super Rugby / URC / Premiership)

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Exclusive snake draft for a full club rugby season. Weekly head-to-head matchups based on players' real performances in Super Rugby Pacific, URC, or English Premiership rounds.

**How it works:**
- Pre-season snake draft; 15–20-player rosters
- Weekly lineup set for upcoming round's matches; injured or non-selected players benched
- Points: tries, assists, carries, tackles, lineouts won, penalties/yellow cards (negative)
- Waiver wire for unowned players; H2H record → playoff bracket

**Platforms:** Custom leagues; CricBattle-style structure adapted for rugby; some Fantrax leagues

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
waiver_wire: true | playoff_bracket: true
```

---

### RU-4: Prediction League (Weekly Scores Pick'em)

**Tags:** `#season-long` `#pick-em` `#confidence-weighted` `#cumulative-scoring`

Predict the result and score of every match in a domestic rugby season each round. Superbru is the dominant global platform for this format across multiple rugby competitions.

**How it works:**
- Each round: submit predicted score (e.g. 24–17) for every fixture
- Exact score = maximum points; correct result + close margin = partial points
- Scoring system: correct winner + correct score margin range → graded points
- Season-long cumulative total; weekly prizes for highest-scoring round

**Platforms:** Superbru (used for Six Nations, URC, Super Rugby, Premiership, World Cup)

```
contest_type: SEASON_LONG | draft_type: PICK_EM (score prediction)
scoring_type: CUMULATIVE | exact_score_bonus: true | margin_graded: true
weekly_prize: configurable
```

---

### RU-5: Sevens Tournament Pick'em

**Tags:** `#single-event` `#pick-em` `#bracket` `#cumulative-scoring`

Predict the bracket progression of an HSBC World Rugby Sevens Series event or an Olympic Sevens tournament. Fast-paced format with multiple rounds in a single weekend.

**How it works:**
- Pool stage: pick winners of each pool match
- Cup/Plate/Bowl knockouts: bracket predictions submitted before knockout play
- Points per correct prediction; more for correct Cup final result
- Can run as a single-event pool (one tournament leg) or season-long across all Sevens Series stops

```
contest_type: SINGLE_EVENT | MULTI_EVENT | draft_type: BRACKET_PICK_EM
pool_stage_predictions: true | scoring_type: CUMULATIVE
```

---

## 🏏 Australian Rules Football (AFL)

---

### AFL-1: Classic Salary Cap (SuperCoach / AFL Fantasy Style)

**Tags:** `#season-long` `#salary-cap` `#weekly-lineup` `#transfers` `#captain-slot` `#cumulative-scoring`

The dominant Australian fantasy format. Build a 30-player squad within a salary cap ($17.8M in AFL Fantasy; ~$9.6M in SuperCoach). Player prices fluctuate based on scoring averages. Strategic trading of "rookies" into "premiums" is central to long-term success.

**How it works:**
- Select 30 players (or 25 in SuperCoach) split by on-field positions (DEF, MID, RUC, FWD) within a salary cap
- Start 22 (or 17 in NRL SuperCoach) each round; bench acts as auto-emergencies for non-playing starters
- Prices change weekly: player's average multiplied by a "magic number" determines price
- Trade limit: 30 trades per season; maximum 2 per round (4 in bye rounds)
- Captain earns 2× points; Vice-Captain is backup captain
- Core strategy: start cheap rookies → sell when price peaks → upgrade to premium scorers

**Variants:** AFL Fantasy Classic (official AFL game), SuperCoach (News Corp), AFL Fantasy Draft (exclusive snake draft mode), NRL SuperCoach (same model for rugby league)

**Platforms:** AFL Fantasy (official), SuperCoach (Herald Sun / News Corp), NRL SuperCoach

```
contest_type: SEASON_LONG | draft_type: SALARY_CAP | squad_size: 30 (SC: 25)
trades_per_season: 30 | max_trades_per_round: 2 (4 in bye rounds)
captain_slot: true (2×) | price_fluctuation: SCORING_AVERAGE × MAGIC_NUMBER
```

---

### AFL-2: Fantasy Draft (Exclusive Snake Draft)

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#waiver-wire` `#cumulative-scoring`

Exclusive version of AFL Fantasy. Snake draft assigns players to one manager only. Weekly head-to-head matchups within a private league.

**How it works:**
- Pre-season snake draft of all AFL players
- Each round: set a starting lineup from your drafted roster
- Weekly H2H matchup vs. one league opponent; W/L record determines standings
- Waiver wire for unowned players; trade market optional
- Season-end playoff bracket for championship

**Platforms:** AFL Fantasy Draft (official)

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
waiver_wire: true | playoff_bracket: true
```

---

### AFL-3: Survivor Draft (Weekly Elimination)

**Tags:** `#season-long` `#snake-draft` `#knockout-scoring` `#waiver-wire`

A guillotine-style format adapted for AFL. Each round, the lowest-scoring team is eliminated; their roster drops to the waiver wire for remaining teams to claim. Referenced in community AFL Fantasy podcasts as a popular format variant.

**How it works:**
- Pre-season snake draft; 18 teams ideal (18 AFL home-and-away rounds)
- Each round: lowest scorer eliminated; their players hit free agency
- Remaining teams can claim dropped players to strengthen their rosters
- Last team standing wins

**Platforms:** Custom leagues via AFL Fantasy Draft infrastructure

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: KNOCKOUT
elimination_trigger: LOWEST_SCORE_WEEKLY | waiver_wire: true (after elimination)
```

---

### AFL-4: Round-by-Round Tips (Footy Tipping)

**Tags:** `#season-long` `#pick-em` `#cumulative-scoring`

"Footy Tipping" is a quintessential Australian tradition. Each round, predict the winner of every AFL game. Correct tips earn points. The longest-running communal sports pool format in Australia.

**How it works:**
- Each AFL round (9 games): predict the winner of every match
- Correct tip = 1 point; some variants award margin bonus (predict winning margin)
- Season cumulative tips total determines the winner
- Tiebreaker: total cumulative margin accuracy
- Runs the full 23 regular-season rounds; optional finals tipping as a separate contest

**Platforms:** AFL SuperCoach Tipping (official), Fox Sports Tipping, custom workplace pools

```
contest_type: SEASON_LONG | draft_type: PICK_EM | scoring_type: CUMULATIVE
margin_tipping: optional | tiebreaker: CUMULATIVE_MARGIN
```

---

### AFL-5: Finals Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict the full AFL Finals Series bracket before the first final is played. The AFL finals use a unique double-chance elimination format (not a simple single-elimination bracket), which adds strategic depth.

**How it works:**
- AFL Finals: 8 teams; unique format where top 4 teams have a second chance if they lose in Week 1
- Predict winners at each stage through Qualifying Finals, Elimination Finals, Semi-Finals, Preliminary Finals, and the Grand Final
- Points per correct result; Grand Final prediction worth the most
- Bonus: predict the Grand Final winning margin or leading goal-kicker

**Platforms:** AFL SuperCoach, Fox Sports Tipping, custom leagues

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
afl_finals_format: DOUBLE_CHANCE_BRACKET | bonus_prediction: MARGIN | LEADING_GOALKICKER
```

---

## 🏉 Rugby League (NRL, Super League)

---

### RL-1: Season-Long Salary Cap (NRL SuperCoach Style)

**Tags:** `#season-long` `#salary-cap` `#weekly-lineup` `#transfers` `#captain-slot` `#cumulative-scoring`

The dominant Australian rugby league fantasy format. Select 25 players within a salary cap of $9.6M. Start 13 per round. Captain earns 2×. Strategic trading of rookies into premiums drives the season.

**How it works:**
- 25-player squad within a ~$9.6M salary cap
- Start 13 per round (17 in full squad including bench substitutes)
- Up to 40 trades per season; max 2 per round (4 in bye rounds)
- Captain earns 2×; Vice-Captain backup
- Scoring: tries (12 pts try, 6 pts last-touch assist), tackle breaks, run metres, tackles, errors (negative), penalties (negative)
- Prices based on 3-round rolling scoring average × price formula

**Platforms:** NRL SuperCoach (official), NRL Fantasy (official)

```
contest_type: SEASON_LONG | draft_type: SALARY_CAP | squad_size: 25
trades_per_season: 40 | max_trades_per_round: 2 | captain_slot: true (2×)
scoring_includes: tries, assists, tackles, run_metres, errors (negative)
```

---

### RL-2: Season-Long Draft League

**Tags:** `#season-long` `#snake-draft` `#head-to-head` `#waiver-wire` `#cumulative-scoring`

Exclusive snake draft assigns NRL or Super League players to one manager each. Weekly head-to-head matchups; waiver wire between rounds. Playoff bracket at season end.

```
contest_type: SEASON_LONG | draft_type: SNAKE | scoring_type: HEAD_TO_HEAD
waiver_wire: true | playoff_bracket: true
```

---

### RL-3: State of Origin / International Match Pick'em

**Tags:** `#single-event` `#pick-em` `#cumulative-scoring` `#confidence-weighted`

Predict the outcome and specific events (first try-scorer, winning margin, half-time leader) for marquee rugby league matchups like State of Origin or international tests.

**How it works:**
- Predict match result (W/D/L), winning margin bracket, first try-scorer
- Exact correct predictions earn maximum points; partial credit for close margin picks
- Can be run as a single game or across all three State of Origin games

```
contest_type: SINGLE_EVENT | MULTI_EVENT | draft_type: PICK_EM
bonus_predictions: FIRST_TRY_SCORER, MARGIN, HALF_TIME_LEADER (configurable)
```

---

## 🎾 Tennis (Grand Slams, ATP/WTA Season)

---

### TEN-1: Grand Slam DFS Salary Cap

**Tags:** `#single-event` `#salary-cap` `#cumulative-scoring` `#captain-slot`

Build a lineup within a salary cap for one Grand Slam. Points earned as players advance. Non-exclusive; captain earns 2×.

```
contest_type: SINGLE_EVENT | draft_type: SALARY_CAP | is_exclusive: false
captain_slot: true | round_progression_bonus: true
```

---

### TEN-2: Draw Bracket Pick'em

**Tags:** `#single-event` `#bracket` `#pick-em` `#cumulative-scoring`

Predict every match through a 128-player Grand Slam draw. Identical structure to March Madness but 7 rounds.

```
contest_type: SINGLE_EVENT | draft_type: BRACKET_PICK_EM | scoring_type: BRACKET
field_size: 128 (7 rounds) | round_values: [1, 2, 4, 8, 16, 32, 64] (configurable)
```

---

### TEN-3: Season-Long One-and-Done

**Tags:** `#season-long` `#one-and-done` `#use-limit` `#cumulative-scoring`

Pick one player per tournament all season on the ATP/WTA tour. Each player limited to N uses. Highest cumulative prize money or fantasy points wins.

```
contest_type: SEASON_LONG | draft_type: OPEN_PICK (per tournament)
use_limit_per_player: 1–2 (configurable) | events: ALL | SLAMS_ONLY | MASTERS_ONLY
```

---

### TEN-4: Season-Long Draft League

**Tags:** `#season-long` `#snake-draft` `#weekly-lineup` `#waiver-wire` `#cumulative-scoring`

Pre-season snake draft; activate players per tournament week. Cumulative season total wins.

```
contest_type: SEASON_LONG | draft_type: SNAKE | weekly_starters: 2–3 | waiver_wire: true
```

---

### TEN-5: Slam Survivor (Round-by-Round)

**Tags:** `#single-event` `#pick-em` `#survivor` `#knockout-scoring`

Pick one player per round; wrong pick = eliminated. Each player usable once per tournament.

```
contest_type: SINGLE_EVENT | draft_type: PICK_EM | scoring_type: KNOCKOUT
one_player_per_tournament: true | elimination_frequency: PER_ROUND
```

---

---

# Cross-Sport Tag Index

This index groups contest structures by shared tag — directly maps to reusable domain model components in PoolMaster.

### `#single-event`
NBA-2, NBA-3, NBA-5, MLB-3, MLB-4, NHL-3, NHL-4, NHL-5, GOLF-1, GOLF-2, GOLF-5, F1-2, NASCAR-2, HR-1, HR-2, HR-3, NCAA-1–5, NCAAH-1–4, NCAAF-1–5, NCAAB-1–5, SOC-3, SOC-4, CRI-1, RU-2, RU-5, AFL-5, TEN-1, TEN-2, TEN-5

### `#multi-event`
HR-4, CRI-2, RU-1, RU-5, RL-3

### `#season-long`
NFL-1–5, NBA-1, NBA-4, MLB-1, MLB-2, MLB-5, NHL-1, NHL-2, GOLF-3, GOLF-4, F1-1, F1-3, F1-4, F1-5, NASCAR-1, NASCAR-3–5, HR-5, SOC-1, SOC-2, SOC-5, CRI-3, CRI-5, RU-3, RU-4, AFL-1–4, RL-1, RL-2, TEN-3, TEN-4

### `#salary-cap`
NBA-2, MLB-4, NHL-1, NHL-4, GOLF-2, GOLF-5, F1-1, F1-2, F1-3, NASCAR-2, HR-2, HR-4, NCAAF-2, SOC-1, SOC-3, CRI-1, CRI-2, RU-1, AFL-1, RL-1, TEN-1

### `#snake-draft`
NFL-1, NFL-4, NFL-5, NBA-1, NBA-4, MLB-1, MLB-2, MLB-5, NHL-2, GOLF-4, F1-4, NASCAR-3, NCAAH-3, NCAAF-4, NCAAB-3, SOC-2, CRI-3, RU-3, AFL-2, AFL-3, RL-2, NCAA-3, TEN-4

### `#auction-draft`
GOLF-5, CRI-3

### `#tiered`
GOLF-1, NASCAR-1, HR-1, HR-4, NCAAF-3

### `#pick-em`
NFL-2, NFL-3, NASCAR-4, NASCAR-5, HR-3, HR-5, NCAAH-2, NCAAH-4, NCAAF-1, NCAAF-5, NCAAB-1, NCAAB-2, NCAAB-4, NCAAB-5, SOC-4, SOC-5, CRI-4, RU-2, RU-4, RU-5, AFL-4, AFL-5, RL-3, NCAA-1, NCAA-2, NCAA-4, NCAA-5, TEN-5, F1-5

### `#survivor`
NFL-2, NFL-5, NASCAR-4, NBA-5, NHL-5, NCAA-2, NCAAH-2, NCAAF-5, NCAAB-4, AFL-3, TEN-5

### `#best-ball`
NFL-4, NBA-4, GOLF-1

### `#one-and-done`
NFL-2, GOLF-3, NASCAR-4, HR-5, CRI-5, TEN-3

### `#bracket`
NBA-3, MLB-3, NHL-3, NCAA-1–5, NCAAH-1, NCAAH-3, NCAAF-1, NCAAB-1, NCAAB-2, NCAAB-3, SOC-4, RU-2, RU-5, AFL-5, TEN-2

### `#captain-slot`
GOLF-2, F1-1, F1-2, NBA-2, NHL-4, NCAAF-2, NCAAF-3, SOC-1, SOC-3, CRI-1, CRI-2, RU-1, AFL-1, RL-1, TEN-1

### `#head-to-head`
NFL-1, NBA-1, MLB-2, NHL-2, NASCAR-5, SOC-2, CRI-3, RU-3, AFL-2, RL-2

### `#waiver-wire`
NFL-1, NFL-5, NBA-1, NBA-4, MLB-1, MLB-2, MLB-5, NHL-2, GOLF-4, SOC-2, CRI-3, RU-3, AFL-2, AFL-3, RL-2, TEN-4

### `#confidence-weighted`
NFL-3, F1-5, CRI-4, RU-4, RL-3

### `#transfers`
GOLF-1 (implicit), F1-1, F1-3, NHL-1, SOC-1, CRI-2, RU-1, AFL-1, RL-1

### `#use-limit`
GOLF-3, GOLF-4, NASCAR-1, HR-5, F1-3, CRI-5, TEN-3

### `#weekly-lineup`
NFL-1, NBA-1, MLB-2, NHL-1, GOLF-4, NASCAR-1, NCAAF-2, NCAAF-4, SOC-1, CRI-3, RU-3, AFL-1, AFL-2, RL-1, RL-2, TEN-4

### `#double-elimination`
NCAAB-3, NCAAB-4

### `#dynasty`
MLB-5

### `#cumulative-scoring`
(All formats except pure knockout/survivor accumulate points — see `#knockout-scoring` for exceptions)

### `#knockout-scoring`
NFL-2, NFL-5, NBA-5, NHL-5, NASCAR-4, NCAA-2, NCAAH-2, NCAAF-5 (hybrid), NCAAB-4, AFL-3, TEN-5

### `#low-score-wins`
GOLF-1 (stroke play)

---

## Domain Model Notes

### CFP Bracket Config

The 12-team CFP bracket requires an extension to the `BracketConfig` domain model to handle the bye-seed mechanic:

```typescript
interface CFPBracketConfig extends BracketConfig {
  bye_seeds: number[];                       // e.g. [1, 2, 3, 4] — skip round 1
  first_round_matchups: [number, number][];  // e.g. [[5,12],[6,11],[7,10],[8,9]]
  no_reseeding: boolean;                     // bracket paths fixed at Selection Day
  host_sites: string[];                      // named bowl games per round
}
```

The existing `BracketPickEmContest` likely assumes all teams play in round 1 — the CFP is the primary case where this breaks.

### NCAA Baseball Tournament Config

The NCAA Baseball Tournament requires a `double_elimination` flag that basketball and hockey do not need:

```typescript
interface NCAATournamentConfig {
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'HYBRID';
  // HYBRID = regional stages use double-elim; CWS finals use best-of-3
  stages: TournamentStage[];   // each stage can have its own format
  best_of_series?: number;     // for Super Regionals (3) and CWS Finals (3)
}
```

For NCAAB-1 (Regional Winner Bracket Pick'em), PoolMaster only needs to track **Regional winners** — not internal double-elimination game results — simplifying implementation significantly while keeping the contest accurate and engaging.

---

*Generated by Claude — PoolMaster Contest Structures by Sport (Full Edition + NCAA Addendum) v2.0*
*Sources: ESPN, Yahoo, Sleeper, DraftKings, FanDuel, Dream11, ICC Official Fantasy, AFL Fantasy, SuperCoach, NRL SuperCoach, Official FPL, Superbru, GridRival, NASCAR Fantasy Live, Splash Sports, PoolGenius, EasyOfficePools, BuzzFantasyGolf, ProTourFantasyGolf, CricBattle, OfficePoolStop, RunYourPool, SimplySportsware, PoolTracker, ActionNetwork, Fantrax, Six Nations Fantasy, PlayFantasyRugby.com, Fantasy Rugby Geek, D1Baseball.com Bracket Challenge, FantasyPostseason.com, ESPN College Football Bracket Challenge, NFFC Post-Season Hold'em, Underdog Best Bowl Mania, CBS Sports College Football Rules*
