/**
 * Tiered Pick Engine.
 *
 * Participants are grouped into tiers (by seed, ranking, odds, or commissioner).
 * Each entry picks one participant from each tier. Non-exclusive: the same
 * participant can be picked by multiple entries.
 *
 * Used by: golf majors (GOLF-T1), NBA/NHL playoffs (NBA-T2, NHL-T2),
 * NCAA basketball (NCAA-T2), horse racing (HR-T1), soccer (SOC-T2), etc.
 */

export interface TierDefinition {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksRequired: number;
  participantIds: string[];
}

export interface TieredPickState {
  contestId: string;
  tiers: TierDefinition[];
  entries: TieredEntryState[];
  bestBallN?: number;
}

export interface TieredEntryState {
  entryId: string;
  picks: TieredPick[];
  isComplete: boolean;
}

export interface TieredPick {
  tierId: string;
  participantId: string;
  pickedAt: Date;
}

export interface TieredPickValidation {
  valid: boolean;
  reason?: string;
}

export class TieredPickEngine {
  /**
   * Validate a proposed tiered pick.
   */
  validatePick(
    state: TieredPickState,
    entryId: string,
    tierId: string,
    participantId: string,
  ): TieredPickValidation {
    const tier = state.tiers.find((t) => t.tierId === tierId);
    if (!tier) {
      return { valid: false, reason: `Tier ${tierId} does not exist` };
    }

    if (!tier.participantIds.includes(participantId)) {
      return { valid: false, reason: `Participant ${participantId} is not in tier ${tierId}` };
    }

    const entry = state.entries.find((e) => e.entryId === entryId);
    const existingPicksInTier = entry?.picks.filter((p) => p.tierId === tierId) ?? [];

    if (existingPicksInTier.length >= tier.picksRequired) {
      return {
        valid: false,
        reason: `Already picked ${existingPicksInTier.length}/${tier.picksRequired} from tier ${tier.tierName}`,
      };
    }

    return { valid: true };
  }

  /**
   * Apply a tiered pick. Returns updated state (immutable).
   */
  applyPick(
    state: TieredPickState,
    entryId: string,
    tierId: string,
    participantId: string,
  ): TieredPickState {
    const newPick: TieredPick = { tierId, participantId, pickedAt: new Date() };

    const updatedEntries = state.entries.map((entry) => {
      if (entry.entryId !== entryId) return entry;

      const updatedPicks = [...entry.picks, newPick];
      const isComplete = this.isEntryComplete(state.tiers, updatedPicks);

      return { ...entry, picks: updatedPicks, isComplete };
    });

    // If entry doesn't exist yet, create it
    if (!updatedEntries.some((e) => e.entryId === entryId)) {
      const isComplete = this.isEntryComplete(state.tiers, [newPick]);
      updatedEntries.push({ entryId, picks: [newPick], isComplete });
    }

    return { ...state, entries: updatedEntries };
  }

  /**
   * Check if an entry has completed all tier picks.
   */
  isEntryComplete(tiers: TierDefinition[], picks: TieredPick[]): boolean {
    return tiers.every((tier) => {
      const tierPicks = picks.filter((p) => p.tierId === tier.tierId);
      return tierPicks.length >= tier.picksRequired;
    });
  }

  /**
   * Get the tiers an entry still needs to pick from.
   */
  getRemainingTiers(state: TieredPickState, entryId: string): TierDefinition[] {
    const entry = state.entries.find((e) => e.entryId === entryId);
    const picks = entry?.picks ?? [];

    return state.tiers.filter((tier) => {
      const tierPicks = picks.filter((p) => p.tierId === tier.tierId);
      return tierPicks.length < tier.picksRequired;
    });
  }

  /**
   * Get the total roster size (sum of picksRequired across all tiers).
   */
  getTotalRosterSize(tiers: TierDefinition[]): number {
    return tiers.reduce((sum, tier) => sum + tier.picksRequired, 0);
  }
}
