import { z } from 'zod';
import { FieldOrderBasis, PlatformTierProfileLastTier, TierProfileType } from './enums';
import type { DomainEntity } from './types';

/**
 * Tier profiles (#1844): how an event's field is laid out in pick tiers. A profile is defined
 * once for the platform and each sport league names one; nothing is set per sport. A new event
 * of the league starts with the profile's tier count. The field is put in order by the profile's
 * own source list (#2160), and then laid out by the profile's type:
 *
 * - EQUAL_GROUPS fills each tier but the last with `tierSize` participants, in that order. The
 *   last tier takes everyone left (ALL_REMAINING), or at most `lastTierMax` (CAPPED), when whoever
 *   is beyond the cap is in no tier and can't be picked. A field too small to reach the last tier
 *   is split evenly over the tiers instead, larger tiers first: a rule fixed here, not a profile
 *   setting.
 * - RANGES puts each participant in the tier whose range holds their value of the profile's first
 *   source (seed 1; seeds 2 to 4; seed 5 and up), so two 1 seeds are both in tier 1. The values are
 *   the source's own, so a RANGES profile orders by SEED or RANKING first, never ODDS.
 */

export const PLATFORM_TIER_PROFILE_TIER_COUNT_MAX = 20;
export const PLATFORM_TIER_PROFILE_TIER_SIZE_MAX = 500;
/** The largest seed or rank a range can name. */
const PLATFORM_TIER_PROFILE_RANGE_VALUE_MAX = 1000;

/**
 * The values a profile orders a field by, first deciding (#2160): each basis at most once, at
 * least one.
 */
export const ProfileSourcesSchema = z.array(z.enum(FieldOrderBasis)).min(1).max(Object.keys(FieldOrderBasis).length)
  .refine((sources) => new Set(sources).size === sources.length, 'List each source once.')
  .describe('The values the field is put in order by, first deciding: the first every participant has orders the field, and the later ones break ties. Each of ODDS, SEED and RANKING at most once.');

/** One tier of a RANGES layout: the seeds or ranks it takes. */
export const TierRangeSchema = z.object({
  tierNumber: z.number().int().min(1).max(PLATFORM_TIER_PROFILE_TIER_COUNT_MAX).describe('The tier, from 1.'),
  fromValue: z.number().int().min(1).max(PLATFORM_TIER_PROFILE_RANGE_VALUE_MAX).describe('The lowest seed or rank the tier takes.'),
  toValue: z.number().int().min(1).max(PLATFORM_TIER_PROFILE_RANGE_VALUE_MAX).nullable()
    .describe('The highest seed or rank the tier takes. Null: everyone from fromValue on, which only the last tier may be.'),
}).describe('The seeds or ranks one tier takes.');
export type TierRange = z.infer<typeof TierRangeSchema>;

export const EqualGroupsLayoutSchema = z.object({
  type: z.literal(TierProfileType.EQUAL_GROUPS),
  tierCount: z.number().int().min(1).max(PLATFORM_TIER_PROFILE_TIER_COUNT_MAX)
    .describe('How many tiers a new event starts with.'),
  tierSize: z.number().int().min(1).max(PLATFORM_TIER_PROFILE_TIER_SIZE_MAX)
    .describe('How many participants auto-tiering puts in each tier before the last.'),
  lastTier: z.enum(PlatformTierProfileLastTier)
    .describe('What the last tier takes: ALL_REMAINING, everyone left; or CAPPED, at most lastTierMax, with anyone beyond in no tier and not pickable.'),
  lastTierMax: z.number().int().min(1).max(PLATFORM_TIER_PROFILE_TIER_SIZE_MAX).nullable()
    .describe('The most the last tier takes when lastTier is CAPPED. Null when it is ALL_REMAINING.'),
}).describe('Tiers of equal size, filled in the field\'s order.');

export const RangesLayoutSchema = z.object({
  type: z.literal(TierProfileType.RANGES),
  ranges: z.array(TierRangeSchema).min(1).max(PLATFORM_TIER_PROFILE_TIER_COUNT_MAX)
    .describe('Each tier\'s seeds or ranks, by tier number from 1: one per tier, with no gap or overlap, and only the last open-ended.'),
}).describe('Tiers by ranges of the first source\'s values.');

/**
 * How a field is laid out in pick tiers (#2160): EQUAL_GROUPS, tiers of one size in the field's
 * order; or RANGES, each tier the seeds or ranks its range holds.
 */
export type TierLayout = z.infer<typeof EqualGroupsLayoutSchema> | z.infer<typeof RangesLayoutSchema>;
export type EqualGroupsLayout = Extract<TierLayout, { type: 'EQUAL_GROUPS' }>;

/** How many tiers a new event starts with: the profile's count, or one per range. */
export function tierCountOf(layout: TierLayout): number {
  return layout.type === TierProfileType.EQUAL_GROUPS ? layout.tierCount : layout.ranges.length;
}

const ProfileNameOfLayoutSchema = z.string().trim().min(1).max(50).describe('The tier profile the layout came from.');

/**
 * The tier layout an event's field was last auto-tiered with: its sport league's profile at the
 * time, with the tier size an admin sent instead, if any. Stored on the event with the tiers.
 */
export const EventTierConfigSchema = z.discriminatedUnion('type', [
  EqualGroupsLayoutSchema.extend({ profileName: ProfileNameOfLayoutSchema }),
  RangesLayoutSchema.extend({ profileName: ProfileNameOfLayoutSchema }),
]).describe('The tier layout an event\'s field was last auto-tiered with.');
export type EventTierConfig = z.infer<typeof EventTierConfigSchema>;

/** A named tier layout, defined once for the platform; each sport league names one (`SportLeague.platformTierProfileId`). */
export type PlatformTierProfile = DomainEntity & TierLayout & {
  /** The profile's key: what migrations, seed scripts and test data find it by, never its name. */
  code: string;
  name: string;
  /** The values the field is ordered by, first deciding (#2160). */
  sources: FieldOrderBasis[];
};

/** A tier profile's layout and sources, as a write sends them. */
export type TierProfileValues = TierLayout & { sources: readonly FieldOrderBasis[] };

/**
 * Why a tier profile's layout and sources can't lay out a field, or null when they can: a cap
 * that doesn't match its last tier; ranges out of tier order, with a gap or an overlap, or open
 * before the last; ranges ordered by odds, which have no seed-like values.
 */
export function findTierLayoutProblem(values: TierProfileValues): string | null {
  if (values.type === TierProfileType.EQUAL_GROUPS) {
    if (values.lastTier === PlatformTierProfileLastTier.CAPPED && values.lastTierMax === null) {
      return 'A capped last tier needs the most it takes.';
    }
    if (values.lastTier === PlatformTierProfileLastTier.ALL_REMAINING && values.lastTierMax !== null) {
      return 'A last tier that takes everyone left has no cap.';
    }
    return null;
  }
  if (values.sources[0] === FieldOrderBasis.ODDS) {
    return 'Ranges are seeds or ranks, so a ranges profile orders by seed or rank first.';
  }
  for (const [index, range] of values.ranges.entries()) {
    if (range.tierNumber !== index + 1) return 'List the ranges by tier, from tier 1, one each.';
    if (range.toValue !== null && range.toValue < range.fromValue) return `Tier ${range.tierNumber}'s range ends before it starts.`;
    if (range.toValue === null && index !== values.ranges.length - 1) return 'Only the last tier can take everyone from its first value on.';
    if (index === 0) continue;
    const previous = values.ranges[index - 1];
    if (previous.toValue !== null && range.fromValue !== previous.toValue + 1) {
      return `Tier ${range.tierNumber} must start right after tier ${previous.tierNumber} ends, with no gap or overlap.`;
    }
  }
  return null;
}

/**
 * Each value's tier index in a RANGES layout (#2160): the tier whose range holds it, by the value
 * and never by position, so two 1 seeds are both in tier 1. A value in no range, or none at all,
 * is in no tier. `tierCount` is how many tiers the event has: a range beyond them goes in its last.
 */
export function placeInRanges(
  ranges: readonly TierRange[],
  tierCount: number,
  values: ReadonlyArray<number | null | undefined>,
): Array<number | null> {
  return values.map((value) => {
    if (value == null) return null;
    const index = ranges.findIndex((range) => value >= range.fromValue && (range.toValue === null || value <= range.toValue));
    return index === -1 ? null : Math.min(index, tierCount - 1);
  });
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
  layout: EqualGroupsLayout,
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
  const placesInTiers = layout.lastTier === PlatformTierProfileLastTier.CAPPED && layout.lastTierMax !== null
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
