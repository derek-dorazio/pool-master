import { expect } from '@jest/globals';
import {
  EventTierConfigSchema,
  TierLayoutValuesSchema,
  PlatformTierProfileLastTier,
  findTierLayoutProblem,
  placeInTiers,
  type TierLayoutValues,
} from '@poolmaster/shared/domain';

// The tier layout a sport league's profile names (#1844), and how it places an ordered field:
// fixed-size tiers once the field reaches the last tier, the last taking everyone left or at most
// its cap, and an even spread, larger tiers first, for a field too small or an event whose tier
// count an admin changed.

const SIX_OF_TEN: TierLayoutValues = { tierCount: 6, tierSize: 10, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
const SIX_OF_TEN_CAPPED: TierLayoutValues = { ...SIX_OF_TEN, lastTier: PlatformTierProfileLastTier.CAPPED, lastTierMax: 15 };

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
    expect(findTierLayoutProblem(layout)).toBe(problem);
  });
});

describe('TierLayoutValuesSchema and EventTierConfigSchema', () => {
  it('refuses a layout of no tiers, more than twenty, or tiers of no one', () => {
    expect(TierLayoutValuesSchema.safeParse({ ...SIX_OF_TEN, tierCount: 0 }).success).toBe(false);
    expect(TierLayoutValuesSchema.safeParse({ ...SIX_OF_TEN, tierCount: 21 }).success).toBe(false);
    expect(TierLayoutValuesSchema.safeParse({ ...SIX_OF_TEN, tierSize: 0 }).success).toBe(false);
    expect(TierLayoutValuesSchema.safeParse(SIX_OF_TEN).success).toBe(true);
  });

  it('reads back an event\'s recorded layout with the profile it came from', () => {
    expect(EventTierConfigSchema.parse({ profileName: '6 tiers of 10', ...SIX_OF_TEN_CAPPED })).toEqual({ profileName: '6 tiers of 10', ...SIX_OF_TEN_CAPPED });
  });
});
