/**
 * Tennis Scoring Template — Grand Slam DFS scoring.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const tennisDfsScoring: ScoringConfig = {
  sport: 'TENNIS',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    { stat_key: 'aces', points_per_unit: 0.25, description: '0.25 pts per ace' },
    { stat_key: 'double_faults', points_per_unit: -0.5, description: '-0.5 per double fault' },
    { stat_key: 'break_points_won', points_per_unit: 0.5, description: '0.5 pts per break' },
    { stat_key: 'straight_sets_win', points_per_unit: 5, description: '+5 for straight-sets win' },
  ],
  position_rules: [
    { position: 1, points: 40, description: 'Tournament winner' },
    { position: 2, points: 30, description: 'Finalist' },
    { position_range: [3, 4], points: 25, description: 'Semifinalists' },
    { position_range: [5, 8], points: 20, description: 'Quarterfinals exit' },
    { position_range: [9, 16], points: 15, description: 'Round of 16 exit' },
    { position_range: [17, 32], points: 10, description: 'Round of 32 exit' },
    { position_range: [33, 64], points: 5, description: 'Round of 64 exit' },
  ],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const TENNIS_TEMPLATES = {
  tennis_slam_dfs: tennisDfsScoring,
} as const;
