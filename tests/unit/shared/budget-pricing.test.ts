import { SlotPricingSchema, priceFieldOnBudgetCurve, slotPricingOf } from '@poolmaster/shared/domain';
import { inMemoryStandardPricing } from '../../support/budget-pricing';

describe('priceFieldOnBudgetCurve — a pricing profile\'s budget curve (#93), over a field already in order', () => {
  const standard = inMemoryStandardPricing();
  const field = (size: number) => Array.from({ length: size }, (_, i) => `p-${i + 1}`);

  it('prices a 144-participant field with the Standard profile from $12,000 at the top to $6,000 at the bottom, steepest at the top', () => {
    const prices = priceFieldOnBudgetCurve(standard, field(144)).map((r) => r.price);

    expect([1, 5, 10, 20, 40, 72, 144].map((seed) => prices[seed - 1])).toEqual([12000, 11400, 10600, 9400, 7700, 6400, 6000]);
  });

  it('makes the cap bind: the six dearest participants cost more than the $50,000 cap and the six cheapest less', () => {
    const prices = priceFieldOnBudgetCurve(standard, field(144)).map((r) => r.price);
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

    expect(sum(prices.slice(0, 6))).toBeGreaterThan(standard.salaryCap);
    expect(sum(prices.slice(-6))).toBeLessThan(standard.salaryCap);
  });

  it('rounds every price to the profile\'s unit: whole $10s with the Small profile', () => {
    const small = { ...standard, salaryCap: 5000, unit: 10 };
    const prices = priceFieldOnBudgetCurve(small, field(37)).map((r) => r.price);

    expect(prices.every((price) => price % 10 === 0)).toBe(true);
    expect(prices[0]).toBe(1200);
    expect(prices[prices.length - 1]).toBe(600);
  });

  it('prices participants by their place in the order given, so the last is at the floor however few remain after a withdrawal', () => {
    const result = priceFieldOnBudgetCurve(standard, ['p-1', 'p-2', 'p-9']);

    expect(result.map((r) => r.price)).toEqual([12000, 6400, 6000]);
  });

  it('prices a straight line with steepness 1', () => {
    const prices = priceFieldOnBudgetCurve({ ...standard, steepness: 1 }, field(3)).map((r) => r.price);

    expect(prices).toEqual([12000, 9000, 6000]);
  });

  it('prices a field of one participant at the top share', () => {
    expect(priceFieldOnBudgetCurve(standard, ['p-1'])).toEqual([{ id: 'p-1', price: 12000 }]);
  });

  it('returns an empty array for an empty field', () => {
    expect(priceFieldOnBudgetCurve(standard, [])).toEqual([]);
  });
});

describe('A slot\'s recorded pricing names the profile its values started from by id', () => {
  const PROFILE_ID = '00000000-0000-4000-8000-0000000000b1';
  const values = { salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

  it('records a profile\'s values with the profile\'s id, not its name', () => {
    const now = new Date();
    const profile = { id: PROFILE_ID, code: 'STANDARD', name: 'Standard', description: 'The usual curve.', sources: [], createdAt: now, updatedAt: now, ...values };

    expect(slotPricingOf(profile)).toEqual({ platformPricingProfileId: PROFILE_ID, ...values });
  });

  it('refuses recorded pricing that names its profile by name rather than id', () => {
    expect(SlotPricingSchema.safeParse({ profileName: 'Standard', ...values }).success).toBe(false);
  });
});
