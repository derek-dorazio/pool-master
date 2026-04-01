/**
 * Golf Scoring Templates — relative-to-par scoring for office pool play.
 *
 * Score is relative to par per hole: birdie = -1, eagle = -2, bogey = +1, etc.
 * Lower total score wins. Best-N counting keeps the best scores from a roster.
 * No missed-cut penalty needed — players who miss the cut already have high
 * relative-to-par scores that won't be among the best N.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const golfRelativeToParScoring: ScoringConfig = {
  sport: 'GOLF',
  scoring_type: 'STROKE_PLAY',
  stat_rules: [
    { stat_key: 'hole_in_one', points_per_unit: -3, description: 'Hole in one (3 under par)' },
    { stat_key: 'albatross', points_per_unit: -3, description: 'Albatross / double eagle (3 under)' },
    { stat_key: 'eagle', points_per_unit: -2, description: 'Eagle (2 under par)' },
    { stat_key: 'birdie', points_per_unit: -1, description: 'Birdie (1 under par)' },
    { stat_key: 'par', points_per_unit: 0, description: 'Par (even)' },
    { stat_key: 'bogey', points_per_unit: 1, description: 'Bogey (1 over par)' },
    { stat_key: 'double_bogey', points_per_unit: 2, description: 'Double bogey (2 over par)' },
    { stat_key: 'triple_bogey_or_worse', points_per_unit: 3, description: 'Triple bogey or worse (3+ over par)' },
  ],
  position_rules: [],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  bracket_round_rules: [],
  special_slots: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: true,
};

export const golfBestNScoring: ScoringConfig = {
  ...golfRelativeToParScoring,
  counting_method: 'BEST_N',
  best_n: 4,
};

export const GOLF_TEMPLATES = {
  golf_relative_to_par: golfRelativeToParScoring,
  golf_pick6_use4: golfBestNScoring,
} as const;
