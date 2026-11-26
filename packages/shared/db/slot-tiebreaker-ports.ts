/**
 * The port for an event slot's tiebreaker game (#2048): what the rule reads of each slot of an
 * event and its Games, and what choosing a tiebreaker game writes.
 */
import type { BackgroundJobRequest, SlotTiebreakerCandidate } from '../domain';

/** One of a slot's Games as the rule and the slot dialog read it. */
export interface SlotTiebreakerGame extends SlotTiebreakerCandidate {
  /** The match the Game is played in. */
  sportEventRoundMatchId: string;
  /** 1 for a single game; a series' games in the order they are played. */
  gameNumber: number;
}

/** One slot of an event with its tiebreaker game and every Game played in it. */
export interface SlotTiebreakerState {
  /** The event slot row (`sport_event_slots.id`). */
  sportEventSlotId: string;
  /** The Season slot it is, as the event DTO's slots name it. */
  seasonSlotId: string;
  sportLeagueId: string;
  tiebreakerGameId: string | null;
  /** Set while a root admin's choice stands; null while the rule's does. */
  chosen: { at: Date; byUserId: string | null } | null;
  /** The slot's Games, by match and game number. */
  games: SlotTiebreakerGame[];
}

/** One slot's new tiebreaker game, and whether a root admin chose it. */
export interface SlotTiebreakerWrite {
  sportEventSlotId: string;
  tiebreakerGameId: string | null;
  chosen: { at: Date; byUserId: string } | null;
}

export interface SlotTiebreakerRepository {
  /** Every slot of the event with its Games; empty for an event that covers no slot. */
  findBySportEvent(sportEventId: string): Promise<SlotTiebreakerState[]>;
  /** Writes each slot's tiebreaker game, with the jobs that follow it, all or none. */
  saveTiebreakerGames(writes: readonly SlotTiebreakerWrite[], jobs: readonly BackgroundJobRequest[]): Promise<void>;
}
