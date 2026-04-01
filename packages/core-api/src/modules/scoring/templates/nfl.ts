/**
 * NFL Scoring Templates — Standard, PPR, and Half-PPR player scoring.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const nflStandardScoring: ScoringConfig = {
  sport: 'NFL',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    // Passing
    { stat_key: 'passing_yards', points_per_unit: 0.04, description: '1 pt per 25 yards', unit_size: 1 },
    { stat_key: 'passing_td', points_per_unit: 4, description: '4 pts per passing TD' },
    { stat_key: 'interception_thrown', points_per_unit: -2, description: '-2 pts per INT' },
    { stat_key: 'passing_2pt_conversion', points_per_unit: 2, description: '2 pts per 2PT pass' },
    // Rushing
    { stat_key: 'rushing_yards', points_per_unit: 0.1, description: '1 pt per 10 yards', unit_size: 1 },
    { stat_key: 'rushing_td', points_per_unit: 6, description: '6 pts per rushing TD' },
    { stat_key: 'rushing_2pt_conversion', points_per_unit: 2, description: '2 pts per 2PT rush' },
    { stat_key: 'fumble_lost', points_per_unit: -2, description: '-2 pts per fumble lost' },
    // Receiving
    { stat_key: 'receiving_yards', points_per_unit: 0.1, description: '1 pt per 10 yards', unit_size: 1 },
    { stat_key: 'receiving_td', points_per_unit: 6, description: '6 pts per receiving TD' },
    { stat_key: 'receiving_2pt_conversion', points_per_unit: 2, description: '2 pts per 2PT rec' },
    // Kicking
    { stat_key: 'fg_made_0_39', points_per_unit: 3, description: '3 pts per FG 0-39 yds' },
    { stat_key: 'fg_made_40_49', points_per_unit: 4, description: '4 pts per FG 40-49 yds' },
    { stat_key: 'fg_made_50_plus', points_per_unit: 5, description: '5 pts per FG 50+ yds' },
    { stat_key: 'fg_missed', points_per_unit: -1, description: '-1 pt per missed FG' },
    { stat_key: 'pat_made', points_per_unit: 1, description: '1 pt per PAT made' },
    { stat_key: 'pat_missed', points_per_unit: -1, description: '-1 pt per PAT missed' },
  ],
  position_rules: [],
  bonus_rules: [
    { trigger: { stat_key: 'passing_yards', condition: { operator: 'gte' as const, value: 300 } }, points: 3, description: '300+ passing yards bonus' },
    { trigger: { stat_key: 'rushing_yards', condition: { operator: 'gte' as const, value: 100 } }, points: 3, description: '100+ rushing yards bonus' },
    { trigger: { stat_key: 'receiving_yards', condition: { operator: 'gte' as const, value: 100 } }, points: 3, description: '100+ receiving yards bonus' },
  ],
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
    ...nflStandardScoring.stat_rules,
    { stat_key: 'reception', points_per_unit: 1, description: '1 pt per reception (PPR)' },
  ],
};

export const nflHalfPprScoring: ScoringConfig = {
  ...nflStandardScoring,
  stat_rules: [
    ...nflStandardScoring.stat_rules,
    { stat_key: 'reception', points_per_unit: 0.5, description: '0.5 pts per reception (Half-PPR)' },
  ],
};

export const NFL_TEMPLATES = {
  nfl_standard: nflStandardScoring,
  nfl_ppr: nflPprScoring,
  nfl_half_ppr: nflHalfPprScoring,
} as const;
