/**
 * Repository ports for the golf extension rows (#236). Each golf row is keyed 1:1 to a
 * core row (SportEventParticipantRound, SportEventParticipantStanding) and is written
 * with it: a write takes the core values and the golf values together, so a core row
 * never exists half-scored.
 */

import type { GolfRoundResult, GolfStandingResult, ParticipantRoundStatus, ParticipantStandingStatus } from '../domain';

export interface GolfRoundWrite {
  sportEventParticipantId: string;
  sportEventRoundId: string;
  /** Core: the participant's progress through the round. */
  status: ParticipantRoundStatus;
  completedAt: Date | null;
  /** Golf: what was scored. */
  strokes: number;
  scoreToPar: number;
  thru: number | null;
}

export interface SportEventParticipantGolfRoundRepository {
  /** Every scored round at the event, by participant then round number. */
  findBySportEvent(sportEventId: string): Promise<GolfRoundResult[]>;
  findBySportEventRound(sportEventRoundId: string): Promise<GolfRoundResult[]>;
  /** By participant then round number. */
  findBySportEventParticipants(sportEventParticipantIds: readonly string[]): Promise<GolfRoundResult[]>;
  upsert(write: GolfRoundWrite): Promise<GolfRoundResult>;
  /** All or none. */
  upsertMany(writes: readonly GolfRoundWrite[]): Promise<void>;
}

export interface GolfStandingWrite {
  sportEventParticipantId: string;
  /** Core. */
  currentRound: number | null;
  status: ParticipantStandingStatus;
  asOf: Date;
  /** Golf: the totals the standing was computed from. */
  eventScoreToPar: number;
  eventStrokes: number;
  currentRoundThru: number | null;
}

export interface SportEventParticipantGolfStandingRepository {
  findBySportEvent(sportEventId: string): Promise<GolfStandingResult[]>;
  findBySportEventParticipants(sportEventParticipantIds: readonly string[]): Promise<GolfStandingResult[]>;
  upsert(write: GolfStandingWrite): Promise<GolfStandingResult>;
  /**
   * Writes the event-side rank onto core standing rows (`position`, `displayPosition`). The
   * ranks are computed from every golfer's score at once, so this is a separate write from
   * `upsert`, which touches one golfer.
   */
  updateRanks(ranks: ReadonlyArray<StandingRankWrite>): Promise<void>;
}

export interface StandingRankWrite {
  standingId: string;
  position: number | null;
  displayPosition: string | null;
}
