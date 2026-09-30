import { z } from 'zod';

/**
 * Only ids with a live scoring engine are listed. The exhaustive
 * `PARTICIPANT_SCORING_DEFINITIONS` record below means an id added here fails
 * the build until its direction, unit and format are declared.
 */
export const ParticipantScoringDefinitionIdSchema = z.enum([
  'GOLF_RELATIVE_TO_PAR_TOTAL',
]);
export type ParticipantScoringDefinitionId = z.infer<
  typeof ParticipantScoringDefinitionIdSchema
>;

export const AggregationDefinitionIdSchema = z.enum([
  'SUM_ALL_ENTRIES',
]);
export type AggregationDefinitionId = z.infer<
  typeof AggregationDefinitionIdSchema
>;

/**
 * Direction of merit is a property of the thing being measured, not of a
 * contest or a sport: golf stroke play is lower-is-better, Stableford points
 * in the same sport are higher-is-better.
 */
export type ScoreDirection = 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';

export interface ParticipantScoringDefinition {
  /** Direction of merit for the raw number this definition produces. */
  direction: ScoreDirection;
  /** What the number counts — for display, and to catch unit mismatches. */
  unit: 'STROKES_TO_PAR';
  /** How one raw value renders. The only formatter for this measure, on every surface. */
  format: (value: number) => string;
}

export const PARTICIPANT_SCORING_DEFINITIONS: Record<
  ParticipantScoringDefinitionId,
  ParticipantScoringDefinition
> = {
  GOLF_RELATIVE_TO_PAR_TOTAL: {
    direction: 'LOWER_IS_BETTER',
    unit: 'STROKES_TO_PAR',
    format: (value) => (value === 0 ? 'E' : value > 0 ? `+${value}` : String(value)),
  },
};

/**
 * Orders two raw scores best-first. This is the one place direction is
 * consulted: everything downstream reads the resulting position, which is
 * direction-free (1 is best in every sport). An unscored value sorts last in
 * both directions — "no score yet" is a display rule, not a merit rule.
 */
export function compareScores(
  direction: ScoreDirection,
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === 'LOWER_IS_BETTER' ? left - right : right - left;
}
