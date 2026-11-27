/**
 * The port for Season slot status (#2013): what the slot status refresh reads of each slot of an
 * event and its Matches, and its one guarded write.
 */
import type { BackgroundJobRequest, MatchStatus, SeasonSlotStatus } from '../domain';

/** One slot of an event as its status is computed from it. */
export interface SlotStatusState {
  /** The Season slot (`SportLeagueSeasonCompetitionSlot`), whose status this is. */
  seasonSlotId: string;
  status: SeasonSlotStatus;
  /** The provider's feed called the slot's play final. */
  feedFinal: boolean;
  /** The status of each Match played in the slot. */
  matchStatuses: MatchStatus[];
}

export interface SlotStatusRepository {
  /** Every slot of the event with its Matches' statuses; empty for an event that covers no slot. */
  findBySportEvent(sportEventId: string): Promise<SlotStatusState[]>;
  /**
   * Moves one Season slot from `from` to `to` with the jobs that follow it, only while it is still
   * `from`; answers whether it moved.
   */
  transitionStatus(seasonSlotId: string, change: { from: SeasonSlotStatus; to: SeasonSlotStatus }, jobs: readonly BackgroundJobRequest[]): Promise<boolean>;
}
