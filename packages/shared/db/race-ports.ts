/**
 * Repository port for the finish-position extension row (#622): one race result per field row.
 * The admin's finishing order is its only writer, and it writes the results, the race's official
 * flag and each runner's core standing (its place in the event) together, all or none.
 */

import type { ParticipantStandingStatus, RaceResultStatus, SportEventParticipantRaceResult } from '../domain';

/** One runner's result, every value exactly as the admin sent it. */
export interface RaceResultWrite {
  sportEventParticipantId: string;
  finishPosition: number | null;
  startPosition: number | null;
  resultStatus: RaceResultStatus;
  riderName: string | null;
}

/** A runner's core standing in the event, written from its result. */
export interface RaceStandingWrite {
  sportEventParticipantId: string;
  /** 1 is the winner; runners in a dead heat share a place. Null for a runner that did not finish. */
  position: number | null;
  displayPosition: string | null;
  status: ParticipantStandingStatus;
  currentRound: number | null;
  asOf: Date;
}

export interface RaceResultApply {
  /** Created or replaced, one per runner named. */
  results: readonly RaceResultWrite[];
  /** Set on every result row of the event: a race's result is official as a whole. */
  isOfficial: boolean;
  /** Created or replaced, one per runner with a result after the write. */
  standings: readonly RaceStandingWrite[];
}

export interface SportEventParticipantRaceResultRepository {
  /** Every result at the event, by field row. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipantRaceResult[]>;
  /** All or none, in one transaction. */
  applyResults(sportEventId: string, apply: RaceResultApply): Promise<void>;
}
