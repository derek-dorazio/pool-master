import { describe, expect, it } from 'vitest';
import { describeFieldOrder } from './field-order-copy';

function row(name: string, values: { oddsToWin?: number | null; seedNumber?: number | null; ranking?: number | null; isActive?: boolean } = {}) {
  return { isActive: values.isActive ?? true, oddsToWin: values.oddsToWin ?? null, seedNumber: values.seedNumber ?? null, ranking: values.ranking ?? null, participant: { name } } as Parameters<typeof describeFieldOrder>[0][number];
}

describe('describeFieldOrder — which value auto-assigned tiers and prices order the field by, in domain words', () => {
  it('says odds when every active participant has odds, ignoring a withdrawn participant without them', () => {
    expect(describeFieldOrder([row('A', { oddsToWin: 3 }), row('B', { oddsToWin: 5 }), row('Out', { isActive: false })]))
      .toBe('Ordered by odds, shortest first.');
  });

  it('says seed, and why, when not every participant has odds', () => {
    expect(describeFieldOrder([row('A', { seedNumber: 1, oddsToWin: 3 }), row('B', { seedNumber: 2 })]))
      .toBe('Ordered by seed (not every participant has odds).');
  });

  it('says rank, and why, when neither odds nor seeds cover the field', () => {
    expect(describeFieldOrder([row('A', { ranking: 1 }), row('B', { ranking: 4 })]))
      .toBe('Ordered by rank (not every participant has odds or a seed).');
  });

  it('says name when no participant has any value, the fallback that keeps auto-assign unblocked', () => {
    expect(describeFieldOrder([row('A'), row('B')]))
      .toBe('Ordered by name (no participant has odds, a seed or a rank).');
  });

  it('says the partial value, those without it last, when no value covers the field', () => {
    expect(describeFieldOrder([row('A', { oddsToWin: 3 }), row('B')]))
      .toBe('Ordered by odds, participants without odds last (no value is set for every participant).');
  });
});
