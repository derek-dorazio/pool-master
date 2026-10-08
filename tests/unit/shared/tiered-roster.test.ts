import { getDefaultCountedScores, getTieredRosterSize } from '@poolmaster/shared/domain';

// #479 — the event owns its tiers and the contest owns how many picks each tier takes, so a
// tiered roster is derived, never stored.
describe('tiered roster arithmetic', () => {
  it.each([
    { tierCount: 6, picksPerTier: 1, roster: 6, counted: 4 },
    { tierCount: 6, picksPerTier: 2, roster: 12, counted: 8 },
    { tierCount: 3, picksPerTier: 2, roster: 6, counted: 2 },
  ])('derives a roster of $roster counting $counted from $tierCount tiers × $picksPerTier pick(s) per tier', ({
    tierCount,
    picksPerTier,
    roster,
    counted,
  }) => {
    expect(getTieredRosterSize(tierCount, picksPerTier)).toBe(roster);
    expect(getDefaultCountedScores(tierCount, picksPerTier)).toBe(counted);
  });

  it('never defaults countedScores below 1 or above the roster when the event has two tiers or fewer', () => {
    expect(getTieredRosterSize(2, 1)).toBe(2);
    expect(getDefaultCountedScores(2, 1)).toBe(1);
    expect(getTieredRosterSize(1, 1)).toBe(1);
    expect(getDefaultCountedScores(1, 1)).toBe(1);
  });

  it('gives an event with no tiers a roster of 0, and a default countedScores no larger than that roster', () => {
    expect(getTieredRosterSize(0, 2)).toBe(0);
    expect(getDefaultCountedScores(0, 2)).toBe(0);
  });
});
