import { expect } from '@jest/globals';
import {
  EqualGroupsLayoutSchema,
  SlotTierLayoutSchema,
  slotTierLayoutOf,
  type PlatformTierProfile,
  FieldOrderBasis,
  PlatformTierProfileLastTier,
  TierProfileType,
  findTierLayoutProblem,
  placeInRanges,
  placeInTiers,
  tierCountOf,
  type EqualGroupsLayout,
  type TierProfileValues,
  type TierRange,
} from '@poolmaster/shared/domain';

// The tier layout a sport league's profile names (#1844), and how it places an ordered field:
// fixed-size tiers once the field reaches the last tier, the last taking everyone left or at most
// its cap, and an even spread, larger tiers first, for a field too small or an event whose tier
// count an admin changed.

const SIX_OF_TEN: EqualGroupsLayout = { type: TierProfileType.EQUAL_GROUPS, tierCount: 6, tierSize: 10, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
const SIX_OF_TEN_CAPPED: EqualGroupsLayout = { ...SIX_OF_TEN, lastTier: PlatformTierProfileLastTier.CAPPED, lastTierMax: 15 };

const PROFILE_ID = '00000000-0000-4000-8000-0000000000a1';

const ODDS_FIRST = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];

function range(tierNumber: number, fromValue: number, toValue: number | null): TierRange {
  return { tierNumber, fromValue, toValue };
}

/** The NFL's playoff seed profile (#2160): tier 1 is seed 1, tier 2 seeds 2 to 4, tier 3 seed 5 on. */
const SEED_RANGES = {
  type: TierProfileType.RANGES,
  sources: [FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING],
  ranges: [range(1, 1, 1), range(2, 2, 4), range(3, 5, null)],
} satisfies TierProfileValues;

/** How many places land in each of `tierCount` tiers, and how many in none. */
function sizes(tierIndexes: ReadonlyArray<number | null>, tierCount: number) {
  const inTier = Array.from({ length: tierCount }, (_, tier) => tierIndexes.filter((index) => index === tier).length);
  return { inTier, inNone: tierIndexes.filter((index) => index === null).length };
}

describe('placeInTiers — a field in its league\'s tier layout', () => {
  it('fills each tier but the last with the profile\'s size and puts everyone left in the last when it takes all remaining: 72 golfers is 10 ×5 and 22', () => {
    const { tierIndexes, spread, tierSize } = placeInTiers(SIX_OF_TEN, 6, 72);

    expect(sizes(tierIndexes, 6)).toEqual({ inTier: [10, 10, 10, 10, 10, 22], inNone: 0 });
    expect([spread, tierSize]).toEqual(['FIXED_SIZE', 10]);
  });

  it('stops a capped last tier at its maximum and leaves everyone beyond it in no tier: 72 golfers capped at 15 is 10 ×5, 15 and 7 unplaced', () => {
    const { tierIndexes } = placeInTiers(SIX_OF_TEN_CAPPED, 6, 72);

    expect(sizes(tierIndexes, 6)).toEqual({ inTier: [10, 10, 10, 10, 10, 15], inNone: 7 });
    // The field's order holds: the unplaced are the last seven, not a scattering.
    expect(tierIndexes.slice(65)).toEqual([null, null, null, null, null, null, null]);
    expect(tierIndexes[64]).toBe(5);
  });

  it('leaves no one out of a capped last tier the field doesn\'t reach its cap of: 60 golfers capped at 15 is 10 each', () => {
    expect(sizes(placeInTiers(SIX_OF_TEN_CAPPED, 6, 60).tierIndexes, 6)).toEqual({ inTier: [10, 10, 10, 10, 10, 10], inNone: 0 });
  });

  it('spreads a field too small to reach the last tier evenly, larger tiers first, whatever the last tier takes: 33 golfers is 6,6,6,5,5,5', () => {
    for (const layout of [SIX_OF_TEN, SIX_OF_TEN_CAPPED]) {
      const { tierIndexes, spread, tierSize } = placeInTiers(layout, 6, 33);

      expect(sizes(tierIndexes, 6)).toEqual({ inTier: [6, 6, 6, 5, 5, 5], inNone: 0 });
      expect([spread, tierSize]).toEqual(['EVEN', null]);
    }
  });

  it('keeps the fixed layout for a field of one more than the tiers before the last hold: 51 golfers is 10 ×5 and 1', () => {
    expect(sizes(placeInTiers(SIX_OF_TEN, 6, 51).tierIndexes, 6).inTier).toEqual([10, 10, 10, 10, 10, 1]);
    expect(placeInTiers(SIX_OF_TEN, 6, 50).spread).toBe('EVEN');
  });

  it('spreads evenly over an event whose tier count an admin changed from the profile\'s: 72 golfers on four tiers is 18 each', () => {
    const { tierIndexes, spread } = placeInTiers(SIX_OF_TEN, 4, 72);

    expect(sizes(tierIndexes, 4).inTier).toEqual([18, 18, 18, 18]);
    expect(spread).toBe('EVEN');
  });

  it('fills the tier size an admin sends instead of the profile\'s, even on a changed tier count, the cap still holding the last tier', () => {
    expect(sizes(placeInTiers(SIX_OF_TEN, 4, 22, 8).tierIndexes, 4).inTier).toEqual([8, 8, 6, 0]);
    const capped = placeInTiers(SIX_OF_TEN_CAPPED, 6, 72, 5);

    expect(sizes(capped.tierIndexes, 6)).toEqual({ inTier: [5, 5, 5, 5, 5, 15], inNone: 32 });
    expect([capped.spread, capped.tierSize]).toEqual(['FIXED_SIZE', 5]);
  });

  it('places no one for an empty field, and leaves trailing tiers empty for a field smaller than the tier count', () => {
    expect(placeInTiers(SIX_OF_TEN, 6, 0).tierIndexes).toEqual([]);
    expect(sizes(placeInTiers(SIX_OF_TEN, 6, 4).tierIndexes, 6).inTier).toEqual([1, 1, 1, 1, 0, 0]);
  });
});

describe('findTierLayoutProblem — a tier layout\'s values agree', () => {
  it.each([
    ['takes everyone left with no cap', SIX_OF_TEN, null],
    ['caps the last tier at a maximum', SIX_OF_TEN_CAPPED, null],
    ['caps the last tier with no maximum', { ...SIX_OF_TEN_CAPPED, lastTierMax: null }, 'A capped last tier needs the most it takes.'],
    ['takes everyone left but names a maximum', { ...SIX_OF_TEN, lastTierMax: 15 }, 'A last tier that takes everyone left has no cap.'],
  ])('answers a layout that %s with %p', (_case, layout, problem) => {
    expect(findTierLayoutProblem({ ...layout, sources: ODDS_FIRST })).toBe(problem);
  });

  it.each([
    ['takes seed 1, seeds 2 to 4 and the rest, by seed first', SEED_RANGES, null],
    ['orders by odds first, which no range holds', { ...SEED_RANGES, sources: ODDS_FIRST }, 'Ranges are seeds or ranks, so a ranges profile orders by seed or rank first.'],
    ['lists its tiers out of order', { ...SEED_RANGES, ranges: [SEED_RANGES.ranges[1], SEED_RANGES.ranges[0], SEED_RANGES.ranges[2]] }, 'List the ranges by tier, from tier 1, one each.'],
    ['ends a range before it starts', { ...SEED_RANGES, ranges: [range(1, 3, 1), range(2, 4, 4), range(3, 5, null)] }, 'Tier 1\'s range ends before it starts.'],
    ['leaves a gap between two tiers', { ...SEED_RANGES, ranges: [range(1, 1, 1), range(2, 3, 4), range(3, 5, null)] }, 'Tier 2 must start right after tier 1 ends, with no gap or overlap.'],
    ['overlaps two tiers', { ...SEED_RANGES, ranges: [range(1, 1, 2), range(2, 2, 4), range(3, 5, null)] }, 'Tier 2 must start right after tier 1 ends, with no gap or overlap.'],
    ['leaves a tier before the last open-ended', { ...SEED_RANGES, ranges: [range(1, 1, null), range(2, 2, 4)] }, 'Only the last tier can take everyone from its first value on.'],
  ])('answers a ranges layout that %s with %p', (_case, values, problem) => {
    expect(findTierLayoutProblem(values as TierProfileValues)).toBe(problem);
  });
});

describe('placeInRanges — each participant in the tier whose range holds its value, not its place in the order', () => {
  it('puts a 14-team, two-conference playoff field in seed tiers: both 1 seeds in tier 1, six in tier 2, six in tier 3', () => {
    // Each conference seeds 1 to 7, so each seed is held by two teams.
    const seeds = [1, 2, 3, 4, 5, 6, 7].flatMap((seed) => [seed, seed]);

    const tiers = placeInRanges(SEED_RANGES.ranges, 3, seeds);

    expect(sizes(tiers, 3)).toEqual({ inTier: [2, 6, 6], inNone: 0 });
  });

  it('places by value whatever the order: two 1 seeds both land in tier 1 though one is listed last', () => {
    expect(placeInRanges(SEED_RANGES.ranges, 3, [1, 2, 5, 1])).toEqual([0, 1, 2, 0]);
  });

  it('leaves a participant with no value, or a value no range holds, in no tier', () => {
    const fromTwo = [range(1, 2, 4), range(2, 5, null)];

    expect(placeInRanges(fromTwo, 2, [null, 1, undefined, 3])).toEqual([null, null, null, 0]);
  });

  it('puts a range beyond an event\'s tier count in its last tier, when an admin left the event fewer tiers', () => {
    expect(placeInRanges(SEED_RANGES.ranges, 2, [1, 3, 7])).toEqual([0, 1, 1]);
  });

  it('counts a ranges layout\'s tiers by its ranges and an equal-groups layout\'s by its tier count', () => {
    expect(tierCountOf(SEED_RANGES)).toBe(3);
    expect(tierCountOf(SIX_OF_TEN)).toBe(6);
  });
});

describe('EqualGroupsLayoutSchema and SlotTierLayoutSchema', () => {
  it('refuses a layout of no tiers, more than twenty, or tiers of no one', () => {
    expect(EqualGroupsLayoutSchema.safeParse({ ...SIX_OF_TEN, tierCount: 0 }).success).toBe(false);
    expect(EqualGroupsLayoutSchema.safeParse({ ...SIX_OF_TEN, tierCount: 21 }).success).toBe(false);
    expect(EqualGroupsLayoutSchema.safeParse({ ...SIX_OF_TEN, tierSize: 0 }).success).toBe(false);
    expect(EqualGroupsLayoutSchema.safeParse(SIX_OF_TEN).success).toBe(true);
  });

  it('reads back a slot\'s recorded layout with the profile it came from, by id and name', () => {
    const recorded = { platformTierProfileId: PROFILE_ID, profileName: '6 tiers of 10', ...SIX_OF_TEN_CAPPED };

    expect(SlotTierLayoutSchema.parse(recorded)).toEqual(recorded);
  });

  it('refuses a slot\'s recorded layout that names its profile by name alone', () => {
    expect(SlotTierLayoutSchema.safeParse({ profileName: '6 tiers of 10', ...SIX_OF_TEN }).success).toBe(false);
  });

  it('reads back a slot\'s recorded ranges layout with its ranges', () => {
    const recorded = { platformTierProfileId: PROFILE_ID, profileName: 'Playoff seeds 1, 2-4, rest', type: TierProfileType.RANGES, ranges: SEED_RANGES.ranges };

    expect(SlotTierLayoutSchema.parse(recorded)).toEqual(recorded);
  });
});

describe('slotTierLayoutOf', () => {
  const stamps = { code: 'TIERS_6_OF_10', name: '6 tiers of 10', description: 'Six tiers of ten.', sources: ODDS_FIRST, createdAt: new Date(0), updatedAt: new Date(0) };

  it('lays a slot out by its profile, with the tier size an admin sent in place of the profile\'s', () => {
    const profile: PlatformTierProfile = { id: PROFILE_ID, ...stamps, ...SIX_OF_TEN };

    expect(slotTierLayoutOf(profile, 8)).toEqual({ platformTierProfileId: PROFILE_ID, profileName: '6 tiers of 10', ...SIX_OF_TEN, tierSize: 8 });
    expect(slotTierLayoutOf(profile, null)).toEqual({ platformTierProfileId: PROFILE_ID, profileName: '6 tiers of 10', ...SIX_OF_TEN });
  });

  it('lays a slot out by a ranges profile\'s own ranges, which take no tier size', () => {
    const profile: PlatformTierProfile = { id: PROFILE_ID, ...stamps, name: 'Seeds', type: TierProfileType.RANGES, ranges: SEED_RANGES.ranges };

    expect(slotTierLayoutOf(profile, null)).toEqual({ platformTierProfileId: PROFILE_ID, profileName: 'Seeds', type: TierProfileType.RANGES, ranges: SEED_RANGES.ranges });
  });
});
