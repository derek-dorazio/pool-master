/**
 * Open Selection Engine.
 *
 * "Pick N from the full unrestricted field" — no draft order, no tiers, no budget.
 * Each entry simply selects N participants from the available pool.
 *
 * Used by: NCAA "Pick 8", golf "Pick 6 from the field", horse racing "Pick 3 winners".
 *
 * Supports exclusive mode (each participant picked by at most one entry) and
 * non-exclusive mode (same participant can appear on multiple entries).
 */

export interface OpenSelectionConfig {
  pickCount: number;
  isExclusive: boolean;
  poolParticipantIds: string[];
  deadline?: Date;
}

export interface OpenSelectionState {
  contestId: string;
  config: OpenSelectionConfig;
  entries: OpenSelectionEntryState[];
}

export interface OpenSelectionEntryState {
  entryId: string;
  picks: string[];
  submittedAt?: Date;
  isComplete: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface SubmitResult {
  success: boolean;
  reason?: string;
  entry?: OpenSelectionEntryState;
}

export class OpenSelectionEngine {
  /**
   * Validate a set of picks against the selection config.
   */
  validatePicks(
    picks: string[],
    config: OpenSelectionConfig,
    existingEntries?: OpenSelectionEntryState[],
    currentEntryId?: string,
  ): ValidationResult {
    // Check pick count
    if (picks.length !== config.pickCount) {
      return {
        valid: false,
        reason: `Must pick exactly ${config.pickCount} participants, got ${picks.length}`,
      };
    }

    // Check for duplicates within the pick set
    const uniquePicks = new Set(picks);
    if (uniquePicks.size !== picks.length) {
      return { valid: false, reason: 'Duplicate participants in pick set' };
    }

    // Check all picks are in the pool
    for (const participantId of picks) {
      if (!config.poolParticipantIds.includes(participantId)) {
        return {
          valid: false,
          reason: `Participant ${participantId} is not in the available pool`,
        };
      }
    }

    // Check exclusivity
    if (config.isExclusive && existingEntries) {
      const takenIds = new Set<string>();
      for (const entry of existingEntries) {
        if (entry.entryId === currentEntryId) continue;
        for (const pick of entry.picks) {
          takenIds.add(pick);
        }
      }

      for (const participantId of picks) {
        if (takenIds.has(participantId)) {
          return {
            valid: false,
            reason: `Participant ${participantId} is already picked by another entry`,
          };
        }
      }
    }

    // Check deadline
    if (config.deadline && new Date() > config.deadline) {
      return { valid: false, reason: 'Selection deadline has passed' };
    }

    return { valid: true };
  }

  /**
   * Submit picks for an entry. Returns updated state (immutable).
   */
  submitPicks(
    state: OpenSelectionState,
    entryId: string,
    picks: string[],
  ): SubmitResult {
    const validation = this.validatePicks(
      picks,
      state.config,
      state.entries,
      entryId,
    );

    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    const newEntry: OpenSelectionEntryState = {
      entryId,
      picks: [...picks],
      submittedAt: new Date(),
      isComplete: true,
    };

    return { success: true, entry: newEntry };
  }

  /**
   * Apply a submission to the state. Returns new state (immutable).
   */
  applySubmission(
    state: OpenSelectionState,
    entryId: string,
    picks: string[],
  ): OpenSelectionState {
    const newEntry: OpenSelectionEntryState = {
      entryId,
      picks: [...picks],
      submittedAt: new Date(),
      isComplete: true,
    };

    // Replace existing entry or add new one
    const existingIdx = state.entries.findIndex((e) => e.entryId === entryId);
    const updatedEntries = [...state.entries];

    if (existingIdx >= 0) {
      updatedEntries[existingIdx] = newEntry;
    } else {
      updatedEntries.push(newEntry);
    }

    return { ...state, entries: updatedEntries };
  }

  /**
   * Get available participants for an entry (respecting exclusivity).
   */
  getAvailableParticipants(
    state: OpenSelectionState,
    entryId: string,
  ): string[] {
    if (!state.config.isExclusive) {
      return [...state.config.poolParticipantIds];
    }

    const takenIds = new Set<string>();
    for (const entry of state.entries) {
      if (entry.entryId === entryId) continue;
      for (const pick of entry.picks) {
        takenIds.add(pick);
      }
    }

    return state.config.poolParticipantIds.filter((id) => !takenIds.has(id));
  }

  /**
   * Check if all entries have submitted their picks.
   */
  isAllComplete(state: OpenSelectionState): boolean {
    return state.entries.every((e) => e.isComplete);
  }
}
