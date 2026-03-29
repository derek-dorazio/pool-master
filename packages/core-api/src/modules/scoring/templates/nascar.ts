/**
 * NASCAR Scoring Template — DraftKings-style with position, place differential, laps.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const nascarDfsScoring: ScoringConfig = {
  sport: 'NASCAR',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    { stat_key: 'place_differential', points_per_unit: 1, description: '±1 pt per position gained/lost vs. start' },
    { stat_key: 'fastest_lap', points_per_unit: 0.45, description: '0.45 pts per fastest lap' },
    { stat_key: 'laps_led', points_per_unit: 0.25, description: '0.25 pts per lap led' },
    { stat_key: 'stage_win', points_per_unit: 4, description: '4 pts per stage win' },
    { stat_key: 'led_most_laps', points_per_unit: 2, description: '+2 pts for leading most laps' },
  ],
  position_rules: [
    { position: 1, points: 45 },
    { position: 2, points: 42 },
    { position: 3, points: 41 },
    { position_range: [4, 10], points: 37 },
    { position_range: [11, 20], points: 27 },
    { position_range: [21, 30], points: 17 },
    { position_range: [31, 40], points: 7 },
  ],
  bonus_rules: [
    { trigger: { stat_key: 'laps_led', condition: { operator: 'gte', value: 1 } }, points: 2, description: 'Bonus for leading any lap' },
  ],
  penalty_rules: [],
  multiplier_rules: [],
  bracket_round_rules: [],
  special_slots: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const NASCAR_TEMPLATES = {
  nascar_dfs_place_diff: nascarDfsScoring,
} as const;
