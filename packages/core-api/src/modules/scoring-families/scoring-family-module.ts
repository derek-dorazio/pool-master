/**
 * What a scoring family does that differs between families (#606). A sport's definition names
 * its family; everything here is reached through the event's sport, never by comparing sports
 * (`rules/architecture-rules.md` §4 *Sport extension*).
 *
 * The shape was checked against the three families planned; all three are registered:
 * - **Stroke play** (golf): strokes per round, a to-par total, unplayed rounds scored as 80.
 * - **Finish position** (racing): one finishing place per race (or per stage), scored from the
 *   contest's points table; a non-finisher scores the table's "did not finish" value.
 * - **Head to head** (basketball's bracket, #698): points per match won, by the round's value
 *   plus a seed upset bonus (#699). It reads the event's matches (who beat whom) as its own field
 *   read; the methods below take what it needs from the field.
 *
 * Each method is here because golf already does it and a second family does it differently.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { ContestScoringSettings, SportEvent } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { ParticipantScore } from '../contests/contest-leaderboard-calculator';
import type { SportEventParticipantView } from '../events/sport-event-participant-service';
import type { LiveScorePersistenceResult } from '../ingestion/core/score-publisher';

/** What scoring a field reads off its event. */
export type FieldScoringEvent = Pick<SportEvent, 'sport' | 'rounds' | 'roundsPar' | 'status'>;

export interface LiveScoreWriteDeps {
  prisma: PrismaClient;
  providerId: string;
  logger?: FastifyBaseLogger;
}

/** The in-progress event a provider's live scores are written to. */
export interface LiveScoreTargetEvent {
  id: string;
  rounds: number | null;
}

/** A live-score result category, the discriminant of a provider's `LiveScoreResult`. */
export type LiveScoreCategory = LiveScoreResult['category'];

/**
 * The one live-score category a family accepts, with the writer for it. One arm per category,
 * so a writer is typed by the result it is handed.
 */
export type LiveScoreWriter = {
  [Category in LiveScoreCategory]: {
    category: Category;
    /** Writes a provider's live-score batch into the family's result rows. */
    persist(
      deps: LiveScoreWriteDeps,
      event: LiveScoreTargetEvent,
      result: Extract<LiveScoreResult, { category: Category }>,
    ): Promise<LiveScorePersistenceResult>;
  };
}[LiveScoreCategory];

export interface ScoringFamilyModule {
  /**
   * Each field row's score in one contest, or null while it is unscored, under that contest's
   * scoring definition and settings (racing's points table is a contest setting; stroke play
   * has none). The family's own rule for a missing result (golf's 80-stroke round, racing's
   * "did not finish" value) is applied here, and nowhere else.
   */
  scoreField(
    field: readonly SportEventParticipantView[],
    event: FieldScoringEvent,
    scoring: ContestScoringSettings,
  ): ParticipantScore[];

  /**
   * The live-score category the family accepts and how it writes one, or null when it takes
   * no live scores (its results are entered by an admin). The score publisher skips a batch of
   * any other category.
   */
  liveScores: LiveScoreWriter | null;
}
