# PoolMaster — Contest History & League History Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

This document defines the full capability plan for contest history and league history across PoolMaster. The goal is to make every league feel like it has a living record — one that managers genuinely want to browse, share, and argue about. History is one of the highest-value retention features in fantasy sports: it's what makes a group stay on the same platform for years.

Research sources include League Legacy, Fantasy Record Book, Fantasy Hudl, Clubhousey, Record Keeper, Yahoo Fantasy, ESPN Fantasy, Sleeper, League History App, Oberon Mt. Power Rating, Fantasy League GOAT (luck analysis), and published academic work on skill vs. luck in fantasy sports.

**Design principle:** History data is append-only and immutable once a contest closes. No retroactive edits to scores or results. All computed analytics (streaks, luck scores, power ratings) are derived from the immutable source records and can be recomputed on demand.

---

## 1. Data Architecture: What Gets Stored

History is split between two storage layers:

- **Relational (SQL):** All permanent, immutable records — contest results, team rosters, draft picks, payouts, standings snapshots. These are the source of truth.
- **NoSQL:** High-volume event-level data — per-round scoring events, stat streams. Retained for the life of the contest plus a configurable archive window.
- **Derived (computed):** Aggregated analytics — streaks, all-time records, luck scores, power ratings. Computed from SQL source records and cached in a read-optimized store (Redis or a dedicated analytics table set).

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOURCE OF TRUTH (SQL)                        │
│                                                                     │
│  ContestResult     ← one row per team per closed contest            │
│  ContestStanding   ← periodic snapshots during live contests        │
│  TeamRosterHistory ← frozen roster at contest lock                  │
│  DraftPickHistory  ← every pick in every draft                      │
│  PayoutHistory     ← prizes awarded per contest per team            │
│  MatchupHistory    ← head-to-head results (season-long H2H leagues) │
│  IntermediatePrize ← mid-contest prize awards                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ derived from
┌───────────────────────────▼─────────────────────────────────────────┐
│                     ANALYTICS LAYER (cached)                        │
│                                                                     │
│  MemberAllTimeStats        StreakRecord                             │
│  LeagueSeasonSummary       RivalryRecord                            │
│  ContestScoringTimeline    PowerRatingHistory                       │
│  LuckScoreHistory          AllTimeLeaderboard                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.1 ContestResult (Core History Table)

The single most important history record. One row per team per completed contest.

```typescript
interface ContestResult {
  // Identity
  id: string;
  contest_id: string;
  league_id: string;
  tenant_id: string;
  season_id: string;
  team_id: string;
  league_membership_id: string;      // links result to a league member (persists if team name changes)

  // Contest metadata (denormalized for historical stability)
  contest_name: string;
  contest_type: ContestType;
  sport: string;
  started_at: Date;
  ended_at: Date;
  num_entries: number;               // total teams in contest at close

  // Result
  final_rank: number;
  final_points: number;
  final_score?: number;              // for stroke-play golf: actual stroke total
  is_winner: boolean;
  is_paid_position: boolean;

  // Intermediate prizes won in this contest
  intermediate_prizes_won: IntermediatePrizeRecord[];

  // Payout
  entry_fee_paid?: number;
  prize_won?: number;
  prize_label?: string;              // "Champion", "Runner-Up", etc.
  net_result?: number;               // prize_won - entry_fee_paid

  // Draft snapshot reference
  draft_session_id?: string;
  draft_position?: number;           // where they picked in the draft

  // Performance snapshot
  roster_snapshot_id: string;        // FK to frozen TeamRosterHistory

  // Computed at close time
  percentile_rank: number;           // rank / num_entries as 0–100
  points_behind_winner: number;
  points_behind_next: number;

  closed_at: Date;
  created_at: Date;
}
```

### 1.2 MatchupHistory (H2H Season-Long Leagues)

For week-by-week head-to-head formats (NFL, NBA, etc.):

```typescript
interface MatchupHistory {
  id: string;
  contest_id: string;
  league_id: string;
  season_id: string;
  week_number: number;
  round_name?: string;               // "Regular Season Week 5", "Playoff Round 1"
  is_playoff: boolean;

  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
  winner_team_id: string;
  margin: number;                    // abs(home_points - away_points)

  // Expected scores at time of matchup (for luck calculation)
  home_projected_points?: number;
  away_projected_points?: number;

  played_at: Date;
}
```

### 1.3 TeamRosterHistory (Frozen Roster at Contest Lock)

```typescript
interface TeamRosterHistory {
  id: string;
  contest_id: string;
  team_id: string;
  locked_at: Date;
  roster: RosterEntry[];             // JSONB snapshot of full roster at lock time
  draft_budget_used?: number;        // for salary cap contests
  tiers_selected?: TierSelection[];  // for tiered contests
}
```

### 1.4 PayoutHistory

```typescript
interface PayoutHistory {
  id: string;
  contest_id: string;
  league_id: string;
  team_id: string;
  league_membership_id: string;
  prize_type: 'FINAL_STANDING' | 'INTERMEDIATE' | 'BONUS';
  prize_label: string;
  prize_rank?: number;
  amount: number;
  is_cash: boolean;
  non_cash_description?: string;
  paid_at?: Date;
  acknowledged_by_member: boolean;
  created_at: Date;
}
```

---

## 2. Contest History

Contest history surfaces the story of a single completed contest — what happened, who won, how it unfolded round by round, and how each team performed.

### 2.1 Contest Summary View

Available to all league members after a contest closes.

```typescript
interface ContestHistorySummary {
  contest_id: string;
  contest_name: string;
  sport: string;
  contest_type: ContestType;
  season: string;
  started_at: Date;
  ended_at: Date;
  num_entries: number;
  draft_type: DraftType;

  // Final standings
  final_standings: ContestStandingEntry[];

  // Payout summary
  total_prize_pool: number;
  payouts_distributed: PayoutSummaryEntry[];

  // Highlights
  highest_score: { team: TeamRef; score: number };
  lowest_score: { team: TeamRef; score: number };
  closest_finish: { team1: TeamRef; team2: TeamRef; margin: number };
  biggest_upset?: { winner: TeamRef; loser: TeamRef; description: string };

  // Intermediate prizes awarded
  intermediate_prizes: IntermediatePrizeAward[];

  // Draft recap (if applicable)
  draft_recap?: DraftRecapSummary;
}
```

### 2.2 Contest Scoring Timeline

For any contest with multiple rounds/events, the scoring timeline shows how the leaderboard evolved over time. This is the "race chart" view — who was leading after round 1, who surged on the weekend, who collapsed.

```typescript
interface ContestScoringTimeline {
  contest_id: string;
  checkpoints: ScoringCheckpoint[];
}

interface ScoringCheckpoint {
  checkpoint_label: string;          // "After Round 1", "Day 2", "Week 3", "After Cut"
  checkpoint_type: string;
  recorded_at: Date;
  standings: {
    team_id: string;
    team_name: string;
    points_at_checkpoint: number;
    rank_at_checkpoint: number;
    rank_change_from_previous: number;   // +3 = moved up 3 places
  }[];
}
```

**Use cases:**
- Golf: standings after each of the 4 rounds
- NASCAR/F1: standings after each stage / after the race
- NFL season: standings after each week of the regular season + playoff rounds
- NCAA bracket: standings after Round of 64, Round of 32, Sweet 16, Elite 8, Final Four

### 2.3 Contest Roster Replay

After a contest closes, members can view every team's locked roster and the final score breakdown by participant.

```typescript
interface ContestRosterReplay {
  contest_id: string;
  team_id: string;
  roster: {
    participant_id: string;
    participant_name: string;
    tier?: number;
    salary_cost?: number;
    draft_round?: number;
    draft_pick?: number;
    final_points: number;
    final_rank_in_event: number;     // actual performance in the real-world event
    scoring_breakdown: ScoringBreakdownEntry[];  // points by stat category
  }[];
  total_points: number;
  final_rank: number;
}
```

### 2.4 Draft History Replay

Full replay of every draft for every contest. This is heavily used by members to analyse draft strategy.

```typescript
interface DraftHistoryReplay {
  contest_id: string;
  draft_session_id: string;
  draft_type: DraftType;
  total_picks: number;
  picks: DraftPickHistoryEntry[];
}

interface DraftPickHistoryEntry {
  pick_number: number;
  round: number;
  pick_in_round: number;
  team_id: string;
  team_name: string;
  participant_id: string;
  participant_name: string;
  participant_cost?: number;         // salary cap
  participant_tier?: number;         // tiered draft
  was_auto_picked: boolean;
  picked_at: Date;

  // Hindsight analytics (computed post-contest)
  final_points_scored: number;       // what this pick actually scored
  pick_value_rank: number;           // rank among all picks by points scored
}
```

---

## 3. League History

League history aggregates across all contests and seasons within a league. This is the persistent record of a league's identity over time.

### 3.1 League Season Summary

One record per season per league, frozen when the season closes.

```typescript
interface LeagueSeasonSummary {
  id: string;
  league_id: string;
  season_id: string;
  season_name: string;               // e.g. "2025 NFL Season", "2025 Masters Pool"
  sport: string;
  year: number;

  num_members: number;
  num_contests: number;
  total_prize_pool: number;

  // Champions per contest type in this season
  champions: SeasonChampion[];

  // Season-level records
  highest_single_contest_score: { team: TeamRef; contest: ContestRef; score: number };
  lowest_single_contest_score: { team: TeamRef; contest: ContestRef; score: number };
  most_consistent_team: { team: TeamRef; metric: string; value: number };
  biggest_upset: { description: string; contest: ContestRef };

  // Season notes (commissioner can add)
  commissioner_note?: string;
  season_emoji?: string;             // fun visual label

  opened_at: Date;
  closed_at: Date;
}

interface SeasonChampion {
  contest_id: string;
  contest_name: string;
  team_id: string;
  team_name: string;
  member_id: string;
  member_display_name: string;
  final_points: number;
  prize_won?: number;
}
```

### 3.2 All-Time Member Stats

The primary cross-season analytics record per league member. Aggregated from ContestResult records.

```typescript
interface MemberAllTimeStats {
  league_id: string;
  league_membership_id: string;
  member_display_name: string;
  seasons_active: number;
  first_contest_at: Date;
  last_contest_at: Date;

  // Contest participation
  total_contests_entered: number;
  total_contests_won: number;
  total_runner_up: number;
  total_top_3: number;
  total_paid_positions: number;      // finished in a paid prize position
  win_rate: number;                  // contests_won / total_contests
  paid_rate: number;                 // paid_positions / total_contests

  // Points
  total_points_scored: number;
  average_points_per_contest: number;
  highest_single_contest_score: { score: number; contest: ContestRef };
  lowest_single_contest_score: { score: number; contest: ContestRef };

  // Financials
  total_entry_fees_paid: number;
  total_prizes_won: number;
  net_winnings: number;              // prizes_won - entry_fees_paid
  roi: number;                       // net_winnings / entry_fees_paid

  // Percentile
  average_percentile_rank: number;   // avg of (rank/num_entries) across all contests
  best_percentile: number;
  worst_percentile: number;

  // By sport
  stats_by_sport: Record<string, MemberSportStats>;

  // By contest type
  stats_by_contest_type: Record<ContestType, MemberContestTypeStats>;

  computed_at: Date;
}
```

### 3.3 All-Time Leaderboard

The definitive ranking of all members in the league by overall historical performance. Multiple ranking dimensions available.

```typescript
interface AllTimeLeaderboard {
  league_id: string;
  as_of_date: Date;

  rankings: AllTimeRankingEntry[];
}

interface AllTimeRankingEntry {
  rank: number;
  league_membership_id: string;
  member_display_name: string;

  // Core stats
  contests_won: number;
  win_rate: number;
  total_points: number;
  avg_points_per_contest: number;
  net_winnings: number;

  // Advanced
  power_rating: number;              // see Section 5
  luck_adjusted_win_rate: number;    // see Section 5
  consistency_score: number;         // low variance in percentile rank = high consistency

  // Longest streaks
  longest_win_streak: number;
  longest_loss_streak: number;
  current_streak: { type: 'WIN' | 'LOSS'; length: number };

  // Championship profile
  championships: number;
  runner_up_finishes: number;
  championship_drought_seasons: number;   // seasons since last win
}
```

---

## 4. Records & Streaks

A dedicated records engine scans ContestResult and MatchupHistory to maintain the league record book. Records are categorised into levels: League All-Time, Single-Season, Single-Contest, and Per-Member Career.

### 4.1 Record Categories

```typescript
type RecordCategory =
  // Scoring Records
  | 'HIGHEST_SINGLE_CONTEST_SCORE'
  | 'LOWEST_SINGLE_CONTEST_SCORE'
  | 'HIGHEST_SEASON_TOTAL'
  | 'HIGHEST_SINGLE_WEEK_SCORE'         // H2H season-long
  | 'LOWEST_SINGLE_WEEK_SCORE'
  | 'BIGGEST_WIN_MARGIN'                // H2H
  | 'SMALLEST_WIN_MARGIN'               // H2H (closest game)
  | 'HIGHEST_POINTS_IN_LOSS'            // H2H — lost despite top-3 score that week

  // Win/Loss Records
  | 'LONGEST_WIN_STREAK'
  | 'LONGEST_LOSS_STREAK'
  | 'LONGEST_PLAYOFF_STREAK'
  | 'MOST_CHAMPIONSHIPS_ALL_TIME'
  | 'MOST_CONSECUTIVE_CHAMPIONSHIPS'
  | 'LONGEST_CHAMPIONSHIP_DROUGHT'
  | 'MOST_RUNNER_UP_FINISHES'
  | 'MOST_TOP_3_FINISHES'
  | 'FIRST_EVER_CHAMPION'
  | 'DEFENDING_CHAMPION'

  // Participation Records
  | 'MOST_SEASONS_ACTIVE'
  | 'MOST_CONTESTS_ENTERED'

  // Financial Records
  | 'MOST_TOTAL_WINNINGS'
  | 'BEST_NET_ROI'
  | 'WORST_NET_ROI'
  | 'MOST_ENTRY_FEES_PAID'

  // Luck/Analytics Records
  | 'LUCKIEST_SEASON'                   // biggest positive luck score
  | 'UNLUCKIEST_SEASON'                 // biggest negative luck score
  | 'MOST_IMPROVED_YEAR_OVER_YEAR'
  | 'MOST_CONSISTENT_ALL_TIME'          // lowest variance in percentile rank

  // Draft Records
  | 'BEST_DRAFT_VALUE'                  // pick that outperformed draft position most
  | 'WORST_DRAFT_VALUE'
  | 'EARLIEST_PICK_TO_WIN_CONTEST'
  | 'LATEST_DRAFT_PICK_TO_WIN_CONTEST'  // biggest draft underdog win

  // H2H Rivalry Records
  | 'MOST_DOMINANT_RIVALRY'             // highest win% against single opponent
  | 'MOST_CONTESTED_RIVALRY'            // most games played against single opponent
```

### 4.2 Record Storage

```typescript
interface LeagueRecord {
  id: string;
  league_id: string;
  category: RecordCategory;
  scope: 'ALL_TIME' | 'SINGLE_SEASON' | 'SINGLE_CONTEST' | 'MEMBER_CAREER';

  record_value: number;
  record_label: string;              // human-readable e.g. "247.8 points"

  held_by_team_id: string;
  held_by_member_id: string;
  held_by_member_name: string;
  set_in_contest_id?: string;
  set_in_season_id?: string;
  set_at: Date;

  previous_record?: {                // what the record was before this
    value: number;
    held_by: string;
    set_at: Date;
  };

  is_tied: boolean;
  tied_with?: string[];              // member IDs sharing the record

  last_computed_at: Date;
}
```

---

## 5. Analytics: Luck, Skill & Power Ratings

These computed analytics separate PoolMaster from basic history-tracking tools. They answer the question every manager asks after a season: "Was I actually good, or just lucky?"

### 5.1 Luck Score (All-Play Method)

The all-play method computes the expected win record a team would have if they played every other team every week. The difference between actual wins and expected wins is the luck score.

```
Expected wins per week = (team score rank - 1) / (num_teams - 1)
                        × (num_teams - 1)
                        = (rank - 1) in a league of N teams

All-play win rate = (wins against all other teams this week) / (N - 1)
Expected season wins = sum of all-play win probability across all weeks
Luck score = actual_wins - expected_wins
```

A luck score of +3.2 means the team won ~3 more games than their scoring would deserve. A score of -2.8 means they scored well enough to have won 3 more games but didn't due to unfortunate matchups.

```typescript
interface LuckScoreRecord {
  league_id: string;
  season_id: string;
  contest_id: string;
  team_id: string;
  league_membership_id: string;

  actual_wins: number;
  expected_wins: number;             // from all-play method
  luck_score: number;                // actual_wins - expected_wins
  luck_percentile: number;           // where this luck score ranks in league that season

  weekly_luck: WeeklyLuckEntry[];    // breakdown per week

  computed_at: Date;
}

interface WeeklyLuckEntry {
  week: number;
  team_score: number;
  actual_result: 'WIN' | 'LOSS' | 'TIE';
  all_play_wins: number;             // how many teams this score would have beaten
  all_play_losses: number;
  weekly_luck: number;               // 1 if won, 0 if lost, minus all_play_win_pct
}
```

### 5.2 Power Rating

Based on the Oberon Mountain Power Rating Formula (used by many ESPN/Sleeper leagues, featured on ESPN Fantasy Focus). Combines average score, score range, and winning percentage into a single skill indicator.

```
Raw Power Rating = (avg_score × 6) + ((high_score + low_score) × 2) + (win_pct × 200 × 2)
                  ─────────────────────────────────────────────────────────────────────────
                                              10

Adjusted Power Rating = raw_power_rating / league_average_raw_power_rating
```

An adjusted power rating above 1.0 means the team performed better than the average team in their league that season. This normalises across seasons where overall scoring levels change.

```typescript
interface PowerRatingRecord {
  league_id: string;
  season_id: string;
  team_id: string;
  league_membership_id: string;

  avg_score: number;
  high_score: number;
  low_score: number;
  win_pct: number;

  raw_power_rating: number;
  league_avg_raw_power_rating: number;
  adjusted_power_rating: number;     // raw / league_avg; 1.0 = exactly average

  // Career-adjusted: how does this season compare to the member's own history
  member_career_avg_power_rating: number;
  career_adjusted_power_rating: number;

  season_rank_by_power_rating: number;

  computed_at: Date;
}
```

### 5.3 Consistency Score

Measures variance in percentile finish across contests. A low standard deviation means the member finishes similarly in every contest — consistently good (or consistently bad). High variance means boom-or-bust.

```typescript
interface ConsistencyScore {
  league_id: string;
  league_membership_id: string;
  contests_included: number;
  mean_percentile: number;           // average finish percentile (0–100, lower = better rank)
  std_dev_percentile: number;        // standard deviation of percentile finishes
  consistency_score: number;         // 100 - std_dev_percentile (higher = more consistent)
  consistency_label: string;         // 'Very Consistent', 'Streaky', 'Volatile'
}
```

### 5.4 Year-Over-Year Improvement

```typescript
interface YearOverYearImprovement {
  league_id: string;
  league_membership_id: string;
  season_comparisons: SeasonComparison[];
}

interface SeasonComparison {
  season_from: string;
  season_to: string;
  avg_percentile_from: number;
  avg_percentile_to: number;
  power_rating_from: number;
  power_rating_to: number;
  improvement_score: number;         // positive = improved
  label: string;                     // 'Most Improved', 'Regressed', 'Consistent'
}
```

---

## 6. Rivalries

Rivalries track the full head-to-head record between every pair of league members, across all contests and seasons.

```typescript
interface RivalryRecord {
  league_id: string;
  member_a_id: string;
  member_b_id: string;

  // All-time H2H (all contest types combined)
  total_contests_shared: number;     // contests both entered
  total_h2h_matchups: number;        // direct matchups (H2H leagues)
  member_a_wins: number;
  member_b_wins: number;
  ties: number;
  member_a_win_pct: number;

  // Points in head-to-head matchups
  member_a_total_points_h2h: number;
  member_b_total_points_h2h: number;
  avg_margin: number;

  // Notable matchups
  biggest_margin: { winner_id: string; margin: number; contest: ContestRef; date: Date };
  closest_game: { winner_id: string; margin: number; contest: ContestRef; date: Date };

  // Streaks
  current_streak: { leader_id: string; length: number };
  longest_streak: { holder_id: string; length: number };

  // By sport / contest type
  h2h_by_sport: Record<string, { a_wins: number; b_wins: number }>;
  h2h_by_season: Record<string, { a_wins: number; b_wins: number }>;

  // Final standings comparison (for non-H2H contests)
  member_a_avg_rank_vs_b: number;    // avg rank in contests both entered
  member_b_avg_rank_vs_a: number;

  last_matchup_at?: Date;
  last_updated_at: Date;
}
```

**Rivalry highlights surfaced in UI:**
- "You've beaten Alex 14–9 all time, but lost the last 3 in a row"
- "Your biggest win over Jordan: 247–183 in the 2023 Masters Pool"
- "You and Sam have never had a direct matchup — but you've both entered 12 contests together"

---

## 7. Trophy Case & Achievements

Every league member has a trophy case displaying their notable achievements as visual badges.

### 7.1 Trophy Types

```typescript
type TrophyType =
  // Championship trophies
  | 'LEAGUE_CHAMPION'                // won a contest
  | 'BACK_TO_BACK_CHAMPION'
  | 'THREE_PEAT'
  | 'DYNASTY'                        // 3+ championships in a league

  // Playoff / finish trophies
  | 'RUNNER_UP'
  | 'TOP_3_FINISH'
  | 'PAID_POSITION'

  // Scoring trophies
  | 'RECORD_SCORE'                   // set a league record score
  | 'PERFECT_CONTEST'                // all picks correct (bracket/survivor)

  // Intermediate prize trophies
  | 'ROUND_LEADER'                   // won a mid-contest prize
  | 'CUT_LEADER'
  | 'WEEKLY_HIGH_SCORE'

  // Season achievement trophies
  | 'REGULAR_SEASON_CHAMPION'
  | 'DIVISION_WINNER'
  | 'MOST_POINTS_SEASON'

  // Analytics trophies
  | 'POWER_PLAYER'                   // top power rating in the league that season
  | 'UNLUCKIEST_PLAYER'              // biggest negative luck score
  | 'COMEBACK_KID'                   // biggest improvement season over season
  | 'IRON_CONSISTENT'                // lowest variance in finish percentile

  // Longevity
  | 'FOUNDING_MEMBER'                // in league since its first season
  | 'VETERAN'                        // 5+ seasons in a league

  // Consolation
  | 'TOILET_BOWL_CHAMPION'
  | 'LAST_PLACE'
```

```typescript
interface Trophy {
  id: string;
  league_id: string;
  league_membership_id: string;
  trophy_type: TrophyType;
  season_id?: string;
  contest_id?: string;
  label: string;                     // e.g. "2024 Masters Pool Champion"
  description: string;
  awarded_at: Date;
  is_displayed: boolean;             // member can hide from case
}
```

---

## 8. API Endpoints

### 8.1 Contest History Endpoints

```
GET  /contests/:id/history/summary          → ContestHistorySummary
GET  /contests/:id/history/timeline         → ContestScoringTimeline
GET  /contests/:id/history/standings        → final standings with scores
GET  /contests/:id/history/roster/:teamId   → ContestRosterReplay
GET  /contests/:id/history/draft            → DraftHistoryReplay
GET  /contests/:id/history/payouts          → PayoutHistory for contest
```

### 8.2 League History Endpoints

```
GET  /leagues/:id/history                   → season list with summaries
GET  /leagues/:id/history/seasons/:sid      → LeagueSeasonSummary
GET  /leagues/:id/history/champions         → champion per season/contest
GET  /leagues/:id/history/members           → AllTimeLeaderboard (configurable sort)
GET  /leagues/:id/history/members/:mid      → MemberAllTimeStats
GET  /leagues/:id/history/records           → full LeagueRecord list
GET  /leagues/:id/history/records/:category → specific record with history
GET  /leagues/:id/history/rivalries         → all rivalry pairs
GET  /leagues/:id/history/rivalries/:mid1/:mid2 → RivalryRecord between two members
GET  /leagues/:id/history/analytics/luck    → LuckScoreRecord list by season
GET  /leagues/:id/history/analytics/power   → PowerRatingRecord list
GET  /leagues/:id/history/trophies/:mid     → member trophy case
```

### 8.3 Member History Endpoints (Cross-League)

```
GET  /members/:id/history                   → all contests entered across all leagues
GET  /members/:id/history/stats             → aggregated stats across all leagues
GET  /members/:id/history/trophies          → all trophies across all leagues
```

---

## 9. History Computation Pipeline

History records are computed and updated through two mechanisms:

**Synchronous (at contest close):** When a contest transitions to CLOSED, the History Service runs synchronously to write the immutable ContestResult, TeamRosterHistory, and PayoutHistory records before any notifications are sent.

**Asynchronous (background jobs):** Derived analytics — power ratings, luck scores, streaks, records, rivalries — are computed by background workers triggered after contest close. They can also be re-triggered on demand by an admin.

```
ContestClosed event (message bus)
        │
        ├──► HistoryWriter (sync)
        │       ├── Write ContestResult rows
        │       ├── Freeze TeamRosterHistory
        │       └── Write PayoutHistory
        │
        └──► AnalyticsWorker (async, queued)
                ├── Recompute MemberAllTimeStats for affected members
                ├── Recompute AllTimeLeaderboard for league
                ├── Update StreakRecords
                ├── Update RivalryRecords
                ├── Recompute LuckScores for season
                ├── Recompute PowerRatings for season
                ├── Check and update LeagueRecord book
                ├── Award new Trophies
                ├── Update LeagueSeasonSummary
                └── Invalidate relevant caches
```

---

## 10. Data Retention Policy

```typescript
interface HistoryRetentionPolicy {
  // SQL — permanent, never deleted
  contest_results: 'PERMANENT';
  matchup_history: 'PERMANENT';
  payout_history: 'PERMANENT';
  draft_pick_history: 'PERMANENT';
  team_roster_history: 'PERMANENT';

  // NoSQL — event-level data retained for defined window
  participant_event_stats: '3_YEARS';    // per-round golf scores, per-lap F1 data etc.
  team_points_events: '3_YEARS';         // high-frequency scoring events

  // Derived / cache — rebuilt on demand, no retention concern
  analytics_cache: 'REBUILT_ON_DEMAND';
  leaderboard_snapshots: '90_DAYS';

  // Contest scoring timeline snapshots (checkpoints)
  scoring_timeline_snapshots: '5_YEARS';
}
```

Tenant admins can configure extended retention (up to unlimited) as a paid feature.

---

## 11. Commissioner History Tools

Commissioners have additional history management capabilities:

- **Season note:** Add a free-text note to any completed season (e.g. "First year we ran a Masters pool. Alex dominated with Rory on his team.")
- **Custom trophy award:** Commissioner can manually award a custom trophy to any member
- **Record correction:** If a contest result was incorrect (e.g. data provider error), commissioner can submit a correction request (requires platform support review for immutable records)
- **Season import:** For leagues migrating to PoolMaster from another platform, commissioners can manually enter historical season data (champions, standings, record holders) even if not tracked in the system. These appear with a `manually_imported: true` flag and are excluded from computed analytics
- **Member merge:** If a member leaves and rejoins under a different account, commissioner can request a member merge to preserve all-time stats
- **History export:** Full export of all league history data as CSV or JSON for any season or all-time

---

## 12. Build Phases

### Phase 1 — Foundation (at contest close)
- ContestResult write on contest close
- TeamRosterHistory freeze
- PayoutHistory write
- Basic contest summary endpoint
- Final standings history per contest

### Phase 2 — League History Views
- LeagueSeasonSummary aggregation
- All-time champion list per league
- Member stats page (wins, entries, winnings)
- AllTimeLeaderboard (basic sort by wins)
- Trophy case (championships and runner-up only)

### Phase 3 — Scoring Timeline & Replays
- ContestScoringTimeline checkpoints
- DraftHistoryReplay
- ContestRosterReplay with scoring breakdown
- MatchupHistory for H2H season-long leagues

### Phase 4 — Records & Rivalries
- LeagueRecord book engine (30+ categories)
- StreakRecord computation
- RivalryRecord computation for all member pairs
- Full trophy type library

### Phase 5 — Analytics: Luck & Power Ratings
- All-play luck score calculation
- Oberon Mountain power rating
- Consistency score
- Year-over-year improvement tracking
- Analytics-based trophies (Power Player, Unluckiest, etc.)

### Phase 6 — Commissioner Tools & Export
- Season notes and custom trophy awards
- Manual season import
- Member merge tool
- Full data export (CSV/JSON)
- Extended retention configuration

---

*Generated by Claude — PoolMaster Contest History & League History Plan v1.0*
