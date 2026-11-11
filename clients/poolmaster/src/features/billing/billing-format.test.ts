import { describe, expect, it } from 'vitest';
import { describeExpansionPrices, describePayments } from './billing-format';

describe('describeExpansionPrices', () => {
  it('lists each band as its entries and price, in the viewer\'s locale', () => {
    const prices = [{ entriesPerContest: 50, priceCents: 1000 }, { entriesPerContest: 1000, priceCents: 3050 }];
    expect(describeExpansionPrices(prices, 'en-US')).toBe('50 entries $10 · 1,000 entries $30.5');
    expect(describeExpansionPrices(prices, 'en-GB')).toBe('50 entries US$10 · 1,000 entries US$30.5');
  });

  it('says None for a plan with no expansion bands', () => {
    expect(describeExpansionPrices([], 'en-US')).toBe('None');
  });
});

describe('describePayments', () => {
  it('says payments are on, or that expanding is free while they are off', () => {
    expect([describePayments({ paymentsEnabled: true }), describePayments({ paymentsEnabled: false })])
      .toEqual(['On', 'Off: expanding a contest is free']);
  });
});
