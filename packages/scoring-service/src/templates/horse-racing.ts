/**
 * Horse Racing Scoring Template — Position-based scoring.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

export const horseRacingPositionScoring: ScoringConfig = {
  sport: 'HORSE_RACING',
  scoring_type: 'POSITION',
  stat_rules: [],
  position_rules: [
    { position: 1, points: 100 },
    { position: 2, points: 60 },
    { position: 3, points: 40 },
    { position: 4, points: 25 },
    { position: 5, points: 15 },
    { position_range: [6, 10], points: 5 },
  ],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const HORSE_RACING_TEMPLATES = {
  horse_racing_position: horseRacingPositionScoring,
} as const;
