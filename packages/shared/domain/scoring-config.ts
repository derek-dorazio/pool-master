/**
 * ScoringConfig — Zod schemas and inferred TypeScript types for the
 * configurable scoring rule framework.
 *
 * Stored as JSONB per contest. The scoring engine reads this config,
 * consumes stat events, and produces points. No sport logic is hard-coded.
 */

import { z } from 'zod';

// --- Enums ---

export const ScoringType = z.enum([
  'CUMULATIVE',
  'KNOCKOUT',
  'BRACKET',
  'STROKE_PLAY',
  'POSITION',
]);
export type ScoringType = z.infer<typeof ScoringType>;

export const DNFHandling = z.enum([
  'ZERO',
  'EXCLUDE',
  'LAST_PLACE',
  'PENALTY',
  'MISSED_CUT_SCORE',
]);
export type DNFHandling = z.infer<typeof DNFHandling>;

export const CountingMethod = z.enum([
  'ALL',
  'BEST_N',
  'DROP_LOWEST_N',
]);
export type CountingMethod = z.infer<typeof CountingMethod>;

export const TiebreakerMethod = z.enum([
  'CHAMPIONSHIP_SCORE_PREDICTION',
  'MOST_CORRECT_PICKS',
  'EARLIER_SUBMISSION',
  'BEST_SINGLE_SCORE',
  'MOST_BIRDIES',
  'LOWEST_ROUND',
  'HEAD_TO_HEAD_RECORD',
  'MOST_WINS',
  'COIN_FLIP',
  'COMMISSIONER_DECISION',
]);
export type TiebreakerMethod = z.infer<typeof TiebreakerMethod>;

// --- Rule Condition ---

export const RuleConditionSchema = z.object({
  operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte', 'between']),
  value: z.number(),
  value2: z.number().optional(),
});
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

// --- Stat Rule ---

export const StatRuleSchema = z.object({
  stat_key: z.string(),
  points_per_unit: z.number(),
  unit_size: z.number().optional(),
  condition: RuleConditionSchema.optional(),
  description: z.string().optional(),
});
export type StatRule = z.infer<typeof StatRuleSchema>;

// --- Position Rule ---

export const PositionRuleSchema = z.object({
  position: z.union([z.number(), z.literal('LAST'), z.literal('CUT')]).optional(),
  position_range: z.tuple([z.number(), z.number()]).optional(),
  points: z.number(),
  description: z.string().optional(),
});
export type PositionRule = z.infer<typeof PositionRuleSchema>;

// --- Bonus Trigger ---

export const BonusTriggerSchema = z.object({
  stat_key: z.string(),
  condition: RuleConditionSchema,
});
export type BonusTrigger = z.infer<typeof BonusTriggerSchema>;

// --- Bonus Rule ---

export const BonusRuleSchema = z.object({
  trigger: BonusTriggerSchema,
  points: z.number(),
  description: z.string().optional(),
});
export type BonusRule = z.infer<typeof BonusRuleSchema>;

// --- Penalty Rule ---

export const PenaltyRuleSchema = z.object({
  trigger: z.string(),
  points: z.number(),
  description: z.string().optional(),
});
export type PenaltyRule = z.infer<typeof PenaltyRuleSchema>;

// --- Multiplier Rule ---

export const MultiplierRuleSchema = z.object({
  applies_to: z.enum(['ALL', 'STAT', 'POSITION', 'SLOT']),
  slot_id: z.string().optional(),
  stat_key: z.string().optional(),
  multiplier: z.number(),
});
export type MultiplierRule = z.infer<typeof MultiplierRuleSchema>;

// --- Bracket Round Rule ---

export const BracketRoundRuleSchema = z.object({
  round: z.number(),
  round_name: z.string().optional(),
  points_per_correct: z.number(),
});
export type BracketRoundRule = z.infer<typeof BracketRoundRuleSchema>;

// --- Upset Bonus Config ---

export const UpsetBonusConfigSchema = z.object({
  type: z.enum(['SEED_DIFFERENCE', 'SEED_MULTIPLIER']),
  apply_round_multiplier: z.boolean().default(false),
}).nullable();
export type UpsetBonusConfig = z.infer<typeof UpsetBonusConfigSchema>;

// --- Tiebreaker Config ---

export const TiebreakerConfigSchema = z.object({
  primary: TiebreakerMethod,
  secondary: TiebreakerMethod.optional(),
  tertiary: TiebreakerMethod.optional(),
});
export type TiebreakerConfig = z.infer<typeof TiebreakerConfigSchema>;

// --- Main ScoringConfig ---

export const ScoringConfigSchema = z.object({
  contest_id: z.string().optional(),
  sport: z.string(),
  scoring_type: ScoringType,

  stat_rules: z.array(StatRuleSchema).default([]),
  position_rules: z.array(PositionRuleSchema).default([]),
  bonus_rules: z.array(BonusRuleSchema).default([]),
  penalty_rules: z.array(PenaltyRuleSchema).default([]),
  multiplier_rules: z.array(MultiplierRuleSchema).default([]),

  bracket_round_rules: z.array(BracketRoundRuleSchema).default([]),
  upset_bonus_config: UpsetBonusConfigSchema.optional(),

  tiebreaker_config: TiebreakerConfigSchema.optional(),

  // DNF / missed cut
  missed_event_score: z.number().optional(),
  missed_event_points: z.number().optional(),
  dnf_handling: DNFHandling.default('ZERO'),

  // Aggregation
  counting_method: CountingMethod.default('ALL'),
  best_n: z.number().int().positive().optional(),
  drop_lowest_n: z.number().int().positive().optional(),

  // Stroke play
  lower_is_better: z.boolean().default(false),
});
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;
