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
  /**
   * How one participant's round renders under this measure — the per-round column of a
   * leaderboard. Here rather than in each client because the server no longer preformats it
   * (#248 deleted `displayType`/`displayValue`): a client reads the definition id off the
   * leaderboard response and renders every round through this one function.
   */
  formatRound: (round: ParticipantRoundScore) => string;
}

/** One participant's scored round, as a formatter needs it. `status` is the round row's own. */
export interface ParticipantRoundScore {
  status: string;
  strokes: number;
  scoreToPar: number;
}

/** A round row's terminal-and-counted states: every hole played. */
const COMPLETED_ROUND_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'COMPLETE']);

const formatStrokesToPar = (value: number): string =>
  value === 0 ? 'E' : value > 0 ? `+${value}` : String(value);

export const PARTICIPANT_SCORING_DEFINITIONS: Record<
  ParticipantScoringDefinitionId,
  ParticipantScoringDefinition
> = {
  GOLF_RELATIVE_TO_PAR_TOTAL: {
    direction: 'LOWER_IS_BETTER',
    unit: 'STROKES_TO_PAR',
    format: formatStrokesToPar,
    // Strokes once a round is complete, to par while it is still being played (or ended short:
    // a withdrawal or a missed cut shows where the golfer stood against par).
    formatRound: (round) => (COMPLETED_ROUND_STATUSES.has(round.status)
      ? String(round.strokes)
      : formatStrokesToPar(round.scoreToPar)),
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

/** A rank computed from a raw score: direction-free, 1 is best, ties share a position. */
export interface ScoreRank {
  position: number | null;
  /** The position as displayed, "T3" when tied; null when unranked. */
  displayPosition: string | null;
}

/**
 * Standard competition ranking over scores already sorted best-first (`compareScores`):
 * equal scores share a position and are shown as "T<n>", the next distinct score takes its
 * index + 1 (1, T2, T2, 4), and an unscored item is unranked. The one ranking rule for a
 * contest's entries and an event's participants alike.
 */
export function rankSortedScores(sortedScores: ReadonlyArray<number | null>): ScoreRank[] {
  const counts = new Map<number, number>();
  for (const score of sortedScores) {
    if (score !== null) counts.set(score, (counts.get(score) ?? 0) + 1);
  }
  let lastScore: number | null = null;
  let lastPosition = 0;
  return sortedScores.map((score, index) => {
    if (score === null) return { position: null, displayPosition: null };
    if (lastScore === null || score !== lastScore) {
      lastScore = score;
      lastPosition = index + 1;
    }
    const tied = (counts.get(score) ?? 1) > 1;
    return { position: lastPosition, displayPosition: tied ? `T${lastPosition}` : String(lastPosition) };
  });
}
