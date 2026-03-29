/**
 * Golf Scoring Templates — DraftKings-style DFS and office pool stroke play.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const golfDfsScoring: ScoringConfig = {
  sport: 'GOLF',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
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
    { trigger: { stat_key: 'consecutive_birdies', condition: { operator: 'gte', value: 3 } }, points: 3, description: '3+ consecutive birdies' },
    { trigger: { stat_key: 'bogey_free_round', condition: { operator: 'eq', value: 1 } }, points: 3, description: 'Bogey-free round' },
    { trigger: { stat_key: 'round_score', condition: { operator: 'lte', value: -5 } }, points: 5, description: 'Round of -5 or better' },
  ],
  penalty_rules: [],
  multiplier_rules: [],
  missed_event_points: 0,
  bracket_round_rules: [],
  special_slots: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const golfStrokePlayScoring: ScoringConfig = {
  sport: 'GOLF',
  scoring_type: 'STROKE_PLAY',
  stat_rules: [
    { stat_key: 'total_strokes', points_per_unit: 1, description: 'Count actual strokes' },
  ],
  position_rules: [],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  bracket_round_rules: [],
  special_slots: [],
  missed_event_score: 80,
  dnf_handling: 'MISSED_CUT_SCORE',
  counting_method: 'BEST_N',
  best_n: 4,
  lower_is_better: true,
};

export const GOLF_TEMPLATES = {
  golf_dfs_standard: golfDfsScoring,
  golf_stroke_pick6_use4: golfStrokePlayScoring,
} as const;
