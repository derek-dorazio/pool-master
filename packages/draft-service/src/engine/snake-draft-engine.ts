/**
 * Snake Draft Engine.
 *
 * Manages the core logic for a snake draft: validates picks, enforces
 * exclusivity, advances the turn, and handles auto-picks on timeout.
 */

import type { DraftStatus } from '@poolmaster/shared/domain';
import { getPickPosition, type PickPosition } from './pick-order';

// --- Types ---

export interface DraftState {
  contestId: string;
  status: DraftStatus;
  entryIds: string[];
  rounds: number;
  currentPickNumber: number;
  picks: DraftPickRecord[];
  autoPickPolicy: AutoPickPolicy;
}

export interface DraftPickRecord {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryId: string;
  participantId: string;
  autoPicked: boolean;
  pickedAt: Date;
}

export type AutoPickPolicy = 'QUEUE_THEN_BEST' | 'BEST_AVAILABLE' | 'RANDOM';

export interface ProposedPick {
  entryId: string;
  participantId: string;
}

export interface PickValidationResult {
  valid: boolean;
  reason?: string;
}

export interface AutoPickInput {
  entryId: string;
  queue: string[];
  availableParticipantIds: string[];
}

// --- Engine ---

export class SnakeDraftEngine {
  /**
   * Get the current pick position based on draft state.
   */
  getCurrentPickPosition(state: DraftState): PickPosition {
    return getPickPosition(state.currentPickNumber, state.entryIds.length);
  }

  /**
   * Get the entry ID that is currently on the clock.
   */
  getCurrentEntryId(state: DraftState): string {
    const position = this.getCurrentPickPosition(state);
    return state.entryIds[position.entryIndex];
  }

  /**
   * Validate a proposed pick.
   */
  validatePick(state: DraftState, pick: ProposedPick): PickValidationResult {
    if (state.status !== 'LIVE') {
      return { valid: false, reason: `Draft is not live (status: ${state.status})` };
    }

    const currentEntryId = this.getCurrentEntryId(state);
    if (pick.entryId !== currentEntryId) {
      return { valid: false, reason: `Not your turn. Current pick belongs to entry ${currentEntryId}` };
    }

    if (this.isParticipantTaken(state, pick.participantId)) {
      return { valid: false, reason: `Participant ${pick.participantId} is already drafted` };
    }

    return { valid: true };
  }

  /**
   * Apply a pick to the draft state. Returns the updated state.
   * Does NOT mutate the input — returns a new state object.
   */
  applyPick(state: DraftState, pick: ProposedPick, autoPicked: boolean = false): DraftState {
    const position = this.getCurrentPickPosition(state);
    const totalPicks = state.entryIds.length * state.rounds;

    const newPick: DraftPickRecord = {
      pickNumber: state.currentPickNumber,
      round: position.round,
      pickInRound: position.pickInRound,
      entryId: pick.entryId,
      participantId: pick.participantId,
      autoPicked,
      pickedAt: new Date(),
    };

    const nextPickNumber = state.currentPickNumber + 1;
    const isComplete = nextPickNumber > totalPicks;

    return {
      ...state,
      currentPickNumber: nextPickNumber,
      status: isComplete ? 'COMPLETE' : state.status,
      picks: [...state.picks, newPick],
    };
  }

  /**
   * Determine the auto-pick for an entry that missed their window.
   */
  resolveAutoPick(state: DraftState, input: AutoPickInput): string | null {
    const takenIds = new Set(state.picks.map((p) => p.participantId));
    const available = input.availableParticipantIds.filter((id) => !takenIds.has(id));

    if (available.length === 0) {
      return null;
    }

    switch (state.autoPickPolicy) {
      case 'QUEUE_THEN_BEST': {
        const fromQueue = input.queue.find((id) => available.includes(id));
        return fromQueue ?? available[0];
      }
      case 'BEST_AVAILABLE':
        return available[0];
      case 'RANDOM':
        return available[Math.floor(Math.random() * available.length)];
      default:
        return available[0];
    }
  }

  /**
   * Check if a participant has already been drafted (exclusivity).
   */
  isParticipantTaken(state: DraftState, participantId: string): boolean {
    return state.picks.some((p) => p.participantId === participantId);
  }

  /**
   * Check if the draft is complete.
   */
  isComplete(state: DraftState): boolean {
    const totalPicks = state.entryIds.length * state.rounds;
    return state.currentPickNumber > totalPicks;
  }

  /**
   * Get all participants drafted by a specific entry.
   */
  getEntryRoster(state: DraftState, entryId: string): DraftPickRecord[] {
    return state.picks.filter((p) => p.entryId === entryId);
  }

  /**
   * Get all participant IDs that have been drafted.
   */
  getTakenParticipantIds(state: DraftState): string[] {
    return state.picks.map((p) => p.participantId);
  }
}
