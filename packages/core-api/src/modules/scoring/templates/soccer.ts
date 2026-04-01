/**
 * Soccer Scoring Template — simple goals and assists scoring.
 *
 * Focused on the core stats that are easy to source and understand.
 * Advanced stats (tackles, interceptions, saves, clean sheets) are deferred.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const soccerGoalsAssistsScoring: ScoringConfig = {
  sport: 'SOCCER',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    { stat_key: 'goal_scored', points_per_unit: 6, description: '6 pts per goal' },
    { stat_key: 'assist', points_per_unit: 4, description: '4 pts per assist' },
    { stat_key: 'yellow_card', points_per_unit: -1, description: '-1 per yellow card' },
    { stat_key: 'red_card', points_per_unit: -3, description: '-3 per red card' },
    { stat_key: 'own_goal', points_per_unit: -2, description: '-2 per own goal' },
  ],
  position_rules: [],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  bracket_round_rules: [],
  special_slots: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const SOCCER_TEMPLATES = {
  soccer_goals_assists: soccerGoalsAssistsScoring,
} as const;
