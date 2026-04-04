# PoolMaster — Draft Configuration Rules Plan

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

This document defines the full set of draft configuration rules PoolMaster must support across all contest types and sports. Research sources include EasyOfficePools, OfficePools.com, OfficePoolJunkie, RunYourPool, SimplySportsware, PoolHost, BuzzFantasyGolf, Splash Sports, DraftKings, FanDuel, FanDuel Snake Rules, and competitive fantasy analysis from FantasyPros, ESPN, DraftSharks, and Bleacher Nation.

## Current MVP Interpretation

This plan is broader than the current launch target. For the active MVP:

- prioritize draft-once tournament pools
- prioritize team-based contests plus individual sports where a player acts as the selectable team/contestant
- prioritize shared contestant metadata such as ranking, odds-derived tier, and odds-derived price
- prioritize `TIERED` and `BUDGET_PICK` as the main launch modes
- keep `SNAKE` model-compatible, but treat full live-snake maturity as secondary unless it becomes necessary for the MVP review flow
- keep tier and price derivation deterministic when imported event fields are sparse by falling back through odds/seed signals instead of leaving contestant ordering ambiguous

Treat the following sections as deferred or future-facing unless a fresh replanning pass says otherwise:

- survivor / knockout modes
- bracket-specific flows
- season-long roster management
- DFS-like salary-cap product expansion

---

## Competitive Landscape Summary

| Platform | Draft Types Supported | Strengths | Gaps |
|---|---|---|---|
| **EasyOfficePools** | Tiers, Snake, Salary Cap (golf-focused) | Tiers for golf pools; quick setup for casual users | Single sport, no live draft room |
| **OfficePools.com** | Snake, Salary Cap, Box pools | Strong hockey focus; salary cap + trades + reserves | Limited to hockey/football |
| **OfficePoolJunkie** | Pick'em, Confidence, Margin, Survivor, Bracket | Wide sport coverage; flexible scoring | No true draft engine |
| **RunYourPool / Splash Sports** | Bracket, Pick'em, Snake (Golf) | 11 sports; mobile app; public contests | Shallow draft configuration |
| **SimplySportsware** | Bracket, Pick'em, Survivor | Clean UI; reliable for NCAA | Very limited sports/draft types |
| **BuzzFantasyGolf** | Tiers, Salary Cap, Snake, Pick'em | Deep golf-specific tier config per tournament | Golf only |
| **DraftKings DFS** | Salary Cap, Tiers, Snake | Industry-leading; $50K cap; Captain slot | Daily/DFS only, not season/league |
| **FanDuel** | Salary Cap, Snake | Live snake draft room; strong auto-pick | DFS/daily, not private leagues |

**PoolMaster's differentiation:** Support all three draft types (Snake, Salary Cap, Tiered) across all sports, in both live and async modes, inside a private multi-sport league — something no single competitor does today.

---

## 1. Snake Draft

### 1.1 How It Works

Each team has one pick per round. The picks go in a specific predetermined order. After a round is over, the following round is the reverse order of the previous round. The draft order moves back and forth like a snake, ensuring teams that pick last in one round pick first in the next.

Snake drafts are used because they promote competitive balance without requiring trades or an auction budget. The format is popular because it is straightforward and fair in practice, but it still rewards managers who understand draft-slot timing, tier structure, and the risks created by long waits between picks.

### 1.2 Configuration Parameters

```typescript
interface SnakeDraftConfig {
  // Core
  num_teams: number;                    // 2–20 teams
  num_rounds: number;                   // equals roster size
  draft_order_type: 'RANDOM' | 'COMMISSIONER' | 'REVERSE_STANDINGS';
  
  // Mode
  draft_mode: 'LIVE' | 'ASYNC';
  
  // Timing (LIVE)
  seconds_per_pick: number;             // 15–300 seconds; default 60
  auto_pick_policy: 'BEST_AVAILABLE' | 'QUEUE_THEN_BEST' | 'RANDOM';
  allow_pause: boolean;                 // commissioner can pause session
  
  // Timing (ASYNC)
  hours_per_pick: number;               // 1–168 hours; default 24
  auto_pick_on_expiry: boolean;         // auto-pick if manager misses window
  
  // Roster constraints
  position_requirements?: PositionRequirement[]; // e.g. {position: 'QB', min: 1, max: 2}
  max_from_same_team?: number;          // e.g. no more than 2 players from same NFL team
  
  // Draft order modifiers
  allow_commissioner_reorder: boolean;  // commissioner can reassign draft slots
  allow_pick_trade: boolean;            // teams can trade pick positions before draft
  
  // Exclusivity
  is_exclusive: true;                   // snake drafts are always exclusive — once taken, gone
  
  // Round Robin variant
  is_round_robin: boolean;              // if true, order does NOT reverse (straight draft)
}
```

### 1.3 Pick Order Algorithm

For a 12-team snake draft, round N pick order:
- Odd rounds: 1 → 2 → 3 → ... → 12
- Even rounds: 12 → 11 → 10 → ... → 1

Team 1 would have the following picks in a 12-team, 15-round draft: 1, 24, 25, 48, 49, 72, 73, 96, 97, 120, 121, 144, 145, 168, and 169.

```typescript
function getPickOrder(teamCount: number, round: number): number[] {
  const order = Array.from({ length: teamCount }, (_, i) => i + 1);
  return round % 2 === 0 ? order.reverse() : order;
}

// Global pick number → { round, pick_in_round, team_id }
function getPickAtPosition(pickNum: number, teamCount: number): PickPosition {
  const round = Math.ceil(pickNum / teamCount);
  const pickInRound = ((pickNum - 1) % teamCount) + 1;
  const teamIndex = round % 2 === 0 
    ? teamCount - pickInRound 
    : pickInRound - 1;
  return { round, pick_in_round: pickInRound, team_index: teamIndex };
}
```

### 1.4 Auto-Pick Logic

If Auto-Draft is on, picks will be automatically made based on: (1) the top-ranked player in the manager's queue, then (2) the top-ranked player in pre-draft rankings if the queue is empty, then (3) the highest-projected available player in the player list if both queue and rankings are empty.

```typescript
interface AutoPickConfig {
  priority_1: 'MANAGER_QUEUE';
  priority_2: 'MANAGER_RANKINGS';
  priority_3: 'SYSTEM_PROJECTIONS' | 'WORLD_RANKING' | 'RANDOM';
  skip_injured: boolean;               // never auto-pick injured/suspended players
  respect_position_requirements: boolean; // ensure roster requirements are met
}
```

### 1.5 Commissioner Controls

The commissioner can pause the draft anytime. They can also change the time limit mid-draft or fast-forward the action if things lag. The commissioner can rewind the draft if there are any mistakes that need to be fixed, and vacate or reassign draft picks.

Commissioner actions during a live snake draft:
- Pause / resume session
- Extend current pick clock
- Force-skip a pick (triggers auto-pick)
- Undo last pick (with confirmation)
- Reassign a pick to a different team
- Change time-per-pick mid-draft

### 1.6 Sports Best Suited For

- **Best fit:** NFL, NBA, NHL, MLB, NASCAR (season-long), tennis (season-long), F1 (season-long)
- **Common use:** Golf pool snake drafts (e.g. Masters, US Open)
- **Less common but supported:** NCAA March Madness team drafts, horse racing derbies

---

## 2. Salary Cap Draft (Auction)

### 2.1 How It Works

Every team in the league starts the auction with the same amount of money to spend on players. A typical starting bank for each team is $100 or $200. This imaginary amount of money is all a manager has to build their initial roster via an auction draft.

In salary cap drafts, teams take turns nominating players, and the team with the highest bid wins that player. The nomination order is usually conducted in either a snake format or just a rotating order.

Unlike snake drafts, salary cap drafts allocate players through bidding and budget management, emphasizing pricing and opportunity cost. Crucially, the same participant can appear on multiple teams' rosters because exclusivity is optional.

### 2.2 Configuration Parameters

```typescript
interface SalaryCapDraftConfig {
  // Budget
  budget_per_team: number;             // e.g. 200, 50000 (for DFS-style)
  budget_currency_label: string;       // "$", "credits", "coins"
  min_bid: number;                     // minimum allowed bid per player; default 1
  min_remaining_per_unfilled_slot: number; // reserve $1 per unfilled roster spot
  
  // Nomination
  nomination_order: 'SNAKE' | 'ROTATING' | 'SIMULTANEOUS';
  nomination_requires_bid: boolean;    // nominator must bid $1 minimum; default true
  can_nominate_without_roster_space: boolean; // keep nominating after roster full
  
  // Bidding
  bid_increment: number;               // minimum bid raise; default 1
  bid_timer_seconds: number;           // 10–120 seconds; default 30
  bid_timer_resets_on_bid: boolean;    // timer resets with each new bid; default true
  allow_blind_bid: boolean;            // blind sealed bids (advanced option)
  
  // Participant pricing
  price_source: 'COMMISSIONER' | 'MARKET_VALUE' | 'WORLD_RANKING_FORMULA' | 'MANUAL';
  allow_price_override: boolean;       // commissioner can override individual prices
  
  // Exclusivity
  is_exclusive: boolean;               // false = DFS-style (same player on many teams)
                                       // true = auction/salary cap (one team per player)
  
  // Roster requirements
  roster_size: number;
  position_requirements?: PositionRequirement[];
  max_spend_per_position?: PositionBudgetCap[];
  
  // FAAB waiver (post-draft)
  enable_faab_waivers: boolean;        // free agent acquisition budget in-season
  waiver_budget: number;               // budget for weekly waivers
  
  // Mode
  draft_mode: 'LIVE' | 'ASYNC';
}
```

### 2.3 Nomination Strategies

Three nomination order styles supported:

**SNAKE nomination** — teams nominate in snake order. If Team A nominates and wins the bid, A still makes the next nomination per the order. This prevents teams from nominating only players they want.

**ROTATING nomination** — fixed rotation; same order every round. Simpler but gives early-order teams fewer late nominations.

**SIMULTANEOUS (Full-Round)** — instead of each team taking turns making a nomination, every team announces which player they will nominate for that round, then all nominated players are auctioned in sequence. Creates interesting strategy around which players are surfaced together.

### 2.4 Budget Enforcement

```typescript
// Budget validation on each bid attempt
function validateBid(team: Team, bid: number, session: DraftSession): ValidationResult {
  const remainingSlots = team.rosterSize - team.currentRoster.length - 1;
  const minReserve = remainingSlots * session.config.min_remaining_per_unfilled_slot;
  const availableBudget = team.remainingBudget - minReserve;
  
  if (bid > availableBudget) {
    return { valid: false, reason: `Max bid is ${availableBudget} (must reserve ${minReserve} for remaining ${remainingSlots} slots)` };
  }
  if (bid < session.config.min_bid) {
    return { valid: false, reason: `Minimum bid is ${session.config.min_bid}` };
  }
  return { valid: true };
}
```

### 2.5 Participant Pricing Models

| Model | Description | Best For |
|---|---|---|
| `COMMISSIONER` | Commissioner sets price for each participant | Small leagues, custom events |
| `MARKET_VALUE` | System auto-assigns based on world ranking/ADP | Mainstream sports |
| `WORLD_RANKING_FORMULA` | Formula: `base_budget * (rank_weight / total_weight)` | Golf, tennis, F1 |
| `MANUAL` | Commissioner uploads CSV with prices | Ultimate flexibility |

### 2.6 Exclusivity Modes

**Exclusive (true auction):** Each participant can only be on one team's roster. A win at auction removes the participant from the pool. This is the traditional fantasy football auction format.

**Non-exclusive (DFS-style salary cap):** Every manager independently selects participants within their budget cap. The same golfer can appear on 50 different teams. Prices are pre-set by the system, not determined by competitive bidding. This is the DraftKings/FanDuel golf format.

### 2.7 Sports Best Suited For

- **Non-exclusive (DFS):** Golf, F1, NASCAR, tennis, horse racing — any event where the "field" is public and broad
- **Exclusive (auction):** NFL, NBA, NHL — traditional season-long fantasy sports
- **Both:** Soccer/EPL, MLB

---

## 3. Tiered Draft (Pick'em by Tier)

### 3.1 How It Works

In tier-based formats, teams and players are assigned tiers. Team managers must draft N players from each tier. The structure forces selection variety — you cannot simply load up on the best players. You must balance choices across tiers.

Tiers provide a kind of middle ground between snake and salary cap. The goal is to simply select the best point producer in each tier. The challenge is that the format favors players with deep knowledge of the sport, and lower tiers can be quite unpredictable.

### 3.2 Configuration Parameters

```typescript
interface TieredDraftConfig {
  // Tier definitions
  tiers: TierDefinition[];
  
  // Selection rules
  selections_per_tier: SelectionPerTier[];
  
  // Roster
  total_roster_size: number;           // sum of all picks_required across tiers
  
  // Selection mode
  selection_mode: 'SIMULTANEOUS' | 'SEQUENTIAL' | 'OPEN_WINDOW';
  // SIMULTANEOUS = everyone selects at the same time, no exclusivity
  // SEQUENTIAL = managers take turns within each tier (snake order within tier)
  // OPEN_WINDOW = managers have a time window to submit full selection
  
  // Exclusivity within tiers
  is_exclusive: boolean;               // if true, once player taken in sequential mode, gone
  
  // Timing
  draft_mode: 'LIVE' | 'ASYNC';
  open_window_hours?: number;          // for OPEN_WINDOW mode
  
  // Tiebreakers
  tiebreaker_config?: TiebreakerConfig;
  
  // Best-ball variant
  use_best_ball: boolean;              // if true, only top N scores from each tier count
  best_ball_n?: number;                // number of scores that count
}

interface TierDefinition {
  tier_id: string;
  tier_name: string;                   // "Tier 1", "Elite", "Dark Horses"
  tier_label?: string;                 // display label
  participants: string[];              // participant_ids in this tier
  tier_assignment_method: 'COMMISSIONER' | 'WORLD_RANKING' | 'ODDS' | 'SEEDING';
  min_participants: number;
  max_participants: number;
}

interface SelectionPerTier {
  tier_id: string;
  picks_required: number;              // how many from this tier each manager must pick
  picks_count_best_n?: number;         // for best-ball: only top N scores from tier count
}
```

### 3.3 Tier Assignment Methods

| Method | Description | Best For |
|---|---|---|
| `COMMISSIONER` | Commissioner manually assigns players to tiers | Custom pools, any sport |
| `WORLD_RANKING` | System assigns based on live world ranking brackets | Golf, tennis |
| `ODDS` | System assigns based on odds-to-win buckets | Horse racing, golf |
| `SEEDING` | System assigns based on tournament seed | NCAA March Madness |

### 3.4 Golf Tier Pool Example

The most popular Masters pool format: everyone picks a team of 6 golfers using a picksheet broken into 6 tiers by odds to win (or world rank). The best 4 of 6 scores make up your team score. Lowest score wins. Cut golfers receive a score of 80 for rounds 3 and 4.

```typescript
// Example: Masters Golf Pool — Pick 6, Use Best 4
const mastersTierConfig: TieredDraftConfig = {
  tiers: [
    { tier_id: 't1', tier_name: 'Tier 1', participants: [/* top 10 by odds */], picks_required_from_tier: 1 },
    { tier_id: 't2', tier_name: 'Tier 2', participants: [/* next 10 */], picks_required_from_tier: 1 },
    { tier_id: 't3', tier_name: 'Tier 3', participants: [/* next 10 */], picks_required_from_tier: 1 },
    { tier_id: 't4', tier_name: 'Tier 4', participants: [/* next 10 */], picks_required_from_tier: 1 },
    { tier_id: 't5', tier_name: 'Tier 5', participants: [/* next 15 */], picks_required_from_tier: 1 },
    { tier_id: 't6', tier_name: 'Dark Horses', participants: [/* remaining */], picks_required_from_tier: 1 },
  ],
  total_roster_size: 6,
  use_best_ball: true,
  best_ball_n: 4,                      // only best 4 of 6 scores count
  selection_mode: 'SIMULTANEOUS',
  is_exclusive: false,                 // multiple managers can pick same golfer
  missed_cut_score: 80,                // penalty score for missed cut
};
```

### 3.5 Sports Best Suited For

- **Golf:** The native home of tiered pools. Used for Masters, US Open, PGA Championship, all majors
- **March Madness:** Region-based or seed-based tiers
- **F1/NASCAR:** Tiers by season championship standing or qualifying position
- **Tennis:** Tiers by ATP/WTA ranking brackets
- **Horse Racing:** Tier by morning-line odds brackets

---

## 4. Additional Draft Modes & Variants

### 4.1 Best Ball Draft

Best Ball is a variant that can be applied to any draft type. After the draft, no lineup management is required. The system automatically uses the best-performing players from a manager's roster each week.

```typescript
interface BestBallConfig {
  enabled: boolean;
  starters_per_position: PositionRequirement[]; // how many from each position count
  // e.g., use best 1 QB, best 2 RB, best 3 WR, best 1 TE each week
}
```

### 4.2 Survivor Draft

Used for week-by-week survival contests. A manager picks one team/player per week. If it wins/succeeds, they survive. Each selection can only be used once.

```typescript
interface SurvivorConfig {
  picks_per_round: number;             // usually 1
  reuse_allowed: boolean;              // can you pick the same team again? usually false
  last_chance_round: boolean;          // some formats allow one "last chance" re-entry
  elimination_trigger: 'LOSS' | 'BOTTOM_N' | 'MISSED_PICK';
}
```

### 4.3 Confidence / Weighted Pick'em

Each manager ranks their picks by confidence. More confident picks are worth more if correct.

```typescript
interface ConfidenceConfig {
  picks_per_round: number;
  confidence_range: [number, number];  // e.g. [1, 16] for 16-team pool
  allow_ties: boolean;                 // can two picks share same confidence weight
}
```

### 4.4 Pick'em (Straight Picks)

Simplest format. Managers pick winners of each game/race/match. Points awarded for correct picks.

---

## 5. Draft Session Lifecycle

```
DRAFT_CREATED
    │
    ▼
DRAFT_CONFIGURING    ← commissioner sets rules, assigns participants to tiers/pricing
    │
    ▼
DRAFT_OPEN           ← for ASYNC / OPEN_WINDOW modes, managers can submit picks
    │
    ▼
DRAFT_LIVE           ← for LIVE mode, real-time picks on the clock
    │
    ▼
DRAFT_PAUSED         ← commissioner paused (LIVE only)
    │
    ▼
DRAFT_COMPLETE       ← all picks made, rosters locked
    │
    ▼
CONTEST_LOCKED       ← event starts, no more changes
```

---

## 6. Auto-Pick & Queue System

All draft types need a queue and auto-pick system for live drafts:

```typescript
interface ManagerDraftQueue {
  manager_id: string;
  draft_session_id: string;
  queued_participants: string[];       // ordered list of desired picks
  pre_draft_rankings: string[];        // system-wide rankings fallback
}

// Auto-pick priority order for snake drafts (per FanDuel / DraftKings standard):
// 1. Top item in manager's queue (if available and valid)
// 2. Top item in manager's pre-draft rankings (if available)  
// 3. System default (highest projected / best world ranking)
// Never auto-pick: injured, suspended, or withdrawn participants
```

---

## 7. Draft Order Generation

```typescript
type DraftOrderMethod = 
  | 'RANDOM'                    // random draw at draft start
  | 'REVERSE_STANDINGS'         // worst record from last season picks first
  | 'COMMISSIONER_MANUAL'       // commissioner sets exact order
  | 'AUCTION'                   // random or rotating nomination order (salary cap)
  | 'SIGNUP_ORDER';             // first to join picks first (casual leagues)
```

---

## 8. Waiver Wire (Post-Draft)

After draft, in-season roster management:

```typescript
interface WaiverConfig {
  waiver_type: 'PRIORITY' | 'FAAB' | 'FREE_AGENT' | 'NONE';
  
  // PRIORITY: worst standing gets first waiver claim each week
  // FAAB: Free Agent Acquisition Budget — each team bids blind each week
  // FREE_AGENT: first come first served
  
  waiver_day: number;                  // day of week claims process (0=Sun, 1=Mon...)
  waiver_processing_time: string;      // "03:00 UTC"
  faab_budget?: number;                // for FAAB type
  blind_bidding?: boolean;             // sealed bids for FAAB
  trade_enabled: boolean;
  trade_deadline?: string;             // ISO date
  trade_review_period_hours?: number;  // commissioner review window
}
```

---

## 9. Draft Configuration Templates

Pre-built templates reduce setup time for commissioners:

```typescript
const DRAFT_TEMPLATES = {
  // Golf
  'golf_masters_tiers_6pick4': { /* Pick 6 Use 4 tiered pool */ },
  'golf_salary_cap_dfs': { /* DFS-style non-exclusive $50K salary cap */ },
  'golf_snake_10team': { /* 10-team snake draft, 6 rounds */ },
  
  // NFL
  'nfl_snake_12team_standard': { /* 12-team, 15 rounds, standard positions */ },
  'nfl_auction_200_ppr': { /* $200 budget, PPR scoring */ },
  
  // NCAA Basketball
  'ncaa_bracket_64': { /* Full bracket pick'em */ },
  'ncaa_pick8': { /* Pick 8 teams for the tournament */ },
  
  // F1
  'f1_salary_cap_weekly': { /* Weekly DFS-style, $50K cap */ },
  'f1_season_long_snake': { /* Full season snake draft of drivers + constructors */ },
  
  // NASCAR
  'nascar_season_snake_4driver': { /* 4 rounds, best 3 of 4 count */ },
  
  // Tennis
  'tennis_slam_salary_cap': { /* Grand Slam DFS-style salary cap */ },
  'tennis_season_long_snake': { /* ATP/WTA season-long league */ },
};
```

---

## 10. Comparison: Draft Types by Contest Type

| Contest Type | Snake | Salary Cap | Tiered | Survivor | Bracket |
|---|---|---|---|---|---|
| Golf (single tournament) | ✅ | ✅ | ✅ best fit | — | — |
| Golf (season long) | ✅ | ✅ | ✅ | — | — |
| NFL (weekly) | ✅ best fit | ✅ | ✅ | ✅ | — |
| NFL (season long) | ✅ | ✅ best fit | — | ✅ | — |
| NCAA Basketball | — | — | ✅ (by seed) | ✅ | ✅ best fit |
| F1 (race weekend) | — | ✅ best fit | ✅ | — | — |
| F1 (season long) | ✅ | ✅ | — | — | — |
| NASCAR | ✅ | ✅ | ✅ | ✅ | — |
| Tennis (tournament) | — | ✅ | ✅ | ✅ | ✅ |
| Horse Racing | — | ✅ | ✅ best fit | — | — |
| Premier League | ✅ | ✅ | — | ✅ | ✅ |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 02-001 | 1 | Snake draft pick order algorithm | Done | `draft-service/src/engine/pick-order.ts` — getRoundOrder, getPickPosition, generatePickSchedule |
| 02-002 | 1 | `SnakeDraftEngine` — validate pick, enforce exclusivity, advance turn | Done | `draft-service/src/engine/snake-draft-engine.ts` — immutable state, applyPick, validatePick |
| 02-003 | 1 | Draft session lifecycle state machine (PENDING → LIVE → PAUSED → COMPLETE) | Done | `draft-service/src/engine/draft-session-manager.ts` — transitionSession, start/pause/resume/complete |
| 02-004 | 1 | Auto-pick logic (queue → rankings → best available) | Done | In SnakeDraftEngine.resolveAutoPick — QUEUE_THEN_BEST, BEST_AVAILABLE, RANDOM policies |
| 02-005 | 1 | Async draft mode — REST routes for pick submission | Done | `draft-service/src/modules/drafts/routes.ts` now serves a mode-aware draft-room contract: snake sessions still use draft-session state, while open-selection and tiered contests now read/write persisted roster picks through the same `/drafts/:contestId` + `/pick` route surface |
| 02-006 | 1 | Commissioner draft controls (pause, resume, undo, extend clock) | Done | extendPickDeadline in session manager; pause/resume via state transitions |
| 02-007 | 1 | Draft order generation (random, commissioner-set, signup) | Done | `draft-service/src/engine/draft-order.ts` — Fisher-Yates shuffle, validation |
| 02-008 | 2 | `TieredPickEngine` — tier enforcement, picks per tier, non-exclusive | Done | `draft-service/src/engine/tiered-pick-engine.ts` — validate, apply, remaining tiers |
| 02-009 | 2 | Tier assignment (seed, ranking, odds, commissioner) | Done | Added AUTO_ODDS and AUTO_SEED modes to tier-engine.ts; extended TierableParticipant with odds/seed fields; updated TierAssignmentMode type |
| 02-010 | 2 | Best-ball variant (pick N, use best M scores — golf) | Done | `scoring-service/src/engine/best-ball.ts` — applyBestBall with lowerIsBetter direction support; exported from engine index |
| 02-011 | 3 | `BudgetPickEngine` — cost validation, budget cap, non-exclusive | Done | `draft-service/src/engine/budget-pick-engine.ts` — validate, apply, affordability check |
| 02-012 | 3 | Budget pricing (from odds, seed, ranking, or commissioner-set) | Done | Added seed-based pricing to pricing-engine.ts; PricingConfig now has seedWeight; ParticipantPricingInput has seed field |
| 02-013 | 3 | Open selection (pick N from unrestricted field — NCAA "Pick 8") | Done | `draft-service/src/engine/open-selection-engine.ts` — validate, submit, apply, available participants; supports exclusive/non-exclusive |
| 02-014 | 4 | Survivor engine — live pick mode (one pick per period) | Done | `survivor-engine.ts` — submitLivePick, resolvePeriod, getPendingEntries |
| 02-015 | 4 | Survivor engine — locked pick mode (all picks upfront) | Done | submitLockedPicks with sequential validation |
| 02-016 | 4 | Survivor config: one-entity-per-season, strikes, buybacks, double pick | Done | All 4 config options implemented and tested |
| 02-017 | 4 | Multiplier survivor (NCAAF-5 hold'em: carry player with growing multiplier) | Done | multipliers config + submitReplacementPick at 1× |
| 02-018 | 5 | Pick'em engine — predict outcomes, score on correctness | Done | `pickem-engine.ts` — validate, submit, resolve period, leaderboard. The follow-up room contract is now live too: `contest_picks` supports `matchupIndex` plus optional `eventId`, `/api/v1/drafts/:contestId` returns matchup-backed `pickEmEvents`, and `/pick` persists per-matchup predictions plus confidence weights. `EVENT_FIELD` pool resolution now generates single-event pick'em matchup rows from real sport-event metadata/provider mappings. Remaining work is broader multi-event/slate ingestion |
| 02-019 | 5 | Confidence-weighted pick'em (assign weights to predictions) | Done | Confidence weights validated (unique, 1-N range); used as points when correct |
| 02-020 | 5 | Bracket pick'em — full bracket submission + round multipliers | Done | `bracket-engine.ts` — validate, submit, score round, series length bonus, tiebreaker. The shared draft-room runtime now also has a real backend contract over `contest_matchups` + `bracket_predictions`, including persisted winner selection, auto-fill, and reset flows, and `EVENT_FIELD` pool resolution now seeds first-round bracket matchups from the real participant field instead of relying on manual matchup inserts |
| 02-021 | 6 | Manager draft queue (pre-rank participants, drag to reorder) | Done | `draft-service/src/engine/draft-queue.ts` — DraftQueue class with set/get/reorder/removeFromAll; exported singleton; wired into snake engine via QUEUE_THEN_BEST policy |
| 02-022 | 6 | ~~Live draft mode — WebSocket integration~~ | Deferred | WebSocket/SSE deferred; async polling is v1 approach |
| 02-023 | 6 | Selection config templates (pre-built per sport per contest type) | Done | `draft-service/src/templates/selection-templates.ts` — 22 templates across 9 sports; GET /templates routes added to drafts module |
| 02-024 | 1 | Event-backed contestant setup for tiered/budget MVP contests | Done | Contest creation now requires a real ingested event, provisions a live `EVENT_FIELD` contestant pool, and normalizes tiered/budget template config into the shared contest request. Pricing/tier services consume participant ranking, odds, seed, and season-record price signals instead of relying on ranking-only fallbacks. Odds-based tier mode is wired correctly, commissioner tier mode maps to manual assignment, sparse imports fall back deterministically through odds/seed ordering before overrides apply, and the create wizard now exposes commissioner-controlled tier count, tier size, picks-per-tier, budget, roster size, tier assignment, and pricing formula inputs before contestant import is finalized. The web flow also surfaces that contestant setup on create review, pre-start contest detail, active contest info, and the draft-room header so users can verify budget/tier rules end to end |

---

> **MVP scope note:** Historical `Done` rows above reflect implementation work that exists in the repository. They do **not** mean every mode is part of the current launch surface. Reconfirm MVP scope against plan 01 and plan 02a before resuming any non-tiered/non-budget draft work.

*Generated by Claude — PoolMaster Draft Configuration Rules Plan v1.0*
