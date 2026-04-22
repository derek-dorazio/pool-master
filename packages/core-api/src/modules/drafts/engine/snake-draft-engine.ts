/**
 * Snake Draft Engine.
 *
 * Manages the core logic for a snake draft: validates picks, enforces
 * exclusivity, advances the turn, and handles auto-picks on timeout.
 */

import type { DraftStatus } from '@poolmaster/shared/domain';
import type { ServiceLogger } from '../../../core/logger';
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
  participantId: string | null;
  autoPicked: boolean;
  isSkipped: boolean;
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
  public constructor(private readonly logger?: ServiceLogger) {}

  /**
   * Get the current pick position based on draft state.
   */
  getCurrentPickPosition(state: DraftState): PickPosition {
    const position = getPickPosition(state.currentPickNumber, state.entryIds.length, this.logger);
    this.logger?.debug(
      {
        action: 'snakeDraftEngine.getCurrentPickPosition',
        data: { contestId: state.contestId, currentPickNumber: state.currentPickNumber, round: position.round, entryIndex: position.entryIndex },
      },
      'Calculated current snake draft pick position',
    );
    return position;
  }

  /**
   * Get the entry ID that is currently on the clock.
   */
  getCurrentEntryId(state: DraftState): string {
    const position = this.getCurrentPickPosition(state);
    const entryId = state.entryIds[position.entryIndex];
    this.logger?.debug(
      { action: 'snakeDraftEngine.getCurrentEntryId', data: { contestId: state.contestId, currentPickNumber: state.currentPickNumber, entryId } },
      'Resolved current on-the-clock draft entry',
    );
    return entryId;
  }

  /**
   * Validate a proposed pick.
   */
  validatePick(state: DraftState, pick: ProposedPick): PickValidationResult {
    this.logger?.debug(
      { action: 'snakeDraftEngine.validatePick.start', data: { contestId: state.contestId, currentPickNumber: state.currentPickNumber, entryId: pick.entryId, participantId: pick.participantId } },
      'Validating snake draft pick',
    );
    if (state.status !== 'LIVE') {
      this.logger?.warn(
        { action: 'snakeDraftEngine.validatePick.invalidStatus', data: { contestId: state.contestId, status: state.status, entryId: pick.entryId } },
        'Rejected snake draft pick because draft is not live',
      );
      return { valid: false, reason: `Draft is not live (status: ${state.status})` };
    }

    const currentEntryId = this.getCurrentEntryId(state);
    if (pick.entryId !== currentEntryId) {
      this.logger?.warn(
        { action: 'snakeDraftEngine.validatePick.notOnClock', data: { contestId: state.contestId, currentEntryId, attemptedEntryId: pick.entryId, currentPickNumber: state.currentPickNumber } },
        'Rejected snake draft pick because entry is not on the clock',
      );
      return { valid: false, reason: `Not your turn. Current pick belongs to entry ${currentEntryId}` };
    }

    if (this.isParticipantTaken(state, pick.participantId)) {
      this.logger?.warn(
        { action: 'snakeDraftEngine.validatePick.alreadyTaken', data: { contestId: state.contestId, entryId: pick.entryId, participantId: pick.participantId } },
        'Rejected snake draft pick because participant was already taken',
      );
      return { valid: false, reason: `Participant ${pick.participantId} is already drafted` };
    }

    this.logger?.info(
      { action: 'snakeDraftEngine.validatePick.success', data: { contestId: state.contestId, entryId: pick.entryId, participantId: pick.participantId } },
      'Validated snake draft pick',
    );
    return { valid: true };
  }

  /**
   * Apply a pick to the draft state. Returns the updated state.
   * Does NOT mutate the input — returns a new state object.
   */
  applyPick(state: DraftState, pick: ProposedPick, autoPicked: boolean = false): DraftState {
    this.logger?.debug(
      { action: 'snakeDraftEngine.applyPick.start', data: { contestId: state.contestId, currentPickNumber: state.currentPickNumber, entryId: pick.entryId, participantId: pick.participantId, autoPicked } },
      'Applying snake draft pick',
    );
    const position = this.getCurrentPickPosition(state);
    const totalPicks = state.entryIds.length * state.rounds;

    const newPick: DraftPickRecord = {
      pickNumber: state.currentPickNumber,
      round: position.round,
      pickInRound: position.pickInRound,
      entryId: pick.entryId,
      participantId: pick.participantId,
      autoPicked,
      isSkipped: false,
      pickedAt: new Date(),
    };

    const nextPickNumber = state.currentPickNumber + 1;
    const isComplete = nextPickNumber > totalPicks;

    const updatedState = {
      ...state,
      currentPickNumber: nextPickNumber,
      status: isComplete ? 'COMPLETE' : state.status,
      picks: [...state.picks, newPick],
    };
    this.logger?.info(
      {
        action: 'snakeDraftEngine.applyPick.success',
        data: {
          contestId: state.contestId,
          entryId: pick.entryId,
          participantId: pick.participantId,
          autoPicked,
          nextPickNumber,
          status: updatedState.status,
        },
      },
      'Applied snake draft pick',
    );
    return updatedState;
  }

  /**
   * Determine the auto-pick for an entry that missed their window.
   */
  resolveAutoPick(state: DraftState, input: AutoPickInput): string | null {
    this.logger?.debug(
      {
        action: 'snakeDraftEngine.resolveAutoPick.start',
        data: {
          contestId: state.contestId,
          entryId: input.entryId,
          autoPickPolicy: state.autoPickPolicy,
          queueLength: input.queue.length,
          availableParticipantCount: input.availableParticipantIds.length,
        },
      },
      'Resolving snake draft auto-pick',
    );
    const takenIds = new Set(state.picks.map((p) => p.participantId).filter((id): id is string => Boolean(id)));
    const available = input.availableParticipantIds.filter((id) => !takenIds.has(id));

    if (available.length === 0) {
      this.logger?.warn(
        { action: 'snakeDraftEngine.resolveAutoPick.noneAvailable', data: { contestId: state.contestId, entryId: input.entryId } },
        'Auto-pick could not resolve because no participants were available',
      );
      return null;
    }

    let resolvedParticipantId: string;
    switch (state.autoPickPolicy) {
      case 'QUEUE_THEN_BEST': {
        const fromQueue = input.queue.find((id) => available.includes(id));
        resolvedParticipantId = fromQueue ?? available[0];
        break;
      }
      case 'BEST_AVAILABLE':
        resolvedParticipantId = available[0];
        break;
      case 'RANDOM':
        resolvedParticipantId = available[Math.floor(Math.random() * available.length)];
        break;
      default:
        resolvedParticipantId = available[0];
        break;
    }
    this.logger?.info(
      { action: 'snakeDraftEngine.resolveAutoPick.success', data: { contestId: state.contestId, entryId: input.entryId, participantId: resolvedParticipantId, autoPickPolicy: state.autoPickPolicy } },
      'Resolved snake draft auto-pick',
    );
    return resolvedParticipantId;
  }

  /**
   * Check if a participant has already been drafted (exclusivity).
   */
  isParticipantTaken(state: DraftState, participantId: string): boolean {
    const taken = state.picks.some((p) => p.participantId === participantId);
    this.logger?.debug(
      { action: 'snakeDraftEngine.isParticipantTaken', data: { contestId: state.contestId, participantId, taken } },
      'Checked whether participant is already drafted',
    );
    return taken;
  }

  /**
   * Check if the draft is complete.
   */
  isComplete(state: DraftState): boolean {
    const totalPicks = state.entryIds.length * state.rounds;
    const complete = state.currentPickNumber > totalPicks;
    this.logger?.debug(
      { action: 'snakeDraftEngine.isComplete', data: { contestId: state.contestId, currentPickNumber: state.currentPickNumber, totalPicks, complete } },
      'Evaluated snake draft completion state',
    );
    return complete;
  }

  /**
   * Get all participants drafted by a specific entry.
   */
  getEntryRoster(state: DraftState, entryId: string): DraftPickRecord[] {
    const roster = state.picks.filter((p) => p.entryId === entryId);
    this.logger?.info(
      { action: 'snakeDraftEngine.getEntryRoster', data: { contestId: state.contestId, entryId, pickCount: roster.length } },
      'Loaded snake draft roster for entry',
    );
    return roster;
  }

  /**
   * Get all participant IDs that have been drafted.
   */
  getTakenParticipantIds(state: DraftState): string[] {
    const takenParticipantIds = state.picks.map((p) => p.participantId).filter((id): id is string => Boolean(id));
    this.logger?.debug(
      { action: 'snakeDraftEngine.getTakenParticipantIds', data: { contestId: state.contestId, participantCount: takenParticipantIds.length } },
      'Loaded drafted participant ids',
    );
    return takenParticipantIds;
  }
}
