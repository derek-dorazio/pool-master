/**
 * Soccer/EPL Scoring Template — DFS-style stat accumulation.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const eplDfsScoring: ScoringConfig = {
  sport: 'SOCCER',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    // Attacking
    { stat_key: 'goal_scored', points_per_unit: 6, description: '6 pts per goal' },
    { stat_key: 'assist', points_per_unit: 4, description: '4 pts per assist' },
    { stat_key: 'shot_on_target', points_per_unit: 0.5, description: '0.5 per shot on target' },
    { stat_key: 'key_pass', points_per_unit: 0.5, description: '0.5 per key pass' },
    // Defending
    { stat_key: 'clean_sheet_gk', points_per_unit: 6, description: 'GK clean sheet' },
    { stat_key: 'clean_sheet_def', points_per_unit: 4, description: 'Defender clean sheet' },
    { stat_key: 'tackle', points_per_unit: 0.5, description: '0.5 per tackle' },
    { stat_key: 'interception', points_per_unit: 0.5, description: '0.5 per interception' },
    // GK specific
    { stat_key: 'save', points_per_unit: 1, description: '1 pt per save' },
    { stat_key: 'penalty_save', points_per_unit: 5, description: '5 pts per penalty save' },
    // Negative
    { stat_key: 'yellow_card', points_per_unit: -1, description: '-1 per yellow card' },
    { stat_key: 'red_card', points_per_unit: -3, description: '-3 per red card' },
    { stat_key: 'own_goal', points_per_unit: -2, description: '-2 per own goal' },
    { stat_key: 'penalty_missed', points_per_unit: -2, description: '-2 per penalty missed' },
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
  epl_dfs_standard: eplDfsScoring,
} as const;
