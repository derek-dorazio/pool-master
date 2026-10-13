import { z } from 'zod';

import { ParticipantRoundStatus } from './enums';

/**
 * Only ids with a live scoring engine are listed. The exhaustive
 * `PARTICIPANT_SCORING_DEFINITIONS` record below means an id added here fails
 * the build until its direction, unit and format are declared.
 */
export const ParticipantScoringDefinitionIdSchema = z.enum([
  'GOLF_RELATIVE_TO_PAR_TOTAL',
  'FINISH_POSITION_POINTS',
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

/** What a scoring definition's number counts. */
export type ScoreUnit = 'STROKES_TO_PAR' | 'POINTS';

export interface ParticipantScoringDefinition {
  /** Direction of merit for the raw number this definition produces. */
  direction: ScoreDirection;
  /** What the number counts — for display, and to catch unit mismatches. */
  unit: ScoreUnit;
  /** How one raw value renders. The only formatter for this measure, on every surface. */
  format: (value: number) => string;
  /**
   * How one participant's round renders under this measure — the per-round column of a
   * leaderboard. Here rather than in each client because the server no longer preformats it
   * (#248 deleted `displayType`/`displayValue`): a client reads the definition id off the
   * leaderboard response and renders every round through this one function. Null for a measure
   * with no per-round score (finish-position points: a race has one result, not round scores).
   */
  formatRound: ((round: ParticipantRoundScore) => string) | null;
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

/**
 * Exhaustive over the definition ids (`satisfies`), and typed per id, so a caller naming one
 * definition gets its own formatters: golf's to-par total always formats rounds.
 */
export const PARTICIPANT_SCORING_DEFINITIONS = {
  GOLF_RELATIVE_TO_PAR_TOTAL: {
    direction: 'LOWER_IS_BETTER',
    unit: 'STROKES_TO_PAR',
    format: formatStrokesToPar,
    // Strokes once a round is complete, to par while it is still being played (or ended short:
    // a withdrawal or a missed cut shows where the golfer stood against par).
    formatRound: (round: ParticipantRoundScore): string => (isRoundComplete(round)
      ? String(round.strokes)
      : formatStrokesToPar(round.scoreToPar)),
  },
  /**
   * Finish position (#622): the points a runner's finishing place earns from the contest's points
   * table, more is better. A race has one result, so there is no per-round score.
   */
  FINISH_POSITION_POINTS: {
    direction: 'HIGHER_IS_BETTER',
    unit: 'POINTS',
    format: (value: number): string => String(value),
    formatRound: null,
  },
} as const satisfies Record<ParticipantScoringDefinitionId, ParticipantScoringDefinition>;

/** The most places a finish-position points table may score. */
export const FINISH_POSITION_POINTS_TABLE_MAX_PLACES = 50;

/**
 * A finish-position contest's settings (#622, plans/racing-sports.md Q9.1): `pointsTable[0]` is
 * what first place scores, `pointsTable[1]` second, and so on; a place beyond the table scores 0.
 * A runner that did not finish, was disqualified or did not start scores `didNotFinishPoints`.
 * A better place never scores fewer points than a worse one.
 */
export const FinishPositionPointsSettingsSchema = z.object({
  pointsTable: z.array(z.number().int().min(0))
    .min(1)
    .max(FINISH_POSITION_POINTS_TABLE_MAX_PLACES)
    .refine(
      (table) => table.every((points, index) => index === 0 || points <= table[index - 1]),
      { message: 'A better finishing place cannot score fewer points than a worse one.' },
    )
    .describe(`Points by finishing place: the first value is what the winner scores, the second second place, and so on, at most ${FINISH_POSITION_POINTS_TABLE_MAX_PLACES} places. Never increasing. A place beyond the table scores 0. Win / Place / Show is [5, 3, 1].`),
  // Required rather than defaulted: the settings travel inside a discriminated union, where a
  // JSON Schema default is not applied, and a template states its 0 like every other value.
  didNotFinishPoints: z.number().int().min(0)
    .describe('What a runner scores when it did not finish, was disqualified or did not start (including one scratched after picks closed). Usually 0.'),
}).describe('Finish-position points settings: the contest\'s points table and its "did not finish" value.');
export type FinishPositionPointsSettings = z.infer<typeof FinishPositionPointsSettingsSchema>;

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
  FINISH_POSITION_POINTS: FinishPositionPointsSettingsSchema,
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
 * A contest's scoring definition and settings as one schema, discriminated by the definition id:
 * what a commissioner sends and a template presets. Its parse is `ContestScoringSettings`.
 */
export const ContestScoringSettingsSchema = z.discriminatedUnion('participantScoringDefinitionId', [
  z.object({
    participantScoringDefinitionId: z.literal('GOLF_RELATIVE_TO_PAR_TOTAL'),
    config: PARTICIPANT_SCORING_SETTINGS_SCHEMAS.GOLF_RELATIVE_TO_PAR_TOTAL,
  }),
  z.object({
    participantScoringDefinitionId: z.literal('FINISH_POSITION_POINTS'),
    config: PARTICIPANT_SCORING_SETTINGS_SCHEMAS.FINISH_POSITION_POINTS,
  }),
]).describe("A contest's participant scoring definition with its settings. The definition must be one the event's sport offers; omitted, the contest takes its template's preset or its sport's default.");

type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Compile-time proof that the schema above and `ContestScoringSettings` admit the same values: a
// definition added to the settings record and not to the schema fails the typecheck here.
const settingsSchemaMatchesType: SameType<ContestScoringSettings, z.infer<typeof ContestScoringSettingsSchema>> = true;
void settingsSchemaMatchesType;

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
  // Parsed as one value so the definition id and its settings stay correlated.
  const settings = ContestScoringSettingsSchema.safeParse({ participantScoringDefinitionId: id.data, config });
  return settings.success
    ? { success: true, data: settings.data }
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
