import { getTieredRosterSize, tieredRosterChoices } from '@poolmaster/shared/domain';

// #479 — the event owns its tiers and the contest owns how many picks each tier takes, so a
// tiered roster is derived, never stored. #2107 — the API hands the form the picks per tier the
// event's tiers allow, each with its roster and default counted scores.
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
    const choices = tieredRosterChoices(Array.from({ length: tierCount }, () => 10));

    expect(getTieredRosterSize(tierCount, picksPerTier)).toBe(roster);
    expect(choices[picksPerTier - 1]).toEqual({ picksPerTier, rosterSize: roster, countedScoresDefault: counted });
  });

  it('never defaults countedScores below 1 when the event has two tiers or fewer', () => {
    expect(tieredRosterChoices([5, 5])[0]).toEqual({ picksPerTier: 1, rosterSize: 2, countedScoresDefault: 1 });
    expect(tieredRosterChoices([5])[0]).toEqual({ picksPerTier: 1, rosterSize: 1, countedScoresDefault: 1 });
  });

  it('gives an event with no tiers a roster of 0', () => {
    expect(getTieredRosterSize(0, 2)).toBe(0);
  });

  it('offers 1 up to the smallest tier\'s size as picks per tier, since no tier can give an entry more than it holds', () => {
    expect(tieredRosterChoices([8, 3, 8]).map((choice) => choice.picksPerTier)).toEqual([1, 2, 3]);
  });

  it('offers no picks per tier while the event has no tiers or one of its tiers is still empty', () => {
    expect(tieredRosterChoices([])).toEqual([]);
    expect(tieredRosterChoices([8, 0, 8])).toEqual([]);
  });
});
