import { z } from 'zod';

import { ParticipantRoundStatus } from './enums';

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
  status: ParticipantRoundStatus;
  strokes: number;
  scoreToPar: number;
}

/**
 * Whether a round row is finished: every hole played. `completedAt` is provider-supplied and
 * often null, so the status is the only signal — which is why it is asked here rather than
 * re-spelled by each surface that needs it. `formatRound` below is one caller; a client
 * deriving which round a leaderboard is currently on is another.
 */
export const isRoundComplete = (round: Pick<ParticipantRoundScore, 'status'>): boolean =>
  round.status === ParticipantRoundStatus.COMPLETED;

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
    formatRound: (round) => (isRoundComplete(round)
      ? String(round.strokes)
      : formatStrokesToPar(round.scoreToPar)),
  },
};

/**
 * What a contest may set for its scoring definition: the Zod schema of a participant scoring
 * rule's `config` column, keyed by the definition id. Exhaustive over the definition ids, so a
 * definition added above fails the build until its settings are declared, even when it takes
 * none. The column is written through these types and read back through these schemas
 * (`parseContestScoringSettings`), so it is typed on both sides.
 *
 * Golf's to-par total takes no settings: the empty object. Its schema strips unknown keys rather
 * than refusing them, because rules written before the settings were typed can still carry the
 * retired `cutRule`/`playoffHandling` keys, which never changed a score. A value that is not an
 * object at all is refused.
 */
export const PARTICIPANT_SCORING_SETTINGS_SCHEMAS = {
  GOLF_RELATIVE_TO_PAR_TOTAL: z.object({}),
} as const satisfies Record<ParticipantScoringDefinitionId, z.ZodType>;

/** One definition's settings, as its schema parses them. */
export type ParticipantScoringSettings<Id extends ParticipantScoringDefinitionId> = z.infer<
  (typeof PARTICIPANT_SCORING_SETTINGS_SCHEMAS)[Id]
>;

/**
 * A contest's scoring definition with the settings it was configured with: a participant
 * scoring rule's definition id and `config`, correlated, so a scoring family narrows on
 * `participantScoringDefinitionId` to read its own settings.
 */
export type ContestScoringSettings = {
  [Id in ParticipantScoringDefinitionId]: {
    participantScoringDefinitionId: Id;
    config: ParticipantScoringSettings<Id>;
  };
}[ParticipantScoringDefinitionId];

/**
 * A stored rule's definition id and config, read back. A row can name a definition the registry
 * no longer has (`DEFINITION_UNKNOWN`) or hold a config its definition's schema refuses
 * (`SETTINGS_INVALID`); either reads as a failed parse, never as a guessed value.
 */
export type ContestScoringSettingsParse =
  | { success: true; data: ContestScoringSettings }
  | {
    success: false;
    reason: 'DEFINITION_UNKNOWN' | 'SETTINGS_INVALID';
    /** The definition id as stored. */
    participantScoringDefinitionId: string;
  };

/** Reads a stored rule's definition id and `config` through the definition's settings schema. */
export function parseContestScoringSettings(
  participantScoringDefinitionId: string,
  config: unknown,
): ContestScoringSettingsParse {
  const id = ParticipantScoringDefinitionIdSchema.safeParse(participantScoringDefinitionId);
  if (!id.success) {
    return { success: false, reason: 'DEFINITION_UNKNOWN', participantScoringDefinitionId };
  }
  const settings = PARTICIPANT_SCORING_SETTINGS_SCHEMAS[id.data].safeParse(config);
  return settings.success
    ? { success: true, data: { participantScoringDefinitionId: id.data, config: settings.data } }
    : { success: false, reason: 'SETTINGS_INVALID', participantScoringDefinitionId };
}

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
