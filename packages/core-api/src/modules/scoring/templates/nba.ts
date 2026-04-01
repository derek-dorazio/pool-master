/**
 * NBA Scoring Template — simple points, assists, rebounds.
 *
 * Focused on core stats that are easy to source.
 * Advanced stats (steals, blocks, turnovers, double/triple-double) are deferred.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const nbaSimpleScoring: ScoringConfig = {
  sport: 'NBA',
  scoring_type: 'CUMULATIVE',
  stat_rules: [
    { stat_key: 'points', points_per_unit: 1, description: '1 pt per point scored' },
    { stat_key: 'assists', points_per_unit: 1.5, description: '1.5 pts per assist' },
    { stat_key: 'rebounds', points_per_unit: 1.25, description: '1.25 pts per rebound' },
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

export const NBA_TEMPLATES = {
  nba_simple: nbaSimpleScoring,
} as const;
