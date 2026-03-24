# PoolMaster — Scoring Rules Configuration Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

This document defines the full scoring rule framework PoolMaster must support. The system must be sport-agnostic: scoring rules are stored as configurable JSON, interpreted by a scoring engine at runtime. No sport logic is hard-coded. Research sources include DraftKings, FanDuel, ESPN, FantasyPros, Splash Sports, BuzzFantasyGolf, EasyOfficePools, PoolTracker, and PoolGenius.

---

## 1. Scoring Architecture

All scoring is driven by a `ScoringConfig` object stored per contest. The scoring engine reads this config, consumes stat events, and produces points.

```typescript
interface ScoringConfig {
  contest_id: string;
  sport: string;
  scoring_type: 'CUMULATIVE' | 'KNOCKOUT' | 'BRACKET' | 'STROKE_PLAY' | 'POSITION';
  
  stat_rules: StatRule[];              // point awards per stat event
  position_rules: PositionRule[];      // point awards per finish position
  bonus_rules: BonusRule[];            // conditional bonus points
  penalty_rules: PenaltyRule[];        // negative point conditions
  multiplier_rules: MultiplierRule[];  // multipliers on top of base rules
  tiebreaker_config: TiebreakerConfig;
  
  // Special handling
  missed_event_score?: number;         // e.g. golf missed cut = 80 strokes
  missed_event_points?: number;        // alternative: missed cut = -5 points
  dnf_handling: 'ZERO' | 'LAST_PLACE' | 'PENALTY' | 'EXCLUDE';
  
  // Aggregation
  counting_method: 'ALL' | 'BEST_N' | 'DROP_LOWEST_N';
  best_n?: number;                     // for BEST_N: how many participants count
  drop_lowest_n?: number;              // for DROP_LOWEST_N: how many to exclude
}

interface StatRule {
  stat_key: string;                    // stat name, sport-specific
  points_per_unit: number;             // e.g. 0.1 per rushing yard
  unit_size?: number;                  // e.g. 10 yards = 1 point → unit_size = 10
  condition?: RuleCondition;           // optional threshold condition
  description: string;
}

interface PositionRule {
  position: number | 'LAST' | 'CUT';
  points: number;
  position_range?: [number, number];   // range of positions all worth same points
}

interface BonusRule {
  trigger: BonusTrigger;               // what stat or condition triggers the bonus
  points: number;
  description: string;
}

interface PenaltyRule {
  trigger: string;                     // stat key
  points: number;                      // negative value
  description: string;
}

interface MultiplierRule {
  applies_to: 'ALL' | 'STAT' | 'POSITION' | 'SLOT';
  slot_id?: string;                    // for captain/multiplier slot in DFS
  stat_key?: string;
  multiplier: number;                  // e.g. 1.5 for captain, 2.0 for double-down
}

interface RuleCondition {
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
  value: number;
  value2?: number;                     // for 'between'
}
```

---

## 2. Sport-Specific Scoring Configurations

### 2.1 NFL Fantasy Football

No universal scoring system exists, but the foundation remains steady in nearly every format: points are awarded based on actual plays and stats from NFL games.

#### Standard (Non-PPR) Scoring

```typescript
const nflStandardScoring: ScoringConfig = {
  sport: 'NFL',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    // Offense — Passing
    { stat_key: 'passing_yards', points_per_unit: 0.04, unit_size: 1, description: '1 pt per 25 passing yards' },
    { stat_key: 'passing_td', points_per_unit: 4, description: '4 pts per passing TD' },
    { stat_key: 'interception_thrown', points_per_unit: -2, description: '-2 pts per interception' },
    { stat_key: 'passing_2pt_conversion', points_per_unit: 2, description: '+2 pts per 2-pt conversion pass' },
    
    // Offense — Rushing
    { stat_key: 'rushing_yards', points_per_unit: 0.1, description: '1 pt per 10 rushing yards' },
    { stat_key: 'rushing_td', points_per_unit: 6, description: '6 pts per rushing TD' },
    { stat_key: 'rushing_2pt_conversion', points_per_unit: 2 },
    { stat_key: 'fumble_lost', points_per_unit: -2, description: '-2 pts per fumble lost' },
    
    // Offense — Receiving
    { stat_key: 'receiving_yards', points_per_unit: 0.1, description: '1 pt per 10 receiving yards' },
    { stat_key: 'receiving_td', points_per_unit: 6, description: '6 pts per receiving TD' },
    { stat_key: 'receiving_2pt_conversion', points_per_unit: 2 },
    // NOTE: no reception points in Standard (non-PPR)
    
    // Kicker
    { stat_key: 'fg_made_0_39', points_per_unit: 3, description: 'FG 0-39 yards' },
    { stat_key: 'fg_made_40_49', points_per_unit: 4, description: 'FG 40-49 yards' },
    { stat_key: 'fg_made_50_plus', points_per_unit: 5, description: 'FG 50+ yards' },
    { stat_key: 'fg_missed', points_per_unit: -1, description: 'Missed FG' },
    { stat_key: 'pat_made', points_per_unit: 1, description: 'Extra point' },
    { stat_key: 'pat_missed', points_per_unit: -1, description: 'Missed extra point' },
  ],
  bonus_rules: [
    { trigger: { stat_key: 'passing_yards', condition: { operator: 'gte', value: 300 } }, points: 3, description: '300+ passing yard bonus' },
    { trigger: { stat_key: 'rushing_yards', condition: { operator: 'gte', value: 100 } }, points: 3, description: '100+ rushing yard bonus' },
    { trigger: { stat_key: 'receiving_yards', condition: { operator: 'gte', value: 100 } }, points: 3, description: '100+ receiving yard bonus' },
  ],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
};
```

#### PPR (Points Per Reception) Variant

PPR scoring adds 1 point per reception (or 0.5 for half-PPR). This significantly changes player values, particularly for pass-catching running backs and high-volume receivers. PPR leagues favor consistent volume while Standard (non-PPR) leagues favor big plays and touchdowns.

```typescript
const pprAddition: StatRule = {
  stat_key: 'reception',
  points_per_unit: 1.0,   // or 0.5 for half-PPR
  description: '1 pt per reception (PPR)',
};
```

#### Available NFL Scoring Variants

| Format | Key Difference | Best For |
|---|---|---|
| Standard | No reception points | Casual leagues |
| PPR | 1 pt per reception | Balanced leagues |
| Half-PPR | 0.5 pts per reception | Most popular overall |
| Superflex | 2 QBs start; QBs worth more | Experienced leagues |
| IDP (Individual Defensive Players) | Defense players also score | Deep leagues |
| Best Ball | No lineup management; auto-use top performers | Set-and-forget |
| Dynasty | Multi-year, carry players and rookie picks | Long-term leagues |

---

### 2.2 Golf (PGA Tour / Majors)

In DFS golf, golfers score points for individual holes and for streaks and bonuses. Birdies are king in fantasy golf, and generally, winning players will distance themselves from the pack with birdies scored. The cut is a concept unique to golf — more than half the field is eliminated on Friday.

#### DraftKings-Style Golf Scoring

```typescript
const golfDraftKingsScoring: ScoringConfig = {
  sport: 'GOLF',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    // Per-hole scoring
    { stat_key: 'hole_in_one', points_per_unit: 10, description: 'Hole in one' },
    { stat_key: 'albatross', points_per_unit: 8, description: 'Albatross (double eagle)' },
    { stat_key: 'eagle', points_per_unit: 5, description: 'Eagle' },
    { stat_key: 'birdie', points_per_unit: 3, description: 'Birdie' },
    { stat_key: 'par', points_per_unit: 0.5, description: 'Par' },
    { stat_key: 'bogey', points_per_unit: -0.5, description: 'Bogey' },
    { stat_key: 'double_bogey', points_per_unit: -1, description: 'Double bogey' },
    { stat_key: 'triple_bogey_or_worse', points_per_unit: -1.5, description: 'Triple bogey or worse' },
  ],
  position_rules: [
    { position: 1, points: 30 },
    { position: 2, points: 20 },
    { position: 3, points: 18 },
    { position: 4, points: 16 },
    { position: 5, points: 14 },
    { position: 6, points: 12 },
    { position: 7, points: 10 },
    { position: 8, points: 9 },
    { position: 9, points: 8 },
    { position: 10, points: 7 },
    { position_range: [11, 15], points: 6 },
    { position_range: [16, 20], points: 4 },
    { position_range: [21, 25], points: 2.5 },
    { position_range: [26, 30], points: 1 },
  ],
  bonus_rules: [
    // Streak bonuses
    { trigger: { stat_key: 'consecutive_birdies', condition: { operator: 'gte', value: 3 } }, points: 3, description: '3+ consecutive birdies' },
    { trigger: { stat_key: 'bogey_free_round', condition: { operator: 'eq', value: 1 } }, points: 3, description: 'Bogey-free round' },
    { trigger: { stat_key: 'round_score', condition: { operator: 'lte', value: -5 } }, points: 5, description: 'Round of -5 or better' },
  ],
  missed_event_points: 0,              // no points for missed cut
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
};
```

#### Office Pool Golf Scoring (Stroke-Based)

Used by EasyOfficePools and most casual golf pools. Lower score is better. Missed cut = penalty score.

```typescript
const golfOfficepoolScoring: ScoringConfig = {
  sport: 'GOLF',
  scoring_type: 'STROKE_PLAY',        // lower is better
  stat_rules: [
    { stat_key: 'total_strokes', points_per_unit: 1, description: 'Count actual strokes' },
  ],
  missed_event_score: 80,             // cut golfers assigned 80 for rounds 3+4
  counting_method: 'BEST_N',         // "Pick 6, Use 4" — best 4 of 6 scores count
  best_n: 4,
  lower_is_better: true,             // for stroke play: lowest combined score wins
};
```

---

### 2.3 Formula 1 (F1)

F1 fantasy scoring combines finish position points (matching the real F1 World Championship system), spots vs. grid position differentials, laps led, and classified finish bonuses.

```typescript
const f1DraftKingsScoring: ScoringConfig = {
  sport: 'F1',
  scoring_type: 'CUMULATIVE',
  position_rules: [
    { position: 1, points: 25 },    // matches real F1 championship
    { position: 2, points: 18 },
    { position: 3, points: 15 },
    { position: 4, points: 12 },
    { position: 5, points: 10 },
    { position: 6, points: 8 },
    { position: 7, points: 6 },
    { position: 8, points: 4 },
    { position: 9, points: 2 },
    { position: 10, points: 1 },
    // 11th–20th: 0 finish position points
  ],
  stat_rules: [
    { stat_key: 'laps_led', points_per_unit: 0.1, description: '0.1 pt per lap led' },
    { stat_key: 'classified_finish', points_per_unit: 1, description: '1 pt for completing 90%+ of race' },
    { stat_key: 'fastest_lap', points_per_unit: 1, description: '1 pt for setting fastest lap' },
    { stat_key: 'beat_teammate', points_per_unit: 3, description: '+3 pts for beating teammate in race' },
  ],
  bonus_rules: [
    // Spots vs. Grid (SVG) — positional gains scored in blocks
    { trigger: { stat_key: 'spots_gained', condition: { operator: 'gte', value: 10 } }, points: 5, description: '+10 spots gained' },
    { trigger: { stat_key: 'spots_gained', condition: { operator: 'between', value: 5, value2: 9 } }, points: 3, description: '+5–9 spots gained' },
    { trigger: { stat_key: 'spots_gained', condition: { operator: 'between', value: 3, value2: 4 } }, points: 2, description: '+3–4 spots gained' },
  ],
  penalty_rules: [
    { trigger: 'spots_lost_10_plus', points: -5, description: '-10+ spots lost' },
    { trigger: 'spots_lost_5_9', points: -3, description: '-5–9 spots lost' },
    { trigger: 'spots_lost_3_4', points: -2, description: '-3–4 spots lost' },
  ],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
};
```

#### Season-Long F1 Format

In season-long formats, each driver and constructor has a price, and rosters must fit within a budget. Prices change during the season based on performance and popularity. Transfer limits apply (usually 3 free transfers per race weekend).

---

### 2.4 NASCAR

Fantasy NASCAR scoring rewards finish position, place differential (starting vs. finishing position), laps led, fastest laps, and stage wins.

```typescript
const nascarDraftKingsScoring: ScoringConfig = {
  sport: 'NASCAR',
  scoring_type: 'CUMULATIVE',
  position_rules: [
    { position: 1, points: 45 },
    { position: 2, points: 42 },
    { position: 3, points: 41 },
    // -1 per position through field
    { position_range: [4, 40], points: 40 }, // calculated as 44 - position
  ],
  stat_rules: [
    { stat_key: 'place_differential', points_per_unit: 1, description: '±1 pt per position gained/lost vs. start' },
    { stat_key: 'fastest_lap', points_per_unit: 0.45, description: '0.45 pts per fastest lap' },
    { stat_key: 'laps_led', points_per_unit: 0.25, description: '0.25 pts per lap led' },
    { stat_key: 'stage_win', points_per_unit: 4, description: '4 pts per stage win' },
    { stat_key: 'led_most_laps', points_per_unit: 2, description: '+2 pts for leading most laps' },
  ],
  bonus_rules: [
    { trigger: { stat_key: 'laps_led', condition: { operator: 'gte', value: 1 } }, points: 2, description: 'Bonus for leading any lap' },
  ],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
};
```

---

### 2.5 NCAA March Madness (Bracket)

There are 6 rounds to the NCAA tournament. For each correct winner picked, a player is awarded points based on what round the winner is picked in. In most cases, the points per round increase as the tournament progresses.

#### Standard Bracket Scoring (CBS/Yahoo/NCAA.com default)

```typescript
const ncaaStandardScoring: ScoringConfig = {
  sport: 'NCAA_BASKETBALL',
  scoring_type: 'BRACKET',
  stat_rules: [], // not stat-based
  position_rules: [], // not position-based
  bracket_round_rules: [
    { round: 1, round_name: 'Round of 64', points_per_correct: 1 },
    { round: 2, round_name: 'Round of 32', points_per_correct: 2 },
    { round: 3, round_name: 'Sweet 16', points_per_correct: 4 },
    { round: 4, round_name: 'Elite Eight', points_per_correct: 8 },
    { round: 5, round_name: 'Final Four', points_per_correct: 16 },
    { round: 6, round_name: 'Championship', points_per_correct: 32 },
  ],
  upset_bonus_config: null,           // no upset bonus in standard format
  tiebreaker_config: {
    type: 'CHAMPIONSHIP_TOTAL_SCORE', // predict final score of championship game
  },
};
```

#### Upset Bonus Bracket Scoring

Pools with upset bonuses award participants extra points if they correctly pick a team to advance and they beat a better-seeded team. A flat bonus amount is awarded for correctly picking upsets. If a player correctly picks a 12 seed to beat a 5 seed in the first round, they get 1 point for the first-round matchup plus 7 upset bonus points (12 seed - 5 seed), for a total of 8 points.

```typescript
const ncaaUpsetBonusScoring: ScoringConfig = {
  // ... same round rules as standard ...
  upset_bonus_config: {
    type: 'SEED_DIFFERENCE',           // bonus = winning_seed - losing_seed
    apply_round_multiplier: false,     // option: multiply bonus by round value
  },
};
```

#### Seed Multiplier Scoring

Instead of fixed points per round, this method multiplies the seed number by the round's point value. A #1 seed pick in the first round is worth 1 point, a #15 seed would be worth 15 points.

```typescript
const ncaaSeedMultiplierScoring = {
  upset_bonus_config: {
    type: 'SEED_MULTIPLIER',           // points = round_value × winning_seed
    apply_round_multiplier: true,
  },
};
```

#### Common Bracket Scoring Systems

| System | Round 1 | Round 2 | Round 3 | Round 4 | Round 5 | Round 6 | Best For |
|---|---|---|---|---|---|---|---|
| Standard (CBS/Yahoo) | 1 | 2 | 4 | 8 | 16 | 32 | Most popular; champion matters most |
| Flat | 1 | 1 | 1 | 1 | 1 | 1 | Early rounds matter as much as late |
| Exponential | 1 | 2 | 4 | 8 | 16 | 32 | Same as standard (most common) |
| Late Weight | 1 | 2 | 3 | 4 | 6 | 10 | Balanced; early rounds count more |
| Championship Heavy | 1 | 2 | 4 | 8 | 16 | 64 | Winner-take-all style |
| ESPN | 10 | 20 | 40 | 80 | 160 | 320 | Same ratio as standard, bigger numbers |

---

### 2.6 NBA Fantasy Basketball

Two main formats: Points League (stat-based, like fantasy football) and Category League (rotisserie-style, win/lose per stat category each week).

```typescript
const nbaPointsLeagueScoring: ScoringConfig = {
  sport: 'NBA',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    { stat_key: 'points', points_per_unit: 1, description: '1 pt per point scored' },
    { stat_key: 'rebounds', points_per_unit: 1.25, description: '1.25 pts per rebound' },
    { stat_key: 'assists', points_per_unit: 1.5, description: '1.5 pts per assist' },
    { stat_key: 'steals', points_per_unit: 2, description: '2 pts per steal' },
    { stat_key: 'blocks', points_per_unit: 2, description: '2 pts per block' },
    { stat_key: 'three_pointer_made', points_per_unit: 0.5, description: '+0.5 per 3PM' },
    { stat_key: 'turnover', points_per_unit: -1, description: '-1 per turnover' },
    { stat_key: 'double_double', points_per_unit: 1.5, description: '+1.5 bonus for double-double' },
    { stat_key: 'triple_double', points_per_unit: 3, description: '+3 bonus for triple-double' },
  ],
};

// Category League — 9 standard categories tracked as wins/losses per week
const nbaNineCategoryLeague = {
  sport: 'NBA',
  scoring_type: 'ROTISSERIE',
  categories: ['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV'],
  // Each category = head-to-head win/loss for the week
};
```

---

### 2.7 Tennis (Grand Slams & Season)

```typescript
const tennisDFSScoring: ScoringConfig = {
  sport: 'TENNIS',
  scoring_type: 'CUMULATIVE',
  position_rules: [
    { position: 1, points: 40, description: 'Tournament winner' },
    { position: 2, points: 30, description: 'Finalist' },
    { position_range: [3, 4], points: 25, description: 'Semifinalists' },
    { position_range: [5, 8], points: 20, description: 'Quarterfinals exit' },
    { position_range: [9, 16], points: 15, description: 'Round of 16 exit' },
    { position_range: [17, 32], points: 10, description: 'Round of 32 exit' },
    { position_range: [33, 64], points: 5, description: 'Round of 64 exit' },
  ],
  stat_rules: [
    { stat_key: 'aces', points_per_unit: 0.25, description: '0.25 pts per ace' },
    { stat_key: 'double_faults', points_per_unit: -0.5, description: '-0.5 per double fault' },
    { stat_key: 'break_points_won', points_per_unit: 0.5, description: '0.5 pts per break' },
    { stat_key: 'straight_sets_win', points_per_unit: 5, description: '+5 for straight-sets win' },
  ],
  dnf_handling: 'ZERO',
};
```

---

### 2.8 Horse Racing

```typescript
const horseRacingScoring: ScoringConfig = {
  sport: 'HORSE_RACING',
  scoring_type: 'POSITION',
  position_rules: [
    { position: 1, points: 100 },
    { position: 2, points: 60 },
    { position: 3, points: 40 },
    { position: 4, points: 25 },
    { position: 5, points: 15 },
    { position_range: [6, 10], points: 5 },
  ],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
};
```

---

### 2.9 EPL / Soccer

```typescript
const eplDFSScoring: ScoringConfig = {
  sport: 'EPL',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    // Attacking
    { stat_key: 'goal_scored', points_per_unit: 6, description: '6 pts per goal' },
    { stat_key: 'assist', points_per_unit: 4, description: '4 pts per assist' },
    { stat_key: 'shot_on_target', points_per_unit: 0.5, description: '0.5 per shot on target' },
    { stat_key: 'key_pass', points_per_unit: 0.5, description: '0.5 per key pass' },
    // Defending
    { stat_key: 'clean_sheet_gk', points_per_unit: 6, description: 'GK clean sheet' },
    { stat_key: 'clean_sheet_def', points_per_unit: 4, description: 'Defender clean sheet' },
    { stat_key: 'tackle', points_per_unit: 0.5, description: '0.5 per tackle' },
    { stat_key: 'interception', points_per_unit: 0.5, description: '0.5 per interception' },
    // GK specific
    { stat_key: 'save', points_per_unit: 1, description: '1 pt per save' },
    { stat_key: 'penalty_save', points_per_unit: 5, description: '5 pts per penalty save' },
    // Negative
    { stat_key: 'yellow_card', points_per_unit: -1, description: '-1 per yellow card' },
    { stat_key: 'red_card', points_per_unit: -3, description: '-3 per red card' },
    { stat_key: 'own_goal', points_per_unit: -2, description: '-2 per own goal' },
    { stat_key: 'penalty_missed', points_per_unit: -2, description: '-2 per penalty missed' },
  ],
  // Position modifier: GK and defenders score differently to forwards
  position_modifiers: {
    'GK': { clean_sheet: 6, goal_scored: 10 },
    'DEF': { clean_sheet: 4, goal_scored: 6 },
    'MID': { clean_sheet: 1, goal_scored: 5 },
    'FWD': { clean_sheet: 0, goal_scored: 4 },
  },
};
```

---

## 3. Roster Slot Multipliers (Captain / Double-Down / MVP)

Many DFS formats include special roster slots that multiply a player's score:

```typescript
interface SpecialSlotConfig {
  slot_id: string;
  slot_name: string;              // 'Captain', 'MVP', 'Double Down', 'Ace'
  multiplier: number;             // 1.5, 2.0, etc.
  cost_multiplier?: number;       // in salary cap: captain costs 1.5x too
  max_per_roster: number;         // usually 1
  eligible_positions?: string[];  // can restrict to specific positions
}

// Example: DraftKings F1 Captain slot
const f1CaptainSlot: SpecialSlotConfig = {
  slot_id: 'captain',
  slot_name: 'Captain',
  multiplier: 1.5,
  cost_multiplier: 1.5,           // captain also costs 1.5x salary
  max_per_roster: 1,
};
```

---

## 4. Tiebreaker Configurations

```typescript
interface TiebreakerConfig {
  primary: TiebreakerMethod;
  secondary?: TiebreakerMethod;
  tertiary?: TiebreakerMethod;
}

type TiebreakerMethod =
  | 'CHAMPIONSHIP_SCORE_PREDICTION'   // bracket: predict final score
  | 'MOST_CORRECT_PICKS'              // most correct individual picks
  | 'EARLIER_SUBMISSION'              // who submitted bracket/picks first
  | 'BEST_SINGLE_SCORE'              // highest single-event score
  | 'MOST_BIRDIES'                   // golf: total birdies or better
  | 'LOWEST_ROUND'                   // golf: best individual round score
  | 'HEAD_TO_HEAD_RECORD'            // season-long: h2h record
  | 'MOST_WINS'                      // most individual wins
  | 'COIN_FLIP'                      // random for casual leagues
  | 'COMMISSIONER_DECISION';         // manual
```

---

## 5. Scoring Types Reference

| Scoring Type | Description | Sports |
|---|---|---|
| `CUMULATIVE` | Points accumulate over time from stats | NFL, NBA, golf DFS, NASCAR, F1 |
| `STROKE_PLAY` | Lower total score wins; stat is strokes | Golf office pools |
| `POSITION` | Points based purely on finish position | Horse racing, F1 simple, NASCAR simple |
| `BRACKET` | Points for predicting game outcomes in a bracket | NCAA March Madness, NFL playoffs |
| `KNOCKOUT` | Participants eliminated on a loss | NCAA Survivor, NFL Survivor |
| `ROTISSERIE` | League-wide category rankings over full season | MLB, NBA category leagues |
| `HEAD_TO_HEAD` | Weekly matchups; one winner per pair | NFL, NBA weekly fantasy |

---

## 6. DNF / Missed Cut / Did Not Start Handling

Each sport has unique edge cases for non-participation:

```typescript
type DNFHandlingPolicy =
  | 'ZERO'           // participant scores 0 (default)
  | 'EXCLUDE'        // participant excluded; best remaining count (works with BEST_N)
  | 'LAST_PLACE'     // participant receives last-place finish points
  | 'PENALTY'        // participant receives a configured penalty score/points
  | 'MISSED_CUT_SCORE'; // golf: assign a fixed stroke score (e.g. 80)

// Sport-specific defaults:
const dnfDefaults: Record<string, DNFHandlingPolicy> = {
  'GOLF_STROKE':       'MISSED_CUT_SCORE',  // 80 for rounds 3+4
  'GOLF_DFS':          'ZERO',              // no points for missed cut
  'NASCAR':            'ZERO',              // DNF = 0 laps led, 0 finish bonus
  'F1':                'ZERO',              // DNF = no classified finish point
  'HORSE_RACING':      'ZERO',              // scratched/fell = 0
  'NFL_FANTASY':       'ZERO',              // inactive/injured = 0
  'NCAA_BRACKET':      'ZERO',              // losing team stops earning bracket points
};
```

---

## 7. Scoring Rule Templates (Pre-Built Configs)

Commissioner selects a template to pre-fill scoring config. All fields remain editable.

```typescript
const SCORING_TEMPLATES = {
  // Golf
  'golf_dfs_standard':           { /* DraftKings-style points */ },
  'golf_stroke_pick6_use4':      { /* EasyOfficePools-style stroke play, best 4 of 6 */ },
  'golf_stroke_all_count':       { /* All selected golfers' strokes count */ },
  'golf_position_only':          { /* Points for finish position only */ },
  
  // NFL
  'nfl_standard_nonppr':         { /* Standard scoring */ },
  'nfl_ppr':                     { /* PPR + standard */ },
  'nfl_half_ppr':                { /* Half-PPR */ },
  'nfl_superflex':               { /* Superflex QB scoring */ },
  'nfl_best_ball':               { /* Best ball — no lineup management */ },
  
  // NBA
  'nba_points_league':           { /* Stat-based points */ },
  'nba_9cat_rotisserie':         { /* 9-category roto */ },
  
  // F1
  'f1_dfs_captain':              { /* DraftKings style with captain slot */ },
  'f1_season_long':              { /* Season-long with transfer rules */ },
  
  // NASCAR
  'nascar_dfs_place_diff':       { /* DraftKings: finish + place differential + laps led */ },
  'nascar_season_stable':        { /* Season-long "stable" of drivers */ },
  
  // NCAA Basketball
  'ncaa_bracket_standard':       { /* 1-2-4-8-16-32 */ },
  'ncaa_bracket_upset_bonus':    { /* Seed difference bonus */ },
  'ncaa_bracket_seed_multiplier':{ /* Seed × round multiplier */ },
  'ncaa_bracket_flat':           { /* 1 pt per correct pick, any round */ },
  'ncaa_survivor':               { /* One pick per round, no repeats */ },
  'ncaa_pick8':                  { /* Pick 8 teams, points for each win */ },
  
  // Tennis
  'tennis_slam_dfs':             { /* Grand Slam DFS scoring */ },
  'tennis_season_long':          { /* Season-long ATP/WTA scoring */ },
  
  // Horse Racing
  'horse_racing_position':       { /* Derby/major race position scoring */ },
  
  // Soccer
  'epl_dfs_standard':            { /* EPL DFS scoring */ },
  'mls_season_long':             { /* MLS season fantasy */ },
};
```

---

## 8. Scoring Engine Data Flow

```
External Stats Provider
        │
        ▼
Stats Ingestion Worker
  ├── normalizes to internal stat schema
  ├── validates stat_key against sport's stat_schema
  └── publishes StatEvent to message bus
        │
        ▼
Scoring Service (subscribes to StatEvent)
  ├── looks up active contests containing participant
  ├── loads ScoringConfig for each contest
  ├── evaluates stat_rules against new stat delta
  ├── evaluates bonus_rules and penalty_rules
  ├── applies multiplier_rules (captain slots, etc.)
  ├── writes TeamPointsEvent to NoSQL (high-frequency)
  └── triggers ContestStanding rollup in SQL (periodic)
        │
        ▼
ContestStanding (SQL) ← updated every N minutes or on-demand
        │
        ▼
WebSocket / SSE broadcast ← fans out updated leaderboard to clients
```

---

## 9. Sport Stat Schemas

Each sport has a defined stat schema — the set of stat keys the ingestion worker can receive and the scoring engine can reference.

```typescript
const STAT_SCHEMAS: Record<string, string[]> = {
  NFL: ['passing_yards', 'passing_td', 'interception_thrown', 'rushing_yards', 'rushing_td',
        'receiving_yards', 'receiving_td', 'reception', 'fumble_lost', 'fg_made_0_39',
        'fg_made_40_49', 'fg_made_50_plus', 'fg_missed', 'pat_made', 'pat_missed', 'sack',
        'defensive_td', 'interception_caught', 'fumble_recovery', 'safety'],

  NBA: ['points', 'rebounds', 'assists', 'steals', 'blocks', 'three_pointer_made',
        'turnover', 'field_goal_made', 'field_goal_attempted', 'free_throw_made',
        'double_double', 'triple_double'],

  GOLF: ['hole_in_one', 'albatross', 'eagle', 'birdie', 'par', 'bogey',
         'double_bogey', 'triple_bogey_or_worse', 'round_score', 'total_strokes',
         'position', 'made_cut', 'missed_cut', 'withdrew', 'bogey_free_round',
         'consecutive_birdies'],

  F1: ['finish_position', 'grid_position', 'spots_gained', 'classified_finish',
       'laps_led', 'fastest_lap', 'beat_teammate', 'dnf', 'grid_penalty'],

  NASCAR: ['finish_position', 'start_position', 'place_differential', 'laps_led',
           'fastest_lap', 'stage_win', 'led_most_laps', 'dnf'],

  TENNIS: ['wins', 'losses', 'round_reached', 'aces', 'double_faults',
           'break_points_won', 'straight_sets_win', 'position'],

  EPL: ['goal_scored', 'assist', 'shot_on_target', 'key_pass', 'clean_sheet',
        'save', 'penalty_save', 'tackle', 'interception', 'yellow_card',
        'red_card', 'own_goal', 'penalty_missed', 'minutes_played'],

  HORSE_RACING: ['finish_position', 'dnf', 'scratched'],

  NCAA_BASKETBALL: ['round_reached', 'games_won', 'seed'],
};
```

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 03-001 | 1 | `ScoringConfig` Zod schema + TypeScript type (stat rules, position rules, bonus, penalty, multiplier) | Not Started | |
| 03-002 | 1 | Scoring engine — evaluate stat_rules against stat deltas | Not Started | |
| 03-003 | 1 | Scoring engine — evaluate position_rules | Not Started | |
| 03-004 | 1 | Scoring engine — evaluate bonus_rules and penalty_rules | Not Started | |
| 03-005 | 1 | Scoring engine — apply multiplier_rules (captain/double-down slots) | Not Started | |
| 03-006 | 1 | DNF/missed cut handling (ZERO, EXCLUDE, LAST_PLACE, PENALTY, MISSED_CUT_SCORE) | Not Started | |
| 03-007 | 1 | Counting methods (ALL, BEST_N, DROP_LOWEST_N) | Not Started | |
| 03-008 | 2 | NFL scoring templates (standard, PPR, half-PPR) | Not Started | |
| 03-009 | 2 | Golf scoring templates (DFS, stroke play office pool) | Not Started | |
| 03-010 | 2 | F1 scoring template (position + SVG + stats) | Not Started | |
| 03-011 | 2 | NASCAR scoring template | Not Started | |
| 03-012 | 2 | NCAA bracket scoring templates (standard, upset bonus, seed multiplier) | Not Started | |
| 03-013 | 2 | NBA scoring templates (points league, 9-cat rotisserie) | Not Started | |
| 03-014 | 2 | Tennis scoring template | Not Started | |
| 03-015 | 2 | Horse racing scoring template | Not Started | |
| 03-016 | 2 | EPL/soccer scoring template | Not Started | |
| 03-017 | 3 | Special roster slot configuration (captain, MVP, double-down) | Not Started | |
| 03-018 | 3 | Tiebreaker configuration and chain evaluation | Not Started | |
| 03-019 | 3 | Sport stat schema validation (validate stat_key against sport's schema) | Not Started | |
| 03-020 | 3 | Scoring template library (commissioner selects, all fields editable) | Not Started | |
| 03-021 | 4 | Bracket scoring type (round-based, correct pick points) | Not Started | |
| 03-022 | 4 | Rotisserie scoring type (category-based rankings) | Not Started | |
| 03-023 | 4 | Head-to-head scoring type (weekly matchups) | Not Started | |
| 03-024 | 4 | Stroke play scoring type (lower is better) | Not Started | |
| 03-025 | 5 | Test suite — validate each template against real historical data | Not Started | See testing-rules.md §8 |

---

*Generated by Claude — PoolMaster Scoring Rules Configuration Plan v1.0*
