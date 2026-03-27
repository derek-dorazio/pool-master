/**
 * NFL Scoring Templates — Standard, PPR, Half-PPR.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

const NFL_BASE_STAT_RULES: ScoringConfig['stat_rules'] = [
  // Passing
  { stat_key: 'passing_yards', points_per_unit: 0.04, unit_size: 1, description: '1 pt per 25 passing yards' },
  { stat_key: 'passing_td', points_per_unit: 4, description: '4 pts per passing TD' },
  { stat_key: 'interception_thrown', points_per_unit: -2, description: '-2 pts per interception' },
  { stat_key: 'passing_2pt_conversion', points_per_unit: 2, description: '+2 pts per 2-pt conversion pass' },
  // Rushing
  { stat_key: 'rushing_yards', points_per_unit: 0.1, description: '1 pt per 10 rushing yards' },
  { stat_key: 'rushing_td', points_per_unit: 6, description: '6 pts per rushing TD' },
  { stat_key: 'rushing_2pt_conversion', points_per_unit: 2, description: '+2 pts per rushing 2-pt conversion' },
  { stat_key: 'fumble_lost', points_per_unit: -2, description: '-2 pts per fumble lost' },
  // Receiving
  { stat_key: 'receiving_yards', points_per_unit: 0.1, description: '1 pt per 10 receiving yards' },
  { stat_key: 'receiving_td', points_per_unit: 6, description: '6 pts per receiving TD' },
  { stat_key: 'receiving_2pt_conversion', points_per_unit: 2, description: '+2 pts per receiving 2-pt conversion' },
  // Kicker
  { stat_key: 'fg_made_0_39', points_per_unit: 3, description: 'FG 0-39 yards' },
  { stat_key: 'fg_made_40_49', points_per_unit: 4, description: 'FG 40-49 yards' },
  { stat_key: 'fg_made_50_plus', points_per_unit: 5, description: 'FG 50+ yards' },
  { stat_key: 'fg_missed', points_per_unit: -1, description: 'Missed FG' },
  { stat_key: 'pat_made', points_per_unit: 1, description: 'Extra point' },
  { stat_key: 'pat_missed', points_per_unit: -1, description: 'Missed extra point' },
];

const NFL_BONUS_RULES: ScoringConfig['bonus_rules'] = [
  { trigger: { stat_key: 'passing_yards', condition: { operator: 'gte', value: 300 } }, points: 3, description: '300+ passing yard bonus' },
  { trigger: { stat_key: 'rushing_yards', condition: { operator: 'gte', value: 100 } }, points: 3, description: '100+ rushing yard bonus' },
  { trigger: { stat_key: 'receiving_yards', condition: { operator: 'gte', value: 100 } }, points: 3, description: '100+ receiving yard bonus' },
];

export const nflStandardScoring: ScoringConfig = {
  sport: 'NFL',
  scoring_type: 'CUMULATIVE',
  stat_rules: NFL_BASE_STAT_RULES,
  bonus_rules: NFL_BONUS_RULES,
  position_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  bracket_round_rules: [],
  special_slots: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const nflPprScoring: ScoringConfig = {
  ...nflStandardScoring,
  stat_rules: [
    ...NFL_BASE_STAT_RULES,
    { stat_key: 'reception', points_per_unit: 1, description: '1 pt per reception (PPR)' },
  ],
};

export const nflHalfPprScoring: ScoringConfig = {
  ...nflStandardScoring,
  stat_rules: [
    ...NFL_BASE_STAT_RULES,
    { stat_key: 'reception', points_per_unit: 0.5, description: '0.5 pts per reception (half-PPR)' },
  ],
};

export const NFL_TEMPLATES = {
  nfl_standard_nonppr: nflStandardScoring,
  nfl_ppr: nflPprScoring,
  nfl_half_ppr: nflHalfPprScoring,
} as const;
