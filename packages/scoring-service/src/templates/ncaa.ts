/**
 * NCAA Bracket Scoring Templates — Standard, Upset Bonus, Seed Multiplier.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';

const NCAA_STANDARD_ROUND_RULES: ScoringConfig['bracket_round_rules'] = [
  { round: 1, round_name: 'Round of 64', points_per_correct: 1 },
  { round: 2, round_name: 'Round of 32', points_per_correct: 2 },
  { round: 3, round_name: 'Sweet 16', points_per_correct: 4 },
  { round: 4, round_name: 'Elite Eight', points_per_correct: 8 },
  { round: 5, round_name: 'Final Four', points_per_correct: 16 },
  { round: 6, round_name: 'Championship', points_per_correct: 32 },
];

export const ncaaStandardScoring: ScoringConfig = {
  sport: 'NCAA_BASKETBALL',
  scoring_type: 'BRACKET',
  stat_rules: [],
  position_rules: [],
  bonus_rules: [],
  penalty_rules: [],
  multiplier_rules: [],
  bracket_round_rules: NCAA_STANDARD_ROUND_RULES,
  upset_bonus_config: null,
  tiebreaker_config: {
    primary: 'CHAMPIONSHIP_SCORE_PREDICTION',
  },
  dnf_handling: 'ZERO',
  counting_method: 'ALL',
  lower_is_better: false,
};

export const ncaaUpsetBonusScoring: ScoringConfig = {
  ...ncaaStandardScoring,
  upset_bonus_config: {
    type: 'SEED_DIFFERENCE',
    apply_round_multiplier: false,
  },
};

export const ncaaSeedMultiplierScoring: ScoringConfig = {
  ...ncaaStandardScoring,
  upset_bonus_config: {
    type: 'SEED_MULTIPLIER',
    apply_round_multiplier: true,
  },
};

export const ncaaFlatScoring: ScoringConfig = {
  ...ncaaStandardScoring,
  bracket_round_rules: [
    { round: 1, round_name: 'Round of 64', points_per_correct: 1 },
    { round: 2, round_name: 'Round of 32', points_per_correct: 1 },
    { round: 3, round_name: 'Sweet 16', points_per_correct: 1 },
    { round: 4, round_name: 'Elite Eight', points_per_correct: 1 },
    { round: 5, round_name: 'Final Four', points_per_correct: 1 },
    { round: 6, round_name: 'Championship', points_per_correct: 1 },
  ],
};

export const NCAA_TEMPLATES = {
  ncaa_bracket_standard: ncaaStandardScoring,
  ncaa_bracket_upset_bonus: ncaaUpsetBonusScoring,
  ncaa_bracket_seed_multiplier: ncaaSeedMultiplierScoring,
  ncaa_bracket_flat: ncaaFlatScoring,
} as const;
