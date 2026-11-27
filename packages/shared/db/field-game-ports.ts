/**
 * Repository port for the results of an event's FIELD Games (#622, #2008): a race or a golf
 * round. Each round of the event holds one FIELD Match with every competitor in it as a side and
 * one Game, and a competitor's result in the round is its side result there. The Game's status is
 * the round's: a race is official once it is COMPLETED, a golf round once every golfer in it has
 * finished. A write puts the side results, the Games' statuses and each competitor's core
 * standing down together, all or none, so a reader never sees a result without the place it gives.
 */

import type { BackgroundJobRequest, GameSideStatus, MatchStatus, ParticipantStandingStatus } from '../domain';

/** One competitor's result in one FIELD Game, every value exactly as the feed or the admin sent it. */
export interface FieldSideWrite {
  sportEventParticipantId: string;
  /** A golfer's strokes; null where the family keeps no score (a race). */
  score: number | null;
  scoreToPar: number | null;
  /** Holes thru; the Game's full count once the side has finished. */
  periodsCompleted: number | null;
  position: number | null;
  startPosition: number | null;
  /** Null while the side is still playing. */
  status: GameSideStatus | null;
}

/** One competitor's result as stored, with its round and its Game's status. */
export interface FieldSideResult extends FieldSideWrite {
  roundNumber: number;
  gameStatus: MatchStatus;
  updatedAt: Date;
}

/** One round's FIELD Game: its status, and the sides it names. */
export interface FieldGameWrite {
  roundNumber: number;
  status: MatchStatus;
  /** When the Game was completed; null while it is not. */
  completedAt: Date | null;
  /** Created or replaced, one per competitor named; a competitor not named keeps its side and result. */
  sides: readonly FieldSideWrite[];
}

/** A competitor's core standing in the event, written from its results. */
export interface FieldStandingWrite {
  sportEventParticipantId: string;
  /** 1 is best; a tie shares a place. Null for a competitor that is unranked. */
  position: number | null;
  displayPosition: string | null;
  status: ParticipantStandingStatus;
  asOf: Date;
  total: number | null;
  scoreToPar: number | null;
}

/** A competitor's core standing as stored. */
export interface FieldStanding extends Omit<FieldStandingWrite, 'asOf'> {
  id: string;
  asOf: Date | null;
}

export interface FieldResultsApply {
  games: readonly FieldGameWrite[];
  /** Created or replaced, one per competitor named. */
  standings: readonly FieldStandingWrite[];
  /** Background jobs the results cause (the event's leaderboard rebuild, #1466), written with them. */
  jobs?: readonly BackgroundJobRequest[];
}

export interface FieldGameRepository {
  /** Every side result in the event's FIELD Games, by round then field row. Empty before the first. */
  findResults(sportEventId: string): Promise<FieldSideResult[]>;
  /** Every standing in the event, by field row. */
  findStandings(sportEventId: string): Promise<FieldStanding[]>;
  /**
   * All or none, in one transaction and in a fixed number of statements however big the field: a
   * round's Match and Game are created with its first result, and a competitor new to a round gets
   * the round's next side number. A round the event does not have is an error.
   */
  applyResults(sportEventId: string, apply: FieldResultsApply): Promise<void>;
}
