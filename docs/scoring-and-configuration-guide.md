# PoolMaster Scoring & Configuration Guide

A complete reference for commissioners setting up contests — how each configuration option affects scoring, draft mechanics, and the player experience.

---

## Table of Contents

1. [Contest Setup Overview](#1-contest-setup-overview)
2. [Selection Types (How Players Pick)](#2-selection-types)
3. [Scoring Types (How Points Are Calculated)](#3-scoring-types)
4. [Scoring Rules in Detail](#4-scoring-rules-in-detail)
5. [Sport-Specific Scoring Templates](#5-sport-specific-scoring-templates)
6. [Special Roster Slots](#6-special-roster-slots)
7. [DNF & Missed Cut Handling](#7-dnf--missed-cut-handling)
8. [Counting Methods](#8-counting-methods)
9. [Tiebreaker Configuration](#9-tiebreaker-configuration)
10. [Configuration Quick Reference](#10-configuration-quick-reference)

---

## 1. Contest Setup Overview

Every PoolMaster contest is built from three key decisions:

1. **Selection Type** — How do players build their roster or make their picks?
2. **Scoring Type** — How are points calculated from real-world results?
3. **Scoring Rules** — What specific stats, positions, or outcomes earn points?

The commissioner chooses a scoring template as a starting point. Every field is customizable after selection.

---

## 2. Selection Types

The selection type determines the draft or pick experience for all players in the contest.

### Snake Draft

Players take turns picking participants (athletes/teams) in a serpentine order. Each pick is exclusive — once someone is drafted, no other player can have them.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **Rounds** | How many picks each player gets | 15 rounds = 15-player roster |
| **Time Per Pick** | Seconds before auto-pick kicks in | 60s for live, 28800s (8hr) for async |
| **Draft Mode** | Live (real-time) or Async (hours per pick) | Live for draft parties, Async for busy leagues |
| **Auto-Pick Policy** | What happens when the clock runs out | Best Available, Player's Queue, or Random |

**Best for:** NFL fantasy, NBA fantasy, MLB fantasy — any sport where exclusive rosters matter.

### Tiered Pick

Participants are organized into tiers (groups). Players pick a set number from each tier. Picks are non-exclusive — multiple players can pick the same participant.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **Tier Definitions** | How many tiers and picks per tier | 4 tiers, 2 picks each = 8 total |
| **Tier Assignment** | How participants are sorted into tiers | By seed, world ranking, odds, or commissioner manual |

**Best for:** Golf majors (pick 2 from Tier 1, 2 from Tier 2...), NHL/NBA playoffs.

### Budget Pick

Each participant has a cost. Players build a roster within a salary cap. Non-exclusive — multiple players can pick the same participant.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **Budget** | Total salary cap | $50,000 |
| **Roster Size** | How many picks to make | 6 golfers, 9 drivers |
| **Pricing Method** | How costs are determined | By odds, seed, world ranking, season stats, or commissioner |

**Best for:** F1 season-long, DFS-style contests, golf pools with salary caps.

### Open Selection

Pick N participants from the entire field. No tiers, no budget, no draft order. Non-exclusive.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **Pick Count** | How many to select | "Pick 8" for NCAA tournament |

**Best for:** Simple office pools, NCAA "Pick 8" tournament pools.

### Pick'Em

Predict outcomes each period (week, round, day). No roster to manage — just pick winners.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **Picks Per Period** | How many picks each week/round | Pick all NFL games, or pick 5 |
| **Confidence Weighting** | Assign confidence points to picks | Rank picks 1-16 by confidence |

**Best for:** NFL weekly pick'em, confidence pools, any sport with regular matchups.

### Bracket Pick'Em

Submit a full bracket prediction before the event starts. All picks are locked at once.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **Start Round** | Which round the bracket begins | Round of 64, Sweet 16, Quarterfinals |
| **Round Values** | Points per correct pick per round | [1, 2, 4, 8, 16, 32] |

**Best for:** March Madness, NFL playoffs, NHL/NBA playoff brackets.

---

## 3. Scoring Types

The scoring type determines the fundamental way points are calculated.

### Cumulative

Points accumulate from player stats over time. The most common fantasy scoring method.

**How it works:** Each stat (touchdowns, goals, assists, etc.) has a point value. A player's fantasy score is the sum of all their stat points plus any bonuses minus any penalties.

**Used by:** NFL fantasy, NBA fantasy, Golf DFS, F1, NASCAR, Soccer/EPL, Tennis

### Stroke Play

Lower total strokes wins. The inverse of cumulative scoring — fewer points is better.

**How it works:** Each golfer's actual stroke count is their score. Missed cut golfers receive a penalty score (typically 80) for each unplayed round. The entry with the lowest combined strokes wins.

**Used by:** Golf office pools (e.g. "Pick 6, Use Best 4")

### Position

Points are awarded based purely on finish position. No individual stats tracked.

**How it works:** 1st place = 100 points, 2nd = 60, 3rd = 40, etc. The commissioner defines the point table.

**Used by:** Horse racing, simple F1 pools, simple NASCAR pools

### Bracket

Points for correctly predicting game/match outcomes in a tournament bracket.

**How it works:** Each correct prediction earns points based on the round. Later rounds are worth more. Optional upset bonuses reward correctly picking upsets.

**Used by:** NCAA March Madness, NFL playoff brackets, NHL/NBA playoff brackets

### Rotisserie (Roto)

Entries are ranked across stat categories. Your score is the sum of your rankings.

**How it works:** In a 10-team league with 9 categories, each team is ranked 1-10 in each category. First place in a category earns 10 points, last earns 1. Your total roto score is the sum across all categories. Highest total wins.

**Used by:** MLB fantasy (traditional), NBA 9-category leagues

### Head-to-Head

Weekly matchups between paired entries. Win/loss record determines standings.

**How it works:** Each week, your team's total fantasy points are compared against your opponent's. Higher score wins. Season standings are based on win-loss-tie record.

**Used by:** NFL fantasy leagues, NBA fantasy leagues

---

## 4. Scoring Rules in Detail

Every scoring configuration is built from these rule types. The commissioner can customize any of them.

### Stat Rules

The foundation of most scoring. Each stat has a point value.

| Field | What It Does | Example |
|-------|-------------|---------|
| **Stat Key** | Which real-world stat to track | `passing_td`, `birdie`, `goal_scored` |
| **Points Per Unit** | How many points per occurrence | 4 pts per passing TD, 6 pts per goal |
| **Unit Size** | How many units per point (for yardage) | 25 passing yards = 1 point (unit_size: 25) |
| **Condition** | Only award points if a threshold is met | Only count rushing yards if >= 50 |

**Example — NFL Passing:**
- Passing Yards: 1 point per 25 yards (0.04 per yard)
- Passing TD: 4 points each
- Interception: -2 points each

### Position Rules

Points awarded based on finish position in a race, tournament, or event.

| Field | What It Does | Example |
|-------|-------------|---------|
| **Position** | Exact finish position | 1st place = 25 points |
| **Position Range** | Range of positions worth the same | 11th-15th = 6 points each |
| **LAST** | Special: last place in the field | Last place = -10 points |

**Example — F1 Race:**
- 1st: 25 pts, 2nd: 18 pts, 3rd: 15 pts, ... 10th: 1 pt, 11th+: 0 pts

### Bonus Rules

Extra points awarded when a stat threshold is reached. Evaluated independently from stat rules.

| Field | What It Does | Example |
|-------|-------------|---------|
| **Trigger Stat** | Which stat to check | `passing_yards` |
| **Condition** | Threshold to trigger bonus | >= 300 |
| **Points** | Bonus points awarded | +3 points |

**Example — NFL Yardage Bonuses:**
- 300+ passing yards: +3 bonus
- 100+ rushing yards: +3 bonus
- 100+ receiving yards: +3 bonus

These are in addition to the per-yard points — they reward milestone performances.

### Penalty Rules

Negative points for undesirable events. Similar to stat rules but triggered by flag-style stats.

**Example — F1 Penalties:**
- Lost 10+ positions from grid: -5 points
- Lost 5-9 positions: -3 points
- Lost 3-4 positions: -2 points

### Multiplier Rules

Multiply a player's score based on their roster slot or other criteria.

| Mode | What It Does | Example |
|------|-------------|---------|
| **ALL** | Multiply entire score | 2x for all stats |
| **SLOT** | Multiply only if player is in a specific slot | Captain slot = 1.5x |
| **STAT** | Multiply a specific stat's contribution | 2x rushing TDs only |
| **POSITION** | Multiply only position-based points | 2x finish position points |

---

## 5. Sport-Specific Scoring Templates

### NFL Fantasy Football

Three variants available — the only difference is reception scoring:

| Template | Reception Points | Best For |
|----------|-----------------|----------|
| **Standard (Non-PPR)** | 0 per reception | Casual leagues, TD-heavy scoring |
| **PPR** | 1 per reception | Balanced leagues — rewards consistency |
| **Half-PPR** | 0.5 per reception | Most popular format overall |

**PPR impact:** Pass-catching running backs and high-volume receivers gain significant value. In a PPR league, a player with 8 catches for 60 yards and no TDs scores 14 points (8 + 6). In standard, that same line scores just 6 points.

**Common stat values (all formats):**
- Passing: 1 pt / 25 yards, 4 pts / TD, -2 / INT
- Rushing: 1 pt / 10 yards, 6 pts / TD
- Receiving: 1 pt / 10 yards, 6 pts / TD
- Kicking: 3 pts / FG (0-39), 4 pts / FG (40-49), 5 pts / FG (50+)
- Bonuses: +3 for 300+ passing, 100+ rushing, or 100+ receiving yards

### Golf — DFS Style

Per-hole scoring rewards aggressive play. Birdies are king in fantasy golf.

| Hole Result | Points |
|-------------|--------|
| Hole-in-One | +10 |
| Albatross | +8 |
| Eagle | +5 |
| Birdie | +3 |
| Par | +0.5 |
| Bogey | -0.5 |
| Double Bogey | -1 |
| Triple+ | -1.5 |

**Finish position bonus:** 1st = 30 pts, 2nd = 20 pts, down to 26th-30th = 1 pt.

**Streak bonuses:** 3+ consecutive birdies (+3), bogey-free round (+3), round of -5 or better (+5).

### Golf — Stroke Play (Office Pool)

Used by EasyOfficePools and most casual golf pools. Lower score is better.

| Setting | Default | What It Does |
|---------|---------|-------------|
| **Counting Method** | Best 4 of 6 | Only your 4 lowest-scoring golfers count |
| **Missed Cut Score** | 80 per round | Cut golfers get 80 for rounds 3 and 4 |

**Impact:** With "Pick 6, Use Best 4," you have insurance against missed cuts. If 2 of your 6 golfers miss the cut, your best 4 (who made the cut) still count. But if 3+ miss, you're forced to count penalty scores.

### F1

Combines finish position (matching real F1 championship points), spots vs. grid differentials, and performance stats.

| Category | Points |
|----------|--------|
| Race finish (1st-10th) | 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 |
| Laps led | 0.1 per lap |
| Fastest lap | +1 |
| Beat teammate | +3 |
| Classified finish (90%+ race) | +1 |
| Gained 10+ spots from grid | +5 bonus |
| Gained 5-9 spots | +3 bonus |
| Lost 10+ spots | -5 penalty |
| DNF | 0 (all points voided) |

**Impact:** Grid-to-finish differential makes qualifying strategy matter. A driver starting 15th and finishing 5th earns 10 position points plus a +5 SVG bonus = 15 extra points on top of their P5 finish points.

### NASCAR

Position-based with place differential and laps led rewarding dominant performances.

| Category | Points |
|----------|--------|
| Win | 45 pts |
| 2nd-3rd | 42, 41 |
| Place differential | ±1 pt per position gained/lost |
| Laps led | 0.25 per lap |
| Fastest lap | 0.45 per lap |
| Stage win | +4 |
| Led most laps | +2 |
| Led any lap | +2 bonus |

### NCAA March Madness Bracket

Four bracket scoring systems available:

| System | Round 1 | Round 2 | Sweet 16 | Elite 8 | Final 4 | Championship | Best For |
|--------|---------|---------|----------|---------|---------|-------------|----------|
| **Standard** | 1 | 2 | 4 | 8 | 16 | 32 | Most popular; champion pick matters most |
| **Flat** | 1 | 1 | 1 | 1 | 1 | 1 | Early rounds count as much as late |
| **Upset Bonus** | 1 + seed diff | 2 + seed diff | ... | ... | ... | ... | Rewards bold picks |
| **Seed Multiplier** | 1 x seed | 2 x seed | 4 x seed | ... | ... | ... | Higher seeds = more points |

**Upset Bonus example:** You correctly pick a 12-seed over a 5-seed in Round 1. You get 1 point for the correct pick plus 7 upset bonus (12 - 5) = 8 points total. Picking a 1-seed correctly gives just 1 point (no upset).

**Seed Multiplier example:** Correctly picking a 14-seed to win in Round 1 = 1 x 14 = 14 points. A 1-seed correct pick = 1 x 1 = 1 point. This dramatically rewards risky picks.

**Tiebreaker:** Predict the total combined score of the championship game. Closest prediction wins the tiebreaker.

### NBA Points League

Stat-based scoring similar to fantasy football.

| Stat | Points |
|------|--------|
| Points scored | 1 |
| Rebounds | 1.25 |
| Assists | 1.5 |
| Steals | 2 |
| Blocks | 2 |
| 3-Pointers Made | +0.5 |
| Turnovers | -1 |
| Double-Double | +1.5 bonus |
| Triple-Double | +3 bonus |

**Impact:** Assists and rebounds are worth more than raw points, making well-rounded players (like Jokic or Giannis) more valuable than pure scorers. A 30-point, 15-rebound, 10-assist triple-double scores 79 fantasy points.

### Tennis (Grand Slam DFS)

Combines tournament advancement with match-level stats.

| Category | Points |
|----------|--------|
| Tournament Winner | 40 |
| Finalist | 30 |
| Semifinal exit | 25 |
| Quarterfinal exit | 20 |
| Round of 16 exit | 15 |
| Aces | 0.25 each |
| Double faults | -0.5 each |
| Break points won | 0.5 each |
| Straight-sets win | +5 bonus |

### Horse Racing

Pure position-based scoring. Simple and straightforward.

| Finish | Points |
|--------|--------|
| 1st (Win) | 100 |
| 2nd (Place) | 60 |
| 3rd (Show) | 40 |
| 4th | 25 |
| 5th | 15 |
| 6th-10th | 5 |
| 11th+ | 0 |

### EPL / Soccer

DFS-style scoring with position-aware rules. Goalkeepers and defenders earn more for clean sheets; forwards earn more for goals.

| Stat | Points |
|------|--------|
| Goal scored | 6 |
| Assist | 4 |
| Shot on target | 0.5 |
| GK clean sheet | 6 |
| Defender clean sheet | 4 |
| Save (GK) | 1 |
| Penalty save | 5 |
| Tackle | 0.5 |
| Yellow card | -1 |
| Red card | -3 |
| Own goal | -2 |

---

## 6. Special Roster Slots

Some contest formats allow special roster slots that multiply a player's score.

| Slot | Typical Multiplier | How It Works |
|------|-------------------|-------------|
| **Captain** | 1.5x | One player designated as captain scores 1.5x points |
| **MVP** | 2.0x | One player designated MVP scores double points |
| **Double Down** | 2.0x | "Lock in" one player for 2x — high risk, high reward |

**Cost multiplier:** In budget-pick contests, a captain slot player may also cost 1.5x their normal salary, balancing the scoring advantage.

**Position eligibility:** Commissioners can restrict which positions are eligible for special slots (e.g. only QBs and RBs for MVP).

**Impact on strategy:** The captain/MVP pick often decides the contest. In a DFS-style F1 contest, making the race winner your captain adds 50% more points to an already high score. Picking the wrong captain can drop you from contention entirely.

---

## 7. DNF & Missed Cut Handling

What happens when a participant doesn't finish — DNF in racing, missed cut in golf, injury in football.

| Policy | What Happens | Best For |
|--------|-------------|----------|
| **Zero** | Participant scores 0 points | Default for most sports |
| **Exclude** | Participant is removed from scoring; only remaining players count | Golf with Best-N counting |
| **Last Place** | Participant receives last-place finish points | Harsh penalty, discourages risky picks |
| **Penalty** | Participant receives a specific negative point value | Configurable severity |
| **Missed Cut Score** | Assign a fixed stroke score (e.g. 80) per missed round | Golf stroke play only |

**Golf missed cut example:** A golfer shoots 76-77 and misses the Friday cut. With "Missed Cut Score = 80," their total becomes 76 + 77 + 80 + 80 = 313. This is significantly worse than a golfer who made the cut and shot 290, punishing the missed cut while still giving a countable score.

**Exclude + Best-N interaction:** If your counting method is "Best 4 of 6" and one golfer is excluded (missed cut with Exclude policy), you pick the best 4 from your remaining 5 golfers. This is more forgiving than the penalty-score approach.

---

## 8. Counting Methods

How individual participant scores are aggregated into your entry's total.

### All

Every participant on your roster counts. Simple and transparent.

**Best for:** NFL fantasy (all starters count), NBA daily fantasy, any sport where you want all picks to matter.

### Best N

Only your top N participants count. The rest are insurance.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **best_n** | How many scores count | Pick 6, Best 4 = only your 4 best scores count |

**Best for:** Golf office pools ("Pick 6, Use Best 4"), contests where you want to protect against missed cuts or bad performances.

**Strategy impact:** With Best-N, you can afford to take risks on boom-or-bust players since their bad weeks get dropped. With All counting, consistency is more important.

### Drop Lowest N

All participants count except your worst N scores.

| Setting | What It Does | Example |
|---------|-------------|---------|
| **drop_lowest_n** | How many worst scores to drop | 10 golfers, drop 2 = 8 count |

**Best for:** Similar to Best-N but phrased differently. "Drop your worst 2" feels different than "Use your best 8" even though they're equivalent in a 10-player roster.

### Lower Is Better

For stroke play (golf), the lowest score wins instead of the highest. This flag inverts all counting logic — "Best N" takes the N lowest scores, and "Drop Lowest" drops the N highest.

---

## 9. Tiebreaker Configuration

When two or more entries have the same score, tiebreakers determine the winner. Commissioners set up a chain — if the first tiebreaker is still tied, it falls through to the second, then the third.

| Method | How It Works | Best For |
|--------|-------------|----------|
| **Championship Score Prediction** | Predict the total score of the final game; closest wins | March Madness, NFL playoff brackets |
| **Most Correct Picks** | More individual correct predictions wins | Bracket pools, pick'em |
| **Earlier Submission** | Whoever submitted their picks first wins | Rewards decisiveness |
| **Best Single Score** | Highest individual event/week score wins | Season-long fantasy |
| **Most Birdies** | Total birdies (or better) across the tournament | Golf pools |
| **Lowest Round** | Best single round score wins | Golf pools |
| **Head-to-Head Record** | Better H2H record against tied opponent wins | Season-long H2H leagues |
| **Most Wins** | Most weekly wins in the season | Season-long leagues |
| **Coin Flip** | Random — fair for casual pools | Casual / fun leagues |
| **Commissioner Decision** | Commissioner decides manually | Ultimate flexibility |

**Example chain:** Primary: Most Correct Picks → Secondary: Earlier Submission → Tertiary: Coin Flip

This means: if two entries are tied on score, the one with more correct picks wins. If they also have the same number of correct picks, the one who submitted earlier wins. If they submitted at the same time (unlikely), it's a coin flip.

---

## 10. Configuration Quick Reference

### Choosing Your Template

| If your pool is... | Use this template | Selection type |
|--------------------|-------------------|----------------|
| NFL fantasy league | `nfl_ppr` or `nfl_half_ppr` | Snake Draft |
| Golf major (casual) | `golf_stroke_pick6_use4` | Tiered or Open Selection |
| Golf major (DFS) | `golf_dfs_standard` | Budget Pick |
| March Madness bracket | `ncaa_bracket_standard` | Bracket Pick'Em |
| March Madness (reward upsets) | `ncaa_bracket_upset_bonus` | Bracket Pick'Em |
| NFL weekly pick'em | Cumulative + pick'em | Pick'Em |
| NFL Survivor | Knockout | Pick'Em (Survivor style) |
| F1 race | `f1_dfs_captain` | Budget Pick |
| NBA fantasy | `nba_points_league` | Snake Draft |
| Kentucky Derby | `horse_racing_position` | Tiered or Open Selection |
| EPL fantasy | `epl_dfs_standard` | Budget Pick |

### Key Settings Cheat Sheet

| Setting | When to change it | Default |
|---------|------------------|---------|
| PPR vs Standard | Always decide before the draft — it changes player values | Half-PPR |
| Best N | Golf pools — pick more than you need for insurance | All |
| Missed Cut Score | Golf stroke play — higher = harsher penalty | 80 |
| Upset Bonus | Bracket pools where you want bold picks rewarded | Off |
| Confidence Weighting | Pick'em pools — adds strategic depth | Off |
| Captain Slot | DFS-style contests — adds high-risk/reward element | Off |
| Tiebreaker | Always set for bracket pools — ties are common | None |
