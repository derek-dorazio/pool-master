import { canFillBudgetRoster } from '@poolmaster/shared/domain';

describe('canFillBudgetRoster', () => {
  it('fits when the cheapest golfers for every place cost exactly the cap', () => {
    expect(canFillBudgetRoster([9_000, 3_000, 2_000], 2, 5_000)).toBe(true);
  });

  it('refuses when even the cheapest golfers for every place cost more than the cap', () => {
    expect(canFillBudgetRoster([9_000, 3_000, 2_001], 2, 5_000)).toBe(false);
  });

  it('sums cent prices exactly, so three thirds of a dollar cap fit without float drift', () => {
    expect(canFillBudgetRoster([33.34, 33.33, 33.33], 3, 100)).toBe(true);
  });

  it('refuses a roster larger than the priced field, since its places cannot all be filled', () => {
    expect(canFillBudgetRoster([100, 100], 3, 50_000)).toBe(false);
  });
});
