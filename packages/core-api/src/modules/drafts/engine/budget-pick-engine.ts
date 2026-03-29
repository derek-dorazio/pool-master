/**
 * Budget Pick Engine.
 *
 * Each participant has a cost. Entries build a roster within a total budget.
 * Non-exclusive: the same participant can be picked by multiple entries.
 *
 * Used by: golf (GOLF-T2), NBA/NHL playoffs (NBA-T3, NHL-T3),
 * NCAA (NCAA-T3), horse racing (HR-T2), soccer (SOC-T3), etc.
 */

export interface BudgetParticipant {
  participantId: string;
  cost: number;
}

export interface BudgetPickState {
  contestId: string;
  budget: number;
  rosterSize: number;
  participants: BudgetParticipant[];
  entries: BudgetEntryState[];
}

export interface BudgetEntryState {
  entryId: string;
  picks: BudgetPick[];
  totalSpent: number;
  isComplete: boolean;
}

export interface BudgetPick {
  participantId: string;
  cost: number;
  pickedAt: Date;
}

export interface BudgetPickValidation {
  valid: boolean;
  reason?: string;
  remainingBudget?: number;
}

export class BudgetPickEngine {
  /**
   * Validate a proposed budget pick.
   */
  validatePick(
    state: BudgetPickState,
    entryId: string,
    participantId: string,
  ): BudgetPickValidation {
    const participant = state.participants.find((p) => p.participantId === participantId);
    if (!participant) {
      return { valid: false, reason: `Participant ${participantId} is not in the pool` };
    }

    const entry = state.entries.find((e) => e.entryId === entryId);
    const currentPicks = entry?.picks ?? [];
    const totalSpent = entry?.totalSpent ?? 0;

    if (currentPicks.length >= state.rosterSize) {
      return { valid: false, reason: `Roster is full (${state.rosterSize} picks)` };
    }

    if (currentPicks.some((p) => p.participantId === participantId)) {
      return { valid: false, reason: `Participant ${participantId} is already on your roster` };
    }

    const remaining = state.budget - totalSpent;
    if (participant.cost > remaining) {
      return {
        valid: false,
        reason: `Cost ${participant.cost} exceeds remaining budget ${remaining}`,
        remainingBudget: remaining,
      };
    }

    const slotsAfterPick = state.rosterSize - currentPicks.length - 1;
    if (slotsAfterPick > 0) {
      const cheapest = this.getCheapestAvailable(state, currentPicks, participantId);
      const minToFillRemaining = cheapest * slotsAfterPick;
      const budgetAfterPick = remaining - participant.cost;

      if (budgetAfterPick < minToFillRemaining) {
        return {
          valid: false,
          reason: `Picking this leaves ${budgetAfterPick} for ${slotsAfterPick} slots (need at least ${minToFillRemaining})`,
          remainingBudget: remaining,
        };
      }
    }

    return { valid: true, remainingBudget: remaining - participant.cost };
  }

  /**
   * Apply a budget pick. Returns updated state (immutable).
   */
  applyPick(
    state: BudgetPickState,
    entryId: string,
    participantId: string,
  ): BudgetPickState {
    const participant = state.participants.find((p) => p.participantId === participantId)!;
    const newPick: BudgetPick = {
      participantId,
      cost: participant.cost,
      pickedAt: new Date(),
    };

    const updatedEntries = state.entries.map((entry) => {
      if (entry.entryId !== entryId) return entry;

      const updatedPicks = [...entry.picks, newPick];
      const totalSpent = entry.totalSpent + participant.cost;
      const isComplete = updatedPicks.length >= state.rosterSize;

      return { ...entry, picks: updatedPicks, totalSpent, isComplete };
    });

    if (!updatedEntries.some((e) => e.entryId === entryId)) {
      updatedEntries.push({
        entryId,
        picks: [newPick],
        totalSpent: participant.cost,
        isComplete: 1 >= state.rosterSize,
      });
    }

    return { ...state, entries: updatedEntries };
  }

  /**
   * Get remaining budget for an entry.
   */
  getRemainingBudget(state: BudgetPickState, entryId: string): number {
    const entry = state.entries.find((e) => e.entryId === entryId);
    return state.budget - (entry?.totalSpent ?? 0);
  }

  /**
   * Get participants that an entry can still afford.
   */
  getAffordableParticipants(
    state: BudgetPickState,
    entryId: string,
  ): BudgetParticipant[] {
    const entry = state.entries.find((e) => e.entryId === entryId);
    const remaining = this.getRemainingBudget(state, entryId);
    const pickedIds = new Set(entry?.picks.map((p) => p.participantId) ?? []);

    return state.participants.filter(
      (p) => p.cost <= remaining && !pickedIds.has(p.participantId),
    );
  }

  private getCheapestAvailable(
    state: BudgetPickState,
    currentPicks: BudgetPick[],
    excludeId: string,
  ): number {
    const pickedIds = new Set(currentPicks.map((p) => p.participantId));
    pickedIds.add(excludeId);

    const available = state.participants.filter((p) => !pickedIds.has(p.participantId));
    if (available.length === 0) return 0;

    return Math.min(...available.map((p) => p.cost));
  }
}
