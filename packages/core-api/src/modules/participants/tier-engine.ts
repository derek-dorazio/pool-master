/**
 * TierAssignmentEngine — assigns participants to tiers for tiered draft formats.
 *
 * Pure functions. Supports AUTO_RANKING, AUTO_PRICE, AUTO_ODDS, AUTO_SEED,
 * and MANUAL assignment modes.
 */

import type { TierConfig, TierDefinition, TierAssignmentMode } from '@poolmaster/shared/domain';

export interface TierableParticipant {
  participantId: string;
  ranking?: number;
  price?: number;
  odds?: number;
  seed?: number;
}

export interface TierAssignment {
  participantId: string;
  tierId: string;
  tierNumber: number;
}

/**
 * Assigns participants to tiers based on the tier config.
 *
 * AUTO_RANKING: sort by ranking, assign by ranking_range on each tier
 * AUTO_PRICE: sort by price desc, assign by price_range on each tier
 * MANUAL: use participant_ids already set on each tier definition (no-op assignment)
 */
export function assignTiers(
  participants: TierableParticipant[],
  config: TierConfig,
): TierAssignment[] {
  switch (config.assignmentMode) {
    case 'AUTO_RANKING':
      return assignByRanking(participants, config.tiers);
    case 'AUTO_PRICE':
      return assignByPrice(participants, config.tiers);
    case 'AUTO_ODDS':
      return assignByOdds(participants, config.tiers);
    case 'AUTO_SEED':
      return assignBySeed(participants, config.tiers);
    case 'MANUAL':
      return assignManual(config.tiers);
  }
}

function assignByRanking(
  participants: TierableParticipant[],
  tiers: TierDefinition[],
): TierAssignment[] {
  // Sort: ranked participants first (ascending), unranked at end
  const sorted = [...participants].sort((a, b) => {
    if (a.ranking === undefined && b.ranking === undefined) return 0;
    if (a.ranking === undefined) return 1;
    if (b.ranking === undefined) return -1;
    return a.ranking - b.ranking;
  });

  const sortedTiers = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);
  return assignSorted(sorted, sortedTiers, 'ranking');
}

function assignByPrice(
  participants: TierableParticipant[],
  tiers: TierDefinition[],
): TierAssignment[] {
  // Sort by price descending (most expensive first = top tier)
  const sorted = [...participants].sort((a, b) => {
    const priceA = a.price ?? 0;
    const priceB = b.price ?? 0;
    return priceB - priceA;
  });

  const sortedTiers = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);
  return assignSorted(sorted, sortedTiers, 'price');
}

function assignByOdds(
  participants: TierableParticipant[],
  tiers: TierDefinition[],
): TierAssignment[] {
  // Sort by odds ascending (lower odds = better = top tier)
  const sorted = [...participants].sort((a, b) => {
    const oddsA = a.odds ?? Infinity;
    const oddsB = b.odds ?? Infinity;
    return oddsA - oddsB;
  });

  const sortedTiers = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);
  return assignEvenDistribution(sorted, sortedTiers);
}

function assignBySeed(
  participants: TierableParticipant[],
  tiers: TierDefinition[],
): TierAssignment[] {
  // Sort by seed ascending (seed 1 = best = top tier)
  const sorted = [...participants].sort((a, b) => {
    const seedA = a.seed ?? Infinity;
    const seedB = b.seed ?? Infinity;
    return seedA - seedB;
  });

  const sortedTiers = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);
  return assignEvenDistribution(sorted, sortedTiers);
}

/**
 * Distributes a sorted participant list evenly across tiers,
 * respecting maxParticipants if set, otherwise splitting evenly.
 */
function assignEvenDistribution(
  sorted: TierableParticipant[],
  tiers: TierDefinition[],
): TierAssignment[] {
  const assignments: TierAssignment[] = [];

  // If tiers have maxParticipants, use those; otherwise split evenly
  const hasMax = tiers.some((t) => t.maxParticipants !== undefined);

  if (hasMax) {
    let idx = 0;
    for (const tier of tiers) {
      const max = tier.maxParticipants ?? sorted.length;
      const count = Math.min(max, sorted.length - idx);
      for (let i = 0; i < count; i++) {
        assignments.push({
          participantId: sorted[idx].participantId,
          tierId: tier.tierId,
          tierNumber: tier.tierNumber,
        });
        idx++;
      }
    }
    // Overflow to last tier
    if (idx < sorted.length && tiers.length > 0) {
      const lastTier = tiers[tiers.length - 1];
      for (let i = idx; i < sorted.length; i++) {
        assignments.push({
          participantId: sorted[i].participantId,
          tierId: lastTier.tierId,
          tierNumber: lastTier.tierNumber,
        });
      }
    }
  } else {
    const perTier = Math.ceil(sorted.length / tiers.length);
    let idx = 0;
    for (const tier of tiers) {
      const count = Math.min(perTier, sorted.length - idx);
      for (let i = 0; i < count; i++) {
        assignments.push({
          participantId: sorted[idx].participantId,
          tierId: tier.tierId,
          tierNumber: tier.tierNumber,
        });
        idx++;
      }
    }
  }

  return assignments;
}

function assignSorted(
  sorted: TierableParticipant[],
  tiers: TierDefinition[],
  mode: 'ranking' | 'price',
): TierAssignment[] {
  const assignments: TierAssignment[] = [];
  const assigned = new Set<string>();

  for (const tier of tiers) {
    let tierCount = 0;

    for (const participant of sorted) {
      if (assigned.has(participant.participantId)) continue;

      const fits = fitsInTier(participant, tier, mode);
      if (!fits) continue;

      if (tier.maxParticipants !== undefined && tierCount >= tier.maxParticipants) {
        break; // overflow to next tier
      }

      assignments.push({
        participantId: participant.participantId,
        tierId: tier.tierId,
        tierNumber: tier.tierNumber,
      });
      assigned.add(participant.participantId);
      tierCount++;
    }
  }

  // Assign unassigned participants to the lowest (last) tier
  if (tiers.length > 0) {
    const lowestTier = tiers[tiers.length - 1];
    for (const participant of sorted) {
      if (assigned.has(participant.participantId)) continue;
      assignments.push({
        participantId: participant.participantId,
        tierId: lowestTier.tierId,
        tierNumber: lowestTier.tierNumber,
      });
    }
  }

  return assignments;
}

function fitsInTier(
  participant: TierableParticipant,
  tier: TierDefinition,
  mode: 'ranking' | 'price',
): boolean {
  if (mode === 'ranking' && tier.rankingRange) {
    const rank = participant.ranking;
    if (rank === undefined) return false;
    return rank >= tier.rankingRange[0] && rank <= tier.rankingRange[1];
  }

  if (mode === 'price' && tier.priceRange) {
    const price = participant.price ?? 0;
    return price >= tier.priceRange[0] && price <= tier.priceRange[1];
  }

  // No range defined — accept all (tier fills by order)
  return true;
}

function assignManual(tiers: TierDefinition[]): TierAssignment[] {
  const assignments: TierAssignment[] = [];
  for (const tier of tiers) {
    for (const participantId of tier.participantIds) {
      assignments.push({
        participantId,
        tierId: tier.tierId,
        tierNumber: tier.tierNumber,
      });
    }
  }
  return assignments;
}
