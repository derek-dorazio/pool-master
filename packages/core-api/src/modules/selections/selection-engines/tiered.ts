/**
 * The tiered selection engine (#198): pick a set number of participants from each of the
 * event's tiers.
 *
 * Its rules are the live room's, specified by `tests/functional/selections.functional.ts`:
 * re-selecting a participant the entry holds **toggles it off**, and selecting into a tier the
 * entry has already filled **replaces** that tier's newest pick rather than rejecting. Both are
 * deliberate; the engines #323 deleted rejected on a full tier and disagreed with production.
 */

import { SelectionType } from '@poolmaster/shared/domain';
import { findTierByLabel } from '../selection-rules';
import type { SelectionTierConfig } from '../types';
import {
  lineupShortfall,
  SelectionOutcomeKind,
  SelectionRejectCode,
  type EntryPick,
  type SelectionEngine,
  type SelectionOutcome,
} from './selection-engine';

/**
 * Where a tiered selection lands within the entry, and which pick it displaces.
 *
 * The central rule: **a full tier replaces, it does not reject.** When the entry already holds
 * as many picks from this tier as the tier asks for, the oldest-first list's last pick is
 * displaced and the new one takes its round. `ENTRY_COMPLETE` is for a full entry with no tier
 * to replace within, which is why the replacement check runs first and the completeness check
 * consults its result.
 *
 * A tier configured to contribute no picks is the degenerate case worth naming: every entry
 * already holds "enough" picks from it, but there is no pick to displace, so a full entry is
 * complete and an unfull one simply places.
 */
export function resolveTieredPlacement(input: {
  tier: SelectionTierConfig;
  tiers: readonly SelectionTierConfig[];
  /** The entry's picks, oldest first. */
  existingPicks: readonly EntryPick[];
  rosterSize: number;
}): SelectionOutcome {
  const { tier, tiers, existingPicks, rosterSize } = input;

  const participantIdsInTier = new Set(tier.participantIds);
  const picksInTier = existingPicks.filter((pick) => participantIdsInTier.has(pick.participantId));
  const replacedPickId =
    picksInTier.length >= tier.picksFromTier
      ? picksInTier[picksInTier.length - 1]?.id ?? null
      : null;

  if (existingPicks.length >= rosterSize && !replacedPickId) {
    return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE };
  }

  const effectivePicksInTierCount = replacedPickId
    ? tier.picksFromTier - 1
    : Math.min(picksInTier.length, tier.picksFromTier - 1);
  const roundsBeforeTier = tiers
    .filter((item) => item.tierNumber < tier.tierNumber)
    .reduce((sum, item) => sum + item.picksFromTier, 0);
  const lineupSlot = roundsBeforeTier + effectivePicksInTierCount + 1;

  return replacedPickId
    ? { kind: SelectionOutcomeKind.REPLACE, lineupSlot, replacedPickId }
    : { kind: SelectionOutcomeKind.ACCEPT, lineupSlot };
}

export const tieredSelectionEngine: SelectionEngine = {
  selectionType: SelectionType.TIERED,

  /**
   * However many picks the tiers ask for, added up (the event's tier count times the
   * contest's picks per tier, #479). The configuration's own `rosterSize` is ignored, which is
   * why a tiered room with no tiers has a roster of 0 and refuses picks with
   * `SELECTION_CONFIG_INVALID`.
   */
  rosterSize: ({ tiers }) => tiers.reduce((sum, tier) => sum + tier.picksFromTier, 0),

  evaluate: ({ participant, heldPick, existingPicks, tiers, rosterSize }) => {
    if (heldPick) return { kind: SelectionOutcomeKind.TOGGLE_OFF, pickId: heldPick.id };

    const tierLabel = participant.tier;
    if (!tierLabel) return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.TIER_MISSING };

    const tier = findTierByLabel(tiers, tierLabel);
    if (!tier) {
      return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.TIER_NOT_FOUND, tierLabel };
    }

    return resolveTieredPlacement({ tier, tiers, existingPicks, rosterSize });
  },

  /**
   * Complete only with exactly `rosterSize` picks and exactly as many from each tier as the
   * tier asks for. The room cannot overfill a tier (a full tier replaces), but the per-tier
   * check still runs on its own, because a pick on a golfer later moved out of every tier
   * counts towards the roster yet fills no tier.
   */
  findShortfall: ({ rosterSize, tiers, picks }) =>
    lineupShortfall({
      rosterSize,
      pickCount: picks.length,
      shortTierNames: tiers
        .filter((tier) => {
          const tierParticipantIds = new Set(tier.participantIds);
          const picksInTier = picks.filter((pick) => tierParticipantIds.has(pick.participantId));
          return picksInTier.length !== tier.picksFromTier;
        })
        .map((tier) => tier.tierName),
    }),

  /** A tiered pick's round is its tier, which is why the history groups by tier. */
  historyRound: ({ tierNumber, entryPickIndex }) => tierNumber ?? entryPickIndex,
};
