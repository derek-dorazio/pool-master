# Ultimate Pool Manager — Contest Rules by Sport

This document defines all contest types, selection methods, scoring rules, and special mechanics for each supported sport.

Deferred features (season-long fantasy, NFL player scoring, DFS, advanced stats) are documented in [plans/deferred/contest-rules-deferred.md](deferred/contest-rules-deferred.md).

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
| **SINGLE_EVENT** | One tournament, race, or playoff series (e.g., The Masters, March Madness, F1 race) |

> SEASON_LONG removed — all contests are single-event. Survivor and pick'em pools that span a season are treated as one "event" (enter once, no weekly management).

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

| Option | Description |
|---|---|
| **Live Pick** | One pick per period, submitted before each begins |
| **Locked Pick** | All picks submitted upfront before the event starts |
| **One-and-Done** | Each team/player usable only once |
| **Strikes** | 0 = instant elimination; 1-3 = allowed wrong picks before out |

> Double pick and buybacks deferred to a future phase.

### Tiebreaker Rules

- **Bracket contests:** Predicted championship game total score
- **Survivor:** Highest cumulative score among remaining players
- **Points-based:** Head-to-head record, then most recent round/week score

---

## Golf

**Contest Type:** SINGLE_EVENT
**Selection Types:** Snake Draft, Tiered, Budget Pick

### Contest Formats

**Tiered Pick Pool**
- 4-10 tiers grouped by world ranking or odds
- Pick 1 golfer per tier
- Best N scores count (e.g., pick 6, use best 4)
- Score is relative to par: birdie = -1, eagle = -2, bogey = +1, etc.
- Lowest combined score wins
- Non-exclusive (multiple managers can pick the same golfer)
- No missed-cut penalty needed — players who miss the cut already have high relative-to-par scores

**Budget Pick Pool**
- Each golfer priced based on ranking/odds
- Roster size configurable (e.g., 6-8 golfers within budget)
- Best N scores count
- Score is relative to par
- Lowest combined score wins

**Snake Draft**
- Exclusive pre-tournament snake draft
- Score is relative to par per hole
- Lowest total combined score wins

### Scoring: Relative to Par

| Result | Score |
|---|---|
| Hole-in-one | -3 |
| Albatross (double eagle) | -3 |
| Eagle | -2 |
| Birdie | -1 |
| Par | 0 |
| Bogey | +1 |
| Double bogey | +2 |
| Triple bogey or worse | +3 |

**Counting:** Best N of M (configurable). Lower is better.
**Missed cut:** No penalty — player's high score naturally falls out of best N.

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Snake Draft (4 rounds) | SNAKE_DRAFT | 4 rounds, 120s per pick, async |
| Tiered Pick 6 Use 4 | TIERED | 6 tiers, 1 per tier, best 4 count, odds-based |
| Budget $50K | BUDGET_PICK | $50K budget, 6-golfer roster, best 4 count, odds-based pricing |

---

## NFL

**Contest Type:** SINGLE_EVENT (team-based only)
**Selection Types:** Pick'em, Survivor

> NFL player-based fantasy scoring (PPR, Standard, Half-PPR) is deferred. Too many stat categories, and the market is already saturated by ESPN, Yahoo, DraftKings. NFL contests use team-based formats only.

### Contest Formats

**Survivor Pool**
- Pick one NFL team per week to win straight-up (no spread)
- Wrong pick = eliminated
- Each team usable only once
- Configurable: strikes (0-3)

**Confidence Pick'em**
- Pick all game winners each week
- Assign confidence points (16 = most confident, 1 = least)
- More confident correct picks earn more points

### Scoring

Team-based — no player stat scoring needed. Winners determined by game results.

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Survivor | PICK_EM | 1 pick/week, one-and-done, 0 strikes |
| Confidence Pick'em | PICK_EM | 16 picks/week, confidence-weighted |

---

## NBA

**Contest Type:** SINGLE_EVENT (playoffs only)
**Selection Types:** Tiered, Budget Pick, Bracket Pick'em, Survivor

> Season-long NBA fantasy draft removed. Focus on playoff pools.

### Contest Formats

**Playoffs Tiered Pool**
- Tiers by seed: 1-2, 3-4, 5-6, 7-8
- Pick 1 team per tier
- Points per series win with round multipliers (1x, 2x, 4x, 8x)

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

### Scoring: Simple Points

| Stat | Points |
|---|---|
| Points scored | +1 |
| Assists | +1.5 |
| Rebounds | +1.25 |

> Advanced stats (steals, blocks, turnovers, double/triple-double bonuses) deferred.

### Selection Templates

| Template | Type | Config |
|---|---|---|
| Playoff Tiers | TIERED | 4 tiers by seed, 1 pick per tier |

---

## NCAA Basketball

**Contest Type:** SINGLE_EVENT
**Selection Types:** Bracket Pick'em, Tiered, Budget Pick, Open Selection, Survivor

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

**Contest Type:** SINGLE_EVENT (per-race)
**Selection Types:** Budget Pick

> Season-long F1 fantasy draft deferred. Focus on per-race pools.

### Contest Formats

**Race Budget Pick**
- Build a driver roster within budget for a single race
- Pricing based on world rankings

### Scoring: Position + Stats

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
| Race Budget | BUDGET_PICK | $10M budget, 5-driver roster |

---

## Tennis

**Contest Type:** SINGLE_EVENT
**Selection Types:** Budget Pick, Bracket Pick'em

### Contest Formats

**Grand Slam Squad Selection** (Budget)
- Build roster for a single tournament
- Score based on rounds won and match stats

**Grand Slam Bracket**
- Predict tournament bracket from Round of 128

### Scoring: Tournament Position + Match Stats

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

**Contest Type:** SINGLE_EVENT (tournament/cup play)
**Selection Types:** Bracket Pick'em

> Season-long EPL fantasy draft removed. Focus on tournament brackets (Champions League, World Cup).

### Contest Formats

**Champions League Bracket**
- Predict UCL knockout bracket
- Bonus for predicting correct score

**Tournament Survivor**
- Pick winners during knockout stage

### Scoring: Goals + Assists

| Stat | Points |
|---|---|
| Goal scored | +6 |
| Assist | +4 |
| Yellow card | -1 |
| Red card | -3 |
| Own goal | -2 |

> Advanced stats (tackles, interceptions, saves, clean sheets) deferred — hard to source reliably.

### Selection Templates

| Template | Type | Config |
|---|---|---|
| UCL Bracket | BRACKET_PICK_EM | Round values [2, 4, 8, 16], correct score bonus +3 |

---

## NASCAR

**Contest Type:** SINGLE_EVENT (per-race)
**Selection Types:** Snake Draft, Survivor

### Contest Formats

**Race Snake Draft**
- Draft drivers for a single race
- Best 3 of 4 scores count

**Race Survivor**
- Pick one driver per race to finish in top 10
- Wrong pick = eliminated
- Each driver usable only once
- 1 strike allowed before elimination

### Scoring: Position + Place Differential

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
| Race Survivor | PICK_EM | 1 pick/race, one-and-done, 1 strike |

---

## Horse Racing

**Contest Type:** SINGLE_EVENT
**Selection Types:** Tiered, Budget Pick

### Contest Formats

**Tiered Pick Pool**
- Horses grouped into tiers by odds
- Pick 1 horse per tier

**Budget Pick Pool**
- Each horse priced by odds
- Build stable within salary cap

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
- Scoring config schema: `packages/shared/domain/scoring-config.ts`
- Domain enums: `packages/shared/domain/enums.ts`
- Deferred features: `plans/deferred/contest-rules-deferred.md`
