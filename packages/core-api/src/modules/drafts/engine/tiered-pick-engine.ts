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
  public constructor(private readonly logger?: ServiceLogger) {}

  /**
   * Validate a proposed tiered pick.
   */
  validatePick(
    state: TieredPickState,
    entryId: string,
    tierId: string,
    participantId: string,
  ): TieredPickValidation {
    this.logger?.debug(
      { action: 'draftTieredEngine.validatePick.start', data: { contestId: state.contestId, entryId, tierId, participantId } },
      'Validating tiered pick',
    );
    const tier = state.tiers.find((t) => t.tierId === tierId);
    if (!tier) {
      this.logger?.warn(
        { action: 'draftTieredEngine.validatePick.missingTier', data: { contestId: state.contestId, entryId, tierId, participantId } },
        'Rejected tiered pick because tier was not found',
      );
      return { valid: false, reason: `Tier ${tierId} does not exist` };
    }

    if (!tier.participantIds.includes(participantId)) {
      this.logger?.warn(
        { action: 'draftTieredEngine.validatePick.invalidParticipant', data: { contestId: state.contestId, entryId, tierId, participantId } },
        'Rejected tiered pick because participant is not assigned to the tier',
      );
      return { valid: false, reason: `Participant ${participantId} is not in tier ${tierId}` };
    }

    const entry = state.entries.find((e) => e.entryId === entryId);
    const existingPicksInTier = entry?.picks.filter((p) => p.tierId === tierId) ?? [];

    if (existingPicksInTier.length >= tier.picksRequired) {
      this.logger?.warn(
        {
          action: 'draftTieredEngine.validatePick.tierFull',
          data: {
            contestId: state.contestId,
            entryId,
            tierId,
            picksRequired: tier.picksRequired,
            existingPicks: existingPicksInTier.length,
          },
        },
        'Rejected tiered pick because the tier quota is already filled',
      );
      return {
        valid: false,
        reason: `Already picked ${existingPicksInTier.length}/${tier.picksRequired} from tier ${tier.tierName}`,
      };
    }

    this.logger?.info(
      { action: 'draftTieredEngine.validatePick.success', data: { contestId: state.contestId, entryId, tierId, participantId } },
      'Validated tiered pick',
    );
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
    this.logger?.debug(
      { action: 'draftTieredEngine.applyPick.start', data: { contestId: state.contestId, entryId, tierId, participantId } },
      'Applying tiered pick',
    );
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

    const updatedState = { ...state, entries: updatedEntries };
    this.logger?.info(
      {
        action: 'draftTieredEngine.applyPick.success',
        data: {
          contestId: state.contestId,
          entryId,
          tierId,
          participantId,
          isComplete: updatedEntries.find((entry) => entry.entryId === entryId)?.isComplete ?? false,
        },
      },
      'Applied tiered pick',
    );
    return updatedState;
  }

  /**
   * Check if an entry has completed all tier picks.
   */
  isEntryComplete(tiers: TierDefinition[], picks: TieredPick[]): boolean {
    const complete = tiers.every((tier) => {
      const tierPicks = picks.filter((p) => p.tierId === tier.tierId);
      return tierPicks.length >= tier.picksRequired;
    });
    this.logger?.debug(
      { action: 'draftTieredEngine.isEntryComplete', data: { tierCount: tiers.length, pickCount: picks.length, complete } },
      'Evaluated tiered entry completeness',
    );
    return complete;
  }

  /**
   * Get the tiers an entry still needs to pick from.
   */
  getRemainingTiers(state: TieredPickState, entryId: string): TierDefinition[] {
    const entry = state.entries.find((e) => e.entryId === entryId);
    const picks = entry?.picks ?? [];

    const remaining = state.tiers.filter((tier) => {
      const tierPicks = picks.filter((p) => p.tierId === tier.tierId);
      return tierPicks.length < tier.picksRequired;
    });
    this.logger?.info(
      { action: 'draftTieredEngine.getRemainingTiers', data: { contestId: state.contestId, entryId, remainingTierCount: remaining.length } },
      'Calculated remaining tiers for entry',
    );
    return remaining;
  }

  /**
   * Get the total roster size (sum of picksRequired across all tiers).
   */
  getTotalRosterSize(tiers: TierDefinition[]): number {
    const rosterSize = tiers.reduce((sum, tier) => sum + tier.picksRequired, 0);
    this.logger?.debug(
      { action: 'draftTieredEngine.getTotalRosterSize', data: { tierCount: tiers.length, rosterSize } },
      'Calculated total roster size for tiered draft',
    );
    return rosterSize;
  }
}
import type { ServiceLogger } from '../../../core/logger';
