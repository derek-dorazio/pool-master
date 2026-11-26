import { describe, expect, it } from 'vitest';
import { describeFieldOrder } from './field-order-copy';

const ODDS_FIRST = ['ODDS', 'SEED', 'RANKING'] as const;
const SEED_FIRST = ['SEED', 'ODDS', 'RANKING'] as const;

function overview(
  tierOrderBasis: 'ODDS' | 'SEED' | 'RANKING' | null,
  tierOrderCoversField: boolean,
  tierOrderSources: readonly ('ODDS' | 'SEED' | 'RANKING')[] = ODDS_FIRST,
) {
  return { tierOrderBasis, tierOrderCoversField, tierOrderSources: [...tierOrderSources] };
}

describe('describeFieldOrder — the order the server decided for the field, from the league profile\'s sources, in domain words', () => {
  it('says odds when odds, the first source, covers the field', () => {
    expect(describeFieldOrder(overview('ODDS', true), true)).toBe('Ordered by odds, shortest first.');
  });

  it('says seed, and which earlier source was missing, when seed decided after odds', () => {
    expect(describeFieldOrder(overview('SEED', true), true)).toBe('Ordered by seed (not every participant has odds).');
  });

  it('says rank, and both earlier sources, when neither odds nor seeds cover the field', () => {
    expect(describeFieldOrder(overview('RANKING', true), true)).toBe('Ordered by rank (not every participant has odds or a seed).');
  });

  it('says seed with no reason when seed is the profile\'s first source, as on a seed-ranges profile', () => {
    expect(describeFieldOrder(overview('SEED', true, SEED_FIRST), true)).toBe('Ordered by seed.');
  });

  it('names the profile\'s own sources when no participant has any of them, so nothing is assigned', () => {
    expect(describeFieldOrder(overview(null, true, ['SEED', 'RANKING']), true)).toBe('Not ordered: no participant has a seed or a rank, so nothing is assigned.');
  });

  it('says the partial value, those without it last, when no source covers the field', () => {
    expect(describeFieldOrder(overview('ODDS', false), true)).toBe('Ordered by odds, participants without odds last (no value is set for every participant).');
  });

  it('says the event has no active field, whatever the overview says, when nobody is active', () => {
    expect(describeFieldOrder(overview(null, true), false)).toBe('Not ordered: the event has no active field.');
  });
});
