/**
 * Repository port for the composite family's extension rows (#934): a stat pool player's stat
 * lines, one per participant round and stat. The loader and the admin stat grid write them (#935).
 */

import type { SportStat } from '../domain';

/** One player's whole line for one game, as it is to be stored. */
export interface GameStatLineWrite {
  sportEventParticipantId: string;
  sportEventRoundId: string;
  /** Each stat once. Empty clears the line, and the player's round with it: they did not play. */
  stats: ReadonlyArray<{ stat: SportStat; value: number }>;
  /** When the game's line was written; the round is COMPLETED from then. */
  completedAt: Date;
}

export interface SportEventParticipantStatLineRepository {
  /** Replaces each player's line for the game, all or none. */
  replaceGameLines(writes: readonly GameStatLineWrite[]): Promise<void>;
}
