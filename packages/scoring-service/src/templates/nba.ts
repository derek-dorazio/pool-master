/**
 * NBA Scoring Templates — Points League and 9-Category Rotisserie.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const nbaPointsLeagueScoring: ScoringConfig = {
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
  position_rules: [],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const NBA_TEMPLATES = {
  nba_points_league: nbaPointsLeagueScoring,
} as const;
