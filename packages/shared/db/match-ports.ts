/**
 * Repository port for an event's matches (#698): its bracket. The admin loads the whole bracket
 * at once and edits one match at a time; results (#699) are written by the head-to-head family.
 */

import type { MatchSide, SportEventMatch } from '../domain';

/** One match of a bracket being loaded. `id` is chosen by the caller so links can name it. */
export interface SportEventMatchWrite {
  id: string;
  roundNumber: number;
  matchNumber: number;
  homeSportEventParticipantId: string | null;
  awaySportEventParticipantId: string | null;
  isNeutralSite: boolean;
  scheduledDate: Date | null;
  advancesToMatchId: string | null;
  advancesToSide: MatchSide | null;
}

/** What one match edit changes; a value left out keeps what is stored. */
export interface SportEventMatchPatch {
  homeSportEventParticipantId?: string | null;
  awaySportEventParticipantId?: string | null;
  isNeutralSite?: boolean;
  scheduledDate?: Date | null;
}

export interface SportEventMatchRepository {
  /** The event's matches in match-number order. */
  findBySportEvent(sportEventId: string): Promise<SportEventMatch[]>;
  /** Replaces every match of the event with `matches`, all or none. Every round named must exist. */
  replaceBracket(sportEventId: string, matches: readonly SportEventMatchWrite[]): Promise<void>;
  update(id: string, patch: SportEventMatchPatch): Promise<void>;
}
