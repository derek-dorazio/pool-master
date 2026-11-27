/**
 * Repository port for a race's finishing order (#622, #2008). A race is one FIELD Match in its
 * event's first round, with every runner as a side and one Game: each runner's result is its
 * side result in that Game, the race's official flag is the Game's status (COMPLETED once
 * official, IN_PROGRESS while provisional), and the rider is the field row's. The admin's
 * finishing order on a test event is its only writer today; it writes the side results, the
 * Game's status, the riders and each runner's core standing together, all or none.
 */

import type { BackgroundJobRequest, GameSideStatus, ParticipantStandingStatus } from '../domain';

/** One runner's result in the race, every value exactly as it was sent. */
export interface RaceOrderSideWrite {
  sportEventParticipantId: string;
  position: number | null;
  startPosition: number | null;
  status: GameSideStatus;
}

/** One runner's result as stored: its side result in the race's Game, and its rider. */
export interface RaceOrderResult extends RaceOrderSideWrite {
  /** Whether the race's Game is official (COMPLETED). */
  isOfficial: boolean;
  updatedAt: Date;
}

/** A runner's core standing in the event, written from its result. */
export interface RaceStandingWrite {
  sportEventParticipantId: string;
  /** 1 is the winner; runners in a dead heat share a place. Null for a runner that did not finish. */
  position: number | null;
  displayPosition: string | null;
  status: ParticipantStandingStatus;
  asOf: Date;
}

export interface RaceOrderApply {
  /** Created or replaced, one per runner named; a runner not named keeps its side and result. */
  sides: readonly RaceOrderSideWrite[];
  /** The race's Game status: a race's result is official as a whole. */
  isOfficial: boolean;
  /** When the result was written: the Game's completion time once official. */
  at: Date;
  /** Created or replaced, one per runner with a result after the write. */
  standings: readonly RaceStandingWrite[];
  /** Background jobs the result causes (the event's leaderboard rebuild, #1466), written with it. */
  jobs?: readonly BackgroundJobRequest[];
}

export interface RaceOrderRepository {
  /** Every runner's result in the event's race, by field row. Empty before the first result. */
  findBySportEvent(sportEventId: string): Promise<RaceOrderResult[]>;
  /**
   * All or none, in one transaction: the race's Match and Game in the event's first round are
   * created with its first result. 409-worthy states (no round) are the caller's to refuse.
   */
  applyOrder(sportEventId: string, apply: RaceOrderApply): Promise<void>;
}
