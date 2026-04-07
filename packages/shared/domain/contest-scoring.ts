import { z } from 'zod';

export const ParticipantScoringDefinitionIdSchema = z.enum([
  'GOLF_RELATIVE_TO_PAR_TOTAL',
  'TEAM_WIN_POINTS',
  'ROUND_MULTIPLIER',
  'SEED_DIFFERENTIAL_BONUS',
  'PREDICTION',
]);
export type ParticipantScoringDefinitionId = z.infer<
  typeof ParticipantScoringDefinitionIdSchema
>;

export const AggregationDefinitionIdSchema = z.enum([
  'SUM_ALL_ENTRIES',
  'SUM_TOP_N_ENTRIES',
]);
export type AggregationDefinitionId = z.infer<
  typeof AggregationDefinitionIdSchema
>;
