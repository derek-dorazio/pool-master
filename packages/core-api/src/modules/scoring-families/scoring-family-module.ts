/**
 * What a scoring family does that differs between families (#606). A sport's definition names
 * its family; everything here is reached through the event's sport, never by comparing sports
 * (`rules/architecture-rules.md` §4 *Sport extension*).
 *
 * The shape was checked against the three families planned, though only stroke play is built:
 * - **Stroke play** (golf): strokes per round, a to-par total, unplayed rounds scored as 80.
 * - **Finish position** (racing): one finishing place per race (or per stage), scored from the
 *   contest's points table; a non-finisher scores the table's "did not finish" value.
 * - **Knockout advancement** (tennis, March Madness): points per match won, by the round's
 *   value plus a seed upset bonus. It reads matches (who beat whom), which arrive with that
 *   family as its own field read; the methods below take what it would need from the field.
 *
 * Each method is here because golf already does it and a second family does it differently.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { ContestEntryStandingResult, ContestEntryStandingWrite } from '@poolmaster/shared/db';
import type { SportEvent } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import type { ParticipantScore } from '../contests/contest-leaderboard-calculator';
import type { SportEventParticipantView } from '../events/sport-event-participant-service';
import type { LiveScorePersistenceResult } from '../ingestion/core/score-publisher';

/** What scoring a field reads off its event. */
export type FieldScoringEvent = Pick<SportEvent, 'sport' | 'rounds' | 'roundsPar' | 'status'>;

/** The family's extension on a settled entry standing: golf's `golf` block today. */
export type EntryStandingDetail = Pick<ContestEntryStandingWrite, 'golf'>;

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

export interface ScoringFamilyModule {
  /**
   * Each field row's contest score, or null while it is unscored. The family's own rule for a
   * missing result (golf's 80-stroke round, racing's "did not finish" value) is applied here,
   * and nowhere else.
   */
  scoreField(field: readonly SportEventParticipantView[], event: FieldScoringEvent): ParticipantScore[];

  /** Writes a provider's live-score batch into the family's result rows. */
  persistLiveScores(
    deps: LiveScoreWriteDeps,
    event: LiveScoreTargetEvent,
    result: LiveScoreResult,
  ): Promise<LiveScorePersistenceResult>;

  /** The family's extension row for an entry's settled total. */
  entryStandingDetail(total: number | null): EntryStandingDetail;

  /** An entry's settled total, read back off the family's extension row. */
  settledEntryTotal(standing: ContestEntryStandingResult): number | null;
}
