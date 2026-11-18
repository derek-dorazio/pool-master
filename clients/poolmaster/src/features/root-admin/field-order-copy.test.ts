import { describe, expect, it } from 'vitest';
import { getSportDefinition, Sport } from '@poolmaster/shared/domain';
import { describeFieldOrder } from './field-order-copy';

const { participant } = getSportDefinition(Sport.BASEBALL).vocabulary;

function row(name: string, values: { oddsToWin?: number | null; seedNumber?: number | null; ranking?: number | null; isActive?: boolean } = {}) {
  return { isActive: values.isActive ?? true, oddsToWin: values.oddsToWin ?? null, seedNumber: values.seedNumber ?? null, ranking: values.ranking ?? null, participant: { name } } as Parameters<typeof describeFieldOrder>[0][number];
}

describe('describeFieldOrder — which value auto-assigned tiers and prices order the field by', () => {
  it('says odds when every active team has odds, ignoring a withdrawn team without them', () => {
    expect(describeFieldOrder([row('A', { oddsToWin: 3 }), row('B', { oddsToWin: 5 }), row('Out', { isActive: false })], participant))
      .toBe('Ordered by odds, shortest first.');
  });

  it('says seed, and why, when not every team has odds', () => {
    expect(describeFieldOrder([row('A', { seedNumber: 1, oddsToWin: 3 }), row('B', { seedNumber: 2 })], participant))
      .toBe('Ordered by seed (not every team has odds).');
  });

  it('says rank, and why, when neither odds nor seeds cover the field', () => {
    expect(describeFieldOrder([row('A', { ranking: 1 }), row('B', { ranking: 4 })], participant))
      .toBe('Ordered by rank (not every team has odds or a seed).');
  });

  it('says name when no team has any value, the fallback that keeps auto-assign unblocked', () => {
    expect(describeFieldOrder([row('A'), row('B')], participant))
      .toBe('Ordered by name (no team has odds, a seed or a rank).');
  });

  it('says the partial value, those without it last, when no value covers the field', () => {
    expect(describeFieldOrder([row('A', { oddsToWin: 3 }), row('B')], participant))
      .toBe('Ordered by odds, teams without odds last (no value is set for every team).');
  });
});
