/**
 * Repository port for the composite family's extension rows (#934): a stat pool player's stat
 * lines, one per participant round and stat. The loader and the admin stat grid write them (#935),
 * and a provider's box scores (#1497).
 */

import type { BackgroundJobRequest, ParticipantRoundStatus, SportStat } from '../domain';

/**
 * Where a player's game stands: COMPLETED once the game is over, IN_PROGRESS while a provider's
 * box score is still moving (#1497). An admin enters only completed games.
 */
export type GameStatLineStatus = Extract<ParticipantRoundStatus, 'COMPLETED' | 'IN_PROGRESS'>;

/** One player's whole line for one game, as it is to be stored. */
export interface GameStatLineWrite {
  sportEventParticipantId: string;
  sportEventRoundId: string;
  /** Each stat once. Empty clears the line, and the player's round with it: they did not play. */
  stats: ReadonlyArray<{ stat: SportStat; value: number }>;
  /** The round's status from this write on. */
  status: GameStatLineStatus;
  /** When the game's line was written complete; null while it is in progress. */
  completedAt: Date | null;
}

/** What one write did to the stored line: added, rewritten, cleared, or left as it was. */
export interface GameStatLineWriteOutcome {
  sportEventParticipantId: string;
  sportEventRoundId: string;
  disposition: 'CREATED' | 'UPDATED' | 'DELETED' | 'UNCHANGED';
}

export interface SportEventParticipantStatLineRepository {
  /**
   * Replaces each player's line for the game, all or none. A line that already holds exactly
   * these stats, at this status, is left as it is, its round's completedAt included. A COMPLETED
   * line stays COMPLETED, with its completedAt, when an IN_PROGRESS write corrects its stats. `jobs` (the
   * event's leaderboard rebuild, #1466) are written in the same transaction. Returns each write's
   * outcome, in the order given.
   */
  replaceGameLines(writes: readonly GameStatLineWrite[], jobs?: readonly BackgroundJobRequest[]): Promise<GameStatLineWriteOutcome[]>;
}
