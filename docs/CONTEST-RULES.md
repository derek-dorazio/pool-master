# Ultimate Pool Manager — Contest Rules by Sport

This document defines all contest types, selection methods, scoring rules, and special mechanics for each supported sport.

---

## Table of Contents

- [Global Mechanics](#global-mechanics)
- [Golf](#golf)
- [NFL](#nfl)
- [NBA](#nba)
- [NCAA Basketball](#ncaa-basketball)
- [F1 (Formula 1)](#f1-formula-1)
- [Tennis](#tennis)
- [Soccer](#soccer)
- [NASCAR](#nascar)
- [Horse Racing](#horse-racing)

---

## Global Mechanics

### Contest Types

| Type | Description |
|---|---|
| **SINGLE_EVENT** | One tournament or event (e.g., The Masters, March Madness) |
| **SEASON_LONG** | Spans an entire season across multiple weeks/events |

### Selection Types

| Type | Exclusive? | Description |
|---|---|---|
| **SNAKE_DRAFT** | Yes | Turn-based draft; each pick owned by one manager |
| **TIERED** | No | Pick one from each tier group; multiple managers can pick the same |
| **BUDGET_PICK** | No | Build roster within a salary cap; non-exclusive |
| **OPEN_SELECTION** | No | Pick N from the full unrestricted field |
| **PICK_EM** | No | Predict outcomes; no roster building |
| **BRACKET_PICK_EM** | No | Predict tournament bracket progression |

### Survivor Mechanics

All survivor contests share these configurable options:

| Option | Description |
|---|---|
| **Live Pick** | One pick per period, submitted before each begins |
| **Locked Pick** | All picks submitted upfront before the event starts |
| **One-and-Done** | Each team/player usable only once per season |
| **Strikes** | 0 = instant elimination; 1-3 = allowed wrong picks before out |
| **Double Pick** | Must pick 2 winners per period (both must win) |
| **Buybacks** | Allow re-entry after elimination (configurable) |

### Tiebreaker Rules

- **Bracket contests:** Predicted championship game total score
- **Survivor:** Highest cumulative score among remaining players
- **Points-based:** Head-to-head record, then most recent week score

---

## Golf

**Contest Type:** SINGLE_EVENT
**Selection Types:** Snake Draft, Tiered, Budget Pick

### Contest Formats

**Tiered Pick Pool**
- 4-10 tiers grouped by world ranking or odds
- Pick 1 golfer per tier
- Best N scores count (e.g., pick 6, use best 4)
- Lowest combined strokes wins
- Non-exclusive (multiple managers can pick the same golfer)
- Missed cut = penalty score of 80 per missed round

**Budget Pick Pool**
- Each golfer priced based on ranking/odds
- Pick 6-8 golfers within total budget
- Best N scores count
- Lowest combined strokes wins

**Snake Draft**
- Exclusive pre-tournament snake draft
- Each golfer's actual stroke total counts
- Missed cut = penalty score
- Lowest total combined strokes wins

### Scoring: DFS Points

| Stat | Points |
|---|---|
| Hole-in-one | +10 |
| Albatross (double eagle) | +8 |
| Eagle | +5 |
| Birdie | +3 |
| Par | +0.5 |
| Bogey | -0.5 |
| Double bogey | -1 |
| Triple bogey or worse | -1.5 |

**Position Bonuses:** 1st place = 30 pts, scaling down to Top 30 = 1 pt

**Bonus Rules:**
- 3+ consecutive birdies: +3 pts
- Bogey-free round: +3 pts
- Round of -5 or better: +5 pts

### Scoring: Stroke Play

- Total actual strokes count (lower is better)
- Missed cut: 80 strokes per missed round
- Best N of M counting method (e.g., best 4 of 6 golfers)

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Snake Draft (4 rounds) | SNAKE_DRAFT | 4 rounds, 120s per pick, async |
| Tiered Pick 6 Use 4 | TIERED | 6 tiers, 1 per tier, best 4 count, odds-based |
| Budget $50K | BUDGET_PICK | $50K budget, 6-golfer roster, odds-based pricing |

---

## NFL

**Contest Type:** SEASON_LONG
**Selection Types:** Snake Draft, Pick'em, Survivor

### Contest Formats

**Snake Draft (Fantasy)**
- 15-round snake draft of individual players
- Weekly scoring based on player stats
- Standard, PPR, or Half-PPR scoring

**Survivor Pool**
- Pick one NFL team per week to win straight-up (no spread)
- Wrong pick = eliminated
- Each team usable only once per season
- Configurable: strikes (0-3), double pick, buybacks

**Confidence Pick'em**
- Pick all game winners each week
- Assign confidence points (16 = most confident, 1 = least)
- More confident correct picks earn more points

### Scoring: Standard (Non-PPR)

**Passing**
| Stat | Points |
|---|---|
| Passing yards | 0.04 per yard (1 pt per 25 yards) |
| Passing TD | +4 |
| Interception thrown | -2 |
| 2-point conversion (pass) | +2 |

**Rushing**
| Stat | Points |
|---|---|
| Rushing yards | 0.1 per yard (1 pt per 10 yards) |
| Rushing TD | +6 |
| 2-point conversion (rush) | +2 |
| Fumble lost | -2 |

**Receiving**
| Stat | Points |
|---|---|
| Receiving yards | 0.1 per yard (1 pt per 10 yards) |
| Receiving TD | +6 |
| 2-point conversion (rec) | +2 |
| Reception (PPR only) | +1 (or +0.5 for Half-PPR) |

**Kicking**
| Stat | Points |
|---|---|
| FG made (0-39 yards) | +3 |
| FG made (40-49 yards) | +4 |
| FG made (50+ yards) | +5 |
| FG missed | -1 |
| PAT made | +1 |
| PAT missed | -1 |

**Bonuses:**
- 300+ passing yards: +3 pts
- 100+ rushing yards: +3 pts
- 100+ receiving yards: +3 pts

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Snake Draft (15 rounds) | SNAKE_DRAFT | 15 rounds, 60s per pick, live mode |
| Survivor | PICK_EM | 1 pick/week, one-and-done, 0 strikes |
| Confidence Pick'em | PICK_EM | 16 picks/week, confidence-weighted |

---

## NBA

**Contest Type:** SINGLE_EVENT, SEASON_LONG
**Selection Types:** Snake Draft, Tiered, Budget Pick, Bracket Pick'em, Survivor

### Contest Formats

**Playoffs Snake Draft**
- Pre-playoffs exclusive draft of all 16 playoff teams
- Points per series win with round multipliers (1x, 2x, 4x, 8x)

**Playoffs Tiered Pool**
- Tiers by seed: 1-2, 3-4, 5-6, 7-8
- Pick 1 team per tier
- Points per series win with round multipliers

**Playoffs Budget Pool**
- Favorites cost more; underdogs are cheap
- Build roster within budget
- Points per series win with round multipliers

**Playoffs Bracket Pick'em**
- Full bracket submission before Game 1
- Points per correct series winner (increasing by round)
- Bonus for predicting correct series length
- Tiebreaker: total points in Finals deciding game

**Playoff Survivor**
- Pick one team per round to advance
- Wrong pick = eliminated
- Each team usable only once across playoffs

### Scoring: Points League

| Stat | Points |
|---|---|
| Points scored | +1 |
| Rebounds | +1.25 |
| Assists | +1.5 |
| Steals | +2 |
| Blocks | +2 |
| Three-pointers made | +0.5 |
| Turnovers | -1 |
| Double-double | +1.5 bonus |
| Triple-double | +3 bonus |

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Snake Draft (12 rounds) | SNAKE_DRAFT | 12 rounds, 90s per pick, live mode |
| Playoff Tiers | TIERED | 4 tiers by seed, 1 pick per tier |

---

## NCAA Basketball

**Contest Type:** SINGLE_EVENT
**Selection Types:** Snake Draft, Tiered, Budget Pick, Bracket Pick'em, Survivor

### Contest Formats

**Bracket Pick'em (March Madness)**
- Full 64-team bracket submission
- Points per correct prediction (increasing by round)
- Multiple scoring variants available

**Snake Draft Team Pool**
- Pre-tournament exclusive draft of tournament teams
- Points per game won with round multipliers

**Tiered Team Pool**
- Tiers by seed: 1-4, 5-8, 9-12, 13-16
- Pick 1 team per tier

**Budget Team Pool**
- Teams priced by seed/odds
- Build roster within budget

**Tournament Survivor**
- Pick one team per day/round to win
- Wrong pick = eliminated
- Each team usable only once

### Scoring: Bracket Standard

| Round | Points per Correct Pick |
|---|---|
| Round of 64 | 1 |
| Round of 32 | 2 |
| Sweet 16 | 4 |
| Elite Eight | 8 |
| Final Four | 16 |
| Championship | 32 |

**Tiebreaker:** Championship game total score prediction

### Scoring Variants

| Variant | Difference |
|---|---|
| **Standard** | Points double each round (1, 2, 4, 8, 16, 32) |
| **Upset Bonus** | Extra points when a lower seed beats a higher seed (seed difference) |
| **Seed Multiplier** | Correct pick points multiplied by the winning team's seed number |
| **Flat** | 1 point per correct pick regardless of round |

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Full 64-Team Bracket | BRACKET_PICK_EM | Round values [1, 2, 4, 8, 16, 32] |
| Pick 8 Teams | OPEN_SELECTION | 8 picks, non-exclusive |
| Tiered by Seed | TIERED | 4 tiers (seeds 1-4, 5-8, 9-12, 13-16), 1 per tier |

---

## F1 (Formula 1)

**Contest Type:** SEASON_LONG
**Selection Types:** Budget Pick, Pick'em

### Contest Formats

**Season Budget Pick**
- Build a driver roster within budget each race
- Pricing based on world rankings

**Season Snake Draft**
- Draft drivers for the full season

**Season Prediction Pick'em**
- Predict race outcomes across the season
- Optional confidence weighting

### Scoring: DFS Captain

**Finish Position Points**
| Position | Points |
|---|---|
| 1st | 25 |
| 2nd | 18 |
| 3rd | 15 |
| 4th | 12 |
| 5th | 10 |
| 6th | 8 |
| 7th | 6 |
| 8th | 4 |
| 9th | 2 |
| 10th | 1 |

**Stat Points**
| Stat | Points |
|---|---|
| Laps led | +0.1 per lap |
| Classified finish (90%+ laps) | +1 |
| Fastest lap | +1 |
| Beat teammate | +3 |

**Position Change Bonuses/Penalties**
| Change | Points |
|---|---|
| Gained 10+ spots | +5 |
| Gained 5-9 spots | +3 |
| Gained 3-4 spots | +2 |
| Lost 3-4 spots | -2 |
| Lost 5-9 spots | -3 |
| Lost 10+ spots | -5 |

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Budget Weekly | BUDGET_PICK | $10M budget, 5-driver roster |
| Season Snake | SNAKE_DRAFT | 3 rounds, 120s per pick, async |

---

## Tennis

**Contest Type:** SINGLE_EVENT, SEASON_LONG
**Selection Types:** Snake Draft, Tiered, Budget Pick, Bracket Pick'em, Survivor

### Contest Formats

**Grand Slam Squad Selection** (Snake, Tiered, or Budget)
- Build roster for a single tournament
- Score based on rounds won and match stats

**Grand Slam Bracket**
- Predict tournament bracket from Round of 128

**Survivor (QF Onward)**
- Pick one player per round from quarterfinals onward
- Wrong pick = eliminated
- Each player usable only once

### Scoring: Grand Slam DFS

**Tournament Position Points**
| Finish | Points |
|---|---|
| Winner | 40 |
| Finalist | 30 |
| Semifinalist | 25 |
| Quarterfinalist | 20 |
| Round of 16 | 15 |
| Round of 32 | 10 |
| Round of 64 | 5 |

**Match Stat Points**
| Stat | Points |
|---|---|
| Aces | +0.25 per ace |
| Double faults | -0.5 per double fault |
| Break points won | +0.5 per break |
| Straight-sets win | +5 |

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Grand Slam Budget | BUDGET_PICK | $5M budget, 8-player roster |
| Grand Slam Bracket | BRACKET_PICK_EM | Round values [1, 2, 4, 8, 16, 32, 64] |

---

## Soccer

**Contest Type:** SINGLE_EVENT, SEASON_LONG
**Selection Types:** Snake Draft, Tiered, Budget Pick, Bracket Pick'em

### Contest Formats

**Season Snake Draft**
- Draft individual players for a full league season
- Weekly scoring from match stats

**Champions League Bracket**
- Predict UCL knockout bracket
- Bonus for predicting correct score

**Tournament Survivor**
- Pick winners during knockout stage

### Scoring: EPL DFS Standard

**Attacking**
| Stat | Points |
|---|---|
| Goal scored | +6 |
| Assist | +4 |
| Shot on target | +0.5 |
| Key pass | +0.5 |

**Defending**
| Stat | Points |
|---|---|
| Clean sheet (GK) | +6 |
| Clean sheet (DEF) | +4 |
| Tackle | +0.5 |
| Interception | +0.5 |
| Save | +1 |
| Penalty save | +5 |

**Penalties**
| Stat | Points |
|---|---|
| Yellow card | -1 |
| Red card | -3 |
| Own goal | -2 |
| Penalty missed | -2 |

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Season Snake (11 rounds) | SNAKE_DRAFT | 11 rounds, 90s per pick, live mode |
| UCL Bracket | BRACKET_PICK_EM | Round values [2, 4, 8, 16], correct score bonus +3 |

---

## NASCAR

**Contest Type:** SEASON_LONG
**Selection Types:** Snake Draft, Pick'em (Survivor)

### Contest Formats

**Season Snake Draft**
- Draft drivers for the full season
- Best 3 of 4 scores count per race weekend

**Season Survivor**
- Pick one driver per race to finish in top 10
- Wrong pick = eliminated
- Each driver usable only once per season
- 1 strike allowed before elimination

**Season Pick'em**
- Predict race outcomes across the season

### Scoring: DFS Place Differential

**Finish Position Points**
| Position | Points |
|---|---|
| 1st | 45 |
| 2nd | 42 |
| 3rd | 41 |
| 4th-10th | 37 |
| 11th-20th | 27 |
| 21st-30th | 17 |
| 31st-40th | 7 |

**Stat Points**
| Stat | Points |
|---|---|
| Place differential | +/-1 per position gained/lost vs. start |
| Fastest lap | +0.45 per fastest lap |
| Laps led | +0.25 per lap |
| Stage win | +4 per stage |
| Led most laps | +2 |

**Bonus:** Led any lap: +2 pts

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Snake Draft (4 rounds) | SNAKE_DRAFT | 4 rounds, 120s per pick, async, best 3 of 4 |
| Season Survivor | PICK_EM | 1 pick/race, one-and-done, 1 strike |

---

## Horse Racing

**Contest Type:** SINGLE_EVENT
**Selection Types:** Snake Draft, Tiered, Budget Pick, Bracket Pick'em

### Contest Formats

**Tiered Pick Pool**
- Horses grouped into tiers by odds
- Pick 1 horse per tier

**Budget Pick Pool**
- Each horse priced by odds
- Build stable within salary cap

**Snake Draft**
- Exclusive pre-race draft of horses

**Pick'em Bracket**
- Predict race outcomes

### Scoring: Finish Position

| Finish | Points |
|---|---|
| 1st (Win) | 100 |
| 2nd (Place) | 60 |
| 3rd (Show) | 40 |
| 4th | 25 |
| 5th | 15 |
| 6th-10th | 5 |

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Tiered by Odds | TIERED | 4 tiers, 1 per tier, odds-based |
| Budget Derby | BUDGET_PICK | $2M budget, 4-horse roster, odds-based pricing |

---

## Source Files

- Scoring templates: `packages/core-api/src/modules/scoring/templates/`
- Selection templates: `packages/core-api/src/modules/drafts/templates/selection-templates.ts`
- Contest structures specification: `plans/archive/2026-04-completed-wave/02a-poolmaster-contest-structures.md`
- Scoring config schemas: `packages/shared/domain/scoring-config.ts`
- Domain enums: `packages/shared/domain/enums.ts`
