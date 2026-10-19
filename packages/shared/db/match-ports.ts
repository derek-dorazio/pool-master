/**
 * Repository port for an event's matches (#698): its bracket. The admin loads the whole bracket
 * at once and edits one match at a time; results (#699) are written by the head-to-head family.
 */

import type { MatchSide, MatchStatus, ParticipantStandingStatus, SportEventMatch } from '../domain';

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
  regionLabel: string | null;
}

/** What one match edit changes; a value left out keeps what is stored. */
export interface SportEventMatchPatch {
  homeSportEventParticipantId?: string | null;
  awaySportEventParticipantId?: string | null;
  isNeutralSite?: boolean;
  scheduledDate?: Date | null;
}

/** A match's result as it is written: entered (COMPLETED with a winner) or cleared (SCHEDULED, empty). */
export interface MatchResultWrite {
  id: string;
  status: MatchStatus;
  winnerSide: MatchSide | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** One side of a later match, set to the team that advances into it, or emptied. */
export interface MatchSideFill {
  id: string;
  side: MatchSide;
  sportEventParticipantId: string | null;
}

/** A team's core standing in the event, written from the bracket's results. */
export interface BracketStandingWrite {
  sportEventParticipantId: string;
  /** 1 is the champion; teams out in the same round share a place. */
  position: number | null;
  displayPosition: string | null;
  status: ParticipantStandingStatus;
  /** The latest round the team has a match in. */
  currentRound: number | null;
  asOf: Date;
}

export interface MatchResultApply {
  result: MatchResultWrite;
  /** The next match's side the winner fills, when the match advances anywhere. */
  sideFill: MatchSideFill | null;
  /** Created or replaced, one per team in the bracket. */
  standings: readonly BracketStandingWrite[];
}

export interface SportEventMatchRepository {
  /** The event's matches in match-number order. */
  findBySportEvent(sportEventId: string): Promise<SportEventMatch[]>;
  /** Several events' matches in one read (#762), each event's in match-number order. */
  findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventMatch[]>;
  /** Replaces every match of the event with `matches`, all or none. Every round named must exist. */
  replaceBracket(sportEventId: string, matches: readonly SportEventMatchWrite[]): Promise<void>;
  update(id: string, patch: SportEventMatchPatch): Promise<void>;
  /** Both sides of each match given, all or none: a reseeded round's teams placed (#722). */
  placeSides(sides: readonly { id: string; homeSportEventParticipantId: string; awaySportEventParticipantId: string }[]): Promise<void>;
  /** A result entered or cleared, the side it fills and the standings it leaves, all or none. */
  applyResult(apply: MatchResultApply): Promise<void>;
}
