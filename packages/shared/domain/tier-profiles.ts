import { z } from 'zod';
import type { DomainEntity } from './types';

/**
 * Tier profiles (#1844): how an event's field is laid out in pick tiers. A profile is defined
 * once for the platform and each sport league names one; nothing is set per sport. A new event
 * of the league starts with the profile's tier count, and auto-tiering fills each tier but the
 * last with `tierSize` participants, in the field's one order (#1807).
 *
 * The last tier takes everyone left (ALL_REMAINING), or at most `lastTierMax` (CAPPED), when
 * whoever is beyond the cap is in no tier and can't be picked. A field too small to reach the
 * last tier is split evenly over the tiers instead, larger tiers first: a rule fixed here, not a
 * profile setting.
 */

export const TIER_PROFILE_TIER_COUNT_MAX = 20;
export const TIER_PROFILE_TIER_SIZE_MAX = 500;

/** What a tier profile's last tier takes. */
export const TierProfileLastTier = {
  /** Everyone left once the tiers before it are filled. */
  ALL_REMAINING: 'ALL_REMAINING',
  /** At most the profile's `lastTierMax`; anyone beyond is in no tier and can't be picked. */
  CAPPED: 'CAPPED',
} as const;
export type TierProfileLastTier = (typeof TierProfileLastTier)[keyof typeof TierProfileLastTier];

/** The four values a field is laid out in tiers with. */
export const TierLayoutValuesSchema = z.object({
  tierCount: z.number().int().min(1).max(TIER_PROFILE_TIER_COUNT_MAX)
    .describe('How many tiers a new event starts with.'),
  tierSize: z.number().int().min(1).max(TIER_PROFILE_TIER_SIZE_MAX)
    .describe('How many participants auto-tiering puts in each tier before the last.'),
  lastTier: z.enum(TierProfileLastTier)
    .describe('What the last tier takes: ALL_REMAINING, everyone left; or CAPPED, at most lastTierMax, with anyone beyond in no tier and not pickable.'),
  lastTierMax: z.number().int().min(1).max(TIER_PROFILE_TIER_SIZE_MAX).nullable()
    .describe('The most the last tier takes when lastTier is CAPPED. Null when it is ALL_REMAINING.'),
}).describe('The values a field is laid out in pick tiers with.');
export type TierLayoutValues = z.infer<typeof TierLayoutValuesSchema>;

/**
 * The tier layout an event's field was last auto-tiered with: its sport league's profile at the
 * time, with the tier size an admin sent instead, if any. Stored on the event with the tiers.
 */
export const EventTierConfigSchema = TierLayoutValuesSchema.extend({
  profileName: z.string().trim().min(1).max(50).describe('The tier profile the layout came from.'),
}).describe('The tier layout an event\'s field was last auto-tiered with.');
export type EventTierConfig = z.infer<typeof EventTierConfigSchema>;

/** A named tier layout, defined once for the platform; each sport league names one (`SportLeague.tierProfileId`). */
export interface TierProfile extends DomainEntity, TierLayoutValues {
  name: string;
}

/** Why a set of tier layout values can't lay out a field, or null when it can. */
export function findTierLayoutProblem(values: TierLayoutValues): string | null {
  if (values.lastTier === TierProfileLastTier.CAPPED && values.lastTierMax === null) {
    return 'A capped last tier needs the most it takes.';
  }
  if (values.lastTier === TierProfileLastTier.ALL_REMAINING && values.lastTierMax !== null) {
    return 'A last tier that takes everyone left has no cap.';
  }
  return null;
}

/** How a field was filled into its tiers. */
export type TierSpread = 'FIXED_SIZE' | 'EVEN';

/**
 * Each place in an ordered field's tier, by index into the event's tiers, or null for a place
 * beyond a capped last tier. `tierCount` is how many tiers the event has, which an admin may
 * have changed from the layout's.
 *
 * With `requestedTierSize` (the admin's correction), each tier but the last takes that many.
 * Otherwise an event that still has the layout's tier count gets the layout's size while the
 * field reaches the last tier. Either way the last tier takes the rest, or up to its cap. Any
 * other tier count, or a field too small for the layout, is spread evenly, larger tiers first
 * (22 on four tiers is 6/6/5/5), with no cap, so no tier is left empty unless the field is
 * smaller than the tier count.
 */
export function placeInTiers(
  layout: TierLayoutValues,
  tierCount: number,
  fieldSize: number,
  requestedTierSize?: number,
): { tierIndexes: Array<number | null>; spread: TierSpread; tierSize: number | null } {
  const fitsLayout = tierCount === layout.tierCount && fieldSize > (tierCount - 1) * layout.tierSize;
  const tierSize = requestedTierSize ?? (fitsLayout ? layout.tierSize : undefined);
  if (tierSize === undefined) {
    const tierIndexAt = evenSpreadTierIndex(fieldSize, tierCount);
    return { tierIndexes: Array.from({ length: fieldSize }, (_, index) => tierIndexAt(index)), spread: 'EVEN', tierSize: null };
  }
  const beforeLastTier = (tierCount - 1) * tierSize;
  const placesInTiers = layout.lastTier === TierProfileLastTier.CAPPED && layout.lastTierMax !== null
    ? beforeLastTier + layout.lastTierMax
    : Number.POSITIVE_INFINITY;
  return {
    tierIndexes: Array.from({ length: fieldSize }, (_, index) => (index < placesInTiers
      ? Math.min(Math.floor(index / tierSize), tierCount - 1)
      : null)),
    spread: 'FIXED_SIZE',
    tierSize,
  };
}

/**
 * The tier index of the participant at `index` when `fieldSize` participants are spread evenly
 * over `tierCount` tiers in order, the first `fieldSize % tierCount` tiers taking one more.
 */
function evenSpreadTierIndex(fieldSize: number, tierCount: number): (index: number) => number {
  const smallSize = Math.floor(fieldSize / tierCount);
  const largeTierCount = fieldSize % tierCount;
  const inLargeTiers = largeTierCount * (smallSize + 1);
  return (index) => (index < inLargeTiers
    ? Math.floor(index / (smallSize + 1))
    : largeTierCount + Math.floor((index - inLargeTiers) / smallSize));
}
