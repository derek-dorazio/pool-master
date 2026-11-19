import { describe, expect, it } from 'vitest';
import type { BillingConfig } from '@/lib/api';
import { describeEntriesIncluded, describeExpansionBands, withPlanPrices } from './plan-price-rows';

const CONFIG: BillingConfig = {
  paymentsEnabled: true,
  planPrices: {
    FREE: { yearlyCents: 0, monthlyCents: 0 },
    PRO: { yearlyCents: 4900, monthlyCents: 499 },
    PREMIUM: { yearlyCents: 9900, monthlyCents: 999 },
    PLATINUM: { yearlyCents: 0, monthlyCents: 0 },
  },
  expansionPrices: {
    FREE: [{ entriesPerContest: 50, priceCents: 1000 }],
    PRO: [],
    PREMIUM: [{ entriesPerContest: 1000, priceCents: 3050 }],
    PLATINUM: [],
  },
};

describe('describeExpansionBands', () => {
  it('lists each band as its entries for its price, in the viewer\'s locale', () => {
    const bands = [{ entriesPerContest: 50, priceCents: 1000 }, { entriesPerContest: 1000, priceCents: 3050 }];
    expect(describeExpansionBands(bands, 'en-US')).toBe('50 for $10 · 1,000 for $30.50');
  });

  it('shows a dash for a plan with no bands', () => {
    expect(describeExpansionBands([], 'en-US')).toBe('—');
  });
});

describe('describeEntriesIncluded', () => {
  it('says Unlimited for a plan with no entry cap and the number otherwise', () => {
    expect([describeEntriesIncluded(null, 'en-US'), describeEntriesIncluded(1000, 'en-US')]).toEqual(['Unlimited', '1,000']);
  });
});

describe('withPlanPrices', () => {
  it('changes only the one plan\'s prices and bands, in whole cents, keeping payments and every other plan as they were', () => {
    const next = withPlanPrices(CONFIG, 'PRO', {
      yearly: 59.99,
      monthly: 5.1,
      bands: [{ entriesPerContest: 100, dollars: 12.34 }],
    });

    expect(next).toEqual({
      ...CONFIG,
      planPrices: { ...CONFIG.planPrices, PRO: { yearlyCents: 5999, monthlyCents: 510 } },
      expansionPrices: { ...CONFIG.expansionPrices, PRO: [{ entriesPerContest: 100, priceCents: 1234 }] },
    });
  });
});
