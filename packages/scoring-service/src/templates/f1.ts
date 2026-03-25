/**
 * F1 Scoring Template — DraftKings-style with position, SVG, and stats.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const f1DfsScoring: ScoringConfig = {
  sport: 'F1',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    { stat_key: 'laps_led', points_per_unit: 0.1, description: '0.1 pt per lap led' },
    { stat_key: 'classified_finish', points_per_unit: 1, description: '1 pt for completing 90%+ of race' },
    { stat_key: 'fastest_lap', points_per_unit: 1, description: '1 pt for setting fastest lap' },
    { stat_key: 'beat_teammate', points_per_unit: 3, description: '+3 pts for beating teammate in race' },
  ],
  position_rules: [
    { position: 1, points: 25 },
    { position: 2, points: 18 },
    { position: 3, points: 15 },
    { position: 4, points: 12 },
    { position: 5, points: 10 },
    { position: 6, points: 8 },
    { position: 7, points: 6 },
    { position: 8, points: 4 },
    { position: 9, points: 2 },
    { position: 10, points: 1 },
  ],
  bonus_rules: [
    { trigger: { stat_key: 'spots_gained', condition: { operator: 'gte', value: 10 } }, points: 5, description: '+10 spots gained' },
    { trigger: { stat_key: 'spots_gained', condition: { operator: 'between', value: 5, value2: 9 } }, points: 3, description: '+5-9 spots gained' },
    { trigger: { stat_key: 'spots_gained', condition: { operator: 'between', value: 3, value2: 4 } }, points: 2, description: '+3-4 spots gained' },
  ],
  penalty_rules: [
    { trigger: 'spots_lost_10_plus', points: -5, description: '-10+ spots lost' },
    { trigger: 'spots_lost_5_9', points: -3, description: '-5-9 spots lost' },
    { trigger: 'spots_lost_3_4', points: -2, description: '-3-4 spots lost' },
  ],
  multiplier_rules: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const F1_TEMPLATES = {
  f1_dfs_captain: f1DfsScoring,
} as const;
